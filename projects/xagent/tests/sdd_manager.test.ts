import assert from "node:assert/strict";
import test from "node:test";

import {
  CreateSddManager,
  type SddManagerDeps,
  type SddRunManagerPort,
} from "../src/service/sdd_manager.js";
import {
  SddStoreError,
  type PrepareFollowupInput,
  type ReserveInitialInput,
  type SddSessionRecord,
  type SddStore,
  type SddTurnRecord,
} from "../src/service/sdd_store.js";
import type {
  FormatFixFollowupInput,
  RenderedSddPrompt,
  RenderSddPromptInput,
} from "../src/service/sdd_prompt.js";
import type {
  AwaitRunResult,
  CloseRunResult,
  CreateRunOptions,
  MessageRunResult,
} from "../src/service/run_manager.js";
import type {
  XagentAwaitInput,
  XagentCloseInput,
  XagentMessageInput,
  XagentSddStartInput,
} from "../src/service/tool_schemas.js";
import { ToolValidationError } from "../src/service/tool_schemas.js";

const x_AgentId = "xrun_20260727000000000_abcdef12";
const x_PlanPath = "/tmp/plans/2026-07-26-xagent-sdd-mode.md";
const x_BriefPath = "/tmp/sdd/task-3-brief.md";
const x_ReportPath = "/tmp/sdd/task-3-report.md";
const x_PromptPath = "/tmp/sdd/dispatch-implementer-task-3.md";
const x_Cwd = "/tmp/worktree";
const x_CanonicalCwd = "/private/tmp/worktree";
const x_BriefText = "Implement SDD start and follow-up.\n";
const x_PromptText = "Rendered implementer prompt pointing at the brief.\n";

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

function CreateFakeStore(recorder: ReturnType<typeof CreateOrderRecorder>): SddStore & {
  readonly reserved: ReserveInitialInput[];
  readonly prepared: PrepareFollowupInput[];
  readonly running: Array<{ agentId: string; turnNumber: number; resumeSequence: number }>;
  readonly failed: Array<{ agentId: string; turnNumber: number }>;
  sessions: Map<string, SddSessionRecord>;
  openTurns: Map<string, SddTurnRecord>;
  reserveError?: Error;
  prepareError?: Error;
}
{
  const reserved: ReserveInitialInput[] = [];
  const prepared: PrepareFollowupInput[] = [];
  const running: Array<{ agentId: string; turnNumber: number; resumeSequence: number }> = [];
  const failed: Array<{ agentId: string; turnNumber: number }> = [];
  const sessions = new Map<string, SddSessionRecord>();
  const openTurns = new Map<string, SddTurnRecord>();
  let nextTurnId = 1;

  return {
    reserved,
    prepared,
    running,
    failed,
    sessions,
    openTurns,
    ReserveInitial(input: ReserveInitialInput): void
    {
      recorder.Record("ReserveInitial", input);
      if (this.reserveError !== undefined)
      {
        throw this.reserveError;
      }
      reserved.push(input);
      sessions.set(input.agentId, {
        agent_id: input.agentId,
        plan_name: input.planName,
        plan_path: input.planPath,
        cwd: input.cwd,
        task_number: input.taskNumber ?? null,
        agent: input.agent,
        harness: input.harness,
        effort: input.effort,
        role: input.role,
        started_at: "2026-07-27T00:00:00.000Z",
        closed_at: null,
      });
      openTurns.set(input.agentId, {
        id: nextTurnId,
        agent_id: input.agentId,
        turn_number: 1,
        kind: "initial",
        round: null,
        brief_path: input.briefPath,
        brief_text: input.briefText,
        report_path: input.reportPath ?? null,
        findings_path: null,
        findings_text: null,
        report_text: null,
        resume_sequence: null,
        completed_sequence: null,
        status: "prepared",
        created_at: "2026-07-27T00:00:00.000Z",
        completed_at: null,
      });
      nextTurnId += 1;
    },
    PrepareFollowup(input: PrepareFollowupInput): number
    {
      recorder.Record("PrepareFollowup", input);
      if (this.prepareError !== undefined)
      {
        throw this.prepareError;
      }
      const session = sessions.get(input.agentId);
      if (session === undefined)
      {
        throw new Error(`missing session ${input.agentId}`);
      }
      if (openTurns.has(input.agentId))
      {
        throw new Error(`open turn exists for ${input.agentId}`);
      }
      prepared.push(input);
      const turnNumber = prepared.length + 1;
      openTurns.set(input.agentId, {
        id: nextTurnId,
        agent_id: input.agentId,
        turn_number: turnNumber,
        kind: input.kind,
        round: input.round,
        brief_path: input.briefPath,
        brief_text: input.briefText,
        report_path: input.reportPath ?? null,
        findings_path: input.findingsPath ?? null,
        findings_text: input.findingsText ?? null,
        report_text: null,
        resume_sequence: null,
        completed_sequence: null,
        status: "prepared",
        created_at: "2026-07-27T00:00:00.000Z",
        completed_at: null,
      });
      nextTurnId += 1;
      return turnNumber;
    },
    MarkRunning(agentId: string, turnNumber: number, resumeSequence: number): void
    {
      recorder.Record("MarkRunning", { agentId, turnNumber, resumeSequence });
      running.push({ agentId, turnNumber, resumeSequence });
      const turn = openTurns.get(agentId);
      if (turn === undefined)
      {
        throw new Error(`no open turn for ${agentId}`);
      }
      openTurns.set(agentId, {
        ...turn,
        status: "running",
        resume_sequence: resumeSequence,
      });
    },
    MarkCompleted(): void
    {
      throw new Error("MarkCompleted not used in Task 3 tests");
    },
    MarkFailed(agentId: string, turnNumber: number): void
    {
      recorder.Record("MarkFailed", { agentId, turnNumber });
      failed.push({ agentId, turnNumber });
      openTurns.delete(agentId);
    },
    MarkAbandoned(): void
    {
      throw new Error("MarkAbandoned not used in Task 3 tests");
    },
    MarkClosed(): void
    {
      throw new Error("MarkClosed not used in Task 3 tests");
    },
    GetSession(agentId: string): SddSessionRecord | undefined
    {
      return sessions.get(agentId);
    },
    GetOpenTurn(agentId: string): SddTurnRecord | undefined
    {
      return openTurns.get(agentId);
    },
    IsSddAgent(agentId: string): boolean
    {
      return sessions.has(agentId);
    },
    ReconcileTerminalRuns(): void
    {
      throw new Error("ReconcileTerminalRuns not used in Task 3 tests");
    },
    Close(): void
    {
    },
  };
}

function CreateFakeRunManager(recorder: ReturnType<typeof CreateOrderRecorder>): SddRunManagerPort & {
  createError?: Error;
  startError?: Error;
  submitError?: Error;
  created: CreateRunOptions[];
  submitted: Array<{ runId: string; text: string }>;
  closed: string[];
  sequence: number;
  phase: string;
  messageCalls: XagentMessageInput[];
}
{
  const created: CreateRunOptions[] = [];
  const submitted: Array<{ runId: string; text: string }> = [];
  const closed: string[] = [];
  const messageCalls: XagentMessageInput[] = [];
  const runs = new Set<string>();

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
    async create(options: CreateRunOptions): Promise<{ readonly runId: string }>
    {
      recorder.Record("create", options);
      if (this.createError !== undefined)
      {
        throw this.createError;
      }
      created.push(options);
      const runId = options.runId ?? x_AgentId;
      runs.add(runId);
      return { runId };
    },
    async start(runId: string): Promise<void>
    {
      recorder.Record("start", runId);
      if (this.startError !== undefined)
      {
        throw this.startError;
      }
      this.phase = "ready";
    },
    async submit(runId: string, text: string): Promise<void>
    {
      recorder.Record("submit", { runId, text });
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
      if (!runs.has(runId) && created.length === 0)
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
      recorder.Record("close", runId);
      closed.push(runId);
      runs.delete(runId);
    },
    has(runId: string): boolean
    {
      return runs.has(runId);
    },
    async messageRun(input: XagentMessageInput): Promise<MessageRunResult>
    {
      recorder.Record("messageRun", input);
      messageCalls.push(input);
      return {
        run_id: input.run_id,
        phase: "running",
        sequence: this.sequence,
      };
    },
    async awaitRun(input: XagentAwaitInput): Promise<AwaitRunResult>
    {
      return {
        schema_version: 1,
        event: "deadline",
        run_id: input.run_id,
        sequence: input.after_sequence,
        phase: "ready",
        elapsed_ms: 0,
      };
    },
    async closeRun(input: XagentCloseInput): Promise<CloseRunResult>
    {
      return {
        run_id: input.run_id,
        closed: true,
      };
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
  reserveError?: Error;
  createError?: Error;
  startError?: Error;
  submitError?: Error;
  render?: (input: RenderSddPromptInput) => Promise<RenderedSddPrompt>;
  readFile?: (filePath: string) => Promise<string>;
}): {
  readonly manager: ReturnType<typeof CreateSddManager>;
  readonly recorder: ReturnType<typeof CreateOrderRecorder>;
  readonly store: ReturnType<typeof CreateFakeStore>;
  readonly runManager: ReturnType<typeof CreateFakeRunManager>;
  readonly rendered: RenderSddPromptInput[];
  readonly readPaths: string[];
}
{
  const recorder = CreateOrderRecorder();
  const store = CreateFakeStore(recorder);
  if (options?.reserveError !== undefined)
  {
    store.reserveError = options.reserveError;
  }
  const runManager = CreateFakeRunManager(recorder);
  if (options?.createError !== undefined)
  {
    runManager.createError = options.createError;
  }
  if (options?.startError !== undefined)
  {
    runManager.startError = options.startError;
  }
  if (options?.submitError !== undefined)
  {
    runManager.submitError = options.submitError;
  }
  const rendered: RenderSddPromptInput[] = [];
  const readPaths: string[] = [];
  const deps: SddManagerDeps = {
    store,
    runManager,
    repoRoot: "/tmp/service-repo",
    async canonicalizeCwd(cwd: string): Promise<string>
    {
      recorder.Record("canonicalizeCwd", cwd);
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
      return {
        prompt: {
          path: x_PromptPath,
          text: x_PromptText,
        },
        metadata: {
          promptPath: x_PromptPath,
          briefPath: "brief" in input ? input.brief : undefined,
          reportPath: "report" in input ? input.report : undefined,
        },
      };
    },
    formatFix(input: FormatFixFollowupInput): string
    {
      recorder.Record("formatFix", input);
      return [
        `Fix round ${input.round}.`,
        `Read the original brief at ${input.briefPath}.`,
        `Read and address only the open findings at ${input.findingsPath}.`,
        "",
        input.findingsText,
        "",
        `Run these covering tests: ${input.tests.join(", ")}.`,
        `Append the fix report to ${input.reportPath}.`,
        `Return only the short Superpowers status contract.`,
      ].join("\n");
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

test("Start follows prepared-before-provider order and returns resolved paths", async () =>
{
  const { manager, recorder, store, runManager } = CreateManagerHarness();

  const result = await manager.Start(ImplementerStartInput());

  assert.deepEqual(recorder.Names(), [
    "canonicalizeCwd",
    "readFile",
    "renderPrompt",
    "allocateRunId",
    "ReserveInitial",
    "create",
    "start",
    "inspect",
    "submit",
    "MarkRunning",
  ]);
  assert.equal(store.reserved.length, 1);
  assert.equal(store.reserved[0]?.agentId, x_AgentId);
  assert.equal(store.reserved[0]?.planName, "2026-07-26-xagent-sdd-mode");
  assert.equal(store.reserved[0]?.cwd, x_CanonicalCwd);
  assert.equal(store.reserved[0]?.briefText, x_BriefText);
  assert.equal(store.reserved[0]?.reportPath, x_ReportPath);
  assert.equal(runManager.created.length, 1);
  assert.equal(runManager.created[0]?.runId, x_AgentId);
  assert.equal(runManager.created[0]?.model, "grok-4.5");
  assert.equal(runManager.created[0]?.thinkingLevel, "high");
  assert.equal(runManager.created[0]?.cwd, x_CanonicalCwd);
  assert.equal(runManager.created[0]?.mode, "subagent");
  assert.equal(runManager.submitted[0]?.text, x_PromptText);
  assert.deepEqual(store.running, [
    { agentId: x_AgentId, turnNumber: 1, resumeSequence: 7 },
  ]);
  assert.deepEqual(result, {
    agent_id: x_AgentId,
    sequence: 7,
    prompt_path: x_PromptPath,
    brief_path: x_BriefPath,
    report_path: x_ReportPath,
  });
  assert.equal(JSON.stringify(result).includes(x_BriefText), false);
  assert.equal(JSON.stringify(result).includes(x_PromptText), false);
});

test("Start reservation failure creates no provider run", async () =>
{
  const { manager, store, runManager, recorder } = CreateManagerHarness({
    reserveError: new ToolValidationError({
      error: "sdd_persistence_failed",
      message: "Unable to reserve SDD session.",
    }),
  });

  await assert.rejects(
    () => manager.Start(ImplementerStartInput()),
    (error: unknown) =>
    {
      assert.ok(error instanceof ToolValidationError);
      assert.equal(error.structured.error, "sdd_persistence_failed");
      return true;
    },
  );

  assert.equal(runManager.created.length, 0);
  assert.equal(store.failed.length, 0);
  assert.ok(recorder.Names().includes("ReserveInitial"));
  assert.equal(recorder.Names().includes("create"), false);
});

test("Start create failure marks the prepared turn failed and closes no live run", async () =>
{
  const { manager, store, runManager } = CreateManagerHarness({
    createError: new Error("provider create failed"),
  });

  await assert.rejects(() => manager.Start(ImplementerStartInput()), /provider create failed/);

  assert.deepEqual(store.failed, [{ agentId: x_AgentId, turnNumber: 1 }]);
  assert.deepEqual(runManager.closed, []);
  assert.equal(runManager.created.length, 0);
});

test("Start start failure marks failed and closes the created run", async () =>
{
  const { manager, store, runManager } = CreateManagerHarness({
    startError: new Error("provider start failed"),
  });

  await assert.rejects(() => manager.Start(ImplementerStartInput()), /provider start failed/);

  assert.deepEqual(store.failed, [{ agentId: x_AgentId, turnNumber: 1 }]);
  assert.deepEqual(runManager.closed, [x_AgentId]);
});

test("Start submit failure marks failed and closes the created run", async () =>
{
  const { manager, store, runManager } = CreateManagerHarness({
    submitError: new Error("provider submit failed"),
  });

  await assert.rejects(() => manager.Start(ImplementerStartInput()), /provider submit failed/);

  assert.deepEqual(store.failed, [{ agentId: x_AgentId, turnNumber: 1 }]);
  assert.deepEqual(runManager.closed, [x_AgentId]);
  assert.equal(runManager.submitted.length, 0);
});

const x_FindingsPath = "/tmp/sdd/task-3-findings.md";
const x_FindingsText = "Important: prepared-before-submit must hold.\n";
const x_ReReviewPromptText = "Rendered re-review prompt.\n";

function TaskReviewerStartInput(): XagentSddStartInput
{
  return {
    role: "task-reviewer",
    cwd: x_Cwd,
    plan: x_PlanPath,
    agent: "opus",
    harness: "claude_code",
    effort: "high",
    task: 3,
    brief: x_BriefPath,
    report: x_ReportPath,
    base: "abc123",
    head: "def456",
  };
}

async function StartAndClearOpenTurn(
  harness: ReturnType<typeof CreateManagerHarness>,
  input: XagentSddStartInput = ImplementerStartInput(),
): Promise<void>
{
  await harness.manager.Start(input);
  harness.store.openTurns.delete(x_AgentId);
  harness.recorder.calls.length = 0;
  harness.runManager.submitted.length = 0;
  harness.rendered.length = 0;
}

test("Followup fix rejects when implementer started without a report path", async () =>
{
  const harness = CreateManagerHarness();
  const input = ImplementerStartInput();
  delete (input as { report?: string }).report;
  await StartAndClearOpenTurn(harness, input);

  await assert.rejects(
    () => harness.manager.Followup({
      kind: "fix",
      agent_id: x_AgentId,
      round: 1,
      findings: x_FindingsPath,
      findings_text: x_FindingsText,
      tests: ["dist/tests/sdd_manager.test.js"],
    }),
    (error: unknown) =>
    {
      assert.ok(error instanceof ToolValidationError);
      assert.equal(error.structured.error, "sdd_report_path_required");
      assert.equal(JSON.stringify(error.structured).includes(x_BriefPath), true);
      assert.equal(
        harness.runManager.submitted.some((entry) => entry.text.includes(x_BriefPath)),
        false,
      );
      return true;
    },
  );
  assert.equal(harness.recorder.Names().includes("submit"), false);
  assert.equal(harness.recorder.Names().includes("formatFix"), false);
});

test("Followup maps store open_turn code to sdd_turn_unresolved without prose matching", async () =>
{
  const harness = CreateManagerHarness();
  await StartAndClearOpenTurn(harness);
  harness.store.prepareError = new SddStoreError(
    "ledger turn still unresolved for agent",
    "open_turn",
  );

  await assert.rejects(
    () => harness.manager.Followup({
      kind: "fix",
      agent_id: x_AgentId,
      round: 1,
      findings: x_FindingsPath,
      findings_text: x_FindingsText,
      tests: ["t"],
    }),
    (error: unknown) =>
    {
      assert.ok(error instanceof ToolValidationError);
      assert.equal(error.structured.error, "sdd_turn_unresolved");
      return true;
    },
  );
  assert.equal(harness.recorder.Names().includes("submit"), false);
});

test("Followup fix reuses the same run id and stored brief/report paths", async () =>
{
  const harness = CreateManagerHarness();
  await StartAndClearOpenTurn(harness);

  const result = await harness.manager.Followup({
    kind: "fix",
    agent_id: x_AgentId,
    round: 1,
    findings: x_FindingsPath,
    findings_text: x_FindingsText,
    tests: ["dist/tests/sdd_manager.test.js"],
  });

  assert.equal(result.agent_id, x_AgentId);
  assert.equal(result.sequence, 7);
  assert.equal(result.turn_number, 2);
  assert.equal(harness.store.prepared.length, 1);
  assert.equal(harness.store.prepared[0]?.kind, "fix");
  assert.equal(harness.store.prepared[0]?.briefPath, x_BriefPath);
  assert.equal(harness.store.prepared[0]?.reportPath, x_ReportPath);
  assert.equal(harness.store.prepared[0]?.findingsText, x_FindingsText);
  assert.ok(harness.runManager.submitted[0]?.text.includes(x_BriefPath));
  assert.ok(harness.runManager.submitted[0]?.text.includes(x_ReportPath));
  assert.ok(harness.runManager.submitted[0]?.text.includes(x_FindingsText));
  assert.equal(harness.runManager.created.length, 1);
  const prepareIndex = harness.recorder.Names().indexOf("PrepareFollowup");
  const submitIndex = harness.recorder.Names().indexOf("submit");
  assert.ok(prepareIndex >= 0);
  assert.ok(submitIndex > prepareIndex);
  assert.deepEqual(harness.store.running.at(-1), {
    agentId: x_AgentId,
    turnNumber: 2,
    resumeSequence: 7,
  });
});

test("Followup re-review uses the same run id and upstream renderer", async () =>
{
  const harness = CreateManagerHarness({
    render: async (input) =>
    {
      if (input.role === "re-review")
      {
        return {
          prompt: { path: "/tmp/sdd/re-review.md", text: x_ReReviewPromptText },
          metadata: {
            promptPath: "/tmp/sdd/re-review.md",
            briefPath: input.brief,
            reportPath: input.report,
            findingsPath: input.findings,
          },
        };
      }
      return {
        prompt: { path: x_PromptPath, text: x_PromptText },
        metadata: {
          promptPath: x_PromptPath,
          briefPath: "brief" in input ? input.brief : undefined,
          reportPath: "report" in input ? input.report : undefined,
        },
      };
    },
    readFile: async (filePath) =>
    {
      if (filePath === x_FindingsPath)
      {
        return x_FindingsText;
      }
      return x_BriefText;
    },
  });
  await StartAndClearOpenTurn(harness, TaskReviewerStartInput());

  const result = await harness.manager.Followup({
    kind: "re-review",
    agent_id: x_AgentId,
    round: 2,
    findings: x_FindingsPath,
    base: "aaa",
    head: "bbb",
    diff: "/tmp/sdd/scoped.diff",
  });

  assert.equal(result.agent_id, x_AgentId);
  assert.equal(result.turn_number, 2);
  assert.equal(harness.rendered.length, 1);
  assert.equal(harness.rendered[0]?.role, "re-review");
  assert.equal(harness.runManager.submitted[0]?.text, x_ReReviewPromptText);
  assert.equal(harness.store.prepared[0]?.kind, "re_review");
  assert.equal(harness.store.prepared[0]?.findingsPath, x_FindingsPath);
  assert.equal(JSON.stringify(result).includes(x_FindingsText), false);
});

test("Followup rejects when another turn is unresolved", async () =>
{
  const harness = CreateManagerHarness();
  await harness.manager.Start(ImplementerStartInput());
  harness.recorder.calls.length = 0;

  await assert.rejects(
    () => harness.manager.Followup({
      kind: "fix",
      agent_id: x_AgentId,
      round: 1,
      findings: x_FindingsPath,
      findings_text: x_FindingsText,
      tests: ["t"],
    }),
    (error: unknown) =>
    {
      assert.ok(error instanceof ToolValidationError);
      assert.equal(error.structured.error, "sdd_turn_unresolved");
      assert.equal(JSON.stringify(error.structured).includes(x_FindingsText), false);
      return true;
    },
  );
  assert.equal(harness.recorder.Names().includes("submit"), false);
  assert.equal(harness.recorder.Names().includes("PrepareFollowup"), false);
});

test("Followup rejects wrong role/kind and unknown/terminal agents before provider input", async () =>
{
  const harness = CreateManagerHarness();
  await StartAndClearOpenTurn(harness, TaskReviewerStartInput());

  await assert.rejects(
    () => harness.manager.Followup({
      kind: "fix",
      agent_id: x_AgentId,
      round: 1,
      findings: x_FindingsPath,
      findings_text: x_FindingsText,
      tests: ["t"],
    }),
    (error: unknown) =>
    {
      assert.ok(error instanceof ToolValidationError);
      assert.equal(error.structured.error, "sdd_followup_role_mismatch");
      return true;
    },
  );

  await assert.rejects(
    () => harness.manager.Followup({
      kind: "re-review",
      agent_id: "xrun_20260727000000000_deadbeef",
      round: 1,
      findings: x_FindingsPath,
      base: "a",
      head: "b",
    }),
    (error: unknown) =>
    {
      assert.ok(error instanceof ToolValidationError);
      assert.equal(error.structured.error, "unknown_sdd_agent");
      return true;
    },
  );

  const closedHarness = CreateManagerHarness();
  await StartAndClearOpenTurn(closedHarness);
  const session = closedHarness.store.sessions.get(x_AgentId)!;
  closedHarness.store.sessions.set(x_AgentId, { ...session, closed_at: "2026-07-27T01:00:00.000Z" });
  await assert.rejects(
    () => closedHarness.manager.Followup({
      kind: "fix",
      agent_id: x_AgentId,
      round: 1,
      findings: x_FindingsPath,
      findings_text: x_FindingsText,
      tests: ["t"],
    }),
    (error: unknown) =>
    {
      assert.ok(error instanceof ToolValidationError);
      assert.equal(error.structured.error, "sdd_session_closed");
      return true;
    },
  );

  const terminalHarness = CreateManagerHarness();
  await StartAndClearOpenTurn(terminalHarness);
  await terminalHarness.runManager.close(x_AgentId);
  terminalHarness.recorder.calls.length = 0;
  await assert.rejects(
    () => terminalHarness.manager.Followup({
      kind: "fix",
      agent_id: x_AgentId,
      round: 1,
      findings: x_FindingsPath,
      findings_text: x_FindingsText,
      tests: ["t"],
    }),
    (error: unknown) =>
    {
      assert.ok(error instanceof ToolValidationError);
      assert.equal(error.structured.error, "sdd_session_terminal");
      return true;
    },
  );
  assert.equal(terminalHarness.recorder.Names().includes("submit"), false);
});

test("Followup keeps a prepared row before submit and marks failed on submit error", async () =>
{
  const harness = CreateManagerHarness();
  await StartAndClearOpenTurn(harness);
  harness.runManager.submitError = new Error("follow-up submit failed");

  await assert.rejects(
    () => harness.manager.Followup({
      kind: "fix",
      agent_id: x_AgentId,
      round: 1,
      findings: x_FindingsPath,
      findings_text: x_FindingsText,
      tests: ["t"],
    }),
    /follow-up submit failed/,
  );

  assert.equal(harness.store.prepared.length, 1);
  assert.deepEqual(harness.store.failed.at(-1), { agentId: x_AgentId, turnNumber: 2 });
  const prepareIndex = harness.recorder.Names().indexOf("PrepareFollowup");
  const submitIndex = harness.recorder.Names().indexOf("submit");
  const failedIndex = harness.recorder.Names().indexOf("MarkFailed");
  assert.ok(prepareIndex >= 0);
  assert.ok(submitIndex > prepareIndex);
  assert.ok(failedIndex > submitIndex);
});

test("MessageGeneric rejects SDD runs and leaves non-SDD messaging unchanged", async () =>
{
  const harness = CreateManagerHarness();
  await StartAndClearOpenTurn(harness);

  await assert.rejects(
    () => harness.manager.MessageGeneric({
      run_id: x_AgentId,
      text: "raw bypass",
    }),
    (error: unknown) =>
    {
      assert.ok(error instanceof ToolValidationError);
      assert.equal(error.structured.error, "sdd_followup_required");
      assert.equal(
        (error.structured.details as { tool?: string } | undefined)?.tool,
        "xagent_sdd_followup",
      );
      return true;
    },
  );
  assert.equal(harness.runManager.messageCalls.length, 0);

  const nonSdd = await harness.manager.MessageGeneric({
    run_id: "xrun_20260727000000000_00nonssd",
    text: "ordinary follow-up",
  });
  assert.equal(nonSdd.run_id, "xrun_20260727000000000_00nonssd");
  assert.equal(harness.runManager.messageCalls.length, 1);
  assert.equal(harness.runManager.messageCalls[0]?.text, "ordinary follow-up");
});
