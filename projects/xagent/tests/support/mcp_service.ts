import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { FakeHarnessAdapter } from "../../src/adapters/fake.js";
import type { HarnessAdapter } from "../../src/adapters/types.js";
import { createXagentMcpHandler } from "../../src/service/mcp.js";
import { XagentRunManager } from "../../src/service/run_manager.js";
import {
  AsSddRunManagerPort,
  CreateSddManager,
  type SddManager,
  type SddRunManagerPort,
} from "../../src/service/sdd_manager.js";
import { CreateSddAgentStore } from "../../src/service/sdd_store.js";
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
  readonly ledger: () => ReturnType<typeof CreateSddAgentStore>;
};

export type WithMcpServiceOptions = {
  readonly includeSddManager?: boolean;
  readonly repoRoot?: string;
  readonly logRoot?: string;
  readonly policy?: SupervisionPolicy;
  readonly adapterFactory?: () => HarnessAdapter;
  readonly sddManager?: SddManager;
  readonly sddStore?: ReturnType<typeof CreateSddAgentStore>;
  readonly createSddManager?: (deps: {
    readonly runManager: XagentRunManager;
    readonly repoRoot: string;
    readonly logRoot: string;
  }) => {
    readonly manager: SddManager;
    readonly store: ReturnType<typeof CreateSddAgentStore>;
  };
  readonly clientName?: string;
};

export type NormalizedLogEvent = {
  readonly type: string;
  readonly payload?: unknown;
  readonly [key: string]: unknown;
};

export type StartedMcpService = {
  startRun(prompt: string): Promise<{ run_id: string; sequence: number }>;
  startSddImplementer(options?: { readonly task?: number }): Promise<{
    agent_id: string;
    sequence: number;
  }>;
  startSddFixer(options?: { readonly task?: number }): Promise<{
    agent_id: string;
    sequence: number;
  }>;
  sddFollowup(input: {
    readonly kind: "fix";
    readonly agent_id: string;
    readonly round: number;
    readonly findings: string;
    readonly findings_text: string;
    readonly tests: readonly string[];
    readonly report: string;
  }): Promise<{ agent_id: string; sequence: number }>;
  await(
    runId: string,
    afterSequence: number,
    deadlineSeconds: number,
  ): Promise<{ event: string }>;
  awaitTurn(
    runId: string,
    afterSequence: number,
    deadlineSeconds?: number,
  ): Promise<Record<string, unknown>>;
  message(runId: string, text: string): Promise<{ sequence: number }>;
  submit(runId: string, text: string): Promise<void>;
  closeRun(runId: string): Promise<void>;
  artifact(name: string): string;
  normalizedEvents(runId: string): Promise<NormalizedLogEvent[]>;
  killAbruptly(): Promise<void>;
  close(): Promise<void>;
  ledger(): ReturnType<typeof CreateSddAgentStore>;
  readonly runManager: XagentRunManager;
  readonly logRoot: string;
  readonly client: Client;
};

export type StartMcpServiceOptions = {
  readonly repoRoot?: string;
  readonly logRoot?: string;
  readonly policy?: SupervisionPolicy;
  readonly adapterFactory?: () => HarnessAdapter;
  readonly failProviderStart?: boolean;
};

// Full MCP harness for Task 9 lifecycle and failure-injection tests. Keeps the
// direct run-manager await/submit helpers that mcp_await tests already use.
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
  const artifactsDir = await mkdtemp(path.join(tmpdir(), "xagent-sdd-artifacts-"));
  const repoRoot = options.repoRoot ?? process.cwd();
  const runManager = new XagentRunManager({
    repoRoot,
    logRoot,
    adapterFactory: options.adapterFactory ?? (() => new FakeHarnessAdapter()),
    policy: options.policy ?? {
      silenceTimeoutMs: 600_000,
      watchdog: {},
    },
  });

  const sddStore = CreateSddAgentStore(logRoot);
  const basePort = AsSddRunManagerPort(runManager);
  const sddRunPort: SddRunManagerPort = options.failProviderStart === true
    ? {
      allocateRunId: () => basePort.allocateRunId(),
      // Fail after the ledger insert and before a run record exists so the row
      // surfaces as an xsvc-13 run_missing tombstone. A throw from adapter.start
      // would leave a run directory and must not set run_missing.
      //
      async create(): Promise<{ readonly runId: string }>
      {
        throw new Error("provider start failed");
      },
      start: (runId) => basePort.start(runId),
      submit: (runId, text) => basePort.submit(runId, text),
      inspect: (runId) => basePort.inspect(runId),
      close: (runId) => basePort.close(runId),
      has: (runId) => basePort.has(runId),
      listOwnedRuns: (input) => basePort.listOwnedRuns(input),
    }
    : basePort;
  const sddManager = CreateSddManager({
    store: sddStore,
    runManager: sddRunPort,
    repoRoot,
    async canonicalizeCwd(candidate: string): Promise<string>
    {
      return candidate;
    },
    async renderPrompt(input)
    {
      const promptPath = path.join(cwd, `dispatch-${input.role}.md`);
      return {
        prompt: {
          path: promptPath,
          text: `Rendered ${input.role} prompt.\n`,
        },
        metadata: {
          promptPath,
          rendererPath: path.join(repoRoot, "projects", "agents", "utils", "dispatch-prompt"),
        },
      };
    },
  });

  const planPath = path.join(cwd, "plan.md");
  const briefPath = path.join(cwd, "brief.md");
  await writeFile(planPath, "# plan\n", "utf8");
  await writeFile(briefPath, "Implement await without ledger report binding.\n", "utf8");

  let server: XagentServer | undefined;
  let closed = false;
  const shutdownController = createShutdownController({
    closeRuns: async () =>
    {
      await runManager.closeAll();
      sddStore.Close();
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
    sddManager,
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
    name: "xagent-start-mcp-service",
    version: "0.0.0",
  });
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp`),
  );
  await client.connect(transport);

  function Artifact(name: string): string
  {
    return path.join(artifactsDir, name);
  }

  async function EnsureArtifact(filePath: string, contents: string): Promise<void>
  {
    await writeFile(filePath, contents, "utf8");
  }

  async function CallToolOrThrow(
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>>
  {
    const result = asToolCallResult(await client.callTool({ name, arguments: args }));
    const body = structuredToolBody(result);
    if (result.isError === true)
    {
      const error = new Error(
        typeof body.message === "string"
          ? body.message
          : typeof body.error === "string"
          ? body.error
          : `MCP tool ${name} failed`,
      );
      (error as { body?: Record<string, unknown> }).body = body;
      throw error;
    }
    return body;
  }

  async function Teardown(options: { readonly abrupt: boolean }): Promise<void>
  {
    if (closed)
    {
      return;
    }
    closed = true;
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
    if (!shutdownController.wasShutdownRequested())
    {
      await server?.close().catch(() => {});
    }
    await runManager.closeAll().catch(() => {});
    sddStore.Close();
    if (!options.abrupt)
    {
      await rm(cwd, { recursive: true, force: true });
      await rm(artifactsDir, { recursive: true, force: true });
      if (ownsLogRoot)
      {
        await rm(logRoot, { recursive: true, force: true });
      }
    }
  }

  return {
    runManager,
    logRoot,
    client,
    startRun(prompt: string)
    {
      return runManager.startRun({
        cwd,
        prompt,
        harness: "codex",
        mode: "subagent",
      });
    },
    async startSddImplementer(startOptions = {})
    {
      const task = startOptions.task ?? 4;
      const reportPath = Artifact(`implementer-task-${task}-report.md`);
      await EnsureArtifact(reportPath, "");
      const body = await CallToolOrThrow("xagent_sdd_start", {
        role: "implementer",
        cwd,
        plan: planPath,
        agent: "fake-model",
        harness: "codex",
        effort: "high",
        task,
        name: "await-no-ledger-write",
        brief: briefPath,
        report: reportPath,
      });
      return {
        agent_id: String(body.agent_id),
        sequence: Number(body.sequence),
      };
    },
    async startSddFixer(startOptions = {})
    {
      const task = startOptions.task ?? 4;
      const findingsPath = Artifact(`fixer-task-${task}-findings.md`);
      const reportPath = Artifact(`fixer-task-${task}-report.md`);
      await EnsureArtifact(findingsPath, "Finding 1: the gate is missing.\n");
      await EnsureArtifact(reportPath, "");
      const body = await CallToolOrThrow("xagent_sdd_start", {
        role: "fixer",
        cwd,
        plan: planPath,
        agent: "fake-model",
        harness: "codex",
        effort: "high",
        task,
        brief: briefPath,
        findings: findingsPath,
        findings_text: "Finding 1: the gate is missing.",
        tests: ["npm test"],
        report: reportPath,
      });
      return {
        agent_id: String(body.agent_id),
        sequence: Number(body.sequence),
      };
    },
    async sddFollowup(input)
    {
      await EnsureArtifact(input.findings, `${input.findings_text}\n`);
      const body = await CallToolOrThrow("xagent_sdd_followup", {
        kind: input.kind,
        agent_id: input.agent_id,
        round: input.round,
        findings: input.findings,
        findings_text: input.findings_text,
        tests: [...input.tests],
        report: input.report,
      });
      return {
        agent_id: String(body.agent_id),
        sequence: Number(body.sequence),
      };
    },
    await(runId: string, afterSequence: number, deadlineSeconds: number)
    {
      return runManager.awaitRun({
        run_id: runId,
        after_sequence: afterSequence,
        deadline_seconds: deadlineSeconds,
      });
    },
    async awaitTurn(runId: string, afterSequence: number, deadlineSeconds = 30)
    {
      return CallToolOrThrow("xagent_await", {
        run_id: runId,
        after_sequence: afterSequence,
        deadline_seconds: deadlineSeconds,
      });
    },
    async message(runId: string, text: string)
    {
      const body = await CallToolOrThrow("xagent_message", {
        run_id: runId,
        text,
      });
      return { sequence: Number(body.sequence) };
    },
    submit(runId: string, text: string)
    {
      return runManager.submit(runId, text);
    },
    async closeRun(runId: string)
    {
      await CallToolOrThrow("xagent_close", { run_id: runId });
    },
    artifact(name: string)
    {
      return Artifact(name);
    },
    async normalizedEvents(runId: string)
    {
      const raw = await readFile(path.join(logRoot, runId, "normalized.jsonl"), "utf8");
      return raw
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as NormalizedLogEvent);
    },
    async killAbruptly()
    {
      await Teardown({ abrupt: true });
    },
    ledger()
    {
      return sddStore;
    },
    async close()
    {
      await Teardown({ abrupt: false });
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
  let sddStore: ReturnType<typeof CreateSddAgentStore> | undefined = options.sddStore;
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
    await run({
      port,
      server,
      runManager,
      client,
      logRoot,
      ledger()
      {
        assert.ok(sddStore !== undefined, "SDD ledger was not constructed");
        return sddStore;
      },
    });
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
