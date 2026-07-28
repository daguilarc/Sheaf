import assert from "node:assert/strict";
import test from "node:test";

import {
  CreateSddManager,
  type SddManagerDeps,
  type SddRunManagerPort,
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
  options?: { live?: boolean; failStart?: boolean },
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
      this.phase = "running";
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
    agent: "grok-4.5",
    harness: "cursor",
    effort: "high",
    task: 3,
    name: "sdd-start-followup",
    brief: x_BriefPath,
    report: x_ReportPath,
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
    agent: "grok-4.5", harness: "cursor", effort: "high",
    task: 3, name: "Ledger v2 store", brief: x_BriefPath, report: x_ReportPath,
  });

  assert.deepEqual(recorder.Names(), [
    "canonicalizeCwd",
    "readFile",
    "renderPrompt",
    "allocateRunId",
    "store.Insert",
    "runManager.create",
    "runManager.start",
    "inspect",
    "runManager.submit",
  ]);
  assert.deepEqual(store.inserted[0], {
    agentId: result.agent_id,
    planPath: x_PlanPath,
    task: 3,
    role: "implementer",
    briefPath: x_BriefPath,
    briefText: x_BriefText,
    cwd: x_CanonicalCwd,
  });
  assert.deepEqual(Object.keys(result).sort(), [
    "agent_id", "prompt_path", "renderer_path", "sequence",
  ]);
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
    agent: "grok-4.5", harness: "cursor", effort: "high",
    task: 3, name: "x", brief: x_BriefPath, report: x_ReportPath,
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
    agent: "grok-4.5", harness: "cursor", effort: "high",
    task: 3, name: "x", brief: x_BriefPath, report: x_ReportPath,
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
    agent: "grok-4.5", harness: "cursor", effort: "high",
    task: 3, name: "x", brief: x_BriefPath, report: x_ReportPath,
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
    agent: "opus", harness: "claude_code", effort: "high",
    task: 3, brief: x_BriefPath, report: x_ReportPath, base: "main", head: "HEAD",
  });
  assert.equal(rendered[0]!.role, "task-reviewer");

  await manager.Start({
    role: "reviewer", cwd: x_Cwd, plan: x_PlanPath,
    agent: "opus", harness: "claude_code", effort: "high",
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
    agent: "grok-4.5", harness: "cursor", effort: "high",
    task: 3, brief: x_BriefPath, findings: "/tmp/f.md",
    findings_text: "one finding", tests: ["npm test"], report: x_ReportPath, round: 2,
  });
  const submitted = runManager.submitted[0]!.text;
  assert.match(submitted, /^You are a fixer for task 3 of plan /);
  assert.match(submitted, /Fix round 2\./);
  assert.ok(!submitted.includes("Fix Round 2\""));
  assert.equal(store.inserted[0]!.role, "fixer");
  assert.equal(result.prompt_path, "");
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
    agent: "opus", harness: "claude_code", effort: "high",
    task: 3, brief: x_BriefPath, findings: "/tmp/f.md", report: x_ReportPath,
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
    agent_id: x_AgentId,
    round: 2,
    findings: "/tmp/sdd/task-3-findings.md",
    findings_text: "one finding",
    tests: ["npm test"],
    report: "/tmp/sdd/task-3-report.md",
  });

  assert.deepEqual(Object.keys(result).sort(), ["agent_id", "sequence"]);
  assert.equal(result.agent_id, x_AgentId);
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
      kind: "fix", agent_id: x_AgentId, round: 1,
      findings: "/tmp/f.md", findings_text: "x", tests: ["npm test"], report: "/tmp/r.md",
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
      kind: "fix", agent_id: x_AgentId, round: 1,
      findings: "/tmp/f.md", findings_text: "x", tests: ["npm test"], report: "/tmp/r.md",
    }),
    (error: unknown) =>
    {
      const structured = structuredErrorFromUnknown(error);
      assert.equal(structured.error, "sdd_agent_not_live");
      assert.deepEqual(structured.details, {
        agent_id: x_AgentId,
        role: "implementer",
        plan_path: x_PlanPath,
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
        kind: "fix", agent_id: x_AgentId, round: 1,
        findings: "/tmp/f.md", findings_text: "x", tests: ["npm test"], report: "/tmp/r.md",
      }),
      (error: unknown) =>
      {
        const structured = structuredErrorFromUnknown(error);
        assert.equal(structured.error, "sdd_agent_not_live");
        assert.deepEqual(structured.details, {
          agent_id: x_AgentId,
          role: "implementer",
          plan_path: x_PlanPath,
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
        kind: "fix", agent_id: x_AgentId, round: 1,
        findings: "/tmp/f.md", findings_text: "x", tests: ["npm test"], report: "/tmp/r.md",
      }),
      (error: unknown) =>
      {
        const structured = structuredErrorFromUnknown(error);
        assert.equal(structured.error, "sdd_agent_busy");
        assert.deepEqual(structured.details, {
          agent_id: x_AgentId,
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
          agent_id: x_AgentId,
          round: 1,
          findings: "/tmp/f.md",
          findings_text: "x",
          tests: ["npm test"],
          report: "/tmp/r.md",
        }
      : {
          kind: "re-review" as const,
          agent_id: x_AgentId,
          round: 1,
          findings: "/tmp/f.md",
          report: "/tmp/r.md",
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
      agent_id: x_AgentId,
      round: 1,
      findings: "/tmp/f.md",
      report: "/tmp/r.md",
      base: "main",
      head: "HEAD",
    }),
    (error: unknown) =>
    {
      const structured = structuredErrorFromUnknown(error);
      assert.equal(structured.error, "sdd_followup_task_required");
      assert.deepEqual(structured.details, {
        agent_id: x_AgentId,
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
    kind: "re-review" as const, agent_id: x_AgentId, round: 1,
    findings: "/tmp/f.md", report: "/tmp/r.md", base: "main", head: "HEAD",
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
      agent_id: x_AgentId,
      round: 1,
      findings: x_FindingsPath,
      findings_text: x_FindingsText,
      tests: ["dist/tests/sdd_manager.test.js"],
      report: x_ReportPath,
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
      agent_id: x_AgentId,
      round: 1,
      findings: x_FindingsPath,
      findings_text: x_FindingsText,
      tests: ["dist/tests/sdd_manager.test.js"],
      report: x_ReportPath,
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
    agent_id: x_AgentId,
    round: 1,
    findings: x_FindingsPath,
    findings_text: x_FindingsText,
    tests: ["dist/tests/sdd_manager.test.js"],
    report: x_ReportPath,
    note,
  });

  const submitted = runManager.submitted.at(-1)?.text ?? "";
  assert.ok(submitted.includes(x_FindingsText), "findings must survive");
  assert.ok(submitted.includes("## Controller Note"));
  assert.ok(submitted.includes(note));
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
