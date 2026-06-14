import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { LifecycleEmitter } from "../../../src/agents/lifecycle.js";
import { AgentManager, AgentManagerError } from "../../../src/agents/manager.js";
import { AgentLifecycleState } from "../../../src/shared/types.js";
import { ManifestExists, ReadManifest } from "../../../src/storage/manifests.js";
import { ResolveChatsDirectory } from "../../../src/storage/paths.js";
import type { StoragePaths } from "../../../src/storage/paths.js";
import type { ModelReference } from "../../../src/shared/types.js";
import {
  CreateFakeTimers,
  CreateStorage,
  CreateTestConfigWithRoot,
  CreateTestModelBundle,
  FakePiSession,
  WaitForManifestUpdated,
  WithFakeRepoAsync,
} from "./helpers.js";
import { CacheTestWorkspace } from "../../storage/helpers.js";

function ResolveOpenAiTestModel(bundle: ReturnType<typeof CreateTestModelBundle>)
{
  const model = bundle.modelRegistry.getAll().find((entry) => entry.provider === "openai");
  assert.ok(model);
  return { provider: model.provider, id: model.id };
}

async function CreateTestManager(
  repoRoot: string,
  options: {
    fakeSessions?: Map<string, FakePiSession>;
    summarizer?: (text: string) => Promise<{ chatName: string; description: string }>;
    idleOffloadSeconds?: number;
    timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
  } = {},
)
{
  const config = CreateTestConfigWithRoot(repoRoot);
  const storagePaths = CreateStorage(repoRoot);
  const modelBundle = CreateTestModelBundle();
  const fakeSessions = options.fakeSessions ?? new Map<string, FakePiSession>();

  return AgentManager.Create({
    config,
    storagePaths,
    modelBundle,
    idleOffloadSeconds: options.idleOffloadSeconds ?? 1,
    setTimeoutFn: options.timers?.setTimeout,
    clearTimeoutFn: options.timers?.clearTimeout,
    summarizer: options.summarizer
      ? async (text) => options.summarizer!(text)
      : undefined,
    createPiSession: async (input) =>
    {
      const fake = new FakePiSession(
        path.basename(input.sessionFilePath, ".jsonl"),
        input.sessionFilePath,
        input.model,
      );
      fakeSessions.set(input.sessionFilePath, fake);
      return fake;
    },
  });
}

async function CreateTestChat(
  manager: AgentManager,
  storagePaths: StoragePaths,
  workspacePath: string,
  model: ModelReference,
)
{
  const { repository, workspace } = await CacheTestWorkspace(storagePaths, workspacePath);
  return manager.createBlankChat(repository.repoId, workspace.workspaceId, model);
}

test("LifecycleEmitter allows lifecycle errors with no subscriber", () =>
{
  const lifecycle = new LifecycleEmitter();

  assert.doesNotThrow(() =>
  {
    lifecycle.EmitError({
      key: {
        repoId: "repo_123456789012",
        workspaceId: "workspace_123456",
        chatId: "chat_123456789012",
      },
      code: "test_error",
      message: "test failure",
      fatal: false,
    });
  });

  const received: string[] = [];
  lifecycle.On("error", (event) =>
  {
    received.push(event.code);
  });
  lifecycle.EmitError({
    key: {
      repoId: "repo_123456789012",
      workspaceId: "workspace_123456",
      chatId: "chat_123456789012",
    },
    code: "subscribed_error",
    message: "subscribed failure",
  });

  assert.deepEqual(received, ["subscribed_error"]);
});

test("createBlankChat allocates a shell without writing a manifest", async () =>
{
  await WithFakeRepoAsync(async (repoRoot) =>
  {
    const manager = await CreateTestManager(repoRoot);
    const storagePaths = CreateStorage(repoRoot);
    const model = ResolveOpenAiTestModel(CreateTestModelBundle());
    const rootDirectory = path.join(repoRoot, "projects", "demo");

    const created = await CreateTestChat(manager, storagePaths, rootDirectory, model);

    assert.ok(created.key.repoId.length > 0);
    assert.ok(created.key.workspaceId.length > 0);
    assert.ok(created.key.chatId.length > 0);
    assert.equal(
      await ManifestExists(storagePaths, created.key.repoId, created.key.workspaceId, created.key.chatId),
      false,
    );
  });
});

test("attachSession transitions new sessions to active and supports hot resume", async () =>
{
  await WithFakeRepoAsync(async (repoRoot) =>
  {
    const fakeSessions = new Map<string, FakePiSession>();
    const manager = await CreateTestManager(repoRoot, { fakeSessions });
    const storagePaths = CreateStorage(repoRoot);
    const model = ResolveOpenAiTestModel(CreateTestModelBundle());
    const rootDirectory = path.join(repoRoot, "projects", "demo");
    const created = await CreateTestChat(manager, storagePaths, rootDirectory, model);

    const first = await manager.attachSession(created.key.repoId, created.key.workspaceId, created.key.chatId, "client-a");
    assert.equal(first.state, AgentLifecycleState.Active);
    assert.equal(first.connectedClientCount, 1);

    const second = await manager.attachSession(created.key.repoId, created.key.workspaceId, created.key.chatId, "client-b");
    assert.equal(second.state, AgentLifecycleState.Active);
    assert.equal(second.connectedClientCount, 2);
    assert.equal(fakeSessions.size, 1);
  });
});

test("submitUserMessage accepts before delivery and defers manifest until assistant completion", async () =>
{
  await WithFakeRepoAsync(async (repoRoot) =>
  {
    const fakeSessions = new Map<string, FakePiSession>();
    const manager = await CreateTestManager(repoRoot, {
      fakeSessions,
      summarizer: async (text) => ({
        chatName: "Generated title",
        description: `About ${text}`,
      }),
    });
    const storagePaths = CreateStorage(repoRoot);
    const model = ResolveOpenAiTestModel(CreateTestModelBundle());
    const rootDirectory = path.join(repoRoot, "projects", "demo");
    const created = await CreateTestChat(manager, storagePaths, rootDirectory, model);
    await manager.attachSession(created.key.repoId, created.key.workspaceId, created.key.chatId, "client-a");

    const accepted: string[] = [];
    manager.lifecycle.On("userMessageAccepted", (event) =>
    {
      accepted.push(event.message.messageId);
    });

    await manager.submitUserMessage(created.key, {
      messageId: "user-1",
      text: "Please inspect src/app.ts",
    });

    assert.deepEqual(accepted, ["user-1"]);
    assert.equal(
      await ManifestExists(storagePaths, created.key.repoId, created.key.workspaceId, created.key.chatId),
      false,
    );

    const fake = [...fakeSessions.values()][0];
    assert.equal(fake.promptCalls.length, 1);
    const manifestReady = WaitForManifestUpdated(manager);
    await fake.EmitAssistantTurn();
    await manifestReady;

    assert.equal(
      await ManifestExists(storagePaths, created.key.repoId, created.key.workspaceId, created.key.chatId),
      true,
    );
    const manifest = await ReadManifest(storagePaths, created.key.repoId, created.key.workspaceId, created.key.chatId);
    assert.equal(manifest.chatName, "Generated title");
    assert.equal(manifest.description, "About Please inspect src/app.ts");
  });
});

test("submitUserMessage uses deterministic summary fallback when summarization fails", async () =>
{
  await WithFakeRepoAsync(async (repoRoot) =>
  {
    const fakeSessions = new Map<string, FakePiSession>();
    const manager = await CreateTestManager(repoRoot, {
      fakeSessions,
      summarizer: async () =>
      {
        throw new Error("summarizer failed");
      },
    });
    const storagePaths = CreateStorage(repoRoot);
    const model = ResolveOpenAiTestModel(CreateTestModelBundle());
    const rootDirectory = path.join(repoRoot, "projects", "demo");
    const created = await CreateTestChat(manager, storagePaths, rootDirectory, model);
    await manager.attachSession(
      created.key.repoId,
      created.key.workspaceId,
      created.key.chatId,
      "client-a",
    );

    await manager.submitUserMessage(created.key, {
      messageId: "user-1",
      text: "Fix the flaky websocket reconnect test",
    });

    const fake = [...fakeSessions.values()][0];
    const manifestReady = WaitForManifestUpdated(manager);
    await fake.EmitAssistantTurn();
    await manifestReady;

    const manifest = await ReadManifest(storagePaths, created.key.repoId, created.key.workspaceId, created.key.chatId);
    assert.equal(manifest.chatName, "Fix the flaky websocket reconnect test");
  });
});

test("assistant manifest write failures do not create a manifest", async () =>
{
  await WithFakeRepoAsync(async (repoRoot) =>
  {
    const fakeSessions = new Map<string, FakePiSession>();
    const manager = await CreateTestManager(repoRoot, {
      fakeSessions,
      summarizer: async () => ({
        chatName: "Generated title",
        description: "Generated description",
      }),
    });
    const storagePaths = CreateStorage(repoRoot);
    const model = ResolveOpenAiTestModel(CreateTestModelBundle());
    const rootDirectory = path.join(repoRoot, "projects", "demo");
    const created = await CreateTestChat(manager, storagePaths, rootDirectory, model);
    await manager.attachSession(
      created.key.repoId,
      created.key.workspaceId,
      created.key.chatId,
      "client-a",
    );
    await manager.submitUserMessage(created.key, {
      messageId: "user-1",
      text: "hello",
    });
    const chatsDirectory = ResolveChatsDirectory(
      storagePaths,
      created.key.repoId,
      created.key.workspaceId,
    );
    await rm(chatsDirectory, { recursive: true, force: true });
    await writeFile(chatsDirectory, "not a directory", "utf8");

    const fake = [...fakeSessions.values()][0];
    assert.ok(fake);
    await fake.EmitAssistantTurn();

    assert.equal(
      await ManifestExists(
        storagePaths,
        created.key.repoId,
        created.key.workspaceId,
        created.key.chatId,
      ),
      false,
    );
  });
});

test("submitUserMessage steers or followUps while streaming", async () =>
{
  await WithFakeRepoAsync(async (repoRoot) =>
  {
    const fakeSessions = new Map<string, FakePiSession>();
    const manager = await CreateTestManager(repoRoot, { fakeSessions });
    const storagePaths = CreateStorage(repoRoot);
    const model = ResolveOpenAiTestModel(CreateTestModelBundle());
    const rootDirectory = path.join(repoRoot, "projects", "demo");
    const created = await CreateTestChat(manager, storagePaths, rootDirectory, model);
    await manager.attachSession(
      created.key.repoId,
      created.key.workspaceId,
      created.key.chatId,
      "client-a",
    );
    const fake = [...fakeSessions.values()][0];
    fake.setStreaming(true);

    await manager.submitUserMessage(created.key, {
      messageId: "user-steer",
      text: "change approach",
      steer: true,
    });
    await manager.submitUserMessage(created.key, {
      messageId: "user-follow",
      text: "also check tests",
      steer: false,
    });

    assert.deepEqual(fake.steerCalls, ["change approach"]);
    assert.equal(fake.promptCalls.length, 1);
    assert.equal(fake.promptCalls[0]?.options?.streamingBehavior, "followUp");
  });
});

test("submitUserMessage reports delivery failure without rejecting when no error listener exists", async () =>
{
  await WithFakeRepoAsync(async (repoRoot) =>
  {
    const fakeSessions = new Map<string, FakePiSession>();
    const manager = await CreateTestManager(repoRoot, { fakeSessions });
    const storagePaths = CreateStorage(repoRoot);
    const model = ResolveOpenAiTestModel(CreateTestModelBundle());
    const rootDirectory = path.join(repoRoot, "projects", "demo");
    const created = await CreateTestChat(manager, storagePaths, rootDirectory, model);
    await manager.attachSession(created.key.repoId, created.key.workspaceId, created.key.chatId);
    const fake = [...fakeSessions.values()][0];
    assert.ok(fake);
    fake.prompt = async () =>
    {
      throw new Error("delivery unavailable");
    };

    await manager.submitUserMessage(created.key, {
      messageId: "user-1",
      text: "hello",
    });

    assert.equal(manager.getStatus(created.key)?.error, "delivery unavailable");
  });
});

test("selectModel validates and updates manifest when present", async () =>
{
  await WithFakeRepoAsync(async (repoRoot) =>
  {
    const fakeSessions = new Map<string, FakePiSession>();
    const manager = await CreateTestManager(repoRoot, { fakeSessions });
    const storagePaths = CreateStorage(repoRoot);
    const modelBundle = CreateTestModelBundle();
    const models = modelBundle.modelRegistry.getAll().filter((entry) => entry.provider === "openai");
    assert.ok(models.length >= 1);
    const initialModel = { provider: models[0]!.provider, id: models[0]!.id };
    const nextModel =
      models.length >= 2
        ? { provider: models[1]!.provider, id: models[1]!.id }
        : { provider: models[0]!.provider, id: models[0]!.id };
    const rootDirectory = path.join(repoRoot, "projects", "demo");
    const created = await CreateTestChat(manager, storagePaths, rootDirectory, initialModel);
    await manager.attachSession(
      created.key.repoId,
      created.key.workspaceId,
      created.key.chatId,
      "client-a",
    );

    await manager.submitUserMessage(created.key, {
      messageId: "user-1",
      text: "hello",
    });
    const fake = [...fakeSessions.values()][0];
    const manifestReady = WaitForManifestUpdated(manager);
    await fake.EmitAssistantTurn();
    await manifestReady;

    const modelEvents: string[] = [];
    manager.lifecycle.On("model", (event) =>
    {
      modelEvents.push(`${event.model.provider}/${event.model.id}`);
    });

    await manager.selectModel(created.key, nextModel, "next_turn");

    assert.deepEqual(modelEvents, [`${nextModel.provider}/${nextModel.id}`]);
    assert.equal(fake.model?.id, nextModel.id);
    const manifest = await ReadManifest(storagePaths, created.key.repoId, created.key.workspaceId, created.key.chatId);
    assert.equal(manifest.model.id, nextModel.id);
  });
});

test("cancelTurn aborts the active pi session", async () =>
{
  await WithFakeRepoAsync(async (repoRoot) =>
  {
    const fakeSessions = new Map<string, FakePiSession>();
    const manager = await CreateTestManager(repoRoot, { fakeSessions });
    const storagePaths = CreateStorage(repoRoot);
    const model = ResolveOpenAiTestModel(CreateTestModelBundle());
    const rootDirectory = path.join(repoRoot, "projects", "demo");
    const created = await CreateTestChat(manager, storagePaths, rootDirectory, model);
    await manager.attachSession(created.key.repoId, created.key.workspaceId, created.key.chatId);

    await manager.cancelTurn(created.key);

    const fake = [...fakeSessions.values()][0];
    assert.equal(fake.abortCalls, 1);
  });
});

test("idle offload disposes agents after timeout with no clients", async () =>
{
  await WithFakeRepoAsync(async (repoRoot) =>
  {
    const timers = CreateFakeTimers();
    const fakeSessions = new Map<string, FakePiSession>();
    const manager = await CreateTestManager(repoRoot, {
      fakeSessions,
      idleOffloadSeconds: 1,
      timers,
    });
    const storagePaths = CreateStorage(repoRoot);
    const model = ResolveOpenAiTestModel(CreateTestModelBundle());
    const rootDirectory = path.join(repoRoot, "projects", "demo");
    const created = await CreateTestChat(manager, storagePaths, rootDirectory, model);
    await manager.attachSession(created.key.repoId, created.key.workspaceId, created.key.chatId, "client-a");
    const fake = [...fakeSessions.values()][0];

    manager.markClientDetached(created.key, "client-a");

    const statusIdle = manager.getStatus(created.key);
    assert.equal(statusIdle?.state, AgentLifecycleState.Idle);

    timers.Advance(1000);

    const statusCold = manager.getStatus(created.key);
    assert.equal(statusCold?.state, AgentLifecycleState.Cold);
    assert.equal(fake.disposed, true);
  });
});

test("idle offload waits for all references sharing a client id to detach", async () =>
{
  await WithFakeRepoAsync(async (repoRoot) =>
  {
    const timers = CreateFakeTimers();
    const fakeSessions = new Map<string, FakePiSession>();
    const manager = await CreateTestManager(repoRoot, {
      fakeSessions,
      idleOffloadSeconds: 1,
      timers,
    });
    const storagePaths = CreateStorage(repoRoot);
    const model = ResolveOpenAiTestModel(CreateTestModelBundle());
    const rootDirectory = path.join(repoRoot, "projects", "demo");
    const created = await CreateTestChat(manager, storagePaths, rootDirectory, model);
    await manager.attachSession(created.key.repoId, created.key.workspaceId, created.key.chatId, "shared-client");
    await manager.attachSession(created.key.repoId, created.key.workspaceId, created.key.chatId, "shared-client");
    const fake = [...fakeSessions.values()][0];

    manager.markClientDetached(created.key, "shared-client");
    assert.equal(manager.getStatus(created.key)?.connectedClientCount, 1);

    timers.Advance(1500);

    assert.equal(manager.getStatus(created.key)?.state, AgentLifecycleState.Active);
    assert.equal(fake?.disposed, false);

    manager.markClientDetached(created.key, "shared-client");
    assert.equal(manager.getStatus(created.key)?.connectedClientCount, 0);

    timers.Advance(1500);

    assert.equal(manager.getStatus(created.key)?.state, AgentLifecycleState.Cold);
    assert.equal(fake?.disposed, true);
  });
});

test("idle offload does not run during active runs or tool calls", async () =>
{
  await WithFakeRepoAsync(async (repoRoot) =>
  {
    const timers = CreateFakeTimers();
    const fakeSessions = new Map<string, FakePiSession>();
    const manager = await CreateTestManager(repoRoot, {
      fakeSessions,
      idleOffloadSeconds: 1,
      timers,
    });
    const storagePaths = CreateStorage(repoRoot);
    const model = ResolveOpenAiTestModel(CreateTestModelBundle());
    const rootDirectory = path.join(repoRoot, "projects", "demo");
    const created = await CreateTestChat(manager, storagePaths, rootDirectory, model);
    await manager.attachSession(created.key.repoId, created.key.workspaceId, created.key.chatId, "client-a");
    const fake = [...fakeSessions.values()][0];

    manager.markClientDetached(created.key, "client-a");
    fake.Emit({ type: "agent_start" });
    fake.Emit({ type: "tool_execution_start", toolCallId: "t1", toolName: "read", args: {} });

    timers.Advance(2000);

    assert.equal(fake.disposed, false);
    assert.equal(manager.getStatus(created.key)?.activeToolCount, 1);
  });
});

test("concurrent attachSession callers share one startup", async () =>
{
  await WithFakeRepoAsync(async (repoRoot) =>
  {
    let createCount = 0;
    const fakeSessions = new Map<string, FakePiSession>();
    const config = CreateTestConfigWithRoot(repoRoot);
    const storagePaths = CreateStorage(repoRoot);
    const modelBundle = CreateTestModelBundle();
    const model = ResolveOpenAiTestModel(modelBundle);
    const rootDirectory = path.join(repoRoot, "projects", "demo");

    const manager = await AgentManager.Create({
      config,
      storagePaths,
      modelBundle,
      createPiSession: async (input) =>
      {
        createCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        const fake = new FakePiSession(
          path.basename(input.sessionFilePath, ".jsonl"),
          input.sessionFilePath,
          input.model,
        );
        fakeSessions.set(input.sessionFilePath, fake);
        return fake;
      },
    });

    const created = await CreateTestChat(manager, storagePaths, rootDirectory, model);
    const results = await Promise.all([
      manager.attachSession(created.key.repoId, created.key.workspaceId, created.key.chatId, "a"),
      manager.attachSession(created.key.repoId, created.key.workspaceId, created.key.chatId, "b"),
      manager.attachSession(created.key.repoId, created.key.workspaceId, created.key.chatId, "c"),
    ]);

    assert.equal(createCount, 1);
    assert.ok(results.every((status) => status.state === AgentLifecycleState.Active));
    assert.equal(results[2]?.connectedClientCount, 3);
  });
});

test("attachSession records startup failure in status without an error listener", async () =>
{
  await WithFakeRepoAsync(async (repoRoot) =>
  {
    const config = CreateTestConfigWithRoot(repoRoot);
    const storagePaths = CreateStorage(repoRoot);
    const modelBundle = CreateTestModelBundle();
    const model = ResolveOpenAiTestModel(modelBundle);
    const rootDirectory = path.join(repoRoot, "projects", "demo");
    const manager = await AgentManager.Create({
      config,
      storagePaths,
      modelBundle,
      createPiSession: async () =>
      {
        throw new Error("pi start failed");
      },
    });
    const created = await CreateTestChat(manager, storagePaths, rootDirectory, model);

    await assert.rejects(
      () => manager.attachSession(created.key.repoId, created.key.workspaceId, created.key.chatId),
      (error) =>
        error instanceof AgentManagerError &&
        error.code === "session_start_failed" &&
        error.message === "pi start failed",
    );

    const status = manager.getStatus(created.key);
    assert.equal(status?.state, AgentLifecycleState.Failed);
    assert.equal(status?.error, "pi start failed");
  });
});
