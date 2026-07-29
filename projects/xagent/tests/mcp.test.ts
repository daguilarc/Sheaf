import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { XagentRunManager } from "../src/service/run_manager.js";
import {
  AsSddRunManagerPort,
  CreateSddManager,
  type SddManager,
} from "../src/service/sdd_manager.js";
import { CreateSddAgentStore } from "../src/service/sdd_store.js";
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
] as const;

function CreateTestSddManager(
  runManager: XagentRunManager,
  repoRoot: string,
  logRoot: string,
): { manager: SddManager; store: ReturnType<typeof CreateSddAgentStore> }
{
  const store = CreateSddAgentStore(logRoot);
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

test("the SDD await and close facade tools are not registered", async () => {
  await withMcpService(async ({ client }) => {
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      "xagent_await",
      "xagent_close",
      "xagent_inspect",
      "xagent_interrupt",
      "xagent_list",
      "xagent_message",
      "xagent_sdd_followup",
      "xagent_sdd_start",
      "xagent_start_non_sdd",
    ]);
    // MCP SDK returns isError rather than throwing for unknown tools.
    //
    const awaitMissing = asToolCallResult(
      await client.callTool({ name: "xagent_sdd_await", arguments: {} }),
    );
    const closeMissing = asToolCallResult(
      await client.callTool({ name: "xagent_sdd_close", arguments: {} }),
    );
    assert.equal(awaitMissing.isError, true);
    assert.equal(closeMissing.isError, true);
  }, {
    createSddManager: ({ runManager, repoRoot, logRoot }) =>
      CreateTestSddManager(runManager, repoRoot, logRoot),
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

test("Streamable HTTP MCP initializes and discovers exactly the nine controller tools", async () => {
  await withMcpService(async ({ port, client }) => {
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [...x_ExpectedToolNames].sort());
    assert.equal(listed.tools.length, 9);

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
    role: "reviewer", ...x_AdvertisedAssignment, task: 4,
    brief: "/tmp/sdd/task-4-brief.md", report: "/tmp/sdd/task-4-report.md",
    base: "main", head: "HEAD",
  },
  {
    role: "reviewer", ...x_AdvertisedAssignment,
    brief: "/tmp/sdd/review-brief.md",
    description: "Branch adds the v2 ledger.", base: "main", head: "HEAD",
  },
  {
    role: "fixer", ...x_AdvertisedAssignment, task: 4,
    brief: "/tmp/sdd/task-4-brief.md",
    findings: "/tmp/sdd/task-4-findings.md",
    findings_text: "one finding",
    tests: ["npm test"],
    report: "/tmp/sdd/task-4-report.md",
  },
  {
    role: "re-reviewer", ...x_AdvertisedAssignment, task: 4,
    brief: "/tmp/sdd/task-4-brief.md",
    findings: "/tmp/sdd/task-4-findings.md",
    report: "/tmp/sdd/task-4-report.md",
    base: "main", head: "HEAD",
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
      ["xagent_sdd_start", "role", ["implementer", "reviewer", "fixer", "re-reviewer"]],
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

test("xagent_sdd_start advertises the four-way role union", async () => {
  // withMcpService owns the callback-scoped client; startMcpService also exposes
  // one via ensureClient() after lazy MCP init.
  //
  await withMcpService(async ({ client }) => {
    const listed = await client.listTools();
    const tool = listed.tools.find((entry) => entry.name === "xagent_sdd_start");
    assert.ok(tool);
    // Guard the negatives against passing vacuously: before Task 0 the
    // advertised schema was `{}`, where "does not mention task-reviewer" is
    // true for the wrong reason.
    assert.ok(Object.keys(tool.inputSchema.properties ?? {}).length > 0);
    assert.equal(JSON.stringify(tool.inputSchema).includes("task-reviewer"), false);
    assert.equal(JSON.stringify(tool.inputSchema).includes("code-reviewer"), false);
    assert.ok(JSON.stringify(tool.inputSchema).includes("re-reviewer"));
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

// A refined schema is a ZodEffects wrapping the real one. Task 6 wraps the
// start union this way, so every structural probe peels first.
function PeelEffects(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current: z.ZodTypeAny = schema;
  while (current instanceof z.ZodEffects) {
    current = current._def.schema;
  }
  return current;
}

function UnwrapZodObject(schema: z.ZodTypeAny): z.ZodObject<z.ZodRawShape> {
  const current = PeelEffects(schema);
  assert.ok(
    current instanceof z.ZodObject,
    `expected ZodObject after unwrap, got ${current.constructor.name}`,
  );
  return current;
}

function UnionOptionsOf(schema: z.ZodTypeAny): ReadonlyArray<z.ZodTypeAny> {
  const current = PeelEffects(schema);
  assert.ok(
    current instanceof z.ZodDiscriminatedUnion,
    `expected ZodDiscriminatedUnion after unwrap, got ${current.constructor.name}`,
  );
  return current.options as ReadonlyArray<z.ZodTypeAny>;
}

// RequiredKeysOf reads isOptional() off the object shape. Fields that are
// .optional() at the shape and only required via superRefine (reviewer's
// report, description, constraints, diff) never enter the required set — so
// a green drift test is not full coverage of refinement-gated fields.
//
function RequiredKeysOf(schema: z.ZodTypeAny): string[] {
  const object = UnwrapZodObject(schema);
  return Object.entries(object.shape)
    .filter(([, field]) => !(field as z.ZodTypeAny).isOptional())
    .map(([key]) => key);
}

test("every required union field appears on the advertised SDD schema", () => {
  const startProperties = Object.keys(XagentSddStartAdvertisedSchema.shape);
  for (const variant of UnionOptionsOf(XagentSddStartInputSchema)) {
    for (const key of RequiredKeysOf(variant)) {
      assert.ok(
        startProperties.includes(key),
        `XagentSddStartAdvertisedSchema is missing required field "${key}"`,
      );
    }
  }

  const followupProperties = Object.keys(XagentSddFollowupAdvertisedSchema.shape);
  for (const variant of UnionOptionsOf(XagentSddFollowupInputSchema)) {
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

// Labelled so a divergence failure names the side that broke. The whole point
// of running both is that they must agree; an unlabelled message makes the
// reader guess which one disagreed.
const x_ReviewerSchemas = [
  ["ReviewerStartSchema", ReviewerStartSchema],
  ["XagentSddStartInputSchema", XagentSddStartInputSchema],
] as const;

function AssertReviewerCases(
  cases: ReadonlyArray<{ payload: Record<string, unknown>; ok: boolean }>,
): void {
  for (const [label, schema] of x_ReviewerSchemas) {
    for (const { payload, ok } of cases) {
      assert.equal(
        schema.safeParse(payload).success, ok,
        `${label}: expected ${ok} for ${JSON.stringify(payload)}`,
      );
    }
  }
}

test("reviewer with a task requires report and forbids description", () => {
  const withTask = {
    role: "reviewer" as const, ...x_Assignment, task: 4,
    brief: "/tmp/sdd/task-4-review-brief.md",
    report: "/tmp/sdd/task-4-report.md",
    base: "main", head: "HEAD",
  };
  const cases: ReadonlyArray<{ payload: Record<string, unknown>; ok: boolean }> = [
    { payload: withTask, ok: true },
    {
      payload: {
        role: "reviewer", ...x_Assignment, task: 4,
        brief: "/tmp/sdd/task-4-review-brief.md", base: "main", head: "HEAD",
      },
      ok: false,
    },
    {
      payload: {
        role: "reviewer", ...x_Assignment, task: 4,
        brief: "/tmp/b.md", report: "/tmp/r.md", base: "main", head: "HEAD",
        description: "whole branch",
      },
      ok: false,
    },
    {
      payload: {
        ...withTask,
        constraints: "/tmp/sdd/constraints.md",
        diff: "/tmp/sdd/scoped.diff",
      },
      ok: true,
    },
  ];
  AssertReviewerCases(cases);
});

test("reviewer without a task requires description and forbids task-scoped fields", () => {
  const wholeBranch = {
    role: "reviewer" as const, ...x_Assignment,
    brief: "/tmp/review-brief.md", base: "main", head: "HEAD",
    description: "Branch adds the v2 ledger.",
  };
  const cases: ReadonlyArray<{ payload: Record<string, unknown>; ok: boolean }> = [
    { payload: wholeBranch, ok: true },
    {
      payload: {
        role: "reviewer", ...x_Assignment,
        brief: "/tmp/review-brief.md", base: "main", head: "HEAD",
      },
      ok: false,
    },
    {
      payload: { ...wholeBranch, report: "/tmp/r.md" },
      ok: false,
    },
    {
      payload: { ...wholeBranch, constraints: "/tmp/sdd/constraints.md" },
      ok: false,
    },
    {
      payload: { ...wholeBranch, diff: "/tmp/sdd/scoped.diff" },
      ok: false,
    },
  ];
  AssertReviewerCases(cases);
});

test("v1 role names and the review_brief field name are rejected", () => {
  assert.equal(XagentSddStartInputSchema.safeParse({
    role: "task-reviewer", ...x_Assignment, task: 4,
    brief: "/tmp/b.md", report: "/tmp/r.md", base: "main", head: "HEAD",
  }).success, false);
  assert.equal(XagentSddStartInputSchema.safeParse({
    role: "code-reviewer", ...x_Assignment,
    review_brief: "/tmp/b.md", description: "x", base: "main", head: "HEAD",
  }).success, false);
  for (const [, schema] of x_ReviewerSchemas) {
    assert.equal(schema.safeParse({
      role: "reviewer", ...x_Assignment,
      review_brief: "/tmp/b.md", base: "main", head: "HEAD", description: "x",
    }).success, false);
  }
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
  // xsvc-11's defining prohibition for fixer and re-reviewer: no `name` field
  // encoding the round into an assignment identity. `fixer` pins this; without
  // this line `re-reviewer` did not.
  assert.equal(
    ReReviewerStartSchema.safeParse({ ...valid, name: "Task 4 Re-Review Round 1" }).success,
    false,
  );
});

test("worker-facing text on v2 roles still rejects controller run ids", () => {
  assert.equal(FixerStartSchema.safeParse({
    role: "fixer", ...x_Assignment, task: 4,
    brief: "/tmp/b.md", findings: "/tmp/f.md",
    findings_text: "see xrun_20260728000000000_0000abcd",
    tests: ["npm test"], report: "/tmp/r.md",
  }).success, false);
  for (const [, schema] of x_ReviewerSchemas) {
    assert.equal(schema.safeParse({
      role: "reviewer", ...x_Assignment,
      brief: "/tmp/review-brief.md", base: "main", head: "HEAD",
      description: "see xrun_20260728000000000_0000abcd",
    }).success, false);
  }
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

// Task 8a: v2 sdd identity block on xagent_list. Uses withMcpService for the
// callback-scoped client; startMcpService now also exposes MCP via ensureClient().
//
test("xagent_list carries the v2 sdd identity block", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "xagent-mcp-sdd-list-"));
  const planPath = path.join(cwd, "2026-07-28-redesign-sdd-ledger.md");
  const briefPath = path.join(cwd, "brief.md");
  const reportPath = path.join(cwd, "report.md");
  await writeFile(planPath, "# plan\n", "utf8");
  await writeFile(briefPath, "Implement list identity.\n", "utf8");
  await writeFile(reportPath, "", "utf8");

  await withMcpService(async ({ client }) => {
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
          task: 4,
          name: "list-identity",
          brief: briefPath,
          report: reportPath,
        },
      }),
    );
    assertToolSucceeded(startedResult);
    const started = structuredToolBody(startedResult);

    const body = structuredToolBody(asToolCallResult(
      await client.callTool({ name: "xagent_list", arguments: {} }),
    ));
    const runs = body.runs as Array<Record<string, unknown>>;
    const row = runs.find((entry) => entry.run_id === started.agent_id)!;
    assert.deepEqual(Object.keys(row.sdd as object).sort(), [
      "brief_path", "cwd", "dispatched_at", "plan", "role", "task",
    ]);
    assert.equal((row.sdd as { plan: string }).plan, "2026-07-28-redesign-sdd-ledger");
    assert.equal(row.run_missing, undefined);
  }, {
    createSddManager: ({ runManager, repoRoot, logRoot }) =>
      CreateTestSddManager(runManager, repoRoot, logRoot),
  });
});

test("a generic run carries no sdd block and no run_missing flag", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "xagent-mcp-generic-list-"));

  await withMcpService(async ({ client }) => {
    const startedResult = asToolCallResult(
      await client.callTool({
        name: "xagent_start_non_sdd",
        arguments: { cwd, prompt: "generic", harness: "codex" },
      }),
    );
    assertToolSucceeded(startedResult);
    const started = structuredToolBody(startedResult);

    const body = structuredToolBody(asToolCallResult(
      await client.callTool({ name: "xagent_list", arguments: {} }),
    ));
    const runs = body.runs as Array<Record<string, unknown>>;
    const row = runs.find((entry) => entry.run_id === started.run_id)!;
    assert.equal(row.sdd, undefined);
    assert.equal(row.run_missing, undefined);
  }, {
    createSddManager: ({ runManager, repoRoot, logRoot }) =>
      CreateTestSddManager(runManager, repoRoot, logRoot),
  });
});

// Task 8b: ledger rows with no run record surface as parallel tombstone
// entries. Uses withMcpService + ledger(); startMcpService also exposes MCP
// via ensureClient() / listRuns() after lazy init.
//
test("a ledger row with no run record is a tombstone entry", async () => {
  await withMcpService(async ({ client, ledger }) => {
    ledger().Insert({
      agentId: "xrun_20260728000000000_0000dead",
      planPath: "/tmp/plans/2026-07-28-redesign-sdd-ledger.md",
      task: 4,
      role: "fixer",
      briefPath: "/tmp/sdd/task-4-brief.md",
      briefText: "brief\n",
      cwd: "/private/tmp/worktree",
    });
    const body = structuredToolBody(asToolCallResult(
      await client.callTool({ name: "xagent_list", arguments: {} }),
    ));
    const runs = body.runs as Array<Record<string, unknown>>;
    const tombstone = runs.find((entry) => entry.run_id === "xrun_20260728000000000_0000dead")!;
    assert.deepEqual(Object.keys(tombstone).sort(), ["run_id", "run_missing", "sdd"]);
    assert.equal(tombstone.run_missing, true);
    assert.equal((tombstone.sdd as { role: string }).role, "fixer");
  }, {
    createSddManager: ({ runManager, repoRoot, logRoot }) =>
      CreateTestSddManager(runManager, repoRoot, logRoot),
  });
});
