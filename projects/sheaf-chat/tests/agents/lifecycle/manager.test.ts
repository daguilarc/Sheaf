import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { AgentManager } from "../../../src/agents/manager.js";
import { AgentLifecycleState } from "../../../src/shared/types.js";
import { ReadManifest } from "../../../src/storage/manifests.js";
import { CreatePile, ManifestExists } from "../../../src/storage/piles.js";
import {
  CreateFakeTimers,
  CreateStorage,
  CreateTestConfigWithRoot,
  CreateTestModelBundle,
  FakePiSession,
  WaitForManifestUpdated,
  WithFakeRepoAsync,
} from "./helpers.js";

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

test("createBlankSession allocates a shell without writing a manifest", async () =>
{
  await WithFakeRepoAsync(async (repoRoot) =>
  {
    const manager = await CreateTestManager(repoRoot);
    const storagePaths = CreateStorage(repoRoot);
    await CreatePile(storagePaths, "default");
    const model = ResolveOpenAiTestModel(CreateTestModelBundle());

    const created = await manager.createBlankSession(
      "default",
      path.join(repoRoot, "projects", "demo"),
      model,
    );

    assert.equal(created.key.pile, "default");
    assert.ok(created.key.sessionId.length > 0);
    assert.equal(
      await ManifestExists(storagePaths, "default", created.key.sessionId),
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
    await CreatePile(storagePaths, "default");
    const model = ResolveOpenAiTestModel(CreateTestModelBundle());
    const rootDirectory = path.join(repoRoot, "projects", "demo");
    const created = await manager.createBlankSession("default", rootDirectory, model);

    const first = await manager.attachSession("default", created.key.sessionId, "client-a");
    assert.equal(first.state, AgentLifecycleState.Active);
    assert.equal(first.connectedClientCount, 1);

    const second = await manager.attachSession("default", created.key.sessionId, "client-b");
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
    await CreatePile(storagePaths, "default");
    const model = ResolveOpenAiTestModel(CreateTestModelBundle());
    const rootDirectory = path.join(repoRoot, "projects", "demo");
    const created = await manager.createBlankSession("default", rootDirectory, model);
    await manager.attachSession("default", created.key.sessionId, "client-a");

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
      await ManifestExists(storagePaths, "default", created.key.sessionId),
      false,
    );

    const fake = [...fakeSessions.values()][0];
    assert.equal(fake.promptCalls.length, 1);
    const manifestReady = WaitForManifestUpdated(manager);
    await fake.EmitAssistantTurn();
    await manifestReady;

    assert.equal(
      await ManifestExists(storagePaths, "default", created.key.sessionId),
      true,
    );
    const manifest = await ReadManifest(storagePaths, "default", created.key.sessionId);
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
    await CreatePile(storagePaths, "default");
    const model = ResolveOpenAiTestModel(CreateTestModelBundle());
    const rootDirectory = path.join(repoRoot, "projects", "demo");
    const created = await manager.createBlankSession("default", rootDirectory, model);
    await manager.attachSession("default", created.key.sessionId);

    await manager.submitUserMessage(created.key, {
      messageId: "user-1",
      text: "Fix the flaky websocket reconnect test",
    });

    const fake = [...fakeSessions.values()][0];
    const manifestReady = WaitForManifestUpdated(manager);
    await fake.EmitAssistantTurn();
    await manifestReady;

    const manifest = await ReadManifest(storagePaths, "default", created.key.sessionId);
    assert.equal(manifest.chatName, "Fix the flaky websocket reconnect test");
  });
});

test("submitUserMessage steers or followUps while streaming", async () =>
{
  await WithFakeRepoAsync(async (repoRoot) =>
  {
    const fakeSessions = new Map<string, FakePiSession>();
    const manager = await CreateTestManager(repoRoot, { fakeSessions });
    const storagePaths = CreateStorage(repoRoot);
    await CreatePile(storagePaths, "default");
    const model = ResolveOpenAiTestModel(CreateTestModelBundle());
    const rootDirectory = path.join(repoRoot, "projects", "demo");
    const created = await manager.createBlankSession("default", rootDirectory, model);
    await manager.attachSession("default", created.key.sessionId);
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

test("selectModel validates and updates manifest when present", async () =>
{
  await WithFakeRepoAsync(async (repoRoot) =>
  {
    const fakeSessions = new Map<string, FakePiSession>();
    const manager = await CreateTestManager(repoRoot, { fakeSessions });
    const storagePaths = CreateStorage(repoRoot);
    await CreatePile(storagePaths, "default");
    const modelBundle = CreateTestModelBundle();
    const models = modelBundle.modelRegistry.getAll().filter((entry) => entry.provider === "openai");
    assert.ok(models.length >= 1);
    const initialModel = { provider: models[0]!.provider, id: models[0]!.id };
    const nextModel =
      models.length >= 2
        ? { provider: models[1]!.provider, id: models[1]!.id }
        : { provider: models[0]!.provider, id: models[0]!.id };
    const rootDirectory = path.join(repoRoot, "projects", "demo");
    const created = await manager.createBlankSession("default", rootDirectory, initialModel);
    await manager.attachSession("default", created.key.sessionId);

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
    const manifest = await ReadManifest(storagePaths, "default", created.key.sessionId);
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
    await CreatePile(storagePaths, "default");
    const model = ResolveOpenAiTestModel(CreateTestModelBundle());
    const rootDirectory = path.join(repoRoot, "projects", "demo");
    const created = await manager.createBlankSession("default", rootDirectory, model);
    await manager.attachSession("default", created.key.sessionId);

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
    await CreatePile(storagePaths, "default");
    const model = ResolveOpenAiTestModel(CreateTestModelBundle());
    const rootDirectory = path.join(repoRoot, "projects", "demo");
    const created = await manager.createBlankSession("default", rootDirectory, model);
    await manager.attachSession("default", created.key.sessionId, "client-a");
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
    await CreatePile(storagePaths, "default");
    const model = ResolveOpenAiTestModel(CreateTestModelBundle());
    const rootDirectory = path.join(repoRoot, "projects", "demo");
    const created = await manager.createBlankSession("default", rootDirectory, model);
    await manager.attachSession("default", created.key.sessionId, "client-a");
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
    await CreatePile(storagePaths, "default");
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

    const created = await manager.createBlankSession("default", rootDirectory, model);
    const results = await Promise.all([
      manager.attachSession("default", created.key.sessionId, "a"),
      manager.attachSession("default", created.key.sessionId, "b"),
      manager.attachSession("default", created.key.sessionId, "c"),
    ]);

    assert.equal(createCount, 1);
    assert.ok(results.every((status) => status.state === AgentLifecycleState.Active));
    assert.equal(results[2]?.connectedClientCount, 3);
  });
});
