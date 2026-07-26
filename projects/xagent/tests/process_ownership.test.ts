import assert from "node:assert/strict";
import {
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { ProcessJsonlSession } from "../src/adapters/process_jsonl.js";
import type {
  AdapterEvent,
  HarnessAdapter,
  HarnessSession,
} from "../src/adapters/types.js";
import {
  createRunRecord,
  updateRunExitStatus,
  updateRunSupervision,
} from "../src/logs.js";
import {
  platformProcessInspector,
  type ProcessInspection,
  type ProcessInspector,
} from "../src/supervision/process_identity.js";
import { reconcileStaleRuns } from "../src/supervision/reconcile.js";
import { Supervisor } from "../src/supervision/supervisor.js";
import type { SupervisionPersistenceState } from "../src/supervision/types.js";

const turnContext = {
  text: "wait",
  turnId: "turn_1",
  inputSequence: 1,
} as const;

const fixtureChildren = new Set<ChildProcess>();

test.afterEach(async () => {
  for (const child of fixtureChildren) {
    stopChild(child);
  }
  await waitUntil(
    () => [...fixtureChildren].every((child) => !isProcessAlive(child.pid)),
  );
  fixtureChildren.clear();
});

test("process session owns a detached process group and interrupts only its active turn", async () => {
  const sentinel = spawnLongLivedChild();
  const session = createLongLivedSession();
  const turn = drainTurn(session.submit(turnContext));

  try {
    await waitUntil(() => session.processIdentity !== undefined);
    const identity = session.processIdentity;
    assert.ok(identity);
    assert.ok(identity.pid > 0);
    assert.equal(identity.process_group_id, process.platform === "win32" ? undefined : identity.pid);
    assert.notEqual(identity.started_at, "");
    assert.notEqual(identity.start_identity, "");

    const inspected = await platformProcessInspector.inspect(identity.pid);
    assert.equal(inspected?.start_identity, identity.start_identity);
    assert.equal(isProcessAlive(sentinel.pid), true);

    await session.interrupt();
    await turn;
    await waitUntil(() => !isProcessAlive(identity.pid));

    assert.equal(session.processIdentity, undefined);
    assert.equal(isProcessAlive(sentinel.pid), true);
  } finally {
    await session.close();
    stopChild(sentinel);
  }
});

test("process session close is idempotent, terminates the active group, and prevents new turns", async () => {
  const session = createLongLivedSession();
  const turn = drainTurn(session.submit(turnContext));
  await waitUntil(() => session.processIdentity !== undefined);
  const pid = session.processIdentity?.pid;
  assert.ok(pid);

  await Promise.all([session.close(), session.close(), session.close()]);
  await turn;
  await waitUntil(() => !isProcessAlive(pid));

  assert.throws(
    () => session.submit({ ...turnContext, turnId: "turn_2", inputSequence: 2 }),
    /closed/i,
  );
});

test("process session cleans up a spawned child when ownership inspection fails", async () => {
  let spawned: ChildProcessWithoutNullStreams | undefined;
  const session = new ProcessJsonlSession({
    harness: "codex",
    cwd: process.cwd(),
    buildCommand: () => ({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
    }),
    parseEvent: (): AdapterEvent[] => [],
    spawnProcess: (command, args, childOptions) => {
      spawned = trackChild(spawn(command, [...args], childOptions));
      return spawned;
    },
    captureProcessIdentity: () => {
      throw Object.assign(new Error("inspection denied"), { code: "EPERM" });
    },
  });

  assert.throws(() => session.submit(turnContext), /inspection denied/);
  assert.ok(spawned?.pid);
  await waitUntil(() => !isProcessAlive(spawned?.pid));
});

test("supervisor persists the active process identity before silent provider output", async () => {
  const session = createLongLivedSession({ emitReady: false });
  const adapter: HarnessAdapter = {
    harness: "codex",
    capabilities: {
      forwardsModel: true,
      forwardsThinkingLevel: true,
      streamsDeltas: true,
    },
    async start(): Promise<HarnessSession> {
      return session;
    },
  };
  const persisted: SupervisionPersistenceState[] = [];
  const supervisor = new Supervisor({
    runId: "xrun_owned_process",
    adapter,
    startOptions: { cwd: process.cwd() },
    policy: { silenceTimeoutMs: 60_000, watchdog: {} },
    metadataSink: async (state) => {
      persisted.push(structuredClone(state));
    },
  });

  await supervisor.start();
  const turn = supervisor.submit("stay silent");
  try {
    await waitUntil(() =>
      persisted.some((state) =>
        state.phase === "running"
        && state.owned_process !== undefined
        && state.owned_process.pid === session.processIdentity?.pid));

    const active = [...persisted].reverse().find((state) => state.owned_process !== undefined);
    assert.deepEqual(active?.owned_process, session.processIdentity);
  } finally {
    await supervisor.close();
    await turn;
  }
});

test("supervisor interruption ends only the active turn and keeps the session ready", async () => {
  const session = createLongLivedSession();
  const adapter: HarnessAdapter = {
    harness: "codex",
    capabilities: {
      forwardsModel: true,
      forwardsThinkingLevel: true,
      streamsDeltas: true,
    },
    async start(): Promise<HarnessSession> {
      return session;
    },
  };
  const supervisor = new Supervisor({
    runId: "xrun_interrupted_turn",
    adapter,
    startOptions: { cwd: process.cwd() },
    policy: { silenceTimeoutMs: 60_000, watchdog: {} },
  });

  await supervisor.start();
  const firstTurn = supervisor.submit("first");
  await waitUntil(() => session.processIdentity !== undefined);
  const firstPid = session.processIdentity?.pid;
  assert.ok(firstPid);

  await supervisor.interrupt();
  await firstTurn;
  assert.equal(supervisor.inspect().phase, "ready");
  assert.equal(session.processIdentity, undefined);

  const secondTurn = supervisor.submit("second");
  await waitUntil(() =>
    session.processIdentity !== undefined
    && session.processIdentity.pid !== firstPid);
  await supervisor.close();
  await secondTurn;
});

test("reconciliation terminates only a matching owned process group and records abandonment first", async () => {
  const fixture = await createActiveRunFixture("matching");
  const signalledGroups: number[] = [];
  const inspector = fakeInspector(
    {
      pid: 4101,
      process_group_id: 5101,
      start_identity: "process-start-a",
    },
    signalledGroups,
  );

  const result = await reconcileStaleRuns(fixture.logRoot, inspector);

  assert.deepEqual(signalledGroups, [5101]);
  assert.deepEqual(result, [{
    run_id: fixture.runId,
    cleanup: "terminated",
  }]);
  const metadata = JSON.parse(await readFile(fixture.record.metadataPath, "utf8"));
  assert.equal(metadata.supervision.phase, "abandoned");
  assert.equal(metadata.exit_status, "failed");
  assert.deepEqual(
    (await readJsonLines(fixture.record.normalizedLogPath)).map((event) => [
      event.type,
      event.reason,
    ]),
    [
      ["supervision.state", "stale_run_abandoned"],
      ["supervision.attention", "stale_run_abandoned"],
      ["supervision.state", "stale_process_terminated"],
    ],
  );
});

test("reconciliation never signals a PID whose process-start identity mismatches", async () => {
  const fixture = await createActiveRunFixture("mismatch");
  const signalledGroups: number[] = [];
  const inspector = fakeInspector(
    {
      pid: 4101,
      process_group_id: 5101,
      start_identity: "different-process-start",
    },
    signalledGroups,
  );

  const result = await reconcileStaleRuns(fixture.logRoot, inspector);

  assert.deepEqual(signalledGroups, []);
  assert.deepEqual(result, [{
    run_id: fixture.runId,
    cleanup: "identity_mismatch",
  }]);
  const metadata = JSON.parse(await readFile(fixture.record.metadataPath, "utf8"));
  assert.equal(metadata.supervision.phase, "abandoned");
  assert.equal(metadata.exit_status, "failed");
  const events = await readJsonLines(fixture.record.normalizedLogPath);
  assert.equal(events[1]?.type, "supervision.attention");
  assert.equal(events[2]?.reason, "stale_process_identity_mismatch");
});

test("reconciliation leaves terminal runs and their logs unchanged", async () => {
  const fixture = await createActiveRunFixture("terminal");
  await updateRunSupervision(fixture.record, {
    ...fixture.record.supervision,
    phase: "completed",
    sequence: 7,
    owned_process: fixture.record.owned_process,
  });
  await updateRunExitStatus(fixture.record, "completed");
  const metadataBefore = await readFile(fixture.record.metadataPath, "utf8");
  const logBefore = await readFile(fixture.record.normalizedLogPath, "utf8");
  const signalledGroups: number[] = [];

  const result = await reconcileStaleRuns(
    fixture.logRoot,
    fakeInspector({
      pid: 4101,
      process_group_id: 5101,
      start_identity: "process-start-a",
    }, signalledGroups),
  );

  assert.deepEqual(result, []);
  assert.deepEqual(signalledGroups, []);
  assert.equal(await readFile(fixture.record.metadataPath, "utf8"), metadataBefore);
  assert.equal(await readFile(fixture.record.normalizedLogPath, "utf8"), logBefore);
});

function createLongLivedSession(
  options: { readonly emitReady?: boolean } = {},
): ProcessJsonlSession {
  const emitReady = options.emitReady ?? true;
  return new ProcessJsonlSession({
    harness: "codex",
    cwd: process.cwd(),
    buildCommand: () => ({
      command: process.execPath,
      args: [
        "-e",
        [
          ...(emitReady
            ? ["console.log(JSON.stringify({ type: 'ready' }))"]
            : []),
          "setInterval(() => {}, 1000)",
        ].join(";"),
      ],
    }),
    parseEvent: (_raw): AdapterEvent[] => [],
    spawnProcess: (command, args, childOptions) =>
      trackChild(spawn(command, [...args], childOptions)),
  });
}

function spawnLongLivedChild(): ChildProcess {
  return trackChild(spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  }));
}

async function drainTurn(events: AsyncIterable<AdapterEvent>): Promise<void> {
  try {
    for await (const _event of events) {
      // Drain provider output so the child can exit cleanly.
    }
  } catch (error) {
    if (
      !(error instanceof Error)
      || !("code" in error)
      || error.code !== "harness_process_interrupted"
    ) {
      throw error;
    }
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`Condition was not met within ${timeoutMs} ms.`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

function isProcessAlive(pid: number | undefined): boolean {
  if (pid === undefined) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error
      && "code" in error
      && error.code === "EPERM";
  }
}

function stopChild(child: ChildProcess): void {
  if (child.pid !== undefined && isProcessAlive(child.pid)) {
    child.kill("SIGTERM");
  }
}

function trackChild<T extends ChildProcess>(child: T): T {
  fixtureChildren.add(child);
  child.once("close", () => {
    fixtureChildren.delete(child);
  });
  return child;
}

async function createActiveRunFixture(suffix: string) {
  const repoRoot = await mkdtemp(path.join(tmpdir(), `xagent-reconcile-${suffix}-`));
  const logRoot = path.join(repoRoot, "xagent");
  const runId = `xrun_reconcile_${suffix}`;
  const record = await createRunRecord({
    repoRoot,
    logRoot,
    runId,
    harness: "codex",
    mode: "subagent",
    clock: () => new Date("2026-07-25T12:00:00.000Z"),
  });
  await updateRunSupervision(record, {
    phase: "running",
    sequence: 3,
    provider_thread_id: "provider-thread",
    last_transport_progress_at: "2026-07-25T12:01:00.000Z",
    last_semantic_progress_at: "2026-07-25T12:00:30.000Z",
    owned_process: {
      pid: 4101,
      process_group_id: 5101,
      started_at: "2026-07-25T11:59:59.000Z",
      start_identity: "process-start-a",
    },
  });
  return { repoRoot, logRoot, runId, record };
}

function fakeInspector(
  inspection: ProcessInspection | undefined,
  signalledGroups: number[],
): ProcessInspector {
  return {
    async inspect(): Promise<ProcessInspection | undefined> {
      return inspection;
    },
    async terminateProcessGroup(processGroupId: number): Promise<void> {
      signalledGroups.push(processGroupId);
    },
  };
}

async function readJsonLines(filePath: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(filePath, "utf8");
  return text.trim() === ""
    ? []
    : text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}
