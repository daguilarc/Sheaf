import assert from "node:assert/strict";
import test from "node:test";

import {
  CreateSddManager,
  type SddManagerDeps,
  type SddRunManagerPort,
  type XagentSddStartResult,
} from "../src/service/sdd_manager.js";
import {
  type InsertSddAgentInput,
  type SddAgentRecord,
  type SddAgentStore,
} from "../src/service/sdd_store.js";
import type {
  FormatFixFollowupInput,
  RenderedSddPrompt,
  RenderSddPromptInput,
} from "../src/service/sdd_prompt.js";
import { SddPromptError } from "../src/service/sdd_prompt.js";
import type {
  CreateRunOptions,
  ListRunsResult,
  MessageRunResult,
} from "../src/service/run_manager.js";
import type {
  XagentMessageInput,
  XagentSddStartInput,
} from "../src/service/tool_schemas.js";
import {
  ImplementerStartSchema,
  ToolValidationError,
  structuredErrorFromUnknown,
} from "../src/service/tool_schemas.js";

const x_AgentId = "xrun_20260727000000000_abcdef12";
const x_PlanPath = "/tmp/plans/2026-07-26-xagent-sdd-mode.md";
const x_BriefPath = "/tmp/sdd/task-3-brief.md";
const x_ReportPath = "/tmp/sdd/task-3-report.md";
const x_PromptPath = "/tmp/sdd/dispatch-implementer-task-3.md";
const x_Cwd = "/tmp/worktree";
const x_CanonicalCwd = "/private/tmp/worktree";
const x_ResolvedBriefPath = "/private/tmp/sdd/task-3-brief.md";
const x_ResolvedReportPath = "/private/tmp/sdd/task-3-report.md";
const x_BriefText = "Implement SDD start and follow-up.\n";
const x_PromptText = "Rendered implementer prompt pointing at the brief.\n";
const x_FindingsPath = "/tmp/sdd/task-3-findings.md";
const x_FindingsText = "Important: prepared-before-submit must hold.\n";

type CallRecord = {
  readonly name: string;
  readonly args?: unknown;
};

function CreateOrderRecorder(): {
  readonly calls: CallRecord[];
  Record(name: string, args?: unknown): void;
  Names(): string[];
}
{
  const calls: CallRecord[] = [];
  return {
    calls,
    Record(name: string, args?: unknown): void
    {
      calls.push({ name, args });
    },
    Names(): string[]
    {
      return calls.map((call) => call.name);
    },
  };
}

function CreateFakeAgentStore(
  recorder: ReturnType<typeof CreateOrderRecorder>,
  record: SddAgentRecord | undefined,
): SddAgentStore & {
  readonly inserted: InsertSddAgentInput[];
}
{
  const inserted: InsertSddAgentInput[] = [];
  return {
    inserted,
    Insert(input: InsertSddAgentInput): void
    {
      recorder.Record("store.Insert", input);
      inserted.push(input);
    },
    Get(agentId: string): SddAgentRecord | undefined
    {
      if (record === undefined || record.agent_id !== agentId)
      {
        return undefined;
      }
      return record;
    },
    ListAll(): readonly SddAgentRecord[]
    {
      return record === undefined ? [] : [record];
    },
    IsSddAgent(agentId: string): boolean
    {
      return record !== undefined && record.agent_id === agentId;
    },
    Close(): void
    {
      recorder.Record("Close");
    },
  };
}

function FakeRendered(): RenderedSddPrompt
{
  return {
    prompt: {
      path: x_PromptPath,
      text: x_PromptText,
    },
    metadata: {
      promptPath: x_PromptPath,
      rendererPath: "/service/checkout/projects/agents/utils/dispatch-prompt",
    },
  };
}

function CreateFakeRunManager(
  recorder: ReturnType<typeof CreateOrderRecorder>,
  options?: { live?: boolean; failStart?: boolean; hangSubmit?: boolean },
): SddRunManagerPort & {
  createError?: Error;
  startError?: Error;
  submitError?: Error;
  messageError?: Error;
  created: CreateRunOptions[];
  submitted: Array<{ runId: string; text: string }>;
  closed: string[];
  sequence: number;
  phase: string;
  submitSettled: boolean;
  messageCalls: XagentMessageInput[];
  messageRun(input: XagentMessageInput): Promise<MessageRunResult>;
}
{
  const created: CreateRunOptions[] = [];
  const submitted: Array<{ runId: string; text: string }> = [];
  const closed: string[] = [];
  const messageCalls: XagentMessageInput[] = [];
  const runs = new Set<string>();
  const live = options?.live !== false;
  if (live)
  {
    // Followup tests skip create(); seed the known agent so has/inspect still
    // check the run id rather than ignoring it.
    //
    runs.add(x_AgentId);
  }

  return {
    created,
    submitted,
    closed,
    messageCalls,
    sequence: 7,
    phase: "ready",
    submitSettled: true,
    allocateRunId(): string
    {
      recorder.Record("allocateRunId");
      return x_AgentId;
    },
    async create(createOptions: CreateRunOptions): Promise<{ readonly runId: string }>
    {
      recorder.Record("runManager.create", createOptions);
      if (this.createError !== undefined)
      {
        throw this.createError;
      }
      created.push(createOptions);
      const runId = createOptions.runId ?? x_AgentId;
      runs.add(runId);
      return { runId };
    },
    async start(runId: string): Promise<void>
    {
      recorder.Record("runManager.start", runId);
      if (options?.failStart === true)
      {
        throw new Error("provider start failed");
      }
      if (this.startError !== undefined)
      {
        throw this.startError;
      }
      this.phase = "ready";
    },
    async submit(runId: string, text: string): Promise<void>
    {
      recorder.Record("runManager.submit", { runId, text });
      if (!runs.has(runId))
      {
        throw new Error(`Cannot submit unknown run: ${runId}`);
      }
      if (this.phase !== "ready")
      {
        throw new Error(`Cannot submit while supervision phase is ${this.phase}.`);
      }
      if (this.submitError !== undefined)
      {
        throw this.submitError;
      }
      submitted.push({ runId, text });
      // Advance the cursor the way a real turn.running event would, so tests
      // can tell a pre-submit snapshot apart from a post-acceptance one.
      //
      this.sequence += 1;
      this.phase = "running";
      if (options?.hangSubmit === true)
      {
        this.submitSettled = false;
        await new Promise<void>(() => {});
      }
    },
    inspect(runId: string)
    {
      recorder.Record("inspect", runId);
      if (!live || !runs.has(runId))
      {
        return undefined;
      }
      return {
        run_id: runId,
        phase: this.phase,
        sequence: this.sequence,
      };
    },
    async close(runId: string): Promise<void>
    {
      recorder.Record("runManager.close", runId);
      closed.push(runId);
      runs.delete(runId);
    },
    has(runId: string): boolean
    {
      return live && runs.has(runId);
    },
    async messageRun(input: XagentMessageInput): Promise<MessageRunResult>
    {
      recorder.Record("messageRun", input);
      if (this.messageError !== undefined)
      {
        throw this.messageError;
      }
      messageCalls.push(input);
      return {
        run_id: input.run_id,
        phase: "running",
        sequence: this.sequence,
      };
    },
    async listOwnedRuns(): Promise<ListRunsResult>
    {
      recorder.Record("listOwnedRuns");
      return {
        runs: [...runs].map((runId) => ({
          run_id: runId,
          harness: "cursor",
          phase: "ready",
          sequence: 4,
          exit_status: "running",
          live: true,
          supervised: true,
          created_at: "2026-07-27T00:00:00.000Z",
          updated_at: "2026-07-27T00:00:00.000Z",
        })),
      };
    },
  };
}

function CreateDeps(
  recorder?: ReturnType<typeof CreateOrderRecorder>,
): Omit<SddManagerDeps, "store" | "runManager">
{
  return {
    repoRoot: "/tmp/service-repo",
    async canonicalizeCwd(cwd: string): Promise<string>
    {
      recorder?.Record("canonicalizeCwd", cwd);
      if (!cwd.startsWith("/"))
      {
        throw new ToolValidationError({
          error: "invalid_working_directory",
          message: "working directory must be an absolute path",
          details: { cwd },
        });
      }
      return x_CanonicalCwd;
    },
    async resolveArtifactPath(filePath: string): Promise<string>
    {
      recorder?.Record("resolveArtifactPath", filePath);
      if (filePath.startsWith("/tmp/"))
      {
        return `/private${filePath}`;
      }
      return filePath;
    },
    async readFile(filePath: string): Promise<string>
    {
      recorder?.Record("readFile", filePath);
      return x_BriefText;
    },
    async renderPrompt(input: RenderSddPromptInput): Promise<RenderedSddPrompt>
    {
      recorder?.Record("renderPrompt", input);
      if (input.role === "re-review")
      {
        return {
          prompt: {
            path: x_PromptPath,
            text: "Rendered re-review prompt.\n",
          },
          metadata: {
            promptPath: x_PromptPath,
            rendererPath: "/service/checkout/projects/agents/utils/dispatch-prompt",
          },
        };
      }
      return FakeRendered();
    },
    formatFix(_input: FormatFixFollowupInput): string
    {
      return "FIX TEXT";
    },
  };
}

function ImplementerStartInput(overrides: Partial<XagentSddStartInput> = {}): XagentSddStartInput
{
  return {
    role: "implementer",
    cwd: x_Cwd,
    plan: x_PlanPath,
    model: "grok-4.5",
    harness: "cursor",
    effort: "high",
    task: 3,
    name: "sdd-start-followup",
    brief: x_BriefPath,
    report_out: x_ReportPath,
    ...overrides,
  } as XagentSddStartInput;
}

function CreateManagerHarness(options?: {
  render?: (input: RenderSddPromptInput) => Promise<RenderedSddPrompt>;
  readFile?: (filePath: string) => Promise<string>;
}): {
  readonly manager: ReturnType<typeof CreateSddManager>;
  readonly recorder: ReturnType<typeof CreateOrderRecorder>;
  readonly store: ReturnType<typeof CreateFakeAgentStore>;
  readonly runManager: ReturnType<typeof CreateFakeRunManager>;
  readonly rendered: RenderSddPromptInput[];
  readonly readPaths: string[];
}
{
  const recorder = CreateOrderRecorder();
  const store = CreateFakeAgentStore(recorder, undefined);
  const runManager = CreateFakeRunManager(recorder);
  const rendered: RenderSddPromptInput[] = [];
  const readPaths: string[] = [];
  const deps: SddManagerDeps = {
    store,
    runManager,
    ...CreateDeps(recorder),
    async readFile(filePath: string): Promise<string>
    {
      recorder.Record("readFile", filePath);
      readPaths.push(filePath);
      if (options?.readFile !== undefined)
      {
        return options.readFile(filePath);
      }
      return x_BriefText;
    },
    async renderPrompt(input: RenderSddPromptInput): Promise<RenderedSddPrompt>
    {
      recorder.Record("renderPrompt", input);
      rendered.push(input);
      if (options?.render !== undefined)
      {
        return options.render(input);
      }
      return FakeRendered();
    },
  };
  return {
    manager: CreateSddManager(deps),
    recorder,
    store,
    runManager,
    rendered,
    readPaths,
  };
}

test("start canonicalizes cwd, inserts the row before creating the run, then renders and submits", async () =>
{
  const recorder = CreateOrderRecorder();
  const store = CreateFakeAgentStore(recorder, undefined);
  const runManager = CreateFakeRunManager(recorder);
  const manager = CreateSddManager({ ...CreateDeps(recorder), store, runManager });

  const result = await manager.Start({
    role: "implementer", cwd: x_Cwd, plan: x_PlanPath,
    model: "grok-4.5", harness: "cursor", effort: "high",
    task: 3, name: "Ledger v2 store", brief: x_BriefPath, report_out: x_ReportPath,
  });

  // waitForTurnRunning polls inspect after submit; require the create/start
  // order and a pre-submit inspect without demanding an exact call list.
  //
  const names = recorder.Names();
  const required = [
    "canonicalizeCwd",
    "readFile",
    "renderPrompt",
    "allocateRunId",
    "store.Insert",
    "runManager.create",
    "runManager.start",
    "inspect",
    "runManager.submit",
  ];
  let searchFrom = 0;
  for (const name of required)
  {
    const idx = names.indexOf(name, searchFrom);
    assert.ok(idx >= 0, `missing ordered call: ${name}`);
    searchFrom = idx + 1;
  }
  assert.deepEqual(store.inserted[0], {
    agentId: result.run_id,
    planPath: x_PlanPath,
    task: 3,
    role: "implementer",
    briefPath: x_BriefPath,
    briefText: x_BriefText,
    cwd: x_CanonicalCwd,
  });
  assert.deepEqual(Object.keys(result).sort(), [
    "brief_path", "prompt_path", "renderer_path", "report_out_path", "run_id", "sequence",
  ]);
});

test("start results use run_id and role-specific report_out_path / renderer keys", async () =>
{
  async function StartRole(
    input: XagentSddStartInput,
  ): Promise<XagentSddStartResult>
  {
    const recorder = CreateOrderRecorder();
    const manager = CreateSddManager({
      ...CreateDeps(recorder),
      store: CreateFakeAgentStore(recorder, undefined),
      runManager: CreateFakeRunManager(recorder),
    });
    return manager.Start(input);
  }

  const implementer = await StartRole({
    role: "implementer", cwd: x_Cwd, plan: x_PlanPath,
    model: "grok-4.5", harness: "cursor", effort: "high",
    task: 3, name: "x", brief: x_BriefPath, report_out: x_ReportPath,
  });
  assert.equal(implementer.run_id, x_AgentId);
  assert.equal(implementer.brief_path, x_ResolvedBriefPath);
  assert.equal(implementer.report_out_path, x_ResolvedReportPath);
  assert.ok("prompt_path" in implementer);
  assert.ok("renderer_path" in implementer);
  assert.ok(!("agent_id" in implementer));

  const fixer = await StartRole({
    role: "fixer", cwd: x_Cwd, plan: x_PlanPath,
    model: "grok-4.5", harness: "cursor", effort: "high",
    task: 3, brief: x_BriefPath, findings: "/tmp/f.md",
    findings_text: "one finding", tests: ["npm test"], report_out: x_ReportPath,
    round: 1,
  });
  assert.equal(fixer.run_id, x_AgentId);
  assert.equal(fixer.brief_path, x_ResolvedBriefPath);
  assert.equal(fixer.report_out_path, x_ResolvedReportPath);
  assert.ok(!("prompt_path" in fixer));
  assert.ok(!("renderer_path" in fixer));
  assert.ok(!("agent_id" in fixer));

  const reviewer = await StartRole({
    role: "reviewer", cwd: x_Cwd, plan: x_PlanPath,
    model: "opus", harness: "claude_code", effort: "high",
    task: 3, brief: x_BriefPath, implementer_report: x_ReportPath,
    base: "main", head: "HEAD",
  });
  assert.equal(reviewer.run_id, x_AgentId);
  assert.equal(reviewer.brief_path, x_ResolvedBriefPath);
  assert.ok(!("report_out_path" in reviewer));
  assert.ok("prompt_path" in reviewer);
  assert.ok(!("agent_id" in reviewer));

  const reReviewer = await StartRole({
    role: "re-reviewer", cwd: x_Cwd, plan: x_PlanPath,
    model: "opus", harness: "claude_code", effort: "high",
    task: 3, brief: x_BriefPath, findings: "/tmp/f.md",
    fixer_report: x_ReportPath, base: "main", head: "HEAD",
    round: 1,
  });
  assert.equal(reReviewer.run_id, x_AgentId);
  assert.equal(reReviewer.brief_path, x_ResolvedBriefPath);
  assert.ok(!("report_out_path" in reReviewer));
  assert.ok("prompt_path" in reReviewer);
  assert.ok(!("agent_id" in reReviewer));
});

test("an invalid cwd creates no ledger row and no run", async () =>
{
  const recorder = CreateOrderRecorder();
  const store = CreateFakeAgentStore(recorder, undefined);
  const runManager = CreateFakeRunManager(recorder);
  const manager = CreateSddManager({
    ...CreateDeps(recorder), store, runManager,
    canonicalizeCwd: async () =>
    {
      throw new ToolValidationError({
        error: "invalid_working_directory", message: "not a directory",
      });
    },
  });
  await assert.rejects(() => manager.Start({
    role: "implementer", cwd: "relative/path", plan: x_PlanPath,
    model: "grok-4.5", harness: "cursor", effort: "high",
    task: 3, name: "x", brief: x_BriefPath, report_out: x_ReportPath,
  }));
  assert.equal(store.inserted.length, 0);
  assert.equal(runManager.created.length, 0);
});

test("a failure after the insert leaves the row untouched as a tombstone", async () =>
{
  const recorder = CreateOrderRecorder();
  const store = CreateFakeAgentStore(recorder, undefined);
  const runManager = CreateFakeRunManager(recorder, { failStart: true });
  const manager = CreateSddManager({ ...CreateDeps(recorder), store, runManager });
  await assert.rejects(() => manager.Start({
    role: "implementer", cwd: x_Cwd, plan: x_PlanPath,
    model: "grok-4.5", harness: "cursor", effort: "high",
    task: 3, name: "x", brief: x_BriefPath, report_out: x_ReportPath,
  }));
  assert.equal(store.inserted.length, 1);
  assert.deepEqual(runManager.closed, [x_AgentId]);
});

test("a create failure after the insert closes no run and leaves the tombstone", async () =>
{
  const recorder = CreateOrderRecorder();
  const store = CreateFakeAgentStore(recorder, undefined);
  const runManager = CreateFakeRunManager(recorder);
  runManager.createError = new Error("provider create failed");
  const manager = CreateSddManager({ ...CreateDeps(recorder), store, runManager });
  await assert.rejects(() => manager.Start({
    role: "implementer", cwd: x_Cwd, plan: x_PlanPath,
    model: "grok-4.5", harness: "cursor", effort: "high",
    task: 3, name: "x", brief: x_BriefPath, report_out: x_ReportPath,
  }));
  assert.equal(store.inserted.length, 1);
  assert.equal(runManager.closed.length, 0);
});

test("reviewer template selection follows task presence", async () =>
{
  const rendered: RenderSddPromptInput[] = [];
  const recorder = CreateOrderRecorder();
  const manager = CreateSddManager({
    ...CreateDeps(recorder),
    store: CreateFakeAgentStore(recorder, undefined),
    runManager: CreateFakeRunManager(recorder),
    renderPrompt: async (input) =>
    {
      rendered.push(input);
      return FakeRendered();
    },
  });

  await manager.Start({
    role: "reviewer", cwd: x_Cwd, plan: x_PlanPath,
    model: "opus", harness: "claude_code", effort: "high",
    task: 3, brief: x_BriefPath, implementer_report: x_ReportPath, base: "main", head: "HEAD",
  });
  assert.equal(rendered[0]!.role, "task-reviewer");

  await manager.Start({
    role: "reviewer", cwd: x_Cwd, plan: x_PlanPath,
    model: "opus", harness: "claude_code", effort: "high",
    brief: x_BriefPath, base: "main", head: "HEAD",
    description: "Branch adds the v2 ledger.",
  });
  assert.equal(rendered[1]!.role, "code-reviewer");
});

test("a fixer renders the fix template and never an assignment name", async () =>
{
  const recorder = CreateOrderRecorder();
  const store = CreateFakeAgentStore(recorder, undefined);
  const runManager = CreateFakeRunManager(recorder);
  const manager = CreateSddManager({ ...CreateDeps(recorder), store, runManager });
  const result = await manager.Start({
    role: "fixer", cwd: x_Cwd, plan: x_PlanPath,
    model: "grok-4.5", harness: "cursor", effort: "high",
    task: 3, brief: x_BriefPath, findings: "/tmp/f.md",
    findings_text: "one finding", tests: ["npm test"], report_out: x_ReportPath, round: 2,
  });
  const submitted = runManager.submitted[0]!.text;
  assert.match(submitted, /^You are a fixer for task 3 of plan /);
  assert.match(submitted, /Fix round 2\./);
  assert.ok(!submitted.includes("Fix Round 2\""));
  assert.equal(store.inserted[0]!.role, "fixer");
  assert.ok(!("prompt_path" in result));
  assert.ok(!("renderer_path" in result));
});

test("a re-reviewer reuses the re-review renderer role", async () =>
{
  const rendered: RenderSddPromptInput[] = [];
  const recorder = CreateOrderRecorder();
  const manager = CreateSddManager({
    ...CreateDeps(recorder),
    store: CreateFakeAgentStore(recorder, undefined),
    runManager: CreateFakeRunManager(recorder),
    renderPrompt: async (input) =>
    {
      rendered.push(input);
      return FakeRendered();
    },
  });
  await manager.Start({
    role: "re-reviewer", cwd: x_Cwd, plan: x_PlanPath,
    model: "opus", harness: "claude_code", effort: "high",
    task: 3, brief: x_BriefPath, findings: "/tmp/f.md", fixer_report: x_ReportPath,
    base: "main", head: "HEAD", round: 2,
  });
  assert.equal(rendered[0]!.role, "re-review");
  assert.equal((rendered[0] as { round: number }).round, 2);
});

test("Start surfaces SddPromptError structured codes through structuredErrorFromUnknown", async () =>
{
  const recorder = CreateOrderRecorder();
  const store = CreateFakeAgentStore(recorder, undefined);
  const runManager = CreateFakeRunManager(recorder);
  const manager = CreateSddManager({
    ...CreateDeps(recorder),
    store,
    runManager,
    renderPrompt: async () =>
    {
      throw new SddPromptError({
        error: "sdd_renderer_missing",
        message: "Trusted dispatch-prompt renderer is unavailable.",
      });
    },
  });

  await assert.rejects(
    () => manager.Start(ImplementerStartInput()),
    (error: unknown) =>
    {
      const structured = structuredErrorFromUnknown(error);
      assert.equal(structured.error, "sdd_renderer_missing");
      assert.equal(
        structured.message,
        "Trusted dispatch-prompt renderer is unavailable.",
      );
      return true;
    },
  );

  assert.equal(store.inserted.length, 0);
  assert.equal(runManager.created.length, 0);
});

test("a fix followup renders and submits with zero ledger writes", async () =>
{
  const recorder = CreateOrderRecorder();
  const store = CreateFakeAgentStore(recorder, {
    agent_id: x_AgentId,
    plan_path: x_PlanPath,
    task: 3,
    role: "implementer",
    brief_path: x_BriefPath,
    brief_text: x_BriefText,
    cwd: x_CanonicalCwd,
    dispatched_at: "2026-07-28T10:00:00.000Z",
  });
  const runManager = CreateFakeRunManager(recorder);
  const formatted: FormatFixFollowupInput[] = [];
  const manager = CreateSddManager({
    ...CreateDeps(), store, runManager,
    formatFix: (input) =>
    {
      formatted.push(input);
      return "FIX TEXT";
    },
  });

  const result = await manager.Followup({
    kind: "fix",
    run_id: x_AgentId,
    round: 2,
    findings: "/tmp/sdd/task-3-findings.md",
    findings_text: "one finding",
    tests: ["npm test"],
    report_out: "/tmp/sdd/task-3-report.md",
  });

  assert.deepEqual(Object.keys(result).sort(), ["run_id", "sequence"]);
  assert.equal(result.run_id, x_AgentId);
  assert.equal(result.sequence, 7);
  assert.equal(formatted[0]!.briefPath, x_BriefPath);
  assert.equal(formatted[0]!.reportPath, "/tmp/sdd/task-3-report.md");
  assert.equal(formatted[0]!.round, 2);
  assert.equal(store.inserted.length, 0);
  assert.ok(recorder.Names().every((name) => !name.startsWith("store.Insert")));
  assert.equal(runManager.submitted.length, 1);
  assert.equal(runManager.submitted[0]!.runId, x_AgentId);
  assert.equal(runManager.submitted[0]!.text, "FIX TEXT");
});

test("an unknown agent id is rejected before anything is submitted", async () =>
{
  const recorder = CreateOrderRecorder();
  const runManager = CreateFakeRunManager(recorder);
  const manager = CreateSddManager({
    ...CreateDeps(), store: CreateFakeAgentStore(recorder, undefined), runManager,
  });
  await assert.rejects(
    () => manager.Followup({
      kind: "fix", run_id: x_AgentId, round: 1,
      findings: "/tmp/f.md", findings_text: "x", tests: ["npm test"], report_out: "/tmp/r.md",
    }),
    (error: unknown) =>
    {
      assert.equal(structuredErrorFromUnknown(error).error, "unknown_sdd_agent");
      return true;
    },
  );
  assert.equal(runManager.submitted.length, 0);
});

test("a dead agent gets sdd_agent_not_live naming the fresh-agent recovery", async () =>
{
  const recorder = CreateOrderRecorder();
  const store = CreateFakeAgentStore(recorder, {
    agent_id: x_AgentId, plan_path: x_PlanPath, task: 3, role: "implementer",
    brief_path: x_BriefPath, brief_text: x_BriefText, cwd: x_CanonicalCwd,
    dispatched_at: "2026-07-28T10:00:00.000Z",
  });
  const runManager = CreateFakeRunManager(recorder, { live: false });
  const manager = CreateSddManager({ ...CreateDeps(), store, runManager });
  await assert.rejects(
    () => manager.Followup({
      kind: "fix", run_id: x_AgentId, round: 1,
      findings: "/tmp/f.md", findings_text: "x", tests: ["npm test"], report_out: "/tmp/r.md",
    }),
    (error: unknown) =>
    {
      const structured = structuredErrorFromUnknown(error);
      assert.equal(structured.error, "sdd_agent_not_live");
      assert.deepEqual(structured.details, {
        run_id: x_AgentId,
        role: "implementer",
        plan: x_PlanPath,
        task: 3,
        recovery: { tool: "xagent_sdd_start", role: "fixer" },
      });
      return true;
    },
  );
  assert.equal(runManager.submitted.length, 0);
});

test("a tracked terminal agent gets sdd_agent_not_live before submit", async () =>
{
  for (const phase of ["completed", "failed", "cancelled", "abandoned"] as const)
  {
    const recorder = CreateOrderRecorder();
    const store = CreateFakeAgentStore(recorder, {
      agent_id: x_AgentId, plan_path: x_PlanPath, task: 3, role: "implementer",
      brief_path: x_BriefPath, brief_text: x_BriefText, cwd: x_CanonicalCwd,
      dispatched_at: "2026-07-28T10:00:00.000Z",
    });
    const runManager = CreateFakeRunManager(recorder);
    runManager.phase = phase;
    const manager = CreateSddManager({ ...CreateDeps(), store, runManager });
    await assert.rejects(
      () => manager.Followup({
        kind: "fix", run_id: x_AgentId, round: 1,
        findings: "/tmp/f.md", findings_text: "x", tests: ["npm test"], report_out: "/tmp/r.md",
      }),
      (error: unknown) =>
      {
        const structured = structuredErrorFromUnknown(error);
        assert.equal(structured.error, "sdd_agent_not_live");
        assert.deepEqual(structured.details, {
          run_id: x_AgentId,
          role: "implementer",
          plan: x_PlanPath,
          task: 3,
          recovery: { tool: "xagent_sdd_start", role: "fixer" },
        });
        return true;
      },
    );
    assert.equal(runManager.submitted.length, 0, `phase ${phase} must not submit`);
  }
});

test("a busy agent is rejected with sdd_agent_busy before submit", async () =>
{
  for (const phase of ["starting", "running"] as const)
  {
    const recorder = CreateOrderRecorder();
    const store = CreateFakeAgentStore(recorder, {
      agent_id: x_AgentId, plan_path: x_PlanPath, task: 3, role: "implementer",
      brief_path: x_BriefPath, brief_text: x_BriefText, cwd: x_CanonicalCwd,
      dispatched_at: "2026-07-28T10:00:00.000Z",
    });
    const runManager = CreateFakeRunManager(recorder);
    runManager.phase = phase;
    const manager = CreateSddManager({ ...CreateDeps(), store, runManager });
    await assert.rejects(
      () => manager.Followup({
        kind: "fix", run_id: x_AgentId, round: 1,
        findings: "/tmp/f.md", findings_text: "x", tests: ["npm test"], report_out: "/tmp/r.md",
      }),
      (error: unknown) =>
      {
        const structured = structuredErrorFromUnknown(error);
        assert.equal(structured.error, "sdd_agent_busy");
        assert.deepEqual(structured.details, {
          run_id: x_AgentId,
          phase,
          recovery: { tool: "xagent_await" },
        });
        return true;
      },
    );
    assert.equal(runManager.submitted.length, 0, `phase ${phase} must not submit`);
  }
});

test("kind must match the immutable start role", async () =>
{
  for (const [role, kind, allowed] of [
    ["implementer", "fix", true], ["fixer", "fix", true],
    ["reviewer", "re-review", true], ["re-reviewer", "re-review", true],
    ["implementer", "re-review", false], ["reviewer", "fix", false],
    ["fixer", "re-review", false], ["re-reviewer", "fix", false],
  ] as const)
  {
    const recorder = CreateOrderRecorder();
    const store = CreateFakeAgentStore(recorder, {
      agent_id: x_AgentId, plan_path: x_PlanPath, task: 3, role,
      brief_path: x_BriefPath, brief_text: x_BriefText, cwd: x_CanonicalCwd,
      dispatched_at: "2026-07-28T10:00:00.000Z",
    });
    const manager = CreateSddManager({
      ...CreateDeps(), store, runManager: CreateFakeRunManager(recorder),
    });
    const input = kind === "fix"
      ? {
          kind: "fix" as const,
          run_id: x_AgentId,
          round: 1,
          findings: "/tmp/f.md",
          findings_text: "x",
          tests: ["npm test"],
          report_out: "/tmp/r.md",
        }
      : {
          kind: "re-review" as const,
          run_id: x_AgentId,
          round: 1,
          findings: "/tmp/f.md",
          fixer_report: "/tmp/r.md",
          base: "main",
          head: "HEAD",
        };
    if (allowed)
    {
      await manager.Followup(input);
    }
    else
    {
      await assert.rejects(() => manager.Followup(input), (error: unknown) =>
      {
        assert.equal(structuredErrorFromUnknown(error).error, "sdd_followup_role_mismatch");
        return true;
      });
    }
  }
});

test("re-review rejects a task-less reviewer before rendering", async () =>
{
  const recorder = CreateOrderRecorder();
  const store = CreateFakeAgentStore(recorder, {
    agent_id: x_AgentId, plan_path: x_PlanPath, task: null, role: "reviewer",
    brief_path: x_BriefPath, brief_text: x_BriefText, cwd: x_CanonicalCwd,
    dispatched_at: "2026-07-28T10:00:00.000Z",
  });
  const runManager = CreateFakeRunManager(recorder);
  const rendered: RenderSddPromptInput[] = [];
  const manager = CreateSddManager({
    ...CreateDeps(),
    store,
    runManager,
    async renderPrompt(input: RenderSddPromptInput): Promise<RenderedSddPrompt>
    {
      rendered.push(input);
      return {
        prompt: { path: x_PromptPath, text: "should not render" },
        metadata: {
          promptPath: x_PromptPath,
          rendererPath: "/service/checkout/projects/agents/utils/dispatch-prompt",
        },
      };
    },
  });
  await assert.rejects(
    () => manager.Followup({
      kind: "re-review",
      run_id: x_AgentId,
      round: 1,
      findings: "/tmp/f.md",
      fixer_report: "/tmp/r.md",
      base: "main",
      head: "HEAD",
    }),
    (error: unknown) =>
    {
      const structured = structuredErrorFromUnknown(error);
      assert.equal(structured.error, "sdd_followup_task_required");
      assert.deepEqual(structured.details, {
        run_id: x_AgentId,
        role: "reviewer",
        kind: "re-review",
      });
      return true;
    },
  );
  assert.equal(rendered.length, 0);
  assert.equal(runManager.submitted.length, 0);
});

test("double-calling a followup leaves the ledger untouched and rejects the busy second call", async () =>
{
  const recorder = CreateOrderRecorder();
  const store = CreateFakeAgentStore(recorder, {
    agent_id: x_AgentId, plan_path: x_PlanPath, task: 3, role: "reviewer",
    brief_path: x_BriefPath, brief_text: x_BriefText, cwd: x_CanonicalCwd,
    dispatched_at: "2026-07-28T10:00:00.000Z",
  });
  const runManager = CreateFakeRunManager(recorder);
  const manager = CreateSddManager({
    ...CreateDeps(), store, runManager,
  });
  const input = {
    kind: "re-review" as const, run_id: x_AgentId, round: 1,
    findings: "/tmp/f.md", fixer_report: "/tmp/r.md", base: "main", head: "HEAD",
  };
  await manager.Followup(input);
  assert.equal(store.inserted.length, 0);
  assert.equal(runManager.submitted.length, 1);
  assert.equal(runManager.phase, "running");
  await assert.rejects(
    () => manager.Followup(input),
    (error: unknown) =>
    {
      assert.equal(structuredErrorFromUnknown(error).error, "sdd_agent_busy");
      return true;
    },
  );
  assert.equal(store.inserted.length, 0);
  assert.equal(runManager.submitted.length, 1);
});

test("Followup fix rejects when findings file is missing or empty", async () =>
{
  const recorder = CreateOrderRecorder();
  const store = CreateFakeAgentStore(recorder, {
    agent_id: x_AgentId,
    plan_path: x_PlanPath,
    task: 3,
    role: "implementer",
    brief_path: x_BriefPath,
    brief_text: x_BriefText,
    cwd: x_CanonicalCwd,
    dispatched_at: "2026-07-28T10:00:00.000Z",
  });

  const missingRunManager = CreateFakeRunManager(recorder);
  const missingManager = CreateSddManager({
    ...CreateDeps(),
    store,
    runManager: missingRunManager,
    async readFile(filePath: string): Promise<string>
    {
      if (filePath === x_FindingsPath)
      {
        throw new Error("ENOENT");
      }
      return x_BriefText;
    },
  });
  await assert.rejects(
    () => missingManager.Followup({
      kind: "fix",
      run_id: x_AgentId,
      round: 1,
      findings: x_FindingsPath,
      findings_text: x_FindingsText,
      tests: ["dist/tests/sdd_manager.test.js"],
      report_out: x_ReportPath,
    }),
    (error: unknown) =>
    {
      assert.ok(error instanceof ToolValidationError);
      assert.equal(error.structured.error, "sdd_artifact_unreadable");
      return true;
    },
  );
  assert.equal(missingRunManager.submitted.length, 0);

  const emptyRunManager = CreateFakeRunManager(CreateOrderRecorder());
  const emptyManager = CreateSddManager({
    ...CreateDeps(),
    store,
    runManager: emptyRunManager,
    async readFile(filePath: string): Promise<string>
    {
      if (filePath === x_FindingsPath)
      {
        return "  \n";
      }
      return x_BriefText;
    },
  });
  await assert.rejects(
    () => emptyManager.Followup({
      kind: "fix",
      run_id: x_AgentId,
      round: 1,
      findings: x_FindingsPath,
      findings_text: x_FindingsText,
      tests: ["dist/tests/sdd_manager.test.js"],
      report_out: x_ReportPath,
    }),
    (error: unknown) =>
    {
      assert.ok(error instanceof ToolValidationError);
      assert.equal(error.structured.error, "sdd_artifact_empty");
      return true;
    },
  );
  assert.equal(emptyRunManager.submitted.length, 0);
});

test("a controller note is appended to a fix follow-up", async () =>
{
  const note = "Ignore the stray build output in projects/synth; it is not yours.";
  const recorder = CreateOrderRecorder();
  const store = CreateFakeAgentStore(recorder, {
    agent_id: x_AgentId,
    plan_path: x_PlanPath,
    task: 3,
    role: "implementer",
    brief_path: x_BriefPath,
    brief_text: x_BriefText,
    cwd: x_CanonicalCwd,
    dispatched_at: "2026-07-28T10:00:00.000Z",
  });
  const runManager = CreateFakeRunManager(recorder);
  const manager = CreateSddManager({
    ...CreateDeps(),
    store,
    runManager,
    formatFix: () => `Fix body.\n${x_FindingsText}`,
  });

  await manager.Followup({
    kind: "fix",
    run_id: x_AgentId,
    round: 1,
    findings: x_FindingsPath,
    findings_text: x_FindingsText,
    tests: ["dist/tests/sdd_manager.test.js"],
    report_out: x_ReportPath,
    note,
  });

  const submitted = runManager.submitted.at(-1)?.text ?? "";
  assert.ok(submitted.includes(x_FindingsText), "findings must survive");
  assert.ok(submitted.includes("## Controller Note"));
  assert.ok(submitted.includes(note));
});

test("Start returns once the turn is running without waiting for submit to finish", async () =>
{
  const recorder = CreateOrderRecorder();
  const store = CreateFakeAgentStore(recorder, undefined);
  const runManager = CreateFakeRunManager(recorder, { hangSubmit: true });
  const manager = CreateSddManager({ ...CreateDeps(recorder), store, runManager });

  const started = await Promise.race([
    manager.Start(ImplementerStartInput()).then((result) => (
      { kind: "result" as const, result }
    )),
    new Promise<{ kind: "timeout" }>((resolve) =>
    {
      setTimeout(() => resolve({ kind: "timeout" }), 200);
    }),
  ]);

  assert.equal(started.kind, "result");
  if (started.kind !== "result")
  {
    return;
  }
  assert.equal(started.result.run_id, x_AgentId);
  // Pre-submit ready cursor, not the advanced running cursor.
  //
  assert.equal(started.result.sequence, 7);
  assert.equal(runManager.phase, "running");
  assert.equal(runManager.sequence, 8);
  assert.equal(runManager.submitted.length, 1);
  assert.equal(runManager.submitSettled, false);
});

test("Followup returns once the turn is running without waiting for submit to finish", async () =>
{
  const recorder = CreateOrderRecorder();
  const store = CreateFakeAgentStore(recorder, {
    agent_id: x_AgentId,
    plan_path: x_PlanPath,
    task: 3,
    role: "implementer",
    brief_path: x_BriefPath,
    brief_text: x_BriefText,
    cwd: x_CanonicalCwd,
    dispatched_at: "2026-07-28T10:00:00.000Z",
  });
  const runManager = CreateFakeRunManager(recorder, { hangSubmit: true });
  const manager = CreateSddManager({
    ...CreateDeps(),
    store,
    runManager,
    formatFix: () => "FIX TEXT",
  });

  const followed = await Promise.race([
    manager.Followup({
      kind: "fix",
      run_id: x_AgentId,
      round: 2,
      findings: "/tmp/sdd/task-3-findings.md",
      findings_text: "one finding",
      tests: ["npm test"],
      report_out: "/tmp/sdd/task-3-report.md",
    }).then((result) => ({ kind: "result" as const, result })),
    new Promise<{ kind: "timeout" }>((resolve) =>
    {
      setTimeout(() => resolve({ kind: "timeout" }), 200);
    }),
  ]);

  assert.equal(followed.kind, "result");
  if (followed.kind !== "result")
  {
    return;
  }
  assert.equal(followed.result.run_id, x_AgentId);
  assert.equal(followed.result.sequence, 7);
  assert.equal(runManager.phase, "running");
  assert.equal(runManager.submitSettled, false);
});

test("Start rejects and closes the run when submit fails before the turn is running", async () =>
{
  const recorder = CreateOrderRecorder();
  const store = CreateFakeAgentStore(recorder, undefined);
  const runManager = CreateFakeRunManager(recorder);
  runManager.submitError = new Error("submit boom");
  const manager = CreateSddManager({ ...CreateDeps(recorder), store, runManager });

  await assert.rejects(
    () => manager.Start(ImplementerStartInput()),
    /submit boom/,
  );
  assert.equal(store.inserted.length, 1);
  assert.deepEqual(runManager.closed, [x_AgentId]);
});

test("SddManager exposes only Start, Followup, and ListGeneric", () =>
{
  const harness = CreateManagerHarness();
  assert.deepEqual(Object.keys(harness.manager).sort(), ["Followup", "ListGeneric", "Start"]);
});

test("a controller note is appended verbatim to every started role", async () =>
{
  const note = "The tree has uncommitted work from a cancelled sibling run; reconcile before editing.";
  const harness = CreateManagerHarness();

  await harness.manager.Start({ ...ImplementerStartInput(), note });

  const submitted = harness.runManager.submitted.at(-1)?.text ?? "";
  assert.ok(submitted.includes("## Controller Note"), "note heading missing");
  assert.ok(submitted.includes(note), "note text missing");
  assert.ok(
    submitted.indexOf("## Controller Note") > submitted.indexOf(x_PromptText.trim().slice(0, 20)),
    "the note must follow the rendered prompt, not replace it",
  );
});

test("a started role without a note is unchanged", async () =>
{
  const harness = CreateManagerHarness();
  await harness.manager.Start(ImplementerStartInput());
  assert.equal(harness.runManager.submitted.at(-1)?.text, x_PromptText);
});

test("a controller note cannot smuggle a run id to the worker", () =>
{
  const rejected = ImplementerStartSchema.safeParse({
    ...ImplementerStartInput(),
    note: "Resume against xrun_20260727192847117_b30af348 when done.",
  });
  assert.equal(rejected.success, false);
});

// Task 8b: tombstones interleave with real rows by dispatched_at/created_at,
// and limit is applied after the merge so a newer tombstone is not dropped
// behind an older real row.
//
test("ListGeneric interleaves tombstones with real rows and limits after the merge", async () =>
{
  const olderRealId = "xrun_20260728000000000_olderreal";
  const newerTombstoneId = "xrun_20260728000000000_newertomb";
  const agents = new Map<string, SddAgentRecord>([
    [olderRealId, {
      agent_id: olderRealId,
      plan_path: "/tmp/plans/2026-07-28-redesign-sdd-ledger.md",
      task: 4,
      role: "implementer",
      brief_path: "/tmp/sdd/task-4-brief.md",
      brief_text: "brief\n",
      cwd: "/private/tmp/worktree",
      dispatched_at: "2026-07-28T10:00:00.000Z",
    }],
    [newerTombstoneId, {
      agent_id: newerTombstoneId,
      plan_path: "/tmp/plans/2026-07-28-redesign-sdd-ledger.md",
      task: 4,
      role: "fixer",
      brief_path: "/tmp/sdd/task-4-brief.md",
      brief_text: "brief\n",
      cwd: "/private/tmp/worktree",
      dispatched_at: "2026-07-28T12:00:00.000Z",
    }],
  ]);
  const store: SddAgentStore = {
    Insert(): void
    {
      throw new Error("Insert is not used by ListGeneric");
    },
    Get(agentId: string)
    {
      return agents.get(agentId);
    },
    ListAll()
    {
      return [...agents.values()];
    },
    IsSddAgent(agentId: string)
    {
      return agents.has(agentId);
    },
    Close(): void {},
  };
  const runManager: SddRunManagerPort = {
    allocateRunId()
    {
      return olderRealId;
    },
    async create()
    {
      return { runId: olderRealId };
    },
    async start() {},
    async submit() {},
    inspect()
    {
      return undefined;
    },
    async close() {},
    has()
    {
      return false;
    },
    async listOwnedRuns()
    {
      return {
        runs: [{
          run_id: olderRealId,
          harness: "cursor",
          phase: "ready",
          sequence: 1,
          exit_status: "running",
          live: true,
          supervised: true,
          created_at: "2026-07-28T11:00:00.000Z",
          updated_at: "2026-07-28T11:00:00.000Z",
        }],
      };
    },
  };
  const manager = CreateSddManager({
    store,
    runManager,
    ...CreateDeps(),
  });

  const listed = await manager.ListGeneric({ live_only: false, limit: 1 });
  assert.equal(listed.runs.length, 1);
  const only = listed.runs[0]!;
  assert.equal(only.run_id, newerTombstoneId);
  assert.equal("run_missing" in only && only.run_missing, true);

  const both = await manager.ListGeneric({ live_only: false, limit: 2 });
  assert.deepEqual(
    both.runs.map((entry) => entry.run_id),
    [newerTombstoneId, olderRealId],
  );
});

// A completed SDD run still has a run record on disk; live_only filters it from
// the page, but must not invent a run_missing tombstone for it (xsvc-13).
//
test("a completed SDD run is not a tombstone under live_only", async () =>
{
  const completedId = "xrun_20260728000000000_completed";
  const agent: SddAgentRecord = {
    agent_id: completedId,
    plan_path: "/tmp/plans/2026-07-28-redesign-sdd-ledger.md",
    task: 4,
    role: "implementer",
    brief_path: "/tmp/sdd/task-4-brief.md",
    brief_text: "brief\n",
    cwd: "/private/tmp/worktree",
    dispatched_at: "2026-07-28T10:00:00.000Z",
  };
  const store: SddAgentStore = {
    Insert(): void
    {
      throw new Error("Insert is not used by ListGeneric");
    },
    Get(agentId: string)
    {
      return agentId === completedId ? agent : undefined;
    },
    ListAll()
    {
      return [agent];
    },
    IsSddAgent(agentId: string)
    {
      return agentId === completedId;
    },
    Close(): void {},
  };
  const completedRow = {
    run_id: completedId,
    harness: "cursor",
    phase: "completed",
    sequence: 2,
    exit_status: "completed",
    live: false,
    supervised: true,
    created_at: "2026-07-28T10:00:01.000Z",
    updated_at: "2026-07-28T11:00:00.000Z",
  };
  const runManager: SddRunManagerPort = {
    allocateRunId()
    {
      return completedId;
    },
    async create()
    {
      return { runId: completedId };
    },
    async start() {},
    async submit() {},
    inspect()
    {
      return undefined;
    },
    async close() {},
    has()
    {
      return false;
    },
    async listOwnedRuns(input)
    {
      const runs = [completedRow]
        .filter((row) => !input.live_only || row.live)
        .slice(0, input.limit);
      return { runs };
    },
  };
  const manager = CreateSddManager({
    store,
    runManager,
    ...CreateDeps(),
  });

  const listed = await manager.ListGeneric({ live_only: true, limit: 50 });
  const entry = listed.runs.find((row) => row.run_id === completedId);
  assert.equal(entry, undefined, "completed runs must not appear under live_only");
  assert.equal(
    listed.runs.some((row) => "run_missing" in row && row.run_id === completedId),
    false,
    "a run record must never be stamped run_missing",
  );
});
