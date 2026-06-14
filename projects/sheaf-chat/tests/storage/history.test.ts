import assert from "node:assert/strict";
import test from "node:test";

import { ReadHistoryPage } from "../../src/storage/history.js";
import { AllocateChatShell, AppendEnvelope } from "../../src/storage/sessionLog.js";
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

async function AppendMessage(
  paths: Parameters<typeof CacheTestWorkspace>[0],
  context: Awaited<ReturnType<typeof CreateShell>>,
  sequence: number,
)
{
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
      payload: { type: "TEXT_MESSAGE_CONTENT", delta: `m${sequence}` },
    },
  );
}

test("ReadHistoryPage supports latest, before, and after pagination", async () =>
{
  await WithTempStorage(async (paths) =>
  {
    const context = await CreateShell(paths);

    for (let sequence = 1; sequence <= 10; sequence += 1)
    {
      await AppendMessage(paths, context, sequence);
    }

    const latest = await ReadHistoryPage(
      paths,
      context.repository.repoId,
      context.workspace.workspaceId,
      context.shell.chatId,
      { limit: 3 },
    );
    assert.equal(latest.direction, "latest");
    assert.deepEqual(
      latest.envelopes.map((envelope) => envelope.sequence),
      [8, 9, 10],
    );
    assert.equal(latest.hasMoreBefore, true);
    assert.equal(latest.hasMoreAfter, false);

    const before = await ReadHistoryPage(
      paths,
      context.repository.repoId,
      context.workspace.workspaceId,
      context.shell.chatId,
      { before: 8, limit: 3 },
    );
    assert.equal(before.direction, "before");
    assert.deepEqual(
      before.envelopes.map((envelope) => envelope.sequence),
      [5, 6, 7],
    );
    assert.equal(before.hasMoreBefore, true);
    assert.equal(before.hasMoreAfter, false);

    const after = await ReadHistoryPage(
      paths,
      context.repository.repoId,
      context.workspace.workspaceId,
      context.shell.chatId,
      { after: 7, limit: 3 },
    );
    assert.equal(after.direction, "after");
    assert.deepEqual(
      after.envelopes.map((envelope) => envelope.sequence),
      [8, 9, 10],
    );
    assert.equal(after.hasMoreAfter, false);
  });
});

test("ReadHistoryPage returns an empty page when history is missing", async () =>
{
  await WithTempStorage(async (paths) =>
  {
    const context = await CreateShell(paths);
    const page = await ReadHistoryPage(
      paths,
      context.repository.repoId,
      context.workspace.workspaceId,
      context.shell.chatId,
      { limit: 50 },
    );

    assert.deepEqual(page.envelopes, []);
    assert.equal(page.oldestSequence, null);
    assert.equal(page.newestSequence, null);
  });
});
