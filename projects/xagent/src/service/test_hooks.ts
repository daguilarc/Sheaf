import { spawn, type ChildProcess } from "node:child_process";

import { FakeHarnessAdapter } from "../adapters/fake.js";
import type { AdapterEvent, HarnessAdapter, HarnessSession, HarnessStartOptions } from "../adapters/types.js";
import type { HarnessName } from "../events.js";
import { captureOwnedProcessIdentity } from "../supervision/process_identity.js";

export function isTestAdapterEnabled(): boolean {
  return process.env.XAGENT_TEST_ADAPTER === "fake";
}

function ParseSddReportTexts(): readonly string[]
{
  const raw = process.env.XAGENT_TEST_SDD_REPORTS;
  if (raw === undefined || raw.trim().length === 0)
  {
    return ["complete final assistant message"];
  }
  const reports = raw.split("|").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  if (reports.length === 0)
  {
    return ["complete final assistant message"];
  }
  return reports;
}

function CreateScriptedTurn(
  reportText: string,
  delayMs: number | undefined,
  inputSequence: number,
): AsyncIterable<AdapterEvent>
{
  async function* scriptedTurn(): AsyncIterable<AdapterEvent>
  {
    if (delayMs !== undefined)
    {
      await new Promise<void>((resolve) =>
      {
        setTimeout(resolve, delayMs);
      });
    }
    yield {
      type: "message.delta",
      message_id: `message_test_hook_${inputSequence}`,
      role: "assistant",
      delta: "packaged test progress",
    };
    yield {
      type: "tool.started",
      tool_call_id: `tool_test_hook_${inputSequence}`,
      name: "fake_tool",
      input: {},
    };
    yield {
      type: "tool.completed",
      tool_call_id: `tool_test_hook_${inputSequence}`,
      name: "fake_tool",
      status: "completed",
      output: { ok: true },
    };
    yield {
      type: "message.completed",
      message_id: `message_test_hook_${inputSequence}`,
      role: "assistant",
      text: reportText,
    };
    yield {
      type: "turn.completed",
      final_text: reportText,
      provider_thread_id: "fake-thread-1",
    };
  }
  return scriptedTurn();
}

export function createTestAdapterFactory(): (harness: HarnessName) => HarnessAdapter {
  return () => {
    const delayMs = parsePositiveInteger(process.env.XAGENT_TEST_DELAY_MS);
    const spawnOwnedChild = process.env.XAGENT_TEST_OWNED_CHILD === "1";
    const reportTexts = ParseSddReportTexts();
    let ownedChild: ChildProcess | undefined;
    let processIdentity = undefined as ReturnType<typeof captureOwnedProcessIdentity>;

    if (spawnOwnedChild) {
      ownedChild = spawn(
        process.execPath,
        ["-e", "setInterval(() => {}, 1_000)"],
        { stdio: "ignore", detached: true },
      );
      if (typeof ownedChild.pid === "number") {
        processIdentity = captureOwnedProcessIdentity(ownedChild.pid);
      }
    }

    const scriptedEvents = reportTexts.map((reportText, index) =>
      CreateScriptedTurn(reportText, delayMs, index + 1),
    );

    const adapter = new FakeHarnessAdapter({
      scriptedEvents,
      includeDeltas: true,
      includeToolEvents: true,
      ...(processIdentity === undefined ? {} : { processIdentity }),
    });

    if (ownedChild === undefined) {
      return adapter;
    }

    return wrapAdapterWithOwnedChildCleanup(adapter, ownedChild);
  };
}

function wrapAdapterWithOwnedChildCleanup(
  adapter: FakeHarnessAdapter,
  ownedChild: ChildProcess,
): HarnessAdapter {
  return {
    harness: adapter.harness,
    capabilities: adapter.capabilities,
    async start(options: HarnessStartOptions): Promise<HarnessSession> {
      const session = await adapter.start(options);
      return wrapSessionWithOwnedChildCleanup(session, ownedChild);
    },
  };
}

function wrapSessionWithOwnedChildCleanup(
  session: HarnessSession,
  ownedChild: ChildProcess,
): HarnessSession {
  let closed = false;
  return {
    providerThreadId: session.providerThreadId,
    processIdentity: session.processIdentity,
    ...(session.interrupt === undefined ? {} : { interrupt: session.interrupt }),
    submit: (context) => session.submit(context),
    close: async () => {
      if (closed) {
        return;
      }
      closed = true;
      await session.close();
      terminateOwnedChild(ownedChild);
    },
  };
}

function terminateOwnedChild(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) {
    return;
  }
  try {
    if (process.platform === "win32") {
      child.kill("SIGTERM");
      return;
    }
    process.kill(-pid, "SIGTERM");
  } catch (error) {
    if (!isMissingProcess(error)) {
      throw error;
    }
  }
}

function parsePositiveInteger(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer test hook value, found ${raw}.`);
  }
  return parsed;
}

function isMissingProcess(error: unknown): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: string }).code === "ESRCH"
  );
}
