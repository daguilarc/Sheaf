import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

import { x_serviceName, x_serviceVersion } from "../../../src/server/constants.js";
import { AppendEnvelope, WriteInitialManifest } from "../../../src/storage/index.js";
import { ResolveManifestFilePath } from "../../../src/storage/paths.js";
import { CreatePile } from "../../../src/storage/piles.js";
import { AllocateSessionShell } from "../../../src/storage/sessionLog.js";
import {
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

test("pile endpoints list and create piles with validation errors", async () =>
{
  await WithTestServer(async ({ baseUrl }) =>
  {
    const empty = await RequestJson(baseUrl, "GET", "/api/piles");
    assert.equal(empty.status, 200);
    assert.deepEqual((empty.body as { piles: unknown[] }).piles, []);

    const created = await RequestJson(baseUrl, "POST", "/api/piles", { pile: "work" });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body, {
      pile: "work",
      sessionCount: 0,
      latestUpdatedAt: null,
    });

    const listed = await RequestJson(baseUrl, "GET", "/api/piles");
    assert.equal(listed.status, 200);
    assert.equal((listed.body as { piles: Array<{ pile: string }> }).piles.length, 1);

    const invalid = await RequestJson(baseUrl, "POST", "/api/piles", { pile: "../escape" });
    assert.equal(invalid.status, 400);
    assert.equal(ErrorBody(invalid.body).code, "invalid_pile");
  });
});

test("session endpoints list, read, and create blank sessions", async () =>
{
  await WithTestServer(async ({ baseUrl, agentManager }) =>
  {
    await RequestJson(baseUrl, "POST", "/api/piles", { pile: "default" });
    const model = ResolveOpenAiTestModel(agentManager);

    const missingPile = await RequestJson(baseUrl, "GET", "/api/piles/missing/sessions");
    assert.equal(missingPile.status, 404);
    assert.equal(ErrorBody(missingPile.body).code, "pile_not_found");

    const created = await RequestJson(baseUrl, "POST", "/api/piles/default/sessions", {
      rootDirectory: "projects/demo",
      model,
    });
    assert.equal(created.status, 201);

    const body = created.body as {
      sessionId: string;
      provisionalSession: { rootDirectory: string; model: typeof model };
      webSocketUrl: string;
    };

    assert.equal(typeof body.sessionId, "string");
    assert.equal(body.provisionalSession.rootDirectory, "projects/demo");
    assert.deepEqual(body.provisionalSession.model, model);
    assert.equal(
      body.webSocketUrl,
      `/ws/chat?p=default&session=${encodeURIComponent(body.sessionId)}`,
    );

    const manifestPath = ResolveManifestFilePath(
      agentManager.storagePaths,
      "default",
      body.sessionId,
    );
    await assert.rejects(async () => access(manifestPath));

    const invalidRoot = await RequestJson(baseUrl, "POST", "/api/piles/default/sessions", {
      rootDirectory: "missing/root",
      model,
    });
    assert.equal(invalidRoot.status, 400);
    assert.equal(ErrorBody(invalidRoot.body).code, "invalid_root_directory");

    const listed = await RequestJson(baseUrl, "GET", "/api/piles/default/sessions");
    assert.equal(listed.status, 200);
    assert.deepEqual((listed.body as { sessions: unknown[] }).sessions, []);

    await WriteInitialManifest(agentManager.storagePaths, {
      pile: "default",
      sessionId: body.sessionId,
      chatName: "Listed chat",
      description: "desc",
      rootDirectory: "projects/demo",
      model,
      extensionVersion: "0.1.0",
    });

    const listedAfter = await RequestJson(baseUrl, "GET", "/api/piles/default/sessions");
    assert.equal((listedAfter.body as { sessions: Array<{ sessionId: string }> }).sessions.length, 1);

    const one = await RequestJson(
      baseUrl,
      "GET",
      `/api/piles/default/sessions/${body.sessionId}`,
    );
    assert.equal(one.status, 200);
    assert.equal(
      (one.body as { manifest: { sessionId: string } }).manifest.sessionId,
      body.sessionId,
    );

    const missingManifest = await RequestJson(
      baseUrl,
      "GET",
      "/api/piles/default/sessions/doesnotexist123",
    );
    assert.equal(missingManifest.status, 404);
    assert.equal(ErrorBody(missingManifest.body).code, "manifest_not_found");
  });
});

test("history fallback supports latest, before, after, and snapshots", async () =>
{
  await WithTestServer(async ({ baseUrl, agentManager }) =>
  {
    await CreatePile(agentManager.storagePaths, "default");
    const shell = await AllocateSessionShell(agentManager.storagePaths, "default", "projects/demo", {
      provider: "openai",
      id: "gpt-5-codex",
    });

    for (let sequence = 1; sequence <= 6; sequence += 1)
    {
      await AppendEnvelope(agentManager.storagePaths, "default", shell.sessionId, {
        kind: "agui.event",
        pile: "default",
        sessionId: shell.sessionId,
        payload: {
          type: "TEXT_MESSAGE_CONTENT",
          messageId: "assistant-1",
          delta: `chunk-${sequence}`,
        },
      });
    }

    const latest = await RequestJson(
      baseUrl,
      "GET",
      `/api/piles/default/sessions/${shell.sessionId}/history?limit=2`,
    );
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

    const before = await RequestJson(
      baseUrl,
      "GET",
      `/api/piles/default/sessions/${shell.sessionId}/history?before=5&limit=2`,
    );
    assert.equal(before.status, 200);
    assert.deepEqual(
      (before.body as { events: Array<{ delta?: string }> }).events.map((event) => event.delta),
      ["chunk-3", "chunk-4"],
    );

    const after = await RequestJson(
      baseUrl,
      "GET",
      `/api/piles/default/sessions/${shell.sessionId}/history?after=4&limit=2`,
    );
    assert.equal(after.status, 200);
    assert.deepEqual(
      (after.body as { events: Array<{ delta?: string }> }).events.map((event) => event.delta),
      ["chunk-5", "chunk-6"],
    );

    const snapshots = await RequestJson(
      baseUrl,
      "GET",
      `/api/piles/default/sessions/${shell.sessionId}/history?prefer=snapshots&limit=6`,
    );
    assert.equal(snapshots.status, 200);
    assert.ok(Array.isArray((snapshots.body as { messages: unknown[] }).messages));

    const invalid = await RequestJson(
      baseUrl,
      "GET",
      `/api/piles/default/sessions/${shell.sessionId}/history?before=3&after=4`,
    );
    assert.equal(invalid.status, 400);
    assert.equal(ErrorBody(invalid.body).code, "invalid_history_request");
  });
});

test("unsupported methods and routes return stable errors", async () =>
{
  await WithTestServer(async ({ baseUrl }) =>
  {
    const method = await RequestJson(baseUrl, "POST", "/api/health");
    assert.equal(method.status, 405);
    assert.equal(ErrorBody(method.body).code, "method_not_allowed");

    const missing = await RequestJson(baseUrl, "GET", "/api/unknown");
    assert.equal(missing.status, 404);
    assert.equal(ErrorBody(missing.body).code, "not_found");

    const barePile = await fetch(`${baseUrl}/api/piles/work`, {
      method: "GET",
      signal: AbortSignal.timeout(1000),
    });
    assert.equal(barePile.status, 404);
    assert.equal(ErrorBody(await barePile.json()).code, "not_found");

    const barePilePost = await fetch(`${baseUrl}/api/piles/work`, {
      method: "POST",
      signal: AbortSignal.timeout(1000),
    });
    assert.equal(barePilePost.status, 404);
    assert.equal(ErrorBody(await barePilePost.json()).code, "not_found");
  });
});
