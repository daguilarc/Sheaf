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
import { z } from "zod";

import {
  FixFollowupSchema,
  FixerStartSchema,
  ReReviewFollowupSchema,
  ReReviewerStartSchema,
  ReviewerStartSchema,
  XagentListInputSchema,
  XagentSddFollowupAdvertisedSchema,
  XagentSddFollowupInputSchema,
  XagentSddStartAdvertisedSchema,
  XagentSddStartInputSchema,
  XagentSddStartInputSchemaV2,
} from "../src/service/tool_schemas.js";
import {
  asToolCallResult,
  assertInvalidWorkingDirectory,
  assertToolSucceeded,
  structuredToolBody,
  withMcpService,
} from "./support/mcp_service.js";

function TrustedRendererPathForTests(repoRoot: string): string {
  return path.join(repoRoot, "projects", "agents", "utils", "dispatch-prompt");
}


const x_GenericToolNames = [
  "xagent_start_non_sdd",
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
          rendererPath: TrustedRendererPathForTests(input.repoRoot),
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

test("xagent_start_non_sdd rejects relative cwd with invalid_working_directory and creates no run", async () => {
  await withMcpService(async ({ client, runManager }) => {
    const result = await client.callTool({
      name: "xagent_start_non_sdd",
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

test("xagent_start_non_sdd rejects missing cwd with invalid_working_directory and creates no run", async () => {
  await withMcpService(async ({ client, runManager }) => {
    const missing = path.join(tmpdir(), `xagent-missing-${Math.random().toString(36).slice(2)}`);
    const result = await client.callTool({
      name: "xagent_start_non_sdd",
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

test("xagent_start_non_sdd rejects non-directory cwd with invalid_working_directory and creates no run", async () => {
  await withMcpService(async ({ client, runManager }) => {
    const dir = await mkdtemp(path.join(tmpdir(), "xagent-mcp-file-"));
    const filePath = path.join(dir, "not-a-directory");
    await writeFile(filePath, "not a directory\n", "utf8");
    const result = await client.callTool({
      name: "xagent_start_non_sdd",
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

test("xagent_start_non_sdd accepts an absolute existing directory and returns run_id plus cursor", async () => {
  await withMcpService(async ({ client, runManager }) => {
    const cwd = await mkdtemp(path.join(tmpdir(), "xagent-mcp-ok-"));
    const result = asToolCallResult(
      await client.callTool({
        name: "xagent_start_non_sdd",
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
        name: "xagent_start_non_sdd",
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

const x_AdvertisedAssignment = {
  cwd: "/private/tmp/worktree",
  plan: "/tmp/plans/2026-07-28-redesign-sdd-ledger.md",
  agent: "grok-4.5",
  harness: "cursor",
  effort: "high",
} as const;

// One union-valid payload per variant. These are the payloads the advertised
// schema must not reject; the union itself is the authority on rejection.
const x_ValidStartPayloads: ReadonlyArray<Record<string, unknown>> = [
  {
    role: "implementer", ...x_AdvertisedAssignment, task: 4,
    name: "Ledger v2 store", brief: "/tmp/sdd/task-4-brief.md",
    report: "/tmp/sdd/task-4-report.md",
  },
  {
    role: "task-reviewer", ...x_AdvertisedAssignment, task: 4,
    brief: "/tmp/sdd/task-4-brief.md", report: "/tmp/sdd/task-4-report.md",
    base: "main", head: "HEAD",
  },
  {
    role: "code-reviewer", ...x_AdvertisedAssignment,
    review_brief: "/tmp/sdd/review-brief.md",
    description: "Branch adds the v2 ledger.", base: "main", head: "HEAD",
  },
];

const x_ValidFollowupPayloads: ReadonlyArray<Record<string, unknown>> = [
  {
    kind: "fix", agent_id: "xrun_20260728000000000_0000abcd", round: 2,
    findings: "/tmp/sdd/task-4-findings.md", findings_text: "one finding",
    tests: ["npm test"], report: "/tmp/sdd/task-4-report.md",
  },
  {
    kind: "re-review", agent_id: "xrun_20260728000000000_0000abcd", round: 2,
    findings: "/tmp/sdd/task-4-findings.md", report: "/tmp/sdd/task-4-report.md",
    base: "main", head: "HEAD",
  },
];

test("the SDD dispatch tools advertise a non-empty input schema naming their discriminator", async () => {
  await withMcpService(async ({ client }) => {
    const listed = await client.listTools();

    for (const [name, discriminator, values] of [
      ["xagent_sdd_start", "role", ["implementer", "task-reviewer", "code-reviewer"]],
      ["xagent_sdd_followup", "kind", ["fix", "re-review"]],
    ] as const) {
      const tool = listed.tools.find((entry) => entry.name === name);
      assert.ok(tool, `${name} must be registered`);
      const properties = (tool.inputSchema as { properties?: Record<string, unknown> })
        .properties ?? {};
      assert.ok(
        Object.keys(properties).length > 0,
        `${name} advertises a field-less schema`,
      );
      assert.ok(
        discriminator in properties,
        `${name} must advertise its ${discriminator} discriminator`,
      );
      const serialized = JSON.stringify(properties[discriminator]);
      for (const value of values) {
        assert.ok(
          serialized.includes(value),
          `${name} must advertise ${discriminator} value ${value}`,
        );
      }
    }
  }, {
    createSddManager: ({ runManager, repoRoot, logRoot }) =>
      CreateTestSddManager(runManager, repoRoot, logRoot),
  });
});

test("the advertised SDD schemas never reject a payload the union accepts", () => {
  for (const payload of x_ValidStartPayloads) {
    assert.equal(
      XagentSddStartInputSchema.safeParse(payload).success, true,
      `fixture is not union-valid: ${JSON.stringify(payload)}`,
    );
    assert.equal(
      XagentSddStartAdvertisedSchema.safeParse(payload).success, true,
      `advertised schema rejects a legal start: ${JSON.stringify(payload)}`,
    );
  }
  for (const payload of x_ValidFollowupPayloads) {
    assert.equal(
      XagentSddFollowupInputSchema.safeParse(payload).success, true,
      `fixture is not union-valid: ${JSON.stringify(payload)}`,
    );
    assert.equal(
      XagentSddFollowupAdvertisedSchema.safeParse(payload).success, true,
      `advertised schema rejects a legal followup: ${JSON.stringify(payload)}`,
    );
  }
});

function UnwrapZodObject(schema: z.ZodTypeAny): z.ZodObject<z.ZodRawShape> {
  let current: z.ZodTypeAny = schema;
  while (current instanceof z.ZodEffects) {
    current = current._def.schema;
  }
  assert.ok(
    current instanceof z.ZodObject,
    `expected ZodObject after unwrap, got ${current.constructor.name}`,
  );
  return current;
}

function RequiredKeysOf(schema: z.ZodTypeAny): string[] {
  const object = UnwrapZodObject(schema);
  return Object.entries(object.shape)
    .filter(([, field]) => !(field as z.ZodTypeAny).isOptional())
    .map(([key]) => key);
}

test("every required union field appears on the advertised SDD schema", () => {
  const startProperties = Object.keys(XagentSddStartAdvertisedSchema.shape);
  for (const variant of XagentSddStartInputSchema.options) {
    for (const key of RequiredKeysOf(variant)) {
      assert.ok(
        startProperties.includes(key),
        `XagentSddStartAdvertisedSchema is missing required field "${key}"`,
      );
    }
  }

  const followupProperties = Object.keys(XagentSddFollowupAdvertisedSchema.shape);
  for (const variant of XagentSddFollowupInputSchema.options) {
    for (const key of RequiredKeysOf(variant)) {
      assert.ok(
        followupProperties.includes(key),
        `XagentSddFollowupAdvertisedSchema is missing required field "${key}"`,
      );
    }
  }
});

const x_Assignment = {
  cwd: "/private/tmp/worktree",
  plan: "/tmp/plans/2026-07-28-redesign-sdd-ledger.md",
  agent: "grok-4.5",
  harness: "cursor",
  effort: "high",
};

test("reviewer with a task requires report and forbids description", () => {
  const scoped = ReviewerStartSchema.safeParse({
    role: "reviewer", ...x_Assignment, task: 4,
    brief: "/tmp/sdd/task-4-review-brief.md",
    report: "/tmp/sdd/task-4-report.md",
    base: "main", head: "HEAD",
  });
  assert.equal(scoped.success, true);

  assert.equal(ReviewerStartSchema.safeParse({
    role: "reviewer", ...x_Assignment, task: 4,
    brief: "/tmp/sdd/task-4-review-brief.md", base: "main", head: "HEAD",
  }).success, false);

  assert.equal(ReviewerStartSchema.safeParse({
    role: "reviewer", ...x_Assignment, task: 4,
    brief: "/tmp/b.md", report: "/tmp/r.md", base: "main", head: "HEAD",
    description: "whole branch",
  }).success, false);
});

test("reviewer without a task requires description and forbids task-scoped fields", () => {
  assert.equal(ReviewerStartSchema.safeParse({
    role: "reviewer", ...x_Assignment,
    brief: "/tmp/review-brief.md", base: "main", head: "HEAD",
    description: "Branch adds the v2 ledger.",
  }).success, true);

  assert.equal(ReviewerStartSchema.safeParse({
    role: "reviewer", ...x_Assignment,
    brief: "/tmp/review-brief.md", base: "main", head: "HEAD",
  }).success, false);

  assert.equal(ReviewerStartSchema.safeParse({
    role: "reviewer", ...x_Assignment,
    brief: "/tmp/review-brief.md", base: "main", head: "HEAD",
    description: "Branch adds the v2 ledger.", report: "/tmp/r.md",
  }).success, false);
});

test("v1 role names and the review_brief field name are rejected", () => {
  assert.equal(XagentSddStartInputSchemaV2.safeParse({
    role: "task-reviewer", ...x_Assignment, task: 4,
    brief: "/tmp/b.md", report: "/tmp/r.md", base: "main", head: "HEAD",
  }).success, false);
  assert.equal(XagentSddStartInputSchemaV2.safeParse({
    role: "code-reviewer", ...x_Assignment,
    review_brief: "/tmp/b.md", description: "x", base: "main", head: "HEAD",
  }).success, false);
  assert.equal(ReviewerStartSchema.safeParse({
    role: "reviewer", ...x_Assignment,
    review_brief: "/tmp/b.md", base: "main", head: "HEAD", description: "x",
  }).success, false);
});

test("fixer requires task, brief, findings, tests, and report and rejects name", () => {
  const valid = {
    role: "fixer" as const, ...x_Assignment, task: 4,
    brief: "/tmp/sdd/task-4-brief.md",
    findings: "/tmp/sdd/task-4-findings.md",
    findings_text: "Two open findings.",
    tests: ["npm test"],
    report: "/tmp/sdd/task-4-report.md",
  };
  assert.equal(FixerStartSchema.safeParse(valid).success, true);
  assert.equal(FixerStartSchema.parse(valid).round, 1);
  assert.equal(FixerStartSchema.safeParse({ ...valid, round: 3 }).success, true);
  assert.equal(FixerStartSchema.safeParse({ ...valid, name: "Task 4 Fix Round 1" }).success, false);
  assert.equal(FixerStartSchema.safeParse({ ...valid, context: "extra" }).success, false);
  assert.equal(FixerStartSchema.safeParse({ ...valid, tests: [] }).success, false);
});

test("re-reviewer requires the original review brief", () => {
  const valid = {
    role: "re-reviewer" as const, ...x_Assignment, task: 4,
    brief: "/tmp/sdd/task-4-review-brief.md",
    findings: "/tmp/sdd/task-4-findings.md",
    report: "/tmp/sdd/task-4-report.md",
    base: "main", head: "HEAD",
  };
  assert.equal(ReReviewerStartSchema.safeParse(valid).success, true);
  const { brief, ...withoutBrief } = valid;
  assert.equal(ReReviewerStartSchema.safeParse(withoutBrief).success, false);
});

test("worker-facing text on v2 roles still rejects controller run ids", () => {
  assert.equal(FixerStartSchema.safeParse({
    role: "fixer", ...x_Assignment, task: 4,
    brief: "/tmp/b.md", findings: "/tmp/f.md",
    findings_text: "see xrun_20260728000000000_0000abcd",
    tests: ["npm test"], report: "/tmp/r.md",
  }).success, false);
});

test("v2 followup shapes require report and keep round render-only", () => {
  const fix = {
    kind: "fix" as const,
    agent_id: "xrun_20260728000000000_0000abcd",
    round: 2,
    findings: "/tmp/f.md",
    findings_text: "one finding",
    tests: ["npm test"],
    report: "/tmp/r.md",
  };
  assert.equal(FixFollowupSchema.safeParse(fix).success, true);
  const { report, ...withoutReport } = fix;
  assert.equal(FixFollowupSchema.safeParse(withoutReport).success, false);

  const reReview = {
    kind: "re-review" as const,
    agent_id: "xrun_20260728000000000_0000abcd",
    round: 2,
    findings: "/tmp/f.md",
    report: "/tmp/r.md",
    base: "main", head: "HEAD",
  };
  assert.equal(ReReviewFollowupSchema.safeParse(reReview).success, true);
  const { report: r2, ...reReviewWithoutReport } = reReview;
  assert.equal(ReReviewFollowupSchema.safeParse(reReviewWithoutReport).success, false);
});
