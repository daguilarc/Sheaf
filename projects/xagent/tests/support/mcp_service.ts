import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { FakeHarnessAdapter } from "../../src/adapters/fake.js";
import type { HarnessAdapter } from "../../src/adapters/types.js";
import { createXagentMcpHandler } from "../../src/service/mcp.js";
import { XagentRunManager } from "../../src/service/run_manager.js";
import type { SddManager } from "../../src/service/sdd_manager.js";
import { CreateSddStore } from "../../src/service/sdd_store.js";
import {
  createShutdownController,
  createXagentServer,
  type XagentServer,
} from "../../src/service/server.js";
import type { SupervisionPolicy } from "../../src/supervision/types.js";

export type ToolCallResult = {
  readonly isError?: boolean;
  readonly content?: unknown;
  readonly structuredContent?: unknown;
};

export function asToolCallResult(result: unknown): ToolCallResult
{
  return result as ToolCallResult;
}

export function structuredToolBody(result: ToolCallResult): Record<string, unknown>
{
  if (
    result.structuredContent !== undefined
    && result.structuredContent !== null
    && typeof result.structuredContent === "object"
  )
  {
    return result.structuredContent as Record<string, unknown>;
  }
  assert.ok(Array.isArray(result.content));
  const textPart = (result.content as Array<{ type?: string; text?: string }>).find(
    (part) => part.type === "text" && typeof part.text === "string",
  );
  assert.ok(textPart?.text);
  return JSON.parse(textPart.text) as Record<string, unknown>;
}

export function assertToolSucceeded(result: ToolCallResult): void
{
  assert.equal(result.isError ?? false, false);
}

export function assertInvalidWorkingDirectory(result: unknown): void
{
  const toolResult = asToolCallResult(result);
  assert.equal(toolResult.isError, true);
  const body = structuredToolBody(toolResult);
  assert.equal(body.error, "invalid_working_directory");
}

export type McpServiceContext = {
  readonly port: number;
  readonly server: XagentServer;
  readonly runManager: XagentRunManager;
  readonly client: Client;
  readonly logRoot: string;
};

export type WithMcpServiceOptions = {
  readonly includeSddManager?: boolean;
  readonly repoRoot?: string;
  readonly logRoot?: string;
  readonly policy?: SupervisionPolicy;
  readonly adapterFactory?: () => HarnessAdapter;
  readonly sddManager?: SddManager;
  readonly sddStore?: ReturnType<typeof CreateSddStore>;
  readonly createSddManager?: (deps: {
    readonly runManager: XagentRunManager;
    readonly repoRoot: string;
    readonly logRoot: string;
  }) => {
    readonly manager: SddManager;
    readonly store: ReturnType<typeof CreateSddStore>;
  };
  readonly clientName?: string;
};

export type StartedMcpService = {
  startRun(prompt: string): Promise<{ run_id: string; sequence: number }>;
  await(
    runId: string,
    afterSequence: number,
    deadlineSeconds: number,
  ): Promise<{ event: string }>;
  submit(runId: string, text: string): Promise<void>;
  close(): Promise<void>;
  readonly runManager: XagentRunManager;
  readonly logRoot: string;
};

export type StartMcpServiceOptions = {
  readonly repoRoot?: string;
  readonly logRoot?: string;
  readonly policy?: SupervisionPolicy;
  readonly adapterFactory?: () => HarnessAdapter;
};

// Lightweight run-manager harness for await/submit filter tests that do not
// need a live MCP HTTP server. Later plan tasks grow this with SDD helpers.
//
export async function startMcpService(
  options: StartMcpServiceOptions = {},
): Promise<StartedMcpService>
{
  // Own only what we created: a caller-supplied logRoot belongs to the caller
  // (Task 9's restart tests reopen one across two services), but the cwd is
  // always ours. Mirrors withMcpService's ownsLogRoot handling below.
  //
  const ownsLogRoot = options.logRoot === undefined;
  const logRoot = options.logRoot ?? await mkdtemp(path.join(tmpdir(), "xagent-await-filter-"));
  const cwd = await mkdtemp(path.join(tmpdir(), "xagent-await-cwd-"));
  const runManager = new XagentRunManager({
    repoRoot: options.repoRoot ?? process.cwd(),
    logRoot,
    adapterFactory: options.adapterFactory ?? (() => new FakeHarnessAdapter()),
    policy: options.policy ?? {
      silenceTimeoutMs: 600_000,
      watchdog: {},
    },
  });
  return {
    runManager,
    logRoot,
    startRun(prompt: string)
    {
      return runManager.startRun({
        cwd,
        prompt,
        harness: "codex",
        mode: "subagent",
      });
    },
    await(runId: string, afterSequence: number, deadlineSeconds: number)
    {
      return runManager.awaitRun({
        run_id: runId,
        after_sequence: afterSequence,
        deadline_seconds: deadlineSeconds,
      });
    },
    submit(runId: string, text: string)
    {
      return runManager.submit(runId, text);
    },
    async close()
    {
      await runManager.closeAll();
      await rm(cwd, { recursive: true, force: true });
      if (ownsLogRoot)
      {
        await rm(logRoot, { recursive: true, force: true });
      }
    },
  };
}

export async function withMcpService(
  run: (context: McpServiceContext) => Promise<void>,
  options: WithMcpServiceOptions = {},
): Promise<void>
{
  const includeSddManager = options.includeSddManager ?? true;
  const repoRoot = options.repoRoot ?? process.cwd();
  const ownsLogRoot = options.logRoot === undefined;
  const logRoot = options.logRoot ?? await mkdtemp(path.join(tmpdir(), "xagent-mcp-"));
  const runManager = new XagentRunManager({
    repoRoot,
    logRoot,
    adapterFactory: options.adapterFactory ?? (() => new FakeHarnessAdapter()),
    policy: options.policy ?? {
      silenceTimeoutMs: 60_000,
      watchdog: {},
    },
  });
  let sddStore: ReturnType<typeof CreateSddStore> | undefined = options.sddStore;
  let sddManager: SddManager | undefined = includeSddManager ? options.sddManager : undefined;
  if (includeSddManager && sddManager === undefined && options.createSddManager !== undefined)
  {
    const created = options.createSddManager({ runManager, repoRoot, logRoot });
    sddManager = created.manager;
    sddStore = created.store;
  }
  if (includeSddManager && sddManager === undefined && options.createSddManager === undefined)
  {
    throw new Error(
      "withMcpService requires sddManager or createSddManager when includeSddManager is true.",
    );
  }

  let server: XagentServer | undefined;
  const shutdownController = createShutdownController({
    closeRuns: async () =>
    {
      await runManager.closeAll();
      sddStore?.Close();
    },
    closeServer: async () =>
    {
      await server?.close();
    },
  });
  const allowedHosts = new Set<string>([
    "127.0.0.1",
    "localhost",
    "[::1]",
    "127.0.0.1:9005",
    "localhost:9005",
  ]);
  const allowedOrigins = new Set<string>([
    "http://127.0.0.1",
    "http://localhost",
    "http://[::1]",
    "http://127.0.0.1:9005",
    "http://localhost:9005",
  ]);
  const mcpHandler = createXagentMcpHandler({
    runManager,
    ...(sddManager === undefined ? {} : { sddManager }),
    getAllowedHosts: () => [...allowedHosts],
    getAllowedOrigins: () => [...allowedOrigins],
  });
  server = createXagentServer({
    bindHost: "127.0.0.1",
    bindPort: 0,
    runManager,
    shutdownController,
    mcpHandler,
  });
  const port = await server.listen();
  allowedHosts.add(`127.0.0.1:${port}`);
  allowedHosts.add(`localhost:${port}`);
  allowedOrigins.add(`http://127.0.0.1:${port}`);
  allowedOrigins.add(`http://localhost:${port}`);
  const client = new Client({
    name: options.clientName ?? "xagent-mcp-test",
    version: "0.0.0",
  });
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp`),
  );
  try
  {
    await client.connect(transport);
    await run({ port, server, runManager, client, logRoot });
  }
  finally
  {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
    if (!shutdownController.wasShutdownRequested())
    {
      await server.close();
    }
    await runManager.closeAll();
    sddStore?.Close();
    if (ownsLogRoot)
    {
      await rm(logRoot, { recursive: true, force: true });
    }
  }
}
