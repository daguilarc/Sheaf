import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  FormatFixFollowup,
  RenderSddPrompt,
  SddPromptError,
} from "../src/service/sdd_prompt.js";
import { generateRunId } from "../src/logs.js";
import {
  AgentIdSchema,
  CodeReviewerStartSchema,
  FixFollowupSchema,
  ImplementerStartSchema,
  ReReviewFollowupSchema,
  TaskReviewerStartSchema,
  XagentSddAwaitInputSchema,
  XagentSddCloseInputSchema,
  XagentSddFollowupInputSchema,
  XagentSddStartInputSchema,
  x_DefaultAwaitDeadlineSeconds,
  x_MaxAwaitDeadlineSeconds,
} from "../src/service/tool_schemas.js";

const execFileAsync = promisify(execFile);
const serviceRepoRoot = path.resolve(import.meta.dirname, "..", "..", "..", "..");

function assertSamePath(left: string, right: string): void {
  assert.equal(realpathSync(left), realpathSync(right));
}

function assertSerializedContainsPath(serialized: string, filePath: string): void {
  assert.ok(
    serialized.includes(filePath) || serialized.includes(path.resolve(filePath)),
    `expected serialized result to include ${filePath}`,
  );
}

const x_ImplementerPlaceholders = [
  "[task name]",
  "[BRIEF_FILE]",
  "[Scene-setting: where this fits, dependencies, architectural context]",
  "[directory]",
  "[REPORT_FILE]",
];

const x_TaskReviewerPlaceholders = [
  "[BRIEF_FILE]",
  "[GLOBAL_CONSTRAINTS]",
  "[REPORT_FILE]",
  "[BASE_SHA]",
  "[HEAD_SHA]",
  "[DIFF_FILE]",
];

const x_ReReviewPlaceholders = [
  "[BRIEF_FILE]",
  "[FINDINGS]",
  "[REPORT_FILE]",
  "[FIX_BASE_SHA]",
  "[HEAD_SHA]",
  "[DIFF_FILE]",
];

const x_CodeReviewerPlaceholders = [
  "[DESCRIPTION]",
  "[PLAN_OR_REQUIREMENTS]",
  "[BASE_SHA]",
  "[HEAD_SHA]",
];

const sampleAgentId = "xrun_20260726000000000_00000001";

const implementerTemplateBody = `You are implementing Task N: [task name]

## Task Description

Read your task brief first: [BRIEF_FILE]

## Context

[Scene-setting: where this fits, dependencies, architectural context]

Work from: [directory]

## Report Format

Write your full report to [REPORT_FILE]
`;

const reviewerTemplateBody = `You are reviewing one task's implementation.

## What Was Requested

Read the task brief: [BRIEF_FILE]

Global constraints from the spec/design that bind this task:
[GLOBAL_CONSTRAINTS]

## What the Implementer Claims They Built

Read the implementer's report: [REPORT_FILE]

## Diff Under Review

**Base:** [BASE_SHA]
**Head:** [HEAD_SHA]
**Diff file:** [DIFF_FILE]
`;

const rereviewTemplateBody = `You are re-reviewing one task's fix round.

## The Task

Read the task brief: [BRIEF_FILE]

## The Findings Under Verification

[FINDINGS]

## The Fix

Read the implementer's report: [REPORT_FILE]

**Fix base:** [FIX_BASE_SHA]
**Head:** [HEAD_SHA]
**Diff file:** [DIFF_FILE]
`;

const codeReviewerTemplateBody = `You are a Senior Code Reviewer.

## What Was Implemented

[DESCRIPTION]

## Requirements / Plan

[PLAN_OR_REQUIREMENTS]

## Git Range to Review

**Base:** [BASE_SHA]
**Head:** [HEAD_SHA]
`;

function makeTemplate(promptBody: string): string {
  const indented = promptBody
    .split("\n")
    .map((line) => (line.length === 0 ? "" : `    ${line}`))
    .join("\n");
  return [
    "# Some Prompt Template",
    "",
    "```",
    "Subagent (general-purpose):",
    '  description: "Do the thing"',
    "  model: [MODEL — REQUIRED: choose per SKILL.md]",
    "  prompt: |",
    indented,
    "```",
    "",
  ].join("\n");
}

async function writeTemplatesRoot(root: string): Promise<void> {
  const templates = [
    {
      skill: "subagent-driven-development",
      filename: "implementer-prompt.md",
      body: implementerTemplateBody,
    },
    {
      skill: "subagent-driven-development",
      filename: "task-reviewer-prompt.md",
      body: reviewerTemplateBody,
    },
    {
      skill: "subagent-driven-development",
      filename: "re-review-prompt.md",
      body: rereviewTemplateBody,
    },
    {
      skill: "requesting-code-review",
      filename: "code-reviewer.md",
      body: codeReviewerTemplateBody,
    },
  ];
  for (const template of templates) {
    const target = path.join(root, template.skill, template.filename);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, makeTemplate(template.body), "utf8");
  }
}

async function createFixture(): Promise<{
  trustedRepoRoot: string;
  callerCwd: string;
  plan: string;
  brief: string;
  report: string;
  reviewBrief: string;
  findings: string;
  constraints: string;
  templatesRoot: string;
  trustedScript: string;
  sentinelScript: string;
  invocations: Array<{ python: string; script: string; args: string[]; cwd: string }>;
}> {
  const base = await mkdtemp(path.join(tmpdir(), "xagent-sdd-prompt-"));
  const trustedRepoRoot = path.join(base, "trusted-repo");
  const callerCwd = path.join(base, "caller-worktree");
  const templatesRoot = path.join(base, "templates", "6.2.0", "skills");
  const invocations: Array<{ python: string; script: string; args: string[]; cwd: string }> = [];

  await mkdir(path.join(trustedRepoRoot, "projects", "agents", "utils"), { recursive: true });
  await mkdir(callerCwd, { recursive: true });
  await mkdir(path.join(callerCwd, "projects", "agents", "utils"), { recursive: true });
  await writeTemplatesRoot(templatesRoot);

  const plan = path.join(callerCwd, "docs", "my-plan.md");
  const brief = path.join(callerCwd, "task-1-brief.md");
  const report = path.join(callerCwd, ".superpowers", "sdd", "my-plan", "task-1-report.md");
  const reviewBrief = path.join(callerCwd, "spec-review-brief.md");
  const findings = path.join(callerCwd, "task-1-findings.md");
  const constraints = path.join(callerCwd, ".superpowers", "sdd", "my-plan", "global-constraints.md");
  await mkdir(path.dirname(plan), { recursive: true });
  await mkdir(path.dirname(report), { recursive: true });
  await writeFile(plan, "# Plan\n\n## Task 1: Thing\n\nDo it.\n", "utf8");
  await writeFile(brief, "BRIEF-BODY-SENTINEL\n", "utf8");
  await writeFile(report, "Implementer report.\n", "utf8");
  await writeFile(reviewBrief, "REVIEW-BRIEF-SENTINEL\n", "utf8");
  await writeFile(findings, "- Finding one\n- Finding two\n", "utf8");
  await writeFile(constraints, "CONSTRAINTS-SENTINEL\n", "utf8");
  await writeFile(path.join(callerCwd, ".superpowers", "sdd", ".gitignore"), "*\n", "utf8");
  await execFileAsync("git", ["init", "-q"], { cwd: callerCwd });
  await execFileAsync("git", ["config", "user.email", "t@example.com"], { cwd: callerCwd });
  await execFileAsync("git", ["config", "user.name", "t"], { cwd: callerCwd });
  await writeFile(path.join(callerCwd, "seed.txt"), "seed\n", "utf8");
  await execFileAsync("git", ["add", "-A"], { cwd: callerCwd });
  await execFileAsync("git", ["commit", "-qm", "seed"], { cwd: callerCwd });
  const shortSha = (await execFileAsync("git", ["rev-parse", "--short", "HEAD"], { cwd: callerCwd })).stdout.trim();
  await writeFile(
    path.join(callerCwd, ".superpowers", "sdd", "my-plan", `review-${shortSha}..${shortSha}.diff`),
    "# Review package\n",
    "utf8",
  );

  const trustedScript = path.join(trustedRepoRoot, "projects", "agents", "utils", "dispatch-prompt");
  const sentinelScript = path.join(callerCwd, "projects", "agents", "utils", "dispatch-prompt");
  const trustedScriptBody = `#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path

invocation = {
    "python": sys.executable,
    "script": sys.argv[0],
    "args": sys.argv[1:],
    "cwd": os.getcwd(),
}
(Path(os.environ["SDD_INVOCATION_LOG"]).open("a", encoding="utf-8")
 .write(json.dumps(invocation) + "\\n"))

role = sys.argv[1]
out = Path(os.environ["SDD_OUTPUT_PATH"])
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(f"rendered {role} prompt\\n", encoding="utf-8")
print(out.resolve())
sys.exit(0)
`;
  await writeFile(trustedScript, trustedScriptBody, "utf8");
  await chmod(trustedScript, 0o755);
  await writeFile(sentinelScript, "#!/bin/sh\necho MALICIOUS\n", "utf8");
  await chmod(sentinelScript, 0o755);

  return {
    trustedRepoRoot,
    callerCwd,
    plan,
    brief,
    report,
    reviewBrief,
    findings,
    constraints,
    templatesRoot,
    trustedScript,
    sentinelScript,
    invocations,
  };
}

async function readInvocations(logPath: string): Promise<Array<{ python: string; script: string; args: string[]; cwd: string }>> {
  const { readFile } = await import("node:fs/promises");
  const raw = await readFile(logPath, "utf8");
  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { python: string; script: string; args: string[]; cwd: string });
}

function validImplementerStart(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    role: "implementer",
    cwd: "/tmp/worktree",
    plan: "/tmp/plan.md",
    task: 1,
    name: "Versioned SQLite SDD Ledger",
    brief: "/tmp/task-1-brief.md",
    report: "/tmp/task-1-report.md",
    agent: "grok-4.5",
    harness: "cursor",
    effort: "high",
    ...overrides,
  };
}

test("XagentSddStartInputSchema accepts a valid implementer start payload", () => {
  const parsed = XagentSddStartInputSchema.parse(validImplementerStart());
  assert.equal(parsed.role, "implementer");
  assert.equal(parsed.task, 1);
  assert.equal(parsed.agent, "grok-4.5");
});

test("XagentSddStartInputSchema rejects empty agent and unknown harness, effort, or role", () => {
  assert.equal(XagentSddStartInputSchema.safeParse(validImplementerStart({ agent: "" })).success, false);
  assert.equal(XagentSddStartInputSchema.safeParse(validImplementerStart({ harness: "unknown" })).success, false);
  assert.equal(XagentSddStartInputSchema.safeParse(validImplementerStart({ effort: "turbo" })).success, false);
  assert.equal(XagentSddStartInputSchema.safeParse(validImplementerStart({ role: "boss" })).success, false);
});

test("XagentSddStartInputSchema rejects missing task for task roles and task on code-reviewer", () => {
  const missingTask = { ...validImplementerStart() };
  delete (missingTask as { task?: number }).task;
  assert.equal(XagentSddStartInputSchema.safeParse(missingTask).success, false);
  assert.equal(
    TaskReviewerStartSchema.safeParse({
      role: "task-reviewer",
      cwd: "/tmp/worktree",
      plan: "/tmp/plan.md",
      brief: "/tmp/brief.md",
      report: "/tmp/report.md",
      base: "HEAD~1",
      head: "HEAD",
      agent: "opus",
      harness: "claude_code",
      effort: "high",
    }).success,
    false,
  );
  assert.equal(
    CodeReviewerStartSchema.safeParse({
      role: "code-reviewer",
      cwd: "/tmp/worktree",
      plan: "/tmp/plan.md",
      task: 1,
      review_brief: "/tmp/review-brief.md",
      base: "HEAD~1",
      head: "HEAD",
      agent: "opus",
      harness: "claude_code",
      effort: "high",
    }).success,
    false,
  );
});

test("XagentSddStartInputSchema rejects unknown fields and invalid task shapes", () => {
  assert.equal(XagentSddStartInputSchema.safeParse(validImplementerStart({ extra: true })).success, false);
  assert.equal(XagentSddStartInputSchema.safeParse(validImplementerStart({ task: 0 })).success, false);
  assert.equal(XagentSddStartInputSchema.safeParse(validImplementerStart({ task: "1" })).success, false);
});

test("code-reviewer permits no task and requires review_brief and description", () => {
  const parsed = CodeReviewerStartSchema.parse({
    role: "code-reviewer",
    cwd: "/tmp/worktree",
    plan: "/tmp/plan.md",
    review_brief: "/tmp/spec-review-brief.md",
    description: "Whole-branch review scope",
    base: "HEAD~1",
    head: "HEAD",
    agent: "opus",
    harness: "claude_code",
    effort: "high",
  });
  assert.equal("task" in parsed, false);
  assert.equal(parsed.review_brief, "/tmp/spec-review-brief.md");
  assert.equal(parsed.description, "Whole-branch review scope");
  assert.equal(
    CodeReviewerStartSchema.safeParse({
      role: "code-reviewer",
      cwd: "/tmp/worktree",
      plan: "/tmp/plan.md",
      base: "HEAD~1",
      head: "HEAD",
      agent: "opus",
      harness: "claude_code",
      effort: "high",
    }).success,
    false,
  );
  assert.equal(
    CodeReviewerStartSchema.safeParse({
      role: "code-reviewer",
      cwd: "/tmp/worktree",
      plan: "/tmp/plan.md",
      review_brief: "/tmp/spec-review-brief.md",
      description: "",
      base: "HEAD~1",
      head: "HEAD",
      agent: "opus",
      harness: "claude_code",
      effort: "high",
    }).success,
    false,
  );
});

test("SDD schemas reject relative and traversal artifact paths", () => {
  assert.equal(XagentSddStartInputSchema.safeParse(validImplementerStart({ brief: "task-1-brief.md" })).success, false);
  assert.equal(XagentSddStartInputSchema.safeParse(validImplementerStart({ plan: "plan.md" })).success, false);
  assert.equal(
    XagentSddStartInputSchema.safeParse(validImplementerStart({ report: "/tmp/../secret/report.md" })).success,
    false,
  );
  assert.equal(
    FixFollowupSchema.safeParse({
      kind: "fix",
      agent_id: sampleAgentId,
      round: 1,
      findings: "findings.md",
      findings_text: "Important finding\n",
      tests: ["projects/xagent/tests/sdd_store.test.ts"],
    }).success,
    false,
  );
  assert.equal(
    ReReviewFollowupSchema.safeParse({
      kind: "re-review",
      agent_id: sampleAgentId,
      round: 1,
      findings: "../findings.md",
      base: "HEAD~1",
      head: "HEAD",
    }).success,
    false,
  );
});

test("XagentSddFollowupInputSchema validates fix and re-review payloads", () => {
  const fix = XagentSddFollowupInputSchema.parse({
    kind: "fix",
    agent_id: sampleAgentId,
    round: 1,
    findings: "/tmp/findings.md",
    findings_text: "Important finding\n",
    tests: ["projects/xagent/tests/sdd_store.test.ts"],
  });
  assert.equal(fix.kind, "fix");

  const rereview = XagentSddFollowupInputSchema.parse({
    kind: "re-review",
    agent_id: sampleAgentId,
    round: 2,
    findings: "/tmp/findings.md",
    base: "HEAD~1",
    head: "HEAD",
  });
  assert.equal(rereview.kind, "re-review");
});

test("AgentIdSchema accepts generateRunId output and rejects invalid ids", () => {
  const generated = generateRunId(new Date("2026-07-26T00:00:00.000Z"));
  assert.equal(AgentIdSchema.safeParse(generated).success, true);
  assert.equal(AgentIdSchema.safeParse("not-a-run").success, false);
  assert.equal(AgentIdSchema.safeParse(sampleAgentId).success, true);
});

test("SDD await and close schemas enforce deadline bounds and after_sequence", () => {
  const defaultParsed = XagentSddAwaitInputSchema.parse({
    agent_id: sampleAgentId,
    after_sequence: 0,
  });
  assert.equal(defaultParsed.deadline_seconds, x_DefaultAwaitDeadlineSeconds);
  assert.equal(x_MaxAwaitDeadlineSeconds, 7000);

  assert.equal(
    XagentSddAwaitInputSchema.safeParse({
      agent_id: sampleAgentId,
      after_sequence: 0,
      deadline_seconds: 7001,
    }).success,
    false,
  );
  assert.equal(
    XagentSddAwaitInputSchema.safeParse({
      agent_id: sampleAgentId,
    }).success,
    false,
  );
  assert.equal(
    XagentSddCloseInputSchema.safeParse({ agent_id: "bad" }).success,
    false,
  );
  assert.equal(
    XagentSddCloseInputSchema.safeParse({ agent_id: sampleAgentId }).success,
    true,
  );
});

test("FormatFixFollowup emits the golden fix clauses with verbatim findings", () => {
  const formatted = FormatFixFollowup({
    round: 2,
    briefPath: "/tmp/task-1-brief.md",
    findingsPath: "/tmp/task-1-findings.md",
    findingsText: "- Important finding one\n- Important finding two\n",
    tests: ["projects/xagent/tests/sdd_store.test.ts", "projects/xagent/tests/logs.test.ts"],
    reportPath: "/tmp/task-1-report.md",
  });
  assert.match(formatted, /^Fix round 2\./);
  assert.match(formatted, /Read the original brief at \/tmp\/task-1-brief\.md\./);
  assert.match(formatted, /Read and address only the open findings at \/tmp\/task-1-findings\.md\./);
  assert.match(formatted, /Run these covering tests: projects\/xagent\/tests\/sdd_store\.test\.ts, projects\/xagent\/tests\/logs\.test\.ts\./);
  assert.match(formatted, /Append the fix report to \/tmp\/task-1-report\.md\./);
  assert.match(formatted, /Return only the short Superpowers status contract\./);
  assert.match(formatted, /- Important finding one/);
  assert.match(formatted, /- Important finding two/);
  assert.doesNotMatch(formatted, /SECRET_FINDING_BODY/);
});

test("RenderSddPrompt invokes only the trusted script through python3 with caller cwd", async () => {
  const fixture = await createFixture();
  const invocationLog = path.join(fixture.trustedRepoRoot, "invocations.jsonl");
  const outputPath = path.join(fixture.callerCwd, ".superpowers", "sdd", "my-plan", "dispatch-implementer-task-1.md");
  process.env.SDD_INVOCATION_LOG = invocationLog;
  process.env.SDD_OUTPUT_PATH = outputPath;

  const rendered = await RenderSddPrompt({
    role: "implementer",
    repoRoot: fixture.trustedRepoRoot,
    cwd: fixture.callerCwd,
    plan: fixture.plan,
    task: 1,
    name: "Versioned SQLite SDD Ledger",
    brief: fixture.brief,
    report: fixture.report,
    templatesRoot: fixture.templatesRoot,
  });

  const invocations = await readInvocations(invocationLog);
  assert.equal(invocations.length, 1);
  assertSamePath(invocations[0]!.cwd, fixture.callerCwd);
  assert.equal(invocations[0]!.script, fixture.trustedScript);
  assert.notEqual(invocations[0]!.script, fixture.sentinelScript);
  assert.equal(invocations[0]!.args[0], "implementer");
  assert.ok(invocations[0]!.args.includes("--plan"));
  assert.ok(invocations[0]!.args.includes(fixture.plan));
  assert.ok(invocations[0]!.args.includes("--name"));
  assert.ok(invocations[0]!.args.includes("Versioned SQLite SDD Ledger"));
  assertSamePath(rendered.prompt.path, outputPath);
  assert.equal(rendered.prompt.text, "rendered implementer prompt\n");
  assertSamePath(rendered.metadata.briefPath!, fixture.brief);
  assertSamePath(rendered.metadata.reportPath!, fixture.report);
});

test("RenderSddPrompt maps code-reviewer requirements through @brief path", async () => {
  const fixture = await createFixture();
  const invocationLog = path.join(fixture.trustedRepoRoot, "invocations-code-reviewer.jsonl");
  const outputPath = path.join(fixture.callerCwd, ".superpowers", "sdd", "my-plan", "dispatch-code-reviewer.md");
  process.env.SDD_INVOCATION_LOG = invocationLog;
  process.env.SDD_OUTPUT_PATH = outputPath;

  await RenderSddPrompt({
    role: "code-reviewer",
    repoRoot: fixture.trustedRepoRoot,
    cwd: fixture.callerCwd,
    plan: fixture.plan,
    reviewBrief: fixture.reviewBrief,
    description: "Whole-branch review",
    base: "HEAD~1",
    head: "HEAD",
    templatesRoot: fixture.templatesRoot,
  });

  const invocations = await readInvocations(invocationLog);
  const requirementsIndex = invocations[0]!.args.indexOf("--requirements");
  assert.ok(requirementsIndex >= 0);
  assert.equal(invocations[0]!.args[requirementsIndex + 1], `@${fixture.reviewBrief}`);
});

test("RenderSddPrompt surfaces renderer failures without leaking bulk text", async () => {
  const fixture = await createFixture();

  await assert.rejects(
    () => RenderSddPrompt(
      {
        role: "implementer",
        repoRoot: fixture.trustedRepoRoot,
        cwd: fixture.callerCwd,
        plan: fixture.plan,
        task: 1,
        name: "Thing",
        brief: fixture.brief,
        templatesRoot: fixture.templatesRoot,
      },
      { pythonExecutable: "/definitely/missing/python3" },
    ),
    (error: unknown) => {
      assert.ok(error instanceof SddPromptError);
      assert.equal(error.structured.error, "sdd_python_missing");
      assert.doesNotMatch(error.message, /BRIEF-BODY-SENTINEL/);
      return true;
    },
  );

  await assert.rejects(
    () => RenderSddPrompt({
      role: "implementer",
      repoRoot: path.join(fixture.trustedRepoRoot, "missing"),
      cwd: fixture.callerCwd,
      plan: fixture.plan,
      task: 1,
      name: "Thing",
      brief: fixture.brief,
      templatesRoot: fixture.templatesRoot,
    }),
    (error: unknown) => {
      assert.ok(error instanceof SddPromptError);
      assert.equal(error.structured.error, "sdd_renderer_missing");
      return true;
    },
  );

  await assert.rejects(
    () => RenderSddPrompt(
      {
        role: "implementer",
        repoRoot: fixture.trustedRepoRoot,
        cwd: fixture.callerCwd,
        plan: fixture.plan,
        task: 1,
        name: "Thing",
        brief: fixture.brief,
        templatesRoot: fixture.templatesRoot,
      },
      {
        execFile: async () => {
          const error = new Error("renderer failed") as Error & { code?: number; stderr?: string };
          error.code = 2;
          error.stderr = "dispatch-prompt: template drift [SECRET_BODY]";
          throw error;
        },
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof SddPromptError);
      assert.equal(error.structured.error, "sdd_renderer_failed");
      assert.doesNotMatch(error.message, /SECRET_BODY/);
      assert.doesNotMatch(JSON.stringify(error.structured), /SECRET_BODY/);
      assert.doesNotMatch(JSON.stringify(error.structured), /template drift/);
      return true;
    },
  );

  await assert.rejects(
    () => RenderSddPrompt(
      {
        role: "implementer",
        repoRoot: fixture.trustedRepoRoot,
        cwd: fixture.callerCwd,
        plan: fixture.plan,
        task: 1,
        name: "Thing",
        brief: fixture.brief,
        templatesRoot: fixture.templatesRoot,
      },
      { execFile: async () => ({ stdout: "\n", stderr: "" }) },
    ),
    (error: unknown) => {
      assert.ok(error instanceof SddPromptError);
      assert.equal(error.structured.error, "sdd_renderer_output_invalid");
      return true;
    },
  );

  await assert.rejects(
    () => RenderSddPrompt(
      {
        role: "implementer",
        repoRoot: fixture.trustedRepoRoot,
        cwd: fixture.callerCwd,
        plan: fixture.plan,
        task: 1,
        name: "Thing",
        brief: fixture.brief,
        templatesRoot: fixture.templatesRoot,
      },
      { execFile: async () => ({ stdout: "/one\n/two\n", stderr: "" }) },
    ),
    (error: unknown) => {
      assert.ok(error instanceof SddPromptError);
      assert.equal(error.structured.error, "sdd_renderer_output_invalid");
      return true;
    },
  );

  await assert.rejects(
    () => RenderSddPrompt(
      {
        role: "implementer",
        repoRoot: fixture.trustedRepoRoot,
        cwd: fixture.callerCwd,
        plan: fixture.plan,
        task: 1,
        name: "Thing",
        brief: fixture.brief,
        templatesRoot: fixture.templatesRoot,
      },
      {
        execFile: async () => ({ stdout: "/tmp/missing-rendered-prompt.md\n", stderr: "" }),
        readFile: async () => {
          throw new Error("missing");
        },
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof SddPromptError);
      assert.equal(error.structured.error, "sdd_prompt_unreadable");
      return true;
    },
  );
});

test("RenderSddPrompt renders all roles without residual placeholders and returns MCP-safe metadata", async () => {
  const fixture = await createFixture();

  const roles = [
    {
      name: "implementer",
      placeholders: x_ImplementerPlaceholders,
      input: {
        role: "implementer" as const,
        repoRoot: serviceRepoRoot,
        cwd: fixture.callerCwd,
        plan: fixture.plan,
        task: 1,
        name: "Versioned SQLite SDD Ledger",
        brief: fixture.brief,
        report: fixture.report,
        context: "Scene-setting for the implementer task.",
        templatesRoot: fixture.templatesRoot,
      },
      requiredPath: fixture.brief,
    },
    {
      name: "task-reviewer",
      placeholders: x_TaskReviewerPlaceholders,
      input: {
        role: "task-reviewer" as const,
        repoRoot: serviceRepoRoot,
        cwd: fixture.callerCwd,
        plan: fixture.plan,
        task: 1,
        brief: fixture.brief,
        report: fixture.report,
        constraints: fixture.constraints,
        base: "HEAD",
        head: "HEAD",
        templatesRoot: fixture.templatesRoot,
      },
      requiredPath: fixture.report,
    },
    {
      name: "re-review",
      placeholders: x_ReReviewPlaceholders,
      input: {
        role: "re-review" as const,
        repoRoot: serviceRepoRoot,
        cwd: fixture.callerCwd,
        plan: fixture.plan,
        task: 1,
        round: 1,
        brief: fixture.brief,
        findings: fixture.findings,
        report: fixture.report,
        base: "HEAD",
        head: "HEAD",
        diff: fixture.brief,
        templatesRoot: fixture.templatesRoot,
      },
      requiredPath: fixture.findings,
    },
    {
      name: "code-reviewer",
      placeholders: x_CodeReviewerPlaceholders,
      input: {
        role: "code-reviewer" as const,
        repoRoot: serviceRepoRoot,
        cwd: fixture.callerCwd,
        plan: fixture.plan,
        reviewBrief: fixture.reviewBrief,
        description: "Whole-branch review",
        base: "HEAD",
        head: "HEAD",
        templatesRoot: fixture.templatesRoot,
      },
      requiredPath: fixture.reviewBrief,
    },
  ];

  for (const role of roles) {
    const rendered = await RenderSddPrompt(role.input);
    for (const token of role.placeholders) {
      assert.doesNotMatch(
        rendered.prompt.text,
        new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    }
    assertSerializedContainsPath(JSON.stringify(rendered.metadata), role.requiredPath);
    assert.doesNotMatch(JSON.stringify(rendered.metadata), /BRIEF-BODY-SENTINEL|REVIEW-BRIEF-SENTINEL/);
    assert.equal("text" in rendered.metadata, false);
    assert.equal("promptText" in rendered.metadata, false);
  }
});
