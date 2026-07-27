import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import Database from "better-sqlite3";

import { FakeHarnessAdapter } from "../src/adapters/fake.js";
import type { AdapterEvent } from "../src/adapters/types.js";
import { parseArgs } from "../src/cli.js";
import type { OutputEvent } from "../src/events.js";
import { createXagentMcpHandler } from "../src/service/mcp.js";
import { XagentRunManager } from "../src/service/run_manager.js";
import {
  AsSddRunManagerPort,
  CreateSddManager,
} from "../src/service/sdd_manager.js";
import {
  CreateSddStore,
  GetSddDatabasePath,
} from "../src/service/sdd_store.js";
import {
  createShutdownController,
  createXagentServer,
  type XagentServer,
} from "../src/service/server.js";
import type { SupervisionPolicy } from "../src/supervision/types.js";

const x_TestPolicy: SupervisionPolicy = {
  silenceTimeoutMs: 60_000,
  watchdog: {},
};

const x_ImplementerBrief = "Implementer task brief for full-flow SDD.\n";
const x_ReviewerBrief = "Task reviewer brief for full-flow SDD.\n";
const x_FindingsText = "Reviewer findings requiring a fix round.\n";
const x_ImplementerReport = "immutable implementer initial report";
const x_FixReport = "immutable implementer fix report";
const x_ReviewerReport = "immutable task reviewer initial report";
const x_ReReviewReport = "immutable task reviewer re-review report";
const x_MutableArtifactText = "mutable artifact contents must not be stored\n";

const x_ForbiddenLedgerColumns = [
  "rendered_prompt",
  "renderedPrompt",
  "jsonl_offset",
  "jsonlOffset",
];

type DispatchLogRow = {
  agent_id: string;
  role: string;
  turn_number: number;
  kind: string;
  round: number | null;
  brief_text: string;
  findings_text: string | null;
  report_text: string | null;
  resume_sequence: number | null;
  completed_sequence: number | null;
  status: string;
  completed_at: string | null;
};

test("MCP fake adapter drives the full SDD lifecycle and records dispatch log rows", async () =>
{
  const fixture = await CreateSddFlowFixture();
  await withSddMcpService(fixture, async ({ client, logRoot }) =>
  {
    const implementerStarted = structuredToolBody(asToolCallResult(
      await client.callTool({
        name: "xagent_sdd_start",
        arguments: {
          role: "implementer",
          cwd: fixture.cwd,
          plan: fixture.planPath,
          agent: "fake-model",
          harness: "codex",
          effort: "high",
          task: 5,
          name: "full-flow-sdd",
          brief: fixture.implementerBriefPath,
          report: fixture.implementerReportPath,
        },
      }),
    ));
    assert.equal(implementerStarted.isError ?? false, false);
    const implementerId = implementerStarted.agent_id as string;
    assert.equal(typeof implementerId, "string");

    const implementerInitial = structuredToolBody(asToolCallResult(
      await client.callTool({
        name: "xagent_sdd_await",
        arguments: {
          agent_id: implementerId,
          after_sequence: implementerStarted.sequence as number,
          deadline_seconds: 30,
        },
      }),
    ));
    assert.equal(implementerInitial.event, "turn.completed");
    assert.equal((implementerInitial.report as { text?: string } | undefined)?.text, x_ImplementerReport);
    assert.equal(JSON.stringify(implementerInitial).includes(x_ImplementerBrief), false);

    const implementerFollowup = structuredToolBody(asToolCallResult(
      await client.callTool({
        name: "xagent_sdd_followup",
        arguments: {
          kind: "fix",
          agent_id: implementerId,
          round: 1,
          findings: fixture.findingsPath,
          findings_text: x_FindingsText,
          tests: ["dist/tests/e2e.test.js"],
        },
      }),
    ));
    assert.equal(implementerFollowup.turn_number, 2);

    const implementerFix = structuredToolBody(asToolCallResult(
      await client.callTool({
        name: "xagent_sdd_await",
        arguments: {
          agent_id: implementerId,
          after_sequence: implementerFollowup.sequence as number,
          deadline_seconds: 30,
        },
      }),
    ));
    assert.equal((implementerFix.report as { text?: string } | undefined)?.text, x_FixReport);

    const reviewerStarted = structuredToolBody(asToolCallResult(
      await client.callTool({
        name: "xagent_sdd_start",
        arguments: {
          role: "task-reviewer",
          cwd: fixture.cwd,
          plan: fixture.planPath,
          agent: "fake-model",
          harness: "codex",
          effort: "high",
          task: 5,
          brief: fixture.reviewerBriefPath,
          report: fixture.reviewerReportPath,
          base: "abc123",
          head: "def456",
        },
      }),
    ));
    const reviewerId = reviewerStarted.agent_id as string;
    assert.notEqual(reviewerId, implementerId);

    const reviewerInitial = structuredToolBody(asToolCallResult(
      await client.callTool({
        name: "xagent_sdd_await",
        arguments: {
          agent_id: reviewerId,
          after_sequence: reviewerStarted.sequence as number,
          deadline_seconds: 30,
        },
      }),
    ));
    assert.equal((reviewerInitial.report as { text?: string } | undefined)?.text, x_ReviewerReport);

    const reviewerFollowup = structuredToolBody(asToolCallResult(
      await client.callTool({
        name: "xagent_sdd_followup",
        arguments: {
          kind: "re-review",
          agent_id: reviewerId,
          round: 2,
          findings: fixture.findingsPath,
          base: "aaa111",
          head: "bbb222",
        },
      }),
    ));
    assert.equal(reviewerFollowup.turn_number, 2);

    const reviewerReReview = structuredToolBody(asToolCallResult(
      await client.callTool({
        name: "xagent_sdd_await",
        arguments: {
          agent_id: reviewerId,
          after_sequence: reviewerFollowup.sequence as number,
          deadline_seconds: 30,
        },
      }),
    ));
    assert.equal((reviewerReReview.report as { text?: string } | undefined)?.text, x_ReReviewReport);

    const implementerClosed = structuredToolBody(asToolCallResult(
      await client.callTool({
        name: "xagent_sdd_close",
        arguments: { agent_id: implementerId },
      }),
    ));
    assert.deepEqual(implementerClosed, { agent_id: implementerId, closed: true });

    const reviewerClosed = structuredToolBody(asToolCallResult(
      await client.callTool({
        name: "xagent_sdd_close",
        arguments: { agent_id: reviewerId },
      }),
    ));
    assert.deepEqual(reviewerClosed, { agent_id: reviewerId, closed: true });

    const database = new Database(GetSddDatabasePath(logRoot), { readonly: true });
    try
    {
      AssertLedgerSchemaExcludesPromptAndOffsetColumns(database);

      const sessions = database
        .prepare("SELECT agent_id, role, closed_at FROM sdd_sessions ORDER BY agent_id")
        .all() as Array<{ agent_id: string; role: string; closed_at: string | null }>;
      assert.equal(sessions.length, 2);
      assert.equal(sessions.every((session) => session.closed_at !== null), true);
      assert.deepEqual(
        sessions.map((session) => session.role).sort(),
        ["implementer", "task-reviewer"],
      );

      const rows = database
        .prepare(
          "SELECT * FROM sdd_dispatch_log ORDER BY agent_id, turn_number",
        )
        .all() as DispatchLogRow[];
      assert.equal(rows.length, 4);

      const implementerTurns = rows.filter((row) => row.agent_id === implementerId);
      const reviewerTurns = rows.filter((row) => row.agent_id === reviewerId);
      assert.equal(implementerTurns.length, 2);
      assert.equal(reviewerTurns.length, 2);

      assert.equal(implementerTurns[0]?.kind, "initial");
      assert.equal(implementerTurns[0]?.brief_text, x_ImplementerBrief);
      assert.equal(implementerTurns[0]?.report_text, x_ImplementerReport);
      assert.equal(implementerTurns[0]?.status, "completed");
      assert.equal(implementerTurns[0]?.resume_sequence, implementerStarted.sequence);
      assert.equal(implementerTurns[0]?.completed_sequence, implementerInitial.sequence);
      assert.ok((implementerTurns[0]?.completed_sequence ?? 0) > (implementerTurns[0]?.resume_sequence ?? 0));
      assert.notEqual(implementerTurns[0]?.completed_at, null);

      assert.equal(implementerTurns[1]?.kind, "fix");
      assert.equal(implementerTurns[1]?.brief_text, x_ImplementerBrief);
      assert.equal(implementerTurns[1]?.findings_text, x_FindingsText);
      assert.equal(implementerTurns[1]?.report_text, x_FixReport);
      assert.equal(implementerTurns[1]?.resume_sequence, implementerFollowup.sequence);
      assert.equal(implementerTurns[1]?.completed_sequence, implementerFix.sequence);

      assert.equal(reviewerTurns[0]?.kind, "initial");
      assert.equal(reviewerTurns[0]?.brief_text, x_ReviewerBrief);
      assert.equal(reviewerTurns[0]?.report_text, x_ReviewerReport);

      assert.equal(reviewerTurns[1]?.kind, "re_review");
      assert.equal(reviewerTurns[1]?.findings_text, x_FindingsText);
      assert.equal(reviewerTurns[1]?.report_text, x_ReReviewReport);

      for (const row of rows)
      {
        assert.notEqual(row.report_text, x_MutableArtifactText);
      }
    }
    finally
    {
      database.close();
    }
  });
});

test("public parser rejects fake harness", () => {
  assert.throws(
    () => parseArgs(["run", "--harness", "fake", "--subagent"]),
    /Unsupported harness: fake/,
  );
});

test("executable fake adapter preserves same-session follow-up behavior", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-e2e-"));
  const result = await runXagent(
    ["run", "--harness", "codex", "--subagent", "first"],
    [
      JSON.stringify({ type: "user.message", text: "second" }),
      JSON.stringify({ type: "control.exit" }),
    ].join("\n") + "\n",
    repoRoot,
    { XAGENT_TEST_ADAPTER: "fake" },
  );

  assert.equal(result.code, 0, result.stderr);
  const events = parseJsonl(result.stdout);
  assert.deepEqual(
    events.filter((event) => event.type === "message.completed").map((event) => event.text),
    ["fake response to first", "fake response to second"],
  );
  assert.deepEqual(
    events.filter((event) => event.type === "turn.completed").map((event) => event.provider_thread_id),
    ["fake-thread-1", "fake-thread-1"],
  );
  assert.equal(events.filter((event) => event.type === "session.ready").length, 3);
});

test("executable subagent mode suppresses stdout detail while logs preserve it", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-e2e-"));
  const result = await runXagent(
    ["run", "--harness", "codex", "--subagent"],
    `${JSON.stringify({ type: "user.message", text: "use tool" })}\n${JSON.stringify({ type: "control.exit" })}\n`,
    repoRoot,
    { XAGENT_TEST_ADAPTER: "fake" },
  );

  assert.equal(result.code, 0, result.stderr);
  const events = parseJsonl(result.stdout);
  assert.equal(events.some((event) => event.type === "raw.provider"), false);
  assert.equal(events.some((event) => event.type === "tool.completed" && "output" in event), false);

  const runId = events[0]?.run_id;
  assert.equal(typeof runId, "string");
  const logs = await runXagent(["logs", runId], "", repoRoot);
  assert.equal(logs.code, 0, logs.stderr);
  const logEvents = parseJsonl(logs.stdout);
  assert.equal(logEvents.some((event) => event.type === "raw.provider"), true);
  assert.equal(logEvents.some((event) => event.type === "tool.completed" && "output" in event), true);
});

test("executable full mode emits raw provider and normalized tool events", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-e2e-"));
  const result = await runXagent(
    ["run", "--harness", "codex", "--full"],
    `${JSON.stringify({ type: "user.message", text: "use tool" })}\n${JSON.stringify({ type: "control.exit" })}\n`,
    repoRoot,
    { XAGENT_TEST_ADAPTER: "fake" },
  );

  assert.equal(result.code, 0, result.stderr);
  const events = parseJsonl(result.stdout);
  assert.equal(events.some((event) => event.type === "raw.provider"), true);
  assert.equal(events.some((event) => event.type === "tool.started"), true);
  assert.equal(events.some((event) => event.type === "tool.completed"), true);
  assert.equal(events.some((event) => event.type === "message.completed"), true);
  assert.equal(events.some((event) => event.type === "turn.completed"), true);
});

test("executable list and logs inspect persisted runs without a server", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-e2e-"));
  const result = await runXagent(
    ["run", "--harness", "codex", "--subagent"],
    `${JSON.stringify({ type: "control.exit" })}\n`,
    repoRoot,
    { XAGENT_TEST_ADAPTER: "fake" },
  );
  assert.equal(result.code, 0, result.stderr);
  const runId = parseJsonl(result.stdout)[0]?.run_id;
  assert.equal(typeof runId, "string");

  const list = await runXagent(["list"], "", repoRoot);
  assert.equal(list.code, 0, list.stderr);
  const runs = JSON.parse(list.stdout) as Array<{ run_id: string }>;
  assert.equal(runs.some((run) => run.run_id === runId), true);

  const logs = await runXagent(["logs", runId], "", repoRoot);
  assert.equal(logs.code, 0, logs.stderr);
  assert.equal(parseJsonl(logs.stdout)[0]?.run_id, runId);
});

async function runXagent(
  args: string[],
  stdin: string,
  cwd: string,
  extraEnv: Record<string, string> = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [path.join(process.cwd(), "dist", "src", "main.js"), ...args], {
    cwd,
    env: { ...process.env, ...extraEnv },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdin.end(stdin);
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  return { code, stdout, stderr };
}

function parseJsonl(text: string): OutputEvent[] {
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as OutputEvent);
}

type SddFlowFixture = {
  readonly repoRoot: string;
  readonly cwd: string;
  readonly planPath: string;
  readonly implementerBriefPath: string;
  readonly reviewerBriefPath: string;
  readonly implementerReportPath: string;
  readonly reviewerReportPath: string;
  readonly findingsPath: string;
};

async function CreateSddFlowFixture(): Promise<SddFlowFixture>
{
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-sdd-e2e-"));
  const cwd = path.join(repoRoot, "worktree");
  await mkdir(cwd, { recursive: true });
  const planPath = path.join(cwd, "docs", "2026-07-26-xagent-sdd-mode.md");
  const implementerBriefPath = path.join(cwd, ".superpowers", "sdd", "task-5-brief.md");
  const reviewerBriefPath = path.join(cwd, ".superpowers", "sdd", "task-5-review-brief.md");
  const implementerReportPath = path.join(cwd, ".superpowers", "sdd", "task-5-report.md");
  const reviewerReportPath = path.join(cwd, ".superpowers", "sdd", "task-5-review-report.md");
  const findingsPath = path.join(cwd, ".superpowers", "sdd", "task-5-findings.md");
  await mkdir(path.dirname(planPath), { recursive: true });
  await mkdir(path.dirname(implementerBriefPath), { recursive: true });
  await writeFile(planPath, "# 2026-07-26-xagent-sdd-mode\n\n## Task 5\n\nFull flow.\n", "utf8");
  await writeFile(implementerBriefPath, x_ImplementerBrief, "utf8");
  await writeFile(reviewerBriefPath, x_ReviewerBrief, "utf8");
  await writeFile(implementerReportPath, x_MutableArtifactText, "utf8");
  await writeFile(reviewerReportPath, x_MutableArtifactText, "utf8");
  await writeFile(findingsPath, x_FindingsText, "utf8");
  return {
    repoRoot,
    cwd,
    planPath,
    implementerBriefPath,
    reviewerBriefPath,
    implementerReportPath,
    reviewerReportPath,
    findingsPath,
  };
}

function CreateScriptedReports(reports: readonly string[]): readonly AsyncIterable<AdapterEvent>[]
{
  return reports.map((reportText, index) =>
  {
    async function* scriptedTurn(): AsyncIterable<AdapterEvent>
    {
      yield {
        type: "message.completed",
        message_id: `message_${index + 1}`,
        role: "assistant",
        text: reportText,
      };
      yield {
        type: "turn.completed",
        final_text: reportText,
        provider_thread_id: "fake-thread-1",
      };
    }
    return scriptedTurn();
  });
}

type ToolCallResult = {
  readonly isError?: boolean;
  readonly content?: unknown;
  readonly structuredContent?: unknown;
};

function asToolCallResult(result: unknown): ToolCallResult
{
  return result as ToolCallResult;
}

function structuredToolBody(result: ToolCallResult): Record<string, unknown>
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

function AssertLedgerSchemaExcludesPromptAndOffsetColumns(database: Database.Database): void
{
  const sessionColumns = database
    .prepare("PRAGMA table_info(sdd_sessions)")
    .all() as Array<{ name: string }>;
  const turnColumns = database
    .prepare("PRAGMA table_info(sdd_turns)")
    .all() as Array<{ name: string }>;

  for (const columnName of x_ForbiddenLedgerColumns)
  {
    assert.equal(sessionColumns.some((column) => column.name === columnName), false);
    assert.equal(turnColumns.some((column) => column.name === columnName), false);
  }
}

async function withSddMcpService(
  fixture: SddFlowFixture,
  run: (context: { client: Client; logRoot: string }) => Promise<void>,
): Promise<void>
{
  const logRoot = path.join(fixture.repoRoot, "data", "xagent");
  let adapterQueue = [
    CreateScriptedReports([x_ImplementerReport, x_FixReport]),
    CreateScriptedReports([x_ReviewerReport, x_ReReviewReport]),
  ];
  const runManager = new XagentRunManager({
    repoRoot: fixture.repoRoot,
    logRoot,
    adapterFactory: () =>
    {
      const scriptedEvents = adapterQueue.shift() ?? CreateScriptedReports([x_ImplementerReport]);
      return new FakeHarnessAdapter({ scriptedEvents });
    },
    policy: x_TestPolicy,
  });
  const store = CreateSddStore(logRoot);
  const sddManager = CreateSddManager({
    store,
    runManager: AsSddRunManagerPort(runManager),
    repoRoot: fixture.repoRoot,
    async canonicalizeCwd(cwd: string): Promise<string>
    {
      return cwd;
    },
    async renderPrompt(input)
    {
      const promptPath = path.join(fixture.cwd, `.superpowers/sdd/dispatch-${input.role}.md`);
      return {
        prompt: {
          path: promptPath,
          text: `Rendered ${input.role} prompt.\n`,
        },
        metadata: {
          promptPath,
          ...("brief" in input ? { briefPath: input.brief } : {}),
          ...("report" in input ? { reportPath: input.report } : {}),
          ...("findings" in input ? { findingsPath: input.findings } : {}),
        },
      };
    },
  });

  let server: XagentServer | undefined;
  const shutdownController = createShutdownController({
    closeRuns: async () =>
    {
      await runManager.closeAll();
      store.Close();
    },
    closeServer: async () =>
    {
      await server?.close();
    },
  });
  const allowedHosts = new Set<string>(["127.0.0.1", "localhost", "[::1]"]);
  const allowedOrigins = new Set<string>(["http://127.0.0.1", "http://localhost", "http://[::1]"]);
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
  const client = new Client({ name: "xagent-sdd-e2e", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp`),
  );
  try
  {
    await client.connect(transport);
    await run({ client, logRoot });
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
    store.Close();
  }
}
