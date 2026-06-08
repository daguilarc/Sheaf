import assert from "node:assert/strict";
import test from "node:test";

import { CreatePile } from "../../src/storage/piles.js";
import {
  AllocateSessionShell,
  AppendEnvelope,
  ReadLatestSequence,
} from "../../src/storage/sessionLog.js";
import { WithTempStorage } from "./helpers.js";

test("AppendEnvelope allocates monotonic sequences for a session", async () =>
{
  await WithTempStorage(async (paths) =>
  {
    await CreatePile(paths, "default");
    const shell = await AllocateSessionShell(paths, "default", "projects/demo", {
      provider: "openai",
      id: "gpt-5-codex",
    });

    const first = await AppendEnvelope(paths, "default", shell.sessionId, {
      kind: "chat.user_message",
      pile: "default",
      sessionId: shell.sessionId,
      payload: { messageId: "m1", text: "hello" },
    });
    const second = await AppendEnvelope(paths, "default", shell.sessionId, {
      kind: "agui.event",
      pile: "default",
      sessionId: shell.sessionId,
      payload: { type: "TEXT_MESSAGE_CONTENT", delta: "hi" },
    });

    assert.equal(first.sequence, 1);
    assert.equal(second.sequence, 2);
    assert.equal(await ReadLatestSequence(paths, "default", shell.sessionId), 2);
  });
});
