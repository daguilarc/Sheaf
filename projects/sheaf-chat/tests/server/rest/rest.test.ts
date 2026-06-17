import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

import WebSocket from "ws";

import { x_serviceName, x_serviceVersion } from "../../../src/server/constants.js";
import { AppendEnvelope, WriteInitialManifest } from "../../../src/storage/index.js";
import { ResolveManifestFilePath } from "../../../src/storage/paths.js";
import {
  CreateWorkspaceChatViaApi,
  RequestJson,
  ResolveOpenAiTestModel,
  WithTestServer,
} from "./helpers.js";

function ErrorBody(body: unknown): { code: string; message: string }
{
  assert.ok(body !== null && typeof body === "object");
  const error = (body as { error?: { code?: string; message?: string } }).error;
  assert.ok(error);
  assert.equal(typeof error.code, "string");
  assert.equal(typeof error.message, "string");
  return {
    code: error.code as string,
    message: error.message as string,
  };
}

function WorkspaceChatsPath(repoId: string, workspaceId: string): string
{
  return `/api/repositories/${encodeURIComponent(repoId)}/workspaces/${encodeURIComponent(workspaceId)}/chats`;
}

function ChatPath(repoId: string, workspaceId: string, chatId: string): string
{
  return `${WorkspaceChatsPath(repoId, workspaceId)}/${encodeURIComponent(chatId)}`;
}

function WebSocketUrl(baseUrl: string, route: string): string
{
  return `${baseUrl.replace(/^http/, "ws")}${route}`;
}

async function RequestWebSocketUpgradeStatus(baseUrl: string, route: string): Promise<number>
{
  return new Promise<number>((resolve, reject) =>
  {
    const socket = new WebSocket(WebSocketUrl(baseUrl, route));
    let settled = false;

    socket.once("unexpected-response", (_request, response) =>
    {
      settled = true;
      resolve(response.statusCode ?? 0);
    });
    socket.once("open", () =>
    {
      socket.close();
      if (!settled)
      {
        settled = true;
        reject(new Error("websocket upgrade unexpectedly succeeded"));
      }
    });
    socket.once("error", (error) =>
    {
      if (!settled)
      {
        settled = true;
        reject(error);
      }
    });
  });
}

test("GET /health returns conductor-compatible service health", async () =>
{
  await WithTestServer(async ({ baseUrl }) =>
  {
    const response = await RequestJson(baseUrl, "GET", "/health");
    assert.equal(response.status, 200);

    const body = response.body as {
      healthy: boolean;
      uptime: number;
    };

    assert.equal(body.healthy, true);
    assert.equal(typeof body.uptime, "number");
    assert.ok(body.uptime >= 0);
  });
});

test("POST /exit returns service-contract body and schedules shutdown after response", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const response = await RequestJson(handle.baseUrl, "POST", "/exit");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { exiting: true });
    assert.equal(handle.scheduledShutdownCount(), 1);

    await handle.runScheduledShutdown();
  }, { holdShutdown: true });
});

test("POST /exit is idempotent and non-exit requests return not_found during shutdown", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const first = await RequestJson(handle.baseUrl, "POST", "/exit");
    const second = await RequestJson(handle.baseUrl, "POST", "/exit");
    const health = await RequestJson(handle.baseUrl, "GET", "/health");
    const wrongMethod = await RequestJson(handle.baseUrl, "GET", "/exit");

    assert.equal(first.status, 200);
    assert.deepEqual(first.body, { exiting: true });
    assert.equal(second.status, 200);
    assert.deepEqual(second.body, { exiting: true });
    assert.equal(handle.scheduledShutdownCount(), 1);
    assert.equal(health.status, 404);
    assert.equal(ErrorBody(health.body).code, "not_found");
    assert.equal(wrongMethod.status, 405);
    assert.equal(ErrorBody(wrongMethod.body).code, "method_not_allowed");

    await handle.runScheduledShutdown();
  }, { holdShutdown: true });
});

test("websocket upgrades are rejected with 404 during shutdown", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const exit = await RequestJson(handle.baseUrl, "POST", "/exit");
    assert.equal(exit.status, 200);

    const status = await RequestWebSocketUpgradeStatus(
      handle.baseUrl,
      "/ws/chat?repo=test&workspace=test&chat=test",
    );
    assert.equal(status, 404);

    await handle.runScheduledShutdown();
  }, { holdShutdown: true });
});

test("GET /api/health returns service metadata without secrets", async () =>
{
  await WithTestServer(async ({ baseUrl, config }) =>
  {
    const response = await RequestJson(baseUrl, "GET", "/api/health");
    assert.equal(response.status, 200);

    const body = response.body as {
      service: string;
      version: string;
      status: string;
      dependencies: {
        localInference: { configured: boolean; available: boolean };
        openAi: { configured: boolean };
      };
    };

    assert.equal(body.service, x_serviceName);
    assert.equal(body.version, x_serviceVersion);
    assert.equal(body.status, "ok");
    assert.equal(body.dependencies.localInference.configured, false);
    assert.equal(body.dependencies.localInference.available, false);
    assert.equal(body.dependencies.openAi.configured, config.openAiApiKey !== null);
    assert.equal(JSON.stringify(body).includes("test-key"), false);
  });
});

test("GET /api/models returns availability metadata", async () =>
{
  await WithTestServer(async ({ baseUrl, agentManager }) =>
  {
    const response = await RequestJson(baseUrl, "GET", "/api/models");
    assert.equal(response.status, 200);

    const body = response.body as {
      models: Array<{ provider: string; id: string; available: boolean }>;
    };

    assert.ok(body.models.length > 0);
    assert.ok(body.models.some((model) => model.provider === "openai"));
    assert.deepEqual(body.models, agentManager.listModels());
  });
});

test("removed pile endpoints return not_found", async () =>
{
  await WithTestServer(async ({ baseUrl }) =>
  {
    const listed = await RequestJson(baseUrl, "GET", "/api/piles");
    assert.equal(listed.status, 404);
    assert.equal(ErrorBody(listed.body).code, "not_found");

    const created = await RequestJson(baseUrl, "POST", "/api/piles", { pile: "work" });
    assert.equal(created.status, 404);
    assert.equal(ErrorBody(created.body).code, "not_found");
  });
});

test("workspace chat endpoints list, read, and create blank chats", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const { baseUrl, agentManager } = handle;
    const model = ResolveOpenAiTestModel(agentManager);
    const created = await CreateWorkspaceChatViaApi(handle);

    const manifestPath = ResolveManifestFilePath(
      agentManager.storagePaths,
      created.repoId,
      created.workspaceId,
      created.chatId,
    );
    await assert.rejects(async () => access(manifestPath));

    const listed = await RequestJson(
      baseUrl,
      "GET",
      WorkspaceChatsPath(created.repoId, created.workspaceId),
    );
    assert.equal(listed.status, 200);
    assert.deepEqual((listed.body as { chats: unknown[] }).chats, []);

    await WriteInitialManifest(agentManager.storagePaths, {
      repoId: created.repoId,
      workspaceId: created.workspaceId,
      chatId: created.chatId,
      repositoryPath: created.workspacePath,
      workspacePath: created.workspacePath,
      chatName: "Listed chat",
      description: "desc",
      rootDirectory: created.workspacePath,
      model,
      extensionVersion: "0.1.0",
    });

    const listedAfter = await RequestJson(
      baseUrl,
      "GET",
      WorkspaceChatsPath(created.repoId, created.workspaceId),
    );
    assert.equal(
      (listedAfter.body as { chats: Array<{ chatId: string }> }).chats[0]?.chatId,
      created.chatId,
    );

    const one = await RequestJson(
      baseUrl,
      "GET",
      ChatPath(created.repoId, created.workspaceId, created.chatId),
    );
    assert.equal(one.status, 200);
    assert.equal(
      (one.body as { manifest: { chatId: string; workspaceId: string } }).manifest.workspaceId,
      created.workspaceId,
    );

    const missingManifest = await RequestJson(
      baseUrl,
      "GET",
      ChatPath(created.repoId, created.workspaceId, "doesnotexist12345"),
    );
    assert.equal(missingManifest.status, 404);
    assert.equal(ErrorBody(missingManifest.body).code, "manifest_not_found");
  });
});

test("workspace chat creation ignores client-provided root directory", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const model = ResolveOpenAiTestModel(handle.agentManager);
    const created = await CreateWorkspaceChatViaApi(handle);
    const response = await RequestJson(
      handle.baseUrl,
      "POST",
      WorkspaceChatsPath(created.repoId, created.workspaceId),
      { rootDirectory: "/tmp/escape", model },
    );

    assert.equal(response.status, 201);
    const body = response.body as {
      provisionalChat: { rootDirectory: string };
      webSocketUrl: string;
    };
    assert.equal(body.provisionalChat.rootDirectory, created.workspacePath);
    assert.match(body.webSocketUrl, /^\/ws\/chat\?repo=/);
    assert.equal(body.webSocketUrl.includes("workspace="), true);
    assert.equal(body.webSocketUrl.includes("chat="), true);
  });
});

test("history endpoint supports latest, before, after, snapshots, and invalid requests", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const created = await CreateWorkspaceChatViaApi(handle);

    for (let sequence = 1; sequence <= 6; sequence += 1)
    {
      await AppendEnvelope(
        handle.agentManager.storagePaths,
        created.repoId,
        created.workspaceId,
        created.chatId,
        {
          kind: "agui.event",
          repoId: created.repoId,
          workspaceId: created.workspaceId,
          chatId: created.chatId,
          payload: {
            type: "TEXT_MESSAGE_CONTENT",
            messageId: "assistant-1",
            delta: `chunk-${sequence}`,
          },
        },
      );
    }

    const historyPath = `${ChatPath(created.repoId, created.workspaceId, created.chatId)}/history`;
    const latest = await RequestJson(handle.baseUrl, "GET", `${historyPath}?limit=2`);
    assert.equal(latest.status, 200);

    const latestBody = latest.body as {
      direction: string;
      events: Array<{ type: string }>;
      envelopes: unknown[];
      hasMoreBefore: boolean;
    };
    assert.equal(latestBody.direction, "latest");
    assert.equal(latestBody.events.length, 2);
    assert.equal(latestBody.envelopes.length, 2);
    assert.equal(latestBody.hasMoreBefore, true);

    const before = await RequestJson(handle.baseUrl, "GET", `${historyPath}?before=5&limit=2`);
    assert.equal(before.status, 200);
    assert.deepEqual(
      (before.body as { events: Array<{ delta?: string }> }).events.map((event) => event.delta),
      ["chunk-3", "chunk-4"],
    );

    const after = await RequestJson(handle.baseUrl, "GET", `${historyPath}?after=4&limit=2`);
    assert.equal(after.status, 200);
    assert.deepEqual(
      (after.body as { events: Array<{ delta?: string }> }).events.map((event) => event.delta),
      ["chunk-5", "chunk-6"],
    );

    const snapshots = await RequestJson(
      handle.baseUrl,
      "GET",
      `${historyPath}?prefer=snapshots&limit=6`,
    );
    assert.equal(snapshots.status, 200);
    assert.ok(Array.isArray((snapshots.body as { messages: unknown[] }).messages));

    const invalid = await RequestJson(
      handle.baseUrl,
      "GET",
      `${historyPath}?before=3&after=4`,
    );
    assert.equal(invalid.status, 400);
    assert.equal(ErrorBody(invalid.body).code, "invalid_history_request");
  });
});
