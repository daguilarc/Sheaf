import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_REALTIME_MODEL,
  type AgentStartConfig,
  type RealtimeEvent,
  type ToolCallSet,
  type ToolDefinition,
} from "../src/index.js";

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

  const event: RealtimeEvent = {
    type: "session.created",
    session: { id: "sess_123" },
  };

  assert.equal(event.type, "session.created");
});

test("package metadata points to built entry point files", async () =>
{
  const packageJsonUrl = new URL("../../package.json", import.meta.url);
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
      access(new URL(`../../${entryPath}`, import.meta.url)),
    ),
  );

  const packageEntry = await import(packageJson.name);

  assert.equal(packageEntry.DEFAULT_REALTIME_MODEL, DEFAULT_REALTIME_MODEL);
});
