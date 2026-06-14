import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import test from "node:test";

import { ReadManifest, WriteInitialManifest } from "../../src/storage/manifests.js";
import { ResolveHistoryFilePath } from "../../src/storage/paths.js";
import {
  AllocateChatShell,
  AppendEnvelope,
  ReadLatestSequence,
} from "../../src/storage/sessionLog.js";
import { CacheTestWorkspace, WithTempStorage } from "./helpers.js";

async function CreateShell(paths: Parameters<typeof CacheTestWorkspace>[0])
{
  const { repository, workspace } = await CacheTestWorkspace(paths, "/tmp/sheaf-demo");
  const shell = await AllocateChatShell(paths, repository.repoId, workspace.workspaceId, {
    provider: "openai",
    id: "gpt-5-codex",
  });

  return { repository, workspace, shell };
}

async function WriteManifest(
  paths: Parameters<typeof CacheTestWorkspace>[0],
  context: Awaited<ReturnType<typeof CreateShell>>,
  lastSequence: number,
)
{
  await WriteInitialManifest(paths, {
    repoId: context.repository.repoId,
    workspaceId: context.workspace.workspaceId,
    chatId: context.shell.chatId,
    repositoryPath: context.repository.path,
    workspacePath: context.workspace.path,
    chatName: "Existing chat",
    description: "Existing chat",
    rootDirectory: context.workspace.path,
    model: {
      provider: "openai",
      id: "gpt-5-codex",
    },
    extensionVersion: "0.1.0",
    lastSequence,
  });
}

test("AppendEnvelope allocates monotonic sequences for a workspace chat", async () =>
{
  await WithTempStorage(async (paths) =>
  {
    const { repository, workspace, shell } = await CreateShell(paths);

    const first = await AppendEnvelope(
      paths,
      repository.repoId,
      workspace.workspaceId,
      shell.chatId,
      {
        kind: "chat.user_message",
        repoId: repository.repoId,
        workspaceId: workspace.workspaceId,
        chatId: shell.chatId,
        payload: { messageId: "m1", text: "hello" },
      },
    );
    const second = await AppendEnvelope(
      paths,
      repository.repoId,
      workspace.workspaceId,
      shell.chatId,
      {
        kind: "agui.event",
        repoId: repository.repoId,
        workspaceId: workspace.workspaceId,
        chatId: shell.chatId,
        payload: { type: "TEXT_MESSAGE_CONTENT", delta: "hi" },
      },
    );

    assert.equal(first.sequence, 1);
    assert.equal(second.sequence, 2);
    assert.equal(
      await ReadLatestSequence(paths, repository.repoId, workspace.workspaceId, shell.chatId),
      2,
    );
  });
});

test("AppendEnvelope initializes allocation from manifest lastSequence", async () =>
{
  await WithTempStorage(async (paths) =>
  {
    const context = await CreateShell(paths);
    await WriteManifest(paths, context, 41);

    const envelope = await AppendEnvelope(
      paths,
      context.repository.repoId,
      context.workspace.workspaceId,
      context.shell.chatId,
      {
        kind: "agui.event",
        repoId: context.repository.repoId,
        workspaceId: context.workspace.workspaceId,
        chatId: context.shell.chatId,
        payload: { type: "TEXT_MESSAGE_CONTENT", delta: "next" },
      },
    );

    assert.equal(envelope.sequence, 42);
  });
});

test("AppendEnvelope recovers allocation from history tail when manifest is stale", async () =>
{
  await WithTempStorage(async (paths) =>
  {
    const context = await CreateShell(paths);
    await WriteManifest(paths, context, 1);

    const historyPath = ResolveHistoryFilePath(
      paths,
      context.repository.repoId,
      context.workspace.workspaceId,
      context.shell.chatId,
    );
    await writeFile(
      historyPath,
      `${JSON.stringify({
        sequence: 8,
        envelope: {
          v: 1,
          kind: "agui.event",
          repoId: context.repository.repoId,
          workspaceId: context.workspace.workspaceId,
          chatId: context.shell.chatId,
          id: "frame-8",
          timestamp: new Date().toISOString(),
          sequence: 8,
          payload: { type: "TEXT_MESSAGE_CONTENT", delta: "recovered" },
        },
      })}\n`,
      "utf8",
    );

    const envelope = await AppendEnvelope(
      paths,
      context.repository.repoId,
      context.workspace.workspaceId,
      context.shell.chatId,
      {
        kind: "agui.event",
        repoId: context.repository.repoId,
        workspaceId: context.workspace.workspaceId,
        chatId: context.shell.chatId,
        payload: { type: "TEXT_MESSAGE_CONTENT", delta: "next" },
      },
    );

    assert.equal(envelope.sequence, 9);
  });
});

test("AppendEnvelope updates manifest recency metadata when manifest exists", async () =>
{
  await WithTempStorage(async (paths) =>
  {
    const context = await CreateShell(paths);
    await WriteManifest(paths, context, 0);

    await AppendEnvelope(
      paths,
      context.repository.repoId,
      context.workspace.workspaceId,
      context.shell.chatId,
      {
        kind: "agui.event",
        repoId: context.repository.repoId,
        workspaceId: context.workspace.workspaceId,
        chatId: context.shell.chatId,
        payload: { type: "TEXT_MESSAGE_CONTENT", delta: "first" },
      },
    );

    const manifest = await ReadManifest(
      paths,
      context.repository.repoId,
      context.workspace.workspaceId,
      context.shell.chatId,
    );
    assert.equal(manifest.history.lastSequence, 1);
  });
});

test("AppendEnvelope rejects explicit sequences behind cached latest sequence", async () =>
{
  await WithTempStorage(async (paths) =>
  {
    const { repository, workspace, shell } = await CreateShell(paths);

    await AppendEnvelope(paths, repository.repoId, workspace.workspaceId, shell.chatId, {
      kind: "agui.event",
      repoId: repository.repoId,
      workspaceId: workspace.workspaceId,
      chatId: shell.chatId,
      payload: { type: "TEXT_MESSAGE_CONTENT", delta: "first" },
    });

    await assert.rejects(
      async () =>
        AppendEnvelope(paths, repository.repoId, workspace.workspaceId, shell.chatId, {
          kind: "agui.event",
          repoId: repository.repoId,
          workspaceId: workspace.workspaceId,
          chatId: shell.chatId,
          sequence: 1,
          payload: { type: "TEXT_MESSAGE_CONTENT", delta: "duplicate" },
        }),
      /sequence 1 is not greater than latest 1/,
    );
  });
});
