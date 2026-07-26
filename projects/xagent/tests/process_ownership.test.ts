import assert from "node:assert/strict";
import {
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
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

test("ending provider iteration early terminates only that turn's owned process group", async () => {
  const sentinel = spawnLongLivedChild();
  const session = createLongLivedSession();
  const events = session.submit(turnContext);
  const identity = session.processIdentity;
  assert.ok(identity);

  try {
    for await (const _event of events) {
      break;
    }
    await waitUntil(() => !isProcessAlive(identity.pid), 1_000);

    assert.equal(session.processIdentity, undefined);
    assert.equal(isProcessAlive(sentinel.pid), true);
    await Promise.all([session.close(), session.close()]);
  } finally {
    await session.close();
    stopChild(sentinel);
  }
});

test("ending a failed provider turn escalates when the process ignores SIGTERM", async () => {
  const sentinel = spawnLongLivedChild();
  const fixture = createSigtermIgnoringSession("failed");
  const adapter: HarnessAdapter = {
    harness: "codex",
    capabilities: {
      forwardsModel: true,
      forwardsThinkingLevel: true,
      streamsDeltas: true,
    },
    async start(): Promise<HarnessSession> {
      return fixture.session;
    },
  };
  const supervisor = new Supervisor({
    runId: "xrun_sigterm_ignoring_failure",
    adapter,
    startOptions: { cwd: process.cwd() },
    policy: { silenceTimeoutMs: 60_000, watchdog: {} },
  });
  let turn: Promise<void> | undefined;

  await supervisor.start();
  try {
    turn = supervisor.submit("fail without exiting");
    await within(turn, 1_000, "failed provider cleanup did not escalate");

    assert.equal(supervisor.inspect().phase, "failed");
    assert.ok(fixture.child()?.pid);
    assert.equal(isProcessAlive(fixture.child()?.pid), false);
    assert.equal(isProcessAlive(sentinel.pid), true);
  } finally {
    forceStopChild(fixture.child());
    stopChild(sentinel);
    await turn?.catch(() => {});
    await supervisor.close().catch(() => {});
  }
});

test("session close escalates and remains idempotent when the process ignores SIGTERM", async () => {
  const sentinel = spawnLongLivedChild();
  const fixture = createSigtermIgnoringSession("ready");
  const turn = drainTurn(fixture.session.submit(turnContext));

  try {
    await fixture.providerReady;
    const pid = fixture.child()?.pid;
    assert.ok(pid);

    await within(
      Promise.all([
        fixture.session.close(),
        fixture.session.close(),
        fixture.session.close(),
      ]),
      1_000,
      "session close did not escalate",
    );
    await turn;

    assert.equal(isProcessAlive(pid), false);
    assert.equal(isProcessAlive(sentinel.pid), true);
  } finally {
    forceStopChild(fixture.child());
    stopChild(sentinel);
    await fixture.session.close().catch(() => {});
    await turn.catch(() => {});
  }
});

test("returning an unconsumed primed iterator cannot wait forever on its pending next", async () => {
  const fixture = createSigtermIgnoringSession("silent");
  const events = fixture.session.submit(turnContext);
  const iterator = events[Symbol.asyncIterator]();

  try {
    await fixture.providerReady;
    const pid = fixture.child()?.pid;
    assert.ok(pid);
    assert.ok(iterator.return);

    await within(
      iterator.return(),
      1_000,
      "primed iterator return did not interrupt its provider",
    );

    assert.equal(isProcessAlive(pid), false);
    assert.equal(fixture.session.processIdentity, undefined);
  } finally {
    forceStopChild(fixture.child());
    await fixture.session.close().catch(() => {});
  }
});

// C1 regression: ProcessJsonlSession writes `command.input` to the
// child's stdin and then SIGTERM/SIGKILLs the child when the turn is
// interrupted. If the child is killed while the stdin write is still
// buffered, Node emits `error` on the Socket — not on the ChildProcess —
// and an unhandled stream error would crash the entire xagent service.
// This test proves the stdin error guard swallows the EPIPE and the
// session still resolves the turn with a proper interrupted outcome.
//
test("interrupting a turn with buffered stdin does not crash the session via EPIPE", async () => {
  const session = new ProcessJsonlSession({
    harness: "codex",
    cwd: process.cwd(),
    buildCommand: () => ({
      command: process.execPath,
      // Child never reads stdin and never exits on its own, so the 64 KiB
      // stdin write stays buffered until SIGTERM/SIGKILL lands mid-write.
      //
      args: ["-e", "setInterval(() => {}, 1000)"],
      input: "x".repeat(64 * 1024),
    }),
    parseEvent: (): AdapterEvent[] => [],
    spawnProcess: (command, args, childOptions) =>
      trackChild(spawn(command, [...args], childOptions)),
    terminationGraceMs: 25,
  });
  const turn = drainTurn(session.submit(turnContext));

  await waitUntil(() => session.processIdentity !== undefined);
  const pid = session.processIdentity?.pid;
  assert.ok(pid);

  await within(session.close(), 1_000, "session close did not settle");
  await turn;

  await waitUntil(() => !isProcessAlive(pid), 1_000);
  assert.equal(isProcessAlive(pid), false);
});

test("session close is bounded when no exit event arrives after SIGKILL", async () => {
  const child = createNonClosingChild();
  const session = new ProcessJsonlSession({
    harness: "codex",
    cwd: process.cwd(),
    buildCommand: () => ({
      command: "non-closing-provider",
      args: [],
    }),
    parseEvent: (): AdapterEvent[] => [],
    spawnProcess: () => child,
    captureProcessIdentity: (pid) => ({
      pid,
      process_group_id: process.platform === "win32" ? undefined : pid,
      started_at: "2026-07-25T12:00:00.000Z",
      start_identity: "non-closing-provider",
    }),
    terminationGraceMs: 10,
  });
  const iterator = session.submit(turnContext)[Symbol.asyncIterator]();

  try {
    await assert.rejects(
      within(
        session.close(),
        250,
        "session close exceeded its final cleanup bound",
      ),
      (error: unknown) =>
        error instanceof Error
        && "code" in error
        && error.code === "harness_process_cleanup_timeout",
    );
  } finally {
    child.stdout.end();
    child.emit("close", null, "SIGKILL");
    await iterator.next().catch(() => {});
  }
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

test("platform process inspection reports an exited PID as not found", async () => {
  const child = trackChild(spawn(process.execPath, ["-e", ""], {
    stdio: "ignore",
  }));
  const pid = child.pid;
  assert.ok(pid);
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", () => resolve());
  });

  assert.equal(await platformProcessInspector.inspect(pid), undefined);
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

test("supervisor observes child exit while active ownership persistence is delayed", async () => {
  const session = new ProcessJsonlSession({
    harness: "codex",
    cwd: process.cwd(),
    buildCommand: () => ({
      command: process.execPath,
      args: ["-e", "process.exit(2)"],
    }),
    parseEvent: (): AdapterEvent[] => [],
    spawnProcess: (command, args, childOptions) =>
      trackChild(spawn(command, [...args], childOptions)),
  });
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
    runId: "xrun_fast_exit",
    adapter,
    startOptions: { cwd: process.cwd() },
    policy: { silenceTimeoutMs: 60_000, watchdog: {} },
    metadataSink: async (state) => {
      if (state.phase === "running" && state.owned_process !== undefined) {
        await new Promise<void>((resolve) => setTimeout(resolve, 60));
      }
      persisted.push(structuredClone(state));
    },
  });

  await supervisor.start();
  const cursor = supervisor.inspect().sequence;
  const turn = supervisor.submit("exit immediately");
  try {
    const failure = await within(
      supervisor.awaitEvent(cursor, 1_000),
      1_000,
      "provider exit was not observed",
    );
    await within(turn, 1_000, "provider turn did not settle after exit");
    assert.equal(supervisor.inspect().phase, "failed");
    assert.equal(failure.reason, "process_exit");
    assert.deepEqual(failure.payload, { exit_code: 2, signal: null });
    assert.equal(
      persisted.find((state) => state.phase === "failed")?.owned_process,
      undefined,
    );
  } finally {
    await supervisor.close();
    void turn.catch(() => {});
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

test("terminal provider failure reaps ownership before persistence and terminal close closes the session", async () => {
  const sentinel = spawnLongLivedChild();
  let providerChild: ChildProcessWithoutNullStreams | undefined;
  const session = new ProcessJsonlSession({
    harness: "codex",
    cwd: process.cwd(),
    buildCommand: () => ({
      command: process.execPath,
      args: [
        "-e",
        [
          "console.log(JSON.stringify({ type: 'failed' }))",
          "setInterval(() => {}, 1000)",
        ].join(";"),
      ],
    }),
    parseEvent: (raw): AdapterEvent[] =>
      isRecord(raw) && raw.type === "failed"
        ? [{
            type: "turn.failed",
            code: "provider_failed",
            message: "provider reported failure",
          }]
        : [],
    spawnProcess: (command, args, childOptions) => {
      providerChild = trackChild(spawn(command, [...args], childOptions));
      return providerChild;
    },
  });
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
    runId: "xrun_terminal_provider_failure",
    adapter,
    startOptions: { cwd: process.cwd() },
    policy: { silenceTimeoutMs: 60_000, watchdog: {} },
    metadataSink: async (state) => {
      persisted.push(structuredClone(state));
    },
  });

  await supervisor.start();
  try {
    await supervisor.submit("fail");
    assert.equal(supervisor.inspect().phase, "failed");
    assert.equal(
      persisted.find((state) => state.phase === "failed")?.owned_process,
      undefined,
    );
    assert.ok(providerChild?.pid);
    await waitUntil(() => !isProcessAlive(providerChild?.pid), 1_000);
    assert.equal(isProcessAlive(sentinel.pid), true);

    await Promise.all([supervisor.close(), supervisor.close(), supervisor.close()]);
    let acceptedPostCloseTurn = false;
    try {
      session.submit({ ...turnContext, turnId: "turn_2", inputSequence: 2 });
      acceptedPostCloseTurn = true;
    } catch (error) {
      assert.match(String(error), /closed/i);
    }
    if (acceptedPostCloseTurn) {
      await session.close();
    }
    assert.equal(acceptedPostCloseTurn, false);
  } finally {
    await supervisor.close();
    await session.close();
    stopChild(sentinel);
  }
});

test("ownership persistence failure closes a primed provider turn before terminal state", async () => {
  const ownershipFailure = new Error("ownership metadata failed");
  let providerChild: ChildProcessWithoutNullStreams | undefined;
  const session = new ProcessJsonlSession({
    harness: "codex",
    cwd: process.cwd(),
    buildCommand: () => ({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
    }),
    parseEvent: (): AdapterEvent[] => [],
    spawnProcess: (command, args, childOptions) => {
      providerChild = trackChild(spawn(command, [...args], childOptions));
      return providerChild;
    },
  });
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
    runId: "xrun_ownership_persistence_failure",
    adapter,
    startOptions: { cwd: process.cwd() },
    policy: { silenceTimeoutMs: 60_000, watchdog: {} },
    metadataSink: async (state) => {
      if (state.phase === "running" && state.owned_process !== undefined) {
        throw ownershipFailure;
      }
      persisted.push(structuredClone(state));
    },
  });

  await supervisor.start();
  try {
    await supervisor.submit("stay alive");
    assert.equal(supervisor.inspect().phase, "failed");
    assert.equal(
      persisted.find((state) => state.phase === "failed")?.owned_process,
      undefined,
    );
    assert.ok(providerChild?.pid);
    await waitUntil(() => !isProcessAlive(providerChild?.pid), 1_000);
  } finally {
    await supervisor.close();
    await session.close();
  }
});

test("reconciliation skips runs owned by the live manager (I-1 race regression)", async () => {
  // Reproduces the I-1 race: after C1 moved reconciliation to run after
  // `listen()` resolved, a run created in the listen→reconcile window
  // would be enumerated from the log root, classified as stale, marked
  // `abandoned`, and have its (matching) owned provider process group
  // SIGTERMed — silently destroying in-flight work owned by this very
  // service instance. The live manager's `listRunIds()` is passed to
  // `reconcileStaleRuns` so those runs are skipped.
  //
  const fixture = await createActiveRunFixture("live_owned");
  const signalledGroups: number[] = [];
  const inspector = fakeInspector(
    {
      pid: 4101,
      process_group_id: 5101,
      start_identity: "process-start-a",
    },
    signalledGroups,
  );
  const metadataBefore = await readFile(fixture.record.metadataPath, "utf8");
  const logBefore = await readFile(fixture.record.normalizedLogPath, "utf8");

  // With the live manager owning this run, reconciliation must skip it.
  //
  const skipped = await reconcileStaleRuns(
    fixture.logRoot,
    inspector,
    new Set([fixture.runId]),
  );

  assert.deepEqual(skipped, []);
  assert.deepEqual(signalledGroups, []);
  assert.equal(await readFile(fixture.record.metadataPath, "utf8"), metadataBefore);
  assert.equal(await readFile(fixture.record.normalizedLogPath, "utf8"), logBefore);

  // Without the liveRunIds guard, the same run WOULD be abandoned —
  // proving the skip (not some other condition) is what protects it.
  //
  const notSkipped = await reconcileStaleRuns(fixture.logRoot, inspector);
  assert.deepEqual(notSkipped, [{
    run_id: fixture.runId,
    cleanup: "terminated",
  }]);
  assert.deepEqual(signalledGroups, [5101]);
  const metadataAfter = JSON.parse(await readFile(fixture.record.metadataPath, "utf8"));
  assert.equal(metadataAfter.supervision.phase, "abandoned");
  assert.equal(metadataAfter.exit_status, "failed");
});

test("reconciliation does not abandon a completed legacy run (I-2 regression)", async () => {
  // Reproduces the I-2 bug: the legacy `xagent run` runtime only calls
  // `updateRunExitStatus` and never advances `supervision.phase`, so a
  // successful interactive run persisted `phase: "starting"` alongside
  // `exit_status: "completed"`. The next service start enumerated it
  // as stale and rewrote it to `abandoned`/`failed` with fabricated
  // `stale_run_abandoned` attention events. The fix advances the
  // supervision phase to a terminal value inside `updateRunExitStatus`,
  // so list/reconcile stay consistent for both supervised and legacy
  // paths.
  //
  const fixture = await createActiveRunFixture("legacy_completed");
  // Simulate the legacy runtime's terminal update: a successful
  // interactive run that calls only `updateRunExitStatus("completed")`.
  //
  await updateRunExitStatus(fixture.record, "completed");

  const metadataAfterExit = JSON.parse(await readFile(fixture.record.metadataPath, "utf8"));
  assert.equal(metadataAfterExit.exit_status, "completed");
  assert.equal(
    metadataAfterExit.supervision.phase,
    "completed",
    "updateRunExitStatus must advance supervision.phase to a terminal value matching the exit status",
  );

  // Reconciliation must NOT enumerate a `completed` run as stale.
  //
  const signalledGroups: number[] = [];
  const result = await reconcileStaleRuns(
    fixture.logRoot,
    fakeInspector(
      {
        pid: 4101,
        process_group_id: 5101,
        start_identity: "process-start-a",
      },
      signalledGroups,
    ),
  );

  assert.deepEqual(result, []);
  assert.deepEqual(signalledGroups, []);
  const metadataAfterReconcile = JSON.parse(await readFile(fixture.record.metadataPath, "utf8"));
  assert.equal(metadataAfterReconcile.supervision.phase, "completed");
  assert.equal(metadataAfterReconcile.exit_status, "completed");
  // No fabricated `stale_run_abandoned` attention events in the log.
  //
  const events = await readJsonLines(fixture.record.normalizedLogPath);
  assert.equal(
    events.some((event) => event.reason === "stale_run_abandoned"),
    false,
    "a completed legacy run must not be abandoned on reconcile",
  );
});

test("updateRunExitStatus does not overwrite a more specific terminal phase already published", async () => {
  // A supervised run that already published `cancelled` or `abandoned`
  // through the supervisor's metadataSink must not have its phase
  // rewritten by a later `updateRunExitStatus("failed")` call (e.g. a
  // crash-handler close path). Only non-terminal phases are advanced.
  //
  const fixture = await createActiveRunFixture("already_terminal");
  await updateRunSupervision(fixture.record, {
    ...fixture.record.supervision,
    phase: "cancelled",
    sequence: 9,
    owned_process: fixture.record.owned_process,
  });
  await updateRunExitStatus(fixture.record, "failed");

  const metadata = JSON.parse(await readFile(fixture.record.metadataPath, "utf8"));
  assert.equal(metadata.exit_status, "failed");
  assert.equal(metadata.supervision.phase, "cancelled");
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

test("reconciliation skips stray and corrupt entries while cleaning valid stale runs", async () => {
  const fixture = await createActiveRunFixture("with_strays");
  await writeFile(path.join(fixture.logRoot, ".DS_Store"), "finder metadata");
  const corruptDir = path.join(fixture.logRoot, "xrun_corrupt");
  await mkdir(corruptDir);
  await writeFile(path.join(corruptDir, "metadata.json"), "{not json");
  const malformedDir = path.join(fixture.logRoot, "xrun_malformed");
  await mkdir(malformedDir);
  await writeFile(
    path.join(malformedDir, "metadata.json"),
    `${JSON.stringify({ run_id: "xrun_malformed" })}\n`,
  );
  const signalledGroups: number[] = [];

  const result = await reconcileStaleRuns(
    fixture.logRoot,
    fakeInspector({
      pid: 4101,
      process_group_id: 5101,
      start_identity: "process-start-a",
    }, signalledGroups),
  );

  assert.deepEqual(result, [{
    run_id: fixture.runId,
    cleanup: "terminated",
  }]);
  assert.deepEqual(signalledGroups, [5101]);
  const metadata = JSON.parse(await readFile(fixture.record.metadataPath, "utf8"));
  assert.equal(metadata.supervision.phase, "abandoned");
});

test("reconciliation contains an invalid run id and continues with later stale runs", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-reconcile-invalid-open-"));
  const logRoot = path.join(repoRoot, "xagent");
  const invalid = await createActiveRunIn(
    repoRoot,
    logRoot,
    "invalid_open",
    "2026-07-25T12:02:00.000Z",
    { pid: 4201, processGroupId: 5201, startIdentity: "invalid-open-start" },
  );
  const valid = await createActiveRunIn(
    repoRoot,
    logRoot,
    "after_invalid_open",
    "2026-07-25T12:01:00.000Z",
    { pid: 4202, processGroupId: 5202, startIdentity: "valid-after-open-start" },
  );
  const invalidMetadata = JSON.parse(
    await readFile(invalid.record.metadataPath, "utf8"),
  ) as Record<string, unknown>;
  invalidMetadata.run_id = "../invalid";
  await writeFile(
    invalid.record.metadataPath,
    `${JSON.stringify(invalidMetadata, null, 2)}\n`,
  );
  const signalledGroups: number[] = [];

  const result = await reconcileStaleRuns(
    logRoot,
    mappedInspector([
      { pid: 4201, process_group_id: 5201, start_identity: "invalid-open-start" },
      { pid: 4202, process_group_id: 5202, start_identity: "valid-after-open-start" },
    ], signalledGroups),
  );

  assert.deepEqual(result, [
    { run_id: "../invalid", cleanup: "persistence_failed" },
    { run_id: valid.runId, cleanup: "terminated" },
  ]);
  assert.deepEqual(signalledGroups, [5202]);
  assert.equal(
    JSON.parse(await readFile(invalid.record.metadataPath, "utf8")).supervision.phase,
    "running",
  );
  assert.equal(
    JSON.parse(await readFile(valid.record.metadataPath, "utf8")).supervision.phase,
    "abandoned",
  );
});

test("reconciliation contains persistence failure without signalling and continues", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-reconcile-persist-"));
  const logRoot = path.join(repoRoot, "xagent");
  const failing = await createActiveRunIn(
    repoRoot,
    logRoot,
    "persistence_failure",
    "2026-07-25T12:02:00.000Z",
    { pid: 4301, processGroupId: 5301, startIdentity: "persistence-failure-start" },
  );
  const valid = await createActiveRunIn(
    repoRoot,
    logRoot,
    "after_persistence_failure",
    "2026-07-25T12:01:00.000Z",
    { pid: 4302, processGroupId: 5302, startIdentity: "valid-after-persist-start" },
  );
  await rm(failing.record.normalizedLogPath);
  await mkdir(failing.record.normalizedLogPath);
  const signalledGroups: number[] = [];

  const result = await reconcileStaleRuns(
    logRoot,
    mappedInspector([
      { pid: 4301, process_group_id: 5301, start_identity: "persistence-failure-start" },
      { pid: 4302, process_group_id: 5302, start_identity: "valid-after-persist-start" },
    ], signalledGroups),
  );

  assert.deepEqual(result, [
    { run_id: failing.runId, cleanup: "persistence_failed" },
    { run_id: valid.runId, cleanup: "terminated" },
  ]);
  assert.deepEqual(signalledGroups, [5302]);
  assert.equal(
    JSON.parse(await readFile(failing.record.metadataPath, "utf8")).supervision.phase,
    "running",
  );
  assert.equal(
    JSON.parse(await readFile(valid.record.metadataPath, "utf8")).supervision.phase,
    "abandoned",
  );
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

function createSigtermIgnoringSession(
  mode: "failed" | "ready" | "silent",
): {
  readonly session: ProcessJsonlSession;
  readonly providerReady: Promise<void>;
  readonly child: () => ChildProcessWithoutNullStreams | undefined;
} {
  let child: ChildProcessWithoutNullStreams | undefined;
  let markProviderReady: (() => void) | undefined;
  const providerReady = new Promise<void>((resolve) => {
    markProviderReady = resolve;
  });
  const commandLines = [
    "process.on('SIGTERM', () => {})",
    "process.stderr.write('provider-ready\\n')",
    ...(mode === "failed"
      ? ["console.log(JSON.stringify({ type: 'failed' }))"]
      : mode === "ready"
        ? ["console.log(JSON.stringify({ type: 'ready' }))"]
        : []),
    "setInterval(() => {}, 1000)",
  ];
  const options = {
    harness: "codex" as const,
    cwd: process.cwd(),
    buildCommand: () => ({
      command: process.execPath,
      args: ["-e", commandLines.join(";")],
    }),
    parseEvent: (raw: unknown): AdapterEvent[] =>
      isRecord(raw) && raw.type === "failed"
        ? [{
            type: "turn.failed",
            code: "provider_failed",
            message: "provider reported failure",
          }]
        : [],
    spawnProcess: (
      command: string,
      args: readonly string[],
      childOptions: { cwd: string; detached: boolean },
    ) => {
      child = trackChild(spawn(command, [...args], childOptions));
      child.stderr.once("data", () => {
        markProviderReady?.();
      });
      return child;
    },
    terminationGraceMs: 25,
  };
  return {
    session: new ProcessJsonlSession(options),
    providerReady,
    child: () => child,
  };
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

async function within<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    handle = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (handle !== undefined) {
      clearTimeout(handle);
    }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stopChild(child: ChildProcess): void {
  if (child.pid !== undefined && isProcessAlive(child.pid)) {
    child.kill("SIGTERM");
  }
}

function forceStopChild(child: ChildProcess | undefined): void {
  if (child?.pid !== undefined && isProcessAlive(child.pid)) {
    child.kill("SIGKILL");
  }
}

function createNonClosingChild(): ChildProcessWithoutNullStreams & {
  readonly stdout: PassThrough;
} {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill(signal?: NodeJS.Signals): boolean;
  };
  child.pid = 999_999_999;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  return child as unknown as ChildProcessWithoutNullStreams & {
    readonly stdout: PassThrough;
  };
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
  return createActiveRunIn(
    repoRoot,
    logRoot,
    suffix,
    "2026-07-25T12:00:00.000Z",
    { pid: 4101, processGroupId: 5101, startIdentity: "process-start-a" },
  );
}

async function createActiveRunIn(
  repoRoot: string,
  logRoot: string,
  suffix: string,
  createdAt: string,
  identity: {
    readonly pid: number;
    readonly processGroupId: number;
    readonly startIdentity: string;
  },
) {
  const runId = `xrun_reconcile_${suffix}`;
  const record = await createRunRecord({
    repoRoot,
    logRoot,
    runId,
    harness: "codex",
    mode: "subagent",
    clock: () => new Date(createdAt),
  });
  await updateRunSupervision(record, {
    phase: "running",
    sequence: 3,
    provider_thread_id: "provider-thread",
    last_transport_progress_at: "2026-07-25T12:01:00.000Z",
    last_semantic_progress_at: "2026-07-25T12:00:30.000Z",
    owned_process: {
      pid: identity.pid,
      process_group_id: identity.processGroupId,
      started_at: "2026-07-25T11:59:59.000Z",
      start_identity: identity.startIdentity,
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

function mappedInspector(
  inspections: readonly ProcessInspection[],
  signalledGroups: number[],
): ProcessInspector {
  return {
    async inspect(pid): Promise<ProcessInspection | undefined> {
      return inspections.find((inspection) => inspection.pid === pid);
    },
    async terminateProcessGroup(processGroupId): Promise<void> {
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
