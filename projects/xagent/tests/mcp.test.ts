import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { FakeHarnessAdapter } from "../src/adapters/fake.js";
import { XagentRunManager } from "../src/service/run_manager.js";
import {
  createShutdownController,
  createXagentServer,
  type XagentServer,
} from "../src/service/server.js";
import type { SupervisionPolicy } from "../src/supervision/types.js";

const x_ExpectedToolNames = [
  "xagent_start",
  "xagent_await",
  "xagent_inspect",
  "xagent_message",
  "xagent_interrupt",
  "xagent_close",
] as const;

const testPolicy: SupervisionPolicy = {
  silenceTimeoutMs: 60_000,
  watchdog: {},
};

test("Streamable HTTP MCP initializes and discovers exactly the six controller tools", async () => {
  await withMcpService(async ({ port, client }) => {
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [...x_ExpectedToolNames].sort());
    assert.equal(listed.tools.length, 6);

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
  });
});

test("xagent_start rejects relative cwd with invalid_working_directory and creates no run", async () => {
  await withMcpService(async ({ client, runManager }) => {
    const result = await client.callTool({
      name: "xagent_start",
      arguments: {
        cwd: "relative/worktree",
        prompt: "hello",
        harness: "codex",
      },
    });
    assertInvalidWorkingDirectory(result);
    assert.deepEqual(runManager.listRunIds(), []);
  });
});

test("xagent_start rejects missing cwd with invalid_working_directory and creates no run", async () => {
  await withMcpService(async ({ client, runManager }) => {
    const missing = path.join(tmpdir(), `xagent-missing-${Math.random().toString(36).slice(2)}`);
    const result = await client.callTool({
      name: "xagent_start",
      arguments: {
        cwd: missing,
        prompt: "hello",
        harness: "codex",
      },
    });
    assertInvalidWorkingDirectory(result);
    assert.deepEqual(runManager.listRunIds(), []);
  });
});

test("xagent_start rejects non-directory cwd with invalid_working_directory and creates no run", async () => {
  await withMcpService(async ({ client, runManager }) => {
    const dir = await mkdtemp(path.join(tmpdir(), "xagent-mcp-file-"));
    const filePath = path.join(dir, "not-a-directory");
    await writeFile(filePath, "not a directory\n", "utf8");
    const result = await client.callTool({
      name: "xagent_start",
      arguments: {
        cwd: filePath,
        prompt: "hello",
        harness: "codex",
      },
    });
    assertInvalidWorkingDirectory(result);
    assert.deepEqual(runManager.listRunIds(), []);
  });
});

test("xagent_start accepts an absolute existing directory and returns run_id plus cursor", async () => {
  await withMcpService(async ({ client, runManager }) => {
    const cwd = await mkdtemp(path.join(tmpdir(), "xagent-mcp-ok-"));
    const result = asToolCallResult(
      await client.callTool({
        name: "xagent_start",
        arguments: {
          cwd,
          prompt: "hello from mcp",
          harness: "codex",
        },
      }),
    );
    assert.equal(result.isError ?? false, false);
    const body = structuredToolBody(result);
    assert.equal(typeof body.run_id, "string");
    assert.ok((body.run_id as string).length > 0);
    assert.equal(typeof body.sequence, "number");
    assert.equal(runManager.has(body.run_id as string), true);
    const phase = runManager.inspect(body.run_id as string)?.phase;
    assert.ok(
      phase === "ready" || phase === "running",
      `expected phase ready|running, got ${phase}`,
    );

    const closed = asToolCallResult(
      await client.callTool({
        name: "xagent_close",
        arguments: { run_id: body.run_id },
      }),
    );
    assert.equal(closed.isError ?? false, false);
  });
});

type ToolCallResult = {
  readonly isError?: boolean;
  readonly content?: unknown;
  readonly structuredContent?: unknown;
};

function asToolCallResult(result: unknown): ToolCallResult {
  return result as ToolCallResult;
}

function assertInvalidWorkingDirectory(result: unknown): void {
  const toolResult = asToolCallResult(result);
  assert.equal(toolResult.isError, true);
  const body = structuredToolBody(toolResult);
  assert.equal(body.error, "invalid_working_directory");
}

function structuredToolBody(result: ToolCallResult): Record<string, unknown> {
  if (
    result.structuredContent !== undefined
    && result.structuredContent !== null
    && typeof result.structuredContent === "object"
  ) {
    return result.structuredContent as Record<string, unknown>;
  }
  assert.ok(Array.isArray(result.content));
  const textPart = (result.content as Array<{ type?: string; text?: string }>).find(
    (part) => part.type === "text" && typeof part.text === "string",
  );
  assert.ok(textPart?.text);
  return JSON.parse(textPart.text) as Record<string, unknown>;
}

async function withMcpService(
  run: (context: {
    port: number;
    server: XagentServer;
    runManager: XagentRunManager;
    client: Client;
  }) => Promise<void>,
): Promise<void> {
  const runManager = new XagentRunManager({
    repoRoot: process.cwd(),
    logRoot: path.join(tmpdir(), `xagent-mcp-${Math.random().toString(36).slice(2)}`),
    adapterFactory: () => new FakeHarnessAdapter(),
    policy: testPolicy,
  });
  let server: XagentServer | undefined;
  const shutdownController = createShutdownController({
    closeRuns: async () => {
      await runManager.closeAll();
    },
    closeServer: async () => {
      await server?.close();
    },
  });
  server = createXagentServer({
    bindHost: "127.0.0.1",
    bindPort: 0,
    runManager,
    shutdownController,
  });
  const port = await server.listen();
  const client = new Client({ name: "xagent-mcp-test", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp`),
  );
  try {
    await client.connect(transport);
    await run({ port, server, runManager, client });
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
    if (!shutdownController.wasShutdownRequested()) {
      await server.close();
    }
    await runManager.closeAll();
  }
}
