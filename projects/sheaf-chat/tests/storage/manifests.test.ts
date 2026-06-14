import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

import {
  ListChatManifests,
  ReadManifest,
  UpdateManifest,
  WriteInitialManifest,
} from "../../src/storage/manifests.js";
import { ResolveManifestFilePath } from "../../src/storage/paths.js";
import {
  AllocateChatShell,
  x_defaultExtensionVersion,
} from "../../src/storage/sessionLog.js";
import type { StoragePaths } from "../../src/storage/paths.js";
import { CacheTestWorkspace, WithTempStorage } from "./helpers.js";

async function CreateShell(
  paths: StoragePaths,
  workspacePath = "/tmp/sheaf-demo",
  model = {
    provider: "openai",
    id: "gpt-5-codex",
  },
)
{
  const { repository, workspace } = await CacheTestWorkspace(paths, workspacePath);
  const shell = await AllocateChatShell(paths, repository.repoId, workspace.workspaceId, model);
  return { repository, workspace, shell };
}

function ManifestInput(context: Awaited<ReturnType<typeof CreateShell>>, name: string)
{
  return {
    repoId: context.repository.repoId,
    workspaceId: context.workspace.workspaceId,
    chatId: context.shell.chatId,
    repositoryPath: context.repository.path,
    workspacePath: context.workspace.path,
    chatName: name,
    description: name,
    rootDirectory: context.workspace.path,
    model: context.shell.provisionalChat.model,
    extensionVersion: x_defaultExtensionVersion,
  };
}

test("AllocateChatShell defers manifest creation until WriteInitialManifest", async () =>
{
  await WithTempStorage(async (paths) =>
  {
    const context = await CreateShell(paths);

    await assert.rejects(() =>
      access(
        ResolveManifestFilePath(
          paths,
          context.repository.repoId,
          context.workspace.workspaceId,
          context.shell.chatId,
        ),
      ));

    const manifest = await WriteInitialManifest(paths, {
      ...ManifestInput(context, "Fix login redirect"),
      description: "Short generated description",
      messageCount: 1,
      lastSequence: 2,
    });

    assert.equal(manifest.chatName, "Fix login redirect");
    assert.equal(manifest.repoId, context.repository.repoId);
    assert.equal(manifest.workspaceId, context.workspace.workspaceId);
    assert.equal(manifest.repositoryPath, context.repository.path);
    assert.equal(manifest.workspacePath, context.workspace.path);
    assert.equal(manifest.rootDirectory, context.workspace.path);
    assert.equal(manifest.history.lastSequence, 2);
    assert.match(manifest.pi.sessionFile, /repositories\/.+\/workspaces\/.+\/chats\/.+\.jsonl$/);
    assert.equal(
      await ReadManifest(
        paths,
        context.repository.repoId,
        context.workspace.workspaceId,
        context.shell.chatId,
      ).then((m) => m.chatId),
      context.shell.chatId,
    );
  });
});

test("ListChatManifests returns manifests newest first and UpdateManifest persists changes", async () =>
{
  await WithTempStorage(async (paths) =>
  {
    const first = await CreateShell(paths, "/tmp/sheaf-demo");
    const second = await CreateShell(paths, "/tmp/sheaf-demo", {
      provider: "local",
      id: "qwen3-coder",
    });

    await WriteInitialManifest(paths, ManifestInput(first, "Older"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await WriteInitialManifest(paths, ManifestInput(second, "Newer"));

    const manifests = await ListChatManifests(
      paths,
      first.repository.repoId,
      first.workspace.workspaceId,
    );
    assert.equal(manifests.length, 2);
    assert.equal(manifests[0]?.chatName, "Newer");
    assert.equal(manifests[1]?.chatName, "Older");

    const updated = await UpdateManifest(
      paths,
      first.repository.repoId,
      first.workspace.workspaceId,
      second.shell.chatId,
      {
        chatName: "Renamed",
        messageCount: 4,
        lastSequence: 9,
      },
    );

    assert.equal(updated.chatName, "Renamed");
    assert.equal(updated.history.messageCount, 4);
    assert.equal(updated.history.lastSequence, 9);
  });
});
