import assert from "node:assert/strict";
import test from "node:test";

import { ReadHistoryPage } from "../../src/storage/history.js";
import { CreatePile } from "../../src/storage/piles.js";
import { AllocateSessionShell, AppendEnvelope } from "../../src/storage/sessionLog.js";
import { WithTempStorage } from "./helpers.js";

test("ReadHistoryPage supports latest, before, and after pagination", async () =>
{
  await WithTempStorage(async (paths) =>
  {
    await CreatePile(paths, "default");
    const shell = await AllocateSessionShell(paths, "default", "projects/demo", {
      provider: "openai",
      id: "gpt-5-codex",
    });

    for (let sequence = 1; sequence <= 10; sequence += 1)
    {
      await AppendEnvelope(paths, "default", shell.sessionId, {
        kind: "agui.event",
        pile: "default",
        sessionId: shell.sessionId,
        payload: { type: "TEXT_MESSAGE_CONTENT", delta: `m${sequence}` },
      });
    }

    const latest = await ReadHistoryPage(paths, "default", shell.sessionId, { limit: 3 });
    assert.equal(latest.direction, "latest");
    assert.equal(latest.envelopes.length, 3);
    assert.deepEqual(
      latest.envelopes.map((envelope) => envelope.sequence),
      [8, 9, 10],
    );
    assert.equal(latest.hasMoreBefore, true);
    assert.equal(latest.hasMoreAfter, false);

    const before = await ReadHistoryPage(paths, "default", shell.sessionId, {
      before: 8,
      limit: 3,
    });
    assert.equal(before.direction, "before");
    assert.deepEqual(
      before.envelopes.map((envelope) => envelope.sequence),
      [5, 6, 7],
    );
    assert.equal(before.hasMoreBefore, true);
    assert.equal(before.hasMoreAfter, false);

    const after = await ReadHistoryPage(paths, "default", shell.sessionId, {
      after: 7,
      limit: 3,
    });
    assert.equal(after.direction, "after");
    assert.deepEqual(
      after.envelopes.map((envelope) => envelope.sequence),
      [8, 9, 10],
    );
    assert.equal(after.hasMoreAfter, false);
  });
});

test("ReadHistoryPage can run while appends continue", async () =>
{
  await WithTempStorage(async (paths) =>
  {
    await CreatePile(paths, "default");
    const shell = await AllocateSessionShell(paths, "default", "projects/demo", {
      provider: "openai",
      id: "gpt-5-codex",
    });

    for (let sequence = 1; sequence <= 5; sequence += 1)
    {
      await AppendEnvelope(paths, "default", shell.sessionId, {
        kind: "chat.user_message",
        pile: "default",
        sessionId: shell.sessionId,
        payload: { messageId: `m${sequence}`, text: `t${sequence}` },
      });
    }

    const pagePromise = ReadHistoryPage(paths, "default", shell.sessionId, { limit: 50 });
    await AppendEnvelope(paths, "default", shell.sessionId, {
      kind: "chat.user_message",
      pile: "default",
      sessionId: shell.sessionId,
      payload: { messageId: "m6", text: "t6" },
    });

    const page = await pagePromise;
    assert.ok(page.envelopes.length >= 5);
  });
});
