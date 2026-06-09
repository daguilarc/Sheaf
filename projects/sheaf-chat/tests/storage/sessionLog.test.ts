import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import test from "node:test";

import { WriteInitialManifest } from "../../src/storage/manifests.js";
import { ResolveHistoryFilePath } from "../../src/storage/paths.js";
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

test("AppendEnvelope initializes allocation from manifest lastSequence", async () =>
{
  await WithTempStorage(async (paths) =>
  {
    await CreatePile(paths, "default");
    const shell = await AllocateSessionShell(paths, "default", "projects/demo", {
      provider: "openai",
      id: "gpt-5-codex",
    });

    await WriteInitialManifest(paths, {
      pile: "default",
      sessionId: shell.sessionId,
      chatName: "Existing chat",
      description: "Existing chat",
      rootDirectory: "projects/demo",
      model: {
        provider: "openai",
        id: "gpt-5-codex",
      },
      extensionVersion: "0.1.0",
      lastSequence: 41,
    });

    const envelope = await AppendEnvelope(paths, "default", shell.sessionId, {
      kind: "agui.event",
      pile: "default",
      sessionId: shell.sessionId,
      payload: { type: "TEXT_MESSAGE_CONTENT", delta: "next" },
    });

    assert.equal(envelope.sequence, 42);
  });
});

test("AppendEnvelope recovers allocation from history tail when manifest is stale", async () =>
{
  await WithTempStorage(async (paths) =>
  {
    await CreatePile(paths, "default");
    const shell = await AllocateSessionShell(paths, "default", "projects/demo", {
      provider: "openai",
      id: "gpt-5-codex",
    });

    await WriteInitialManifest(paths, {
      pile: "default",
      sessionId: shell.sessionId,
      chatName: "Existing chat",
      description: "Existing chat",
      rootDirectory: "projects/demo",
      model: {
        provider: "openai",
        id: "gpt-5-codex",
      },
      extensionVersion: "0.1.0",
      lastSequence: 1,
    });

    const historyPath = ResolveHistoryFilePath(paths, "default", shell.sessionId);
    await writeFile(
      historyPath,
      `${JSON.stringify({
        sequence: 8,
        envelope: {
          kind: "agui.event",
          pile: "default",
          sessionId: shell.sessionId,
          sequence: 8,
          payload: { type: "TEXT_MESSAGE_CONTENT", delta: "recovered" },
          createdAt: new Date().toISOString(),
        },
      })}\n`,
      "utf8",
    );

    const envelope = await AppendEnvelope(paths, "default", shell.sessionId, {
      kind: "agui.event",
      pile: "default",
      sessionId: shell.sessionId,
      payload: { type: "TEXT_MESSAGE_CONTENT", delta: "next" },
    });

    assert.equal(envelope.sequence, 9);
  });
});

test("AppendEnvelope rejects explicit sequences behind cached latest sequence", async () =>
{
  await WithTempStorage(async (paths) =>
  {
    await CreatePile(paths, "default");
    const shell = await AllocateSessionShell(paths, "default", "projects/demo", {
      provider: "openai",
      id: "gpt-5-codex",
    });

    await AppendEnvelope(paths, "default", shell.sessionId, {
      kind: "agui.event",
      pile: "default",
      sessionId: shell.sessionId,
      payload: { type: "TEXT_MESSAGE_CONTENT", delta: "first" },
    });

    await assert.rejects(
      async () =>
        AppendEnvelope(paths, "default", shell.sessionId, {
          kind: "agui.event",
          pile: "default",
          sessionId: shell.sessionId,
          sequence: 1,
          payload: { type: "TEXT_MESSAGE_CONTENT", delta: "duplicate" },
        }),
      /sequence 1 is not greater than latest 1/,
    );
  });
});
