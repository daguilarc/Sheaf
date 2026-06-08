import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

import {
  ListSessionManifests,
  ReadManifest,
  UpdateManifest,
  WriteInitialManifest,
} from "../../src/storage/manifests.js";
import { CreatePile } from "../../src/storage/piles.js";
import { ResolveManifestFilePath } from "../../src/storage/paths.js";
import {
  AllocateSessionShell,
  x_defaultExtensionVersion,
} from "../../src/storage/sessionLog.js";
import { WithTempStorage } from "./helpers.js";

test("AllocateSessionShell defers manifest creation until WriteInitialManifest", async () =>
{
  await WithTempStorage(async (paths) =>
  {
    await CreatePile(paths, "default");
    const shell = await AllocateSessionShell(paths, "default", "projects/demo", {
      provider: "openai",
      id: "gpt-5-codex",
    });

    await assert.rejects(() => access(ResolveManifestFilePath(paths, "default", shell.sessionId)));

    const manifest = await WriteInitialManifest(paths, {
      pile: "default",
      sessionId: shell.sessionId,
      chatName: "Fix login redirect",
      description: "Short generated description",
      rootDirectory: shell.provisionalSession.rootDirectory,
      model: shell.provisionalSession.model,
      extensionVersion: x_defaultExtensionVersion,
      messageCount: 1,
      lastSequence: 2,
    });

    assert.equal(manifest.chatName, "Fix login redirect");
    assert.equal(manifest.history.lastSequence, 2);
    assert.match(manifest.pi.sessionFile, /default\/.+\.jsonl$/);
    assert.equal(await ReadManifest(paths, "default", shell.sessionId).then((m) => m.sessionId), shell.sessionId);
  });
});

test("ListSessionManifests returns manifests newest first and UpdateManifest persists changes", async () =>
{
  await WithTempStorage(async (paths) =>
  {
    await CreatePile(paths, "work");
    const first = await AllocateSessionShell(paths, "work", "projects/a", {
      provider: "openai",
      id: "gpt-5-codex",
    });
    const second = await AllocateSessionShell(paths, "work", "projects/b", {
      provider: "local",
      id: "qwen3-coder",
    });

    await WriteInitialManifest(paths, {
      pile: "work",
      sessionId: first.sessionId,
      chatName: "Older",
      description: "older",
      rootDirectory: first.provisionalSession.rootDirectory,
      model: first.provisionalSession.model,
      extensionVersion: x_defaultExtensionVersion,
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    await WriteInitialManifest(paths, {
      pile: "work",
      sessionId: second.sessionId,
      chatName: "Newer",
      description: "newer",
      rootDirectory: second.provisionalSession.rootDirectory,
      model: second.provisionalSession.model,
      extensionVersion: x_defaultExtensionVersion,
    });

    const manifests = await ListSessionManifests(paths, "work");
    assert.equal(manifests.length, 2);
    assert.equal(manifests[0]?.chatName, "Newer");
    assert.equal(manifests[1]?.chatName, "Older");

    const updated = await UpdateManifest(paths, "work", second.sessionId, {
      chatName: "Renamed",
      messageCount: 4,
      lastSequence: 9,
    });

    assert.equal(updated.chatName, "Renamed");
    assert.equal(updated.history.messageCount, 4);
    assert.equal(updated.history.lastSequence, 9);
  });
});
