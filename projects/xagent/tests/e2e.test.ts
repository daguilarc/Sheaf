import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { FakeHarnessAdapter } from "../src/adapters/fake.js";
import type { AdapterEvent } from "../src/adapters/types.js";
import { parseArgs } from "../src/cli.js";
import type { OutputEvent } from "../src/events.js";
import {
  AsSddRunManagerPort,
  CreateSddManager,
} from "../src/service/sdd_manager.js";
import {
  CreateSddStore,
  GetSddDatabasePath,
} from "../src/service/sdd_store.js";
import {
  asToolCallResult,
  assertToolSucceeded,
  structuredToolBody,
  withMcpService,
} from "./support/mcp_service.js";

function TrustedRendererPathForTests(repoRoot: string): string {
  return path.join(repoRoot, "projects", "agents", "utils", "dispatch-prompt");
}


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
  const adapterQueue = [
    CreateScriptedReports([x_ImplementerReport, x_FixReport]),
    CreateScriptedReports([x_ReviewerReport, x_ReReviewReport]),
  ];
  await withMcpService(async ({ client, logRoot }) =>
  {
    const implementerStartedResult = asToolCallResult(
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
    );
    assertToolSucceeded(implementerStartedResult);
    const implementerStarted = structuredToolBody(implementerStartedResult);
    assert.equal(JSON.stringify(implementerStarted).includes(x_ImplementerBrief), false);
    const implementerId = implementerStarted.agent_id as string;
    assert.equal(typeof implementerId, "string");

    const implementerInitialResult = asToolCallResult(
      await client.callTool({
        name: "xagent_sdd_await",
        arguments: {
          agent_id: implementerId,
          after_sequence: implementerStarted.sequence as number,
          deadline_seconds: 30,
        },
      }),
    );
    assertToolSucceeded(implementerInitialResult);
    const implementerInitial = structuredToolBody(implementerInitialResult);
    assert.equal(implementerInitial.event, "turn.completed");
    assert.equal((implementerInitial.report as { text?: string } | undefined)?.text, x_ImplementerReport);
    assert.equal(JSON.stringify(implementerInitial).includes(x_ImplementerBrief), false);

    const implementerFollowupResult = asToolCallResult(
      await client.callTool({
        name: "xagent_sdd_followup",
        arguments: {
          kind: "fix",
          agent_id: implementerId,
          round: 1,
          findings: fixture.findingsPath,
          findings_text: x_FindingsText,
          tests: ["dist/tests/e2e.test.js"],
          report: fixture.implementerReportPath,
        },
      }),
    );
    assertToolSucceeded(implementerFollowupResult);
    const implementerFollowup = structuredToolBody(implementerFollowupResult);
    assert.equal(JSON.stringify(implementerFollowup).includes(x_FindingsText), false);
    assert.equal(implementerFollowup.turn_number, 2);

    const implementerFixResult = asToolCallResult(
      await client.callTool({
        name: "xagent_sdd_await",
        arguments: {
          agent_id: implementerId,
          after_sequence: implementerFollowup.sequence as number,
          deadline_seconds: 30,
        },
      }),
    );
    assertToolSucceeded(implementerFixResult);
    const implementerFix = structuredToolBody(implementerFixResult);
    assert.equal((implementerFix.report as { text?: string } | undefined)?.text, x_FixReport);

    const reviewerStartedResult = asToolCallResult(
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
    );
    assertToolSucceeded(reviewerStartedResult);
    const reviewerStarted = structuredToolBody(reviewerStartedResult);
    assert.equal(JSON.stringify(reviewerStarted).includes(x_ReviewerBrief), false);
    const reviewerId = reviewerStarted.agent_id as string;
    assert.notEqual(reviewerId, implementerId);

    const reviewerInitialResult = asToolCallResult(
      await client.callTool({
        name: "xagent_sdd_await",
        arguments: {
          agent_id: reviewerId,
          after_sequence: reviewerStarted.sequence as number,
          deadline_seconds: 30,
        },
      }),
    );
    assertToolSucceeded(reviewerInitialResult);
    const reviewerInitial = structuredToolBody(reviewerInitialResult);
    assert.equal((reviewerInitial.report as { text?: string } | undefined)?.text, x_ReviewerReport);

    const reviewerFollowupResult = asToolCallResult(
      await client.callTool({
        name: "xagent_sdd_followup",
        arguments: {
          kind: "re-review",
          agent_id: reviewerId,
          round: 2,
          findings: fixture.findingsPath,
          report: fixture.reviewerReportPath,
          base: "aaa111",
          head: "bbb222",
        },
      }),
    );
    assertToolSucceeded(reviewerFollowupResult);
    const reviewerFollowup = structuredToolBody(reviewerFollowupResult);
    assert.equal(JSON.stringify(reviewerFollowup).includes(x_FindingsText), false);
    assert.equal(reviewerFollowup.turn_number, 2);

    const reviewerReReviewResult = asToolCallResult(
      await client.callTool({
        name: "xagent_sdd_await",
        arguments: {
          agent_id: reviewerId,
          after_sequence: reviewerFollowup.sequence as number,
          deadline_seconds: 30,
        },
      }),
    );
    assertToolSucceeded(reviewerReReviewResult);
    const reviewerReReview = structuredToolBody(reviewerReReviewResult);
    assert.equal((reviewerReReview.report as { text?: string } | undefined)?.text, x_ReReviewReport);

    const implementerClosedResult = asToolCallResult(
      await client.callTool({
        name: "xagent_sdd_close",
        arguments: { agent_id: implementerId },
      }),
    );
    assertToolSucceeded(implementerClosedResult);
    assert.deepEqual(structuredToolBody(implementerClosedResult), { agent_id: implementerId, closed: true });

    const reviewerClosedResult = asToolCallResult(
      await client.callTool({
        name: "xagent_sdd_close",
        arguments: { agent_id: reviewerId },
      }),
    );
    assertToolSucceeded(reviewerClosedResult);
    assert.deepEqual(structuredToolBody(reviewerClosedResult), { agent_id: reviewerId, closed: true });

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
  }, {
    repoRoot: fixture.repoRoot,
    logRoot: path.join(fixture.repoRoot, "data", "xagent"),
    clientName: "xagent-sdd-e2e",
    adapterFactory: () =>
    {
      const scriptedEvents = adapterQueue.shift();
      assert.ok(scriptedEvents, "unexpected extra SDD session adapter construction");
      return new FakeHarnessAdapter({ scriptedEvents });
    },
    createSddManager: ({ runManager, repoRoot, logRoot }) =>
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
          const promptPath = path.join(fixture.cwd, `.superpowers/sdd/dispatch-${input.role}.md`);
          return {
            prompt: {
              path: promptPath,
              text: `Rendered ${input.role} prompt.\n`,
            },
            metadata: {
              promptPath,
              rendererPath: TrustedRendererPathForTests(input.repoRoot),
              ...("brief" in input ? { briefPath: input.brief } : {}),
              ...("report" in input ? { reportPath: input.report } : {}),
              ...("findings" in input ? { findingsPath: input.findings } : {}),
            },
          };
        },
      });
      return { manager, store };
    },
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
