import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_REALTIME_MODEL,
  type AgentStartConfig,
  type CreateResponseOptions,
  type QueuedEventResult,
  type RealtimeAgentTurnMode,
  type RealtimeEvent,
  type SendMessageOptions,
  type StructuredContextMessage,
  type ToolCallSet,
  type ToolDefinition,
} from "../../src/agent/src/index.js";

test("exports public contracts from the library entry point", () =>
{
  assert.equal(DEFAULT_REALTIME_MODEL, "gpt-realtime-2");

  const tool: ToolDefinition = {
    name: "echo",
    inputSchema: { type: "object" },
    callback: (args) =>
    {
      const value = (args as { value?: number }).value ?? 0;
      return { ok: value > 0 };
    },
  };

  const toolCallSet: ToolCallSet = {
    name: "demo",
    tools: [tool],
  };

  const config: AgentStartConfig = {
    systemPrompt: "system",
    initialContext: "context",
    toolCallSet,
  };

  assert.equal(config.model, undefined);
  assert.equal(config.toolCallSet.tools[0]?.name, "echo");

  const turnMode: RealtimeAgentTurnMode = {
    type: "server_vad",
    silenceDurationMs: 500,
    createResponse: true,
    interruptResponse: true,
  };
  assert.equal(turnMode.type, "server_vad");

  const sendOpts: SendMessageOptions = {
    createResponse: true,
    queuePolicy: "enqueue",
    previousItemId: "item_1",
  };
  assert.equal(sendOpts.createResponse, true);

  const createOpts: CreateResponseOptions = {
    response: { instructions: "hi" },
  };
  assert.deepEqual(createOpts.response, { instructions: "hi" });

  const structured: StructuredContextMessage = {
    kind: "k",
    source: "vscode",
    payload: { a: 1 },
    summary: "s",
  };
  assert.equal(structured.summary, "s");

  const sent: QueuedEventResult = { status: "sent" };
  assert.deepEqual(sent, { status: "sent" });

  const event: RealtimeEvent = {
    type: "session.created",
    session: { id: "sess_123" },
  };

  assert.equal(event.type, "session.created");
});

test("package metadata points to built entry point files", async () =>
{
  const packageJsonUrl = new URL("../../../package.json", import.meta.url);
  const packageJson = JSON.parse(await readFile(packageJsonUrl, "utf8")) as {
    name: string;
    main: string;
    types: string;
    exports: {
      ".": {
        import: string;
        types: string;
      };
    };
  };

  const entryPaths = [
    packageJson.main,
    packageJson.types,
    packageJson.exports["."].import,
    packageJson.exports["."].types,
  ];

  await Promise.all(
    entryPaths.map((entryPath) =>
      access(new URL(`../../../${entryPath}`, import.meta.url)),
    ),
  );

  const packageEntry = await import(packageJson.name);

  assert.equal(packageEntry.DEFAULT_REALTIME_MODEL, DEFAULT_REALTIME_MODEL);
});
