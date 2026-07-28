import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { FakeHarnessAdapter } from "../src/adapters/fake.js";
import type { AdapterEvent } from "../src/adapters/types.js";
import type { XagentRunManager } from "../src/service/run_manager.js";
import {
  AsSddRunManagerPort,
  CreateSddManager,
  type SddManager,
} from "../src/service/sdd_manager.js";
import { CreateSddStore, GetSddDatabasePath } from "../src/service/sdd_store.js";
import { XagentListInputSchema } from "../src/service/tool_schemas.js";
import {
  asToolCallResult,
  assertInvalidWorkingDirectory,
  assertToolSucceeded,
  structuredToolBody,
  withMcpService,
} from "./support/mcp_service.js";

const x_GenericToolNames = [
  "xagent_start",
  "xagent_await",
  "xagent_inspect",
  "xagent_message",
  "xagent_interrupt",
  "xagent_close",
  "xagent_list",
] as const;

const x_ExpectedToolNames = [
  ...x_GenericToolNames,
  "xagent_sdd_start",
  "xagent_sdd_followup",
  "xagent_sdd_await",
  "xagent_sdd_close",
] as const;

function CreateTestSddManager(
  runManager: XagentRunManager,
  repoRoot: string,
  logRoot: string,
): { manager: SddManager; store: ReturnType<typeof CreateSddStore> }
{
  const store = CreateSddStore(logRoot);
  const manager = CreateSddManager({
    store,
    runManager: AsSddRunManagerPort(runManager),
    repoRoot,
    async canonicalizeCwd(cwd: string): Promise<string>
    {
      return cwd;
    },
    async renderPrompt(input)
    {
      const promptPath = path.join(repoRoot, `dispatch-${input.role}.md`);
      return {
        prompt: {
          path: promptPath,
          text: `Rendered ${input.role} prompt.\n`,
        },
        metadata: {
          promptPath,
        },
      };
    },
  });
  return { manager, store };
}

test("xagent_sdd_start and xagent_sdd_await persist the sanitized report before returning", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-mcp-sdd-"));
  const logRoot = path.join(repoRoot, "data", "xagent");
  const cwd = path.join(repoRoot, "work");
  await mkdir(cwd, { recursive: true });
  const planPath = path.join(cwd, "plan.md");
  const briefPath = path.join(cwd, "brief.md");
  const reportPath = path.join(cwd, "report.md");
  await writeFile(planPath, "# plan\n", "utf8");
  await writeFile(briefPath, "Brief for MCP SDD smoke.\n", "utf8");
  await writeFile(reportPath, "mutable artifact text\n", "utf8");

  async function* scriptedTurn(): AsyncIterable<AdapterEvent> {
    yield {
      type: "message.completed",
      message_id: "message_mcp_sdd",
      role: "assistant",
      text: "sanitized MCP SDD report",
    };
    yield {
      type: "turn.completed",
      final_text: "sanitized MCP SDD report",
      provider_thread_id: "fake-thread-mcp-sdd",
    };
  }

  await withMcpService(async ({ client, logRoot: serviceLogRoot }) => {
    const startedResult = asToolCallResult(
      await client.callTool({
        name: "xagent_sdd_start",
        arguments: {
          role: "implementer",
          cwd,
          plan: planPath,
          agent: "fake-model",
          harness: "codex",
          effort: "high",
          task: 5,
          name: "mcp-sdd-smoke",
          brief: briefPath,
          report: reportPath,
        },
      }),
    );
    assertToolSucceeded(startedResult);
    const started = structuredToolBody(startedResult);
    const agentId = started.agent_id as string;

    const awaitedResult = asToolCallResult(
      await client.callTool({
        name: "xagent_sdd_await",
        arguments: {
          agent_id: agentId,
          after_sequence: started.sequence as number,
          deadline_seconds: 30,
        },
      }),
    );
    assertToolSucceeded(awaitedResult);
    const awaited = structuredToolBody(awaitedResult);
    assert.equal(awaited.event, "turn.completed");
    assert.equal((awaited.report as { text?: string } | undefined)?.text, "sanitized MCP SDD report");
    assert.equal(JSON.stringify(awaited).includes("Brief for MCP SDD smoke"), false);

    const database = new Database(GetSddDatabasePath(serviceLogRoot), { readonly: true });
    try
    {
      const row = database
        .prepare(
          "SELECT status, report_text, completed_sequence, resume_sequence FROM sdd_turns WHERE agent_id = ? AND turn_number = 1",
        )
        .get(agentId) as {
          status: string;
          report_text: string;
          completed_sequence: number;
          resume_sequence: number;
        };
      assert.equal(row.status, "completed");
      assert.equal(row.report_text, "sanitized MCP SDD report");
      assert.equal(row.completed_sequence, awaited.sequence);
      assert.equal(row.resume_sequence, started.sequence);
      assert.notEqual(row.report_text, "mutable artifact text\n");
    }
    finally
    {
      database.close();
    }

    const closedResult = asToolCallResult(
      await client.callTool({
        name: "xagent_sdd_close",
        arguments: { agent_id: agentId },
      }),
    );
    assertToolSucceeded(closedResult);
    assert.deepEqual(structuredToolBody(closedResult), { agent_id: agentId, closed: true });
  }, {
    repoRoot,
    logRoot,
    adapterFactory: () => new FakeHarnessAdapter({ scriptedEvents: [scriptedTurn()] }),
    createSddManager: ({ runManager, repoRoot: serviceRepoRoot, logRoot: serviceLogRoot }) =>
      CreateTestSddManager(runManager, serviceRepoRoot, serviceLogRoot),
  });
});

test("Streamable HTTP MCP initializes and discovers exactly the seven generic tools without sddManager", async () => {
  await withMcpService(async ({ port, client }) => {
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [...x_GenericToolNames].sort());
    assert.equal(listed.tools.length, 7);

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
  }, { includeSddManager: false });
});

test("Streamable HTTP MCP initializes and discovers exactly the eleven controller tools", async () => {
  await withMcpService(async ({ port, client }) => {
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [...x_ExpectedToolNames].sort());
    assert.equal(listed.tools.length, 11);

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
  }, {
    createSddManager: ({ runManager, repoRoot, logRoot }) =>
      CreateTestSddManager(runManager, repoRoot, logRoot),
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
  }, {
    createSddManager: ({ runManager, repoRoot, logRoot }) =>
      CreateTestSddManager(runManager, repoRoot, logRoot),
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
  }, {
    createSddManager: ({ runManager, repoRoot, logRoot }) =>
      CreateTestSddManager(runManager, repoRoot, logRoot),
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
  }, {
    createSddManager: ({ runManager, repoRoot, logRoot }) =>
      CreateTestSddManager(runManager, repoRoot, logRoot),
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
    assertToolSucceeded(result);
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
    assertToolSucceeded(closed);
  }, {
    createSddManager: ({ runManager, repoRoot, logRoot }) =>
      CreateTestSddManager(runManager, repoRoot, logRoot),
  });
});

test("xagent_list returns owned runs newest first and flags the live one", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "xagent-mcp-list-"));

  await withMcpService(async ({ client }) => {
    const startedResult = asToolCallResult(
      await client.callTool({
        name: "xagent_start",
        arguments: { cwd, prompt: "hello", harness: "codex" },
      }),
    );
    assertToolSucceeded(startedResult);
    const started = structuredToolBody(startedResult);

    const listedResult = asToolCallResult(
      await client.callTool({ name: "xagent_list", arguments: {} }),
    );
    assertToolSucceeded(listedResult);
    const rows = structuredToolBody(listedResult).runs as Array<Record<string, unknown>>;

    const row = rows.find((entry) => entry.run_id === started.run_id);
    assert.ok(row, "the started run must be listed");
    assert.equal(row.live, true);
    assert.equal(row.supervised, true);
    assert.equal(row.harness, "codex");
    assert.equal(typeof row.phase, "string");
    assert.equal(typeof row.created_at, "string");
  }, { createSddManager: ({ runManager, repoRoot, logRoot }) => CreateTestSddManager(runManager, repoRoot, logRoot) });
});

test("xagent_list defaults its paging arguments and rejects unknown ones", () => {
  const defaults = XagentListInputSchema.parse({});
  assert.equal(defaults.live_only, false);
  assert.equal(defaults.limit, 50);

  assert.equal(XagentListInputSchema.safeParse({ bogus: true }).success, false);
  assert.equal(XagentListInputSchema.safeParse({ limit: 0 }).success, false);
  assert.equal(XagentListInputSchema.safeParse({ limit: 201 }).success, false);
});
