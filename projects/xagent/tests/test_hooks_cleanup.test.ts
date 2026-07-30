import assert from "node:assert/strict";
import test from "node:test";

import type { HarnessSession } from "../src/adapters/types.js";
import { createTestAdapterFactory } from "../src/service/test_hooks.js";

// The packaged cleanup smoke asserts the same contract over MCP, but its
// post-close signal check races the service's HTTP response: a slow reply can
// hide a `close()` that returned before its owned child died. These tests pin
// the contract in-process with no timing slack.
//
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

  process.kill(-pid, "SIGKILL");
  await waitUntilMissing(pid);

  await session.close();
});

async function startOwnedChildSession(): Promise<HarnessSession> {
  const previous = process.env.XAGENT_TEST_OWNED_CHILD;
  process.env.XAGENT_TEST_OWNED_CHILD = "1";
  try {
    const adapter = createTestAdapterFactory()("codex");
    return await adapter.start({ cwd: process.cwd() });
  } finally {
    if (previous === undefined) {
      delete process.env.XAGENT_TEST_OWNED_CHILD;
    } else {
      process.env.XAGENT_TEST_OWNED_CHILD = previous;
    }
  }
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
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
  }
}

function isMissingProcess(error: unknown): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: string }).code === "ESRCH"
  );
}
