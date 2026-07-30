import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import test from "node:test";

import type { AdapterEvent, AdapterTurnContext, HarnessSession } from "../src/adapters/types.js";
import {
  createTestAdapterFactory,
  wrapSessionWithOwnedChildCleanup,
} from "../src/service/test_hooks.js";

// The packaged cleanup smoke asserts the same contract over MCP, but its
// post-close signal check races the service's HTTP response: a slow reply can
// hide a `close()` that returned before its owned child died. These tests pin
// the contract in-process with no timing slack.
//
const fixturePids = new Set<number>();

test.afterEach(async () => {
  // Every real child here is detached, so an assertion failure mid-test would
  // otherwise leak it. Signal by positive pid: negative-pid group signalling is
  // Unix-only, and these fixtures are single-process groups.
  //
  for (const pid of fixturePids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      if (!isMissingProcess(error)) {
        throw error;
      }
    }
  }
  for (const pid of fixturePids) {
    await waitUntilMissing(pid);
  }
  fixturePids.clear();
});

test("test adapter close resolves only after its owned child has exited", async () => {
  const session = await startOwnedChildSession();
  const pid = session.processIdentity?.pid;
  assert.equal(typeof pid, "number");

  await session.close();

  assert.throws(
    () => {
      process.kill(pid as number, 0);
    },
    (error: unknown) => isMissingProcess(error),
    "owned child must be gone the moment close() resolves",
  );
});

test("test adapter close completes when its owned child already exited", async () => {
  const session = await startOwnedChildSession();
  const pid = session.processIdentity?.pid as number;

  process.kill(pid, "SIGKILL");
  await waitUntilMissing(pid);

  await session.close();
});

// Node reports a failed `child.kill()` by emitting `"error"` on the
// ChildProcess — notably on Windows, where killing can fail outright. An error
// is not proof of exit, so it must not release `close()` while the child lives.
// SIGTERM is not catchable on Windows, so only POSIX can hold a child alive
// across the first escalation step.
//
test("test adapter close ignores a kill error while its owned child is still alive", {
  skip: process.platform === "win32" ? "requires catchable SIGTERM" : false,
}, async () => {
  const child = await spawnSigtermResistantChild();
  const session = wrapSessionWithOwnedChildCleanup(inertSession(), child);

  let settled = false;
  const closing = session.close();
  void closing.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );

  await delay(100);
  child.emit("error", new Error("simulated kill failure"));
  await delay(100);

  assert.equal(hasExited(child), false, "fixture child must survive SIGTERM");
  assert.equal(settled, false, "close() must not resolve on a kill error");

  await closing;

  assert.equal(hasExited(child), true, "close() must escalate to SIGKILL and await exit");
});

async function startOwnedChildSession(): Promise<HarnessSession> {
  const previous = process.env.XAGENT_TEST_OWNED_CHILD;
  process.env.XAGENT_TEST_OWNED_CHILD = "1";
  try {
    const adapter = createTestAdapterFactory()("codex");
    const session = await adapter.start({ cwd: process.cwd() });
    trackPid(session.processIdentity?.pid);
    return session;
  } finally {
    if (previous === undefined) {
      delete process.env.XAGENT_TEST_OWNED_CHILD;
    } else {
      process.env.XAGENT_TEST_OWNED_CHILD = previous;
    }
  }
}

// The child announces itself only once its SIGTERM handler is installed;
// signalling before then would kill it with the default disposition and prove
// nothing about the kill-error path.
//
async function spawnSigtermResistantChild(): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    [
      "-e",
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1_000);"
      + " process.stdout.write('ready\\n')",
    ],
    { stdio: ["ignore", "pipe", "ignore"], detached: true },
  );
  trackPid(child.pid);
  await new Promise<void>((resolve, reject) => {
    child.stdout?.once("data", () => {
      resolve();
    });
    child.once("error", reject);
    child.once("exit", () => {
      reject(new Error("fixture child exited before it was ready"));
    });
  });
  child.stdout?.removeAllListeners("data");
  child.removeAllListeners("error");
  child.removeAllListeners("exit");
  child.stdout?.resume();
  return child;
}

function inertSession(): HarnessSession {
  return {
    submit: (_context: AdapterTurnContext): AsyncIterable<AdapterEvent> => emptyTurn(),
    close: async () => {},
  };
}

async function* emptyTurn(): AsyncIterable<AdapterEvent> {
  // No provider output: these tests exercise cleanup, not turns.
  //
}

function trackPid(pid: number | undefined): void {
  if (typeof pid === "number") {
    fixturePids.add(pid);
  }
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitUntilMissing(pid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (isMissingProcess(error)) {
        return;
      }
      throw error;
    }
    if (Date.now() > deadline) {
      throw new Error(`Process ${pid} did not exit.`);
    }
    await delay(10);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function isMissingProcess(error: unknown): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: string }).code === "ESRCH"
  );
}
