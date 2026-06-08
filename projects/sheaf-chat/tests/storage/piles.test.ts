import assert from "node:assert/strict";
import test from "node:test";

import { WriteInitialManifest } from "../../src/storage/manifests.js";
import { CreatePile, ListPiles, ManifestExists } from "../../src/storage/piles.js";
import { AllocateSessionShell, x_defaultExtensionVersion } from "../../src/storage/sessionLog.js";
import { WithTempStorage } from "./helpers.js";

test("CreatePile and ListPiles report empty and populated piles", async () =>
{
  await WithTempStorage(async (paths) =>
  {
    const created = await CreatePile(paths, "team.alpha");
    assert.equal(created.pile, "team.alpha");
    assert.equal(created.sessionCount, 0);
    assert.equal(created.latestUpdatedAt, null);

    const piles = await ListPiles(paths);
    assert.deepEqual(piles, [created]);
  });
});

test("ListPiles counts manifests and tracks latest update time", async () =>
{
  await WithTempStorage(async (paths) =>
  {
    await CreatePile(paths, "default");
    const allocated = await AllocateSessionShell(paths, "default", "projects/demo", {
      provider: "openai",
      id: "gpt-5-codex",
    });
    await WriteInitialManifest(paths, {
      pile: "default",
      sessionId: allocated.sessionId,
      chatName: "First chat",
      description: "demo",
      rootDirectory: allocated.provisionalSession.rootDirectory,
      model: allocated.provisionalSession.model,
      extensionVersion: x_defaultExtensionVersion,
    });

    const piles = await ListPiles(paths);
    assert.equal(piles.length, 1);
    assert.equal(piles[0]?.sessionCount, 1);
    assert.ok(piles[0]?.latestUpdatedAt);
    assert.equal(await ManifestExists(paths, "default", allocated.sessionId), true);
  });
});
