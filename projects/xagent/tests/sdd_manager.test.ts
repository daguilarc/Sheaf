import assert from "node:assert/strict";
import test from "node:test";

import {
  CreateSddManager,
  type SddManagerDeps,
  type SddRunManagerPort,
} from "../src/service/sdd_manager.js";
import {
  SddStoreError,
  type InsertSddAgentInput,
  type PrepareFollowupInput,
  type ReserveInitialInput,
  type SddAgentRecord,
  type SddSessionRecord,
  type SddStore,
  type SddTurnRecord,
} from "../src/service/sdd_store.js";
import type {
  FormatFixFollowupInput,
  RenderedSddPrompt,
  RenderSddPromptInput,
} from "../src/service/sdd_prompt.js";
import { SddPromptError } from "../src/service/sdd_prompt.js";
import type {
  AwaitRunResult,
  CloseRunResult,
  CreateRunOptions,
  ListRunsResult,
  MessageRunResult,
} from "../src/service/run_manager.js";
import type {
  XagentAwaitInput,
  XagentCloseInput,
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
  readonly completed: Array<{
    agentId: string;
    turnNumber: number;
    reportText: string;
    completedSequence: number;
  }>;
  readonly closed: Array<{ agentId: string; closedAt: string }>;
  readonly abandoned: Array<{ agentId: string; turnNumber: number }>;
  readonly reconciled: Array<ReadonlyMap<string, string>>;
  sessions: Map<string, SddSessionRecord>;
  openTurns: Map<string, SddTurnRecord>;
  turnsByAgent: Map<string, SddTurnRecord[]>;
  reserveError?: Error;
  prepareError?: Error;
  markCompletedError?: Error;
  markClosedError?: Error;
}
{
  const reserved: ReserveInitialInput[] = [];
  const prepared: PrepareFollowupInput[] = [];
  const running: Array<{ agentId: string; turnNumber: number; resumeSequence: number }> = [];
  const failed: Array<{ agentId: string; turnNumber: number }> = [];
  const completed: Array<{
    agentId: string;
    turnNumber: number;
    reportText: string;
    completedSequence: number;
  }> = [];
  const closed: Array<{ agentId: string; closedAt: string }> = [];
  const abandoned: Array<{ agentId: string; turnNumber: number }> = [];
  const reconciled: Array<ReadonlyMap<string, string>> = [];
  const sessions = new Map<string, SddSessionRecord>();
  const openTurns = new Map<string, SddTurnRecord>();
  const turnsByAgent = new Map<string, SddTurnRecord[]>();
  let nextTurnId = 1;

  function RememberTurn(turn: SddTurnRecord): void
  {
    const existing = turnsByAgent.get(turn.agent_id) ?? [];
    const without = existing.filter((entry) => entry.turn_number !== turn.turn_number);
    without.push(turn);
    turnsByAgent.set(turn.agent_id, without);
  }

  return {
    reserved,
    prepared,
    running,
    failed,
    completed,
    closed,
    abandoned,
    reconciled,
    sessions,
    openTurns,
    turnsByAgent,
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
      const turn: SddTurnRecord = {
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
      };
      openTurns.set(input.agentId, turn);
      RememberTurn(turn);
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
      const turn: SddTurnRecord = {
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
      };
      openTurns.set(input.agentId, turn);
      RememberTurn(turn);
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
      const updated = {
        ...turn,
        status: "running" as const,
        resume_sequence: resumeSequence,
      };
      openTurns.set(agentId, updated);
      RememberTurn(updated);
    },
    MarkCompleted(
      agentId: string,
      turnNumber: number,
      reportText: string,
      completedSequence: number,
    ): void
    {
      recorder.Record("MarkCompleted", {
        agentId,
        turnNumber,
        reportText,
        completedSequence,
      });
      if (this.markCompletedError !== undefined)
      {
        throw this.markCompletedError;
      }
      const turn = openTurns.get(agentId);
      if (turn === undefined || turn.turn_number !== turnNumber || turn.status !== "running")
      {
        throw new SddStoreError(
          `Cannot mark turn ${turnNumber} completed for ${agentId}: expected running turn.`,
        );
      }
      completed.push({ agentId, turnNumber, reportText, completedSequence });
      const updated = {
        ...turn,
        status: "completed" as const,
        report_text: reportText,
        completed_sequence: completedSequence,
        completed_at: "2026-07-27T00:30:00.000Z",
      };
      openTurns.delete(agentId);
      RememberTurn(updated);
    },
    MarkFailed(agentId: string, turnNumber: number): void
    {
      recorder.Record("MarkFailed", { agentId, turnNumber });
      failed.push({ agentId, turnNumber });
      const turn = openTurns.get(agentId);
      if (turn !== undefined)
      {
        RememberTurn({
          ...turn,
          status: "failed",
          completed_at: "2026-07-27T00:30:00.000Z",
        });
      }
      openTurns.delete(agentId);
    },
    MarkAbandoned(agentId: string, turnNumber: number): void
    {
      recorder.Record("MarkAbandoned", { agentId, turnNumber });
      abandoned.push({ agentId, turnNumber });
      const turn = openTurns.get(agentId);
      if (turn !== undefined)
      {
        RememberTurn({
          ...turn,
          status: "abandoned",
          completed_at: "2026-07-27T00:30:00.000Z",
        });
      }
      openTurns.delete(agentId);
    },
    MarkClosed(agentId: string, closedAt: string): void
    {
      recorder.Record("MarkClosed", { agentId, closedAt });
      if (this.markClosedError !== undefined)
      {
        throw this.markClosedError;
      }
      const session = sessions.get(agentId);
      if (session === undefined || session.closed_at !== null)
      {
        throw new SddStoreError(`Cannot close SDD session ${agentId}: session missing or already closed.`);
      }
      closed.push({ agentId, closedAt });
      sessions.set(agentId, { ...session, closed_at: closedAt });
    },
    GetSession(agentId: string): SddSessionRecord | undefined
    {
      return sessions.get(agentId);
    },
    GetOpenTurn(agentId: string): SddTurnRecord | undefined
    {
      return openTurns.get(agentId);
    },
    GetLatestTurn(agentId: string): SddTurnRecord | undefined
    {
      const candidates = [...(turnsByAgent.get(agentId) ?? [])];
      const open = openTurns.get(agentId);
      if (open !== undefined)
      {
        candidates.push(open);
      }
      return candidates
        .sort((left, right) => right.turn_number - left.turn_number)
        .at(0);
    },
    GetTurnByCompletedSequence(
      agentId: string,
      completedSequence: number,
    ): SddTurnRecord | undefined
    {
      const turns = turnsByAgent.get(agentId) ?? [];
      return turns.find(
        (turn) =>
          turn.status === "completed"
          && turn.completed_sequence === completedSequence,
      );
    },
    IsSddAgent(agentId: string): boolean
    {
      return sessions.has(agentId);
    },
    ReconcileTerminalRuns(phases: ReadonlyMap<string, string>): void
    {
      recorder.Record("ReconcileTerminalRuns", [...phases.entries()]);
      reconciled.push(phases);
      const terminal = new Set(["failed", "cancelled", "abandoned"]);
      for (const [agentId, phase] of phases)
      {
        if (!terminal.has(phase))
        {
          continue;
        }
        const turn = openTurns.get(agentId);
        if (turn === undefined)
        {
          continue;
        }
        abandoned.push({ agentId, turnNumber: turn.turn_number });
        RememberTurn({
          ...turn,
          status: "abandoned",
          completed_at: "2026-07-27T00:30:00.000Z",
        });
        openTurns.delete(agentId);
      }
    },
    Insert(_input: InsertSddAgentInput): void
    {
      throw new Error("CreateFakeStore.Insert is not used by current manager tests");
    },
    Get(_agentId: string): SddAgentRecord | undefined
    {
      throw new Error("CreateFakeStore.Get is not used by current manager tests");
    },
    ListAll(): readonly SddAgentRecord[]
    {
      throw new Error("CreateFakeStore.ListAll is not used by current manager tests");
    },
    Close(): void
    {
      recorder.Record("Close");
    },
  };
}

function CreateFakeRunManager(recorder: ReturnType<typeof CreateOrderRecorder>): SddRunManagerPort & {
  createError?: Error;
  startError?: Error;
  submitError?: Error;
  closeRunError?: Error;
  messageError?: Error;
  created: CreateRunOptions[];
  submitted: Array<{ runId: string; text: string }>;
  closed: string[];
  closeRunCalls: XagentCloseInput[];
  awaitCalls: XagentAwaitInput[];
  sequence: number;
  phase: string;
  messageCalls: XagentMessageInput[];
  awaitResult?: AwaitRunResult | ((input: XagentAwaitInput) => AwaitRunResult | Promise<AwaitRunResult>);
}
{
  const created: CreateRunOptions[] = [];
  const submitted: Array<{ runId: string; text: string }> = [];
  const closed: string[] = [];
  const closeRunCalls: XagentCloseInput[] = [];
  const awaitCalls: XagentAwaitInput[] = [];
  const messageCalls: XagentMessageInput[] = [];
  const runs = new Set<string>();

  return {
    created,
    submitted,
    closed,
    closeRunCalls,
    awaitCalls,
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
    async awaitRun(input: XagentAwaitInput): Promise<AwaitRunResult>
    {
      recorder.Record("awaitRun", input);
      awaitCalls.push(input);
      if (typeof this.awaitResult === "function")
      {
        return this.awaitResult(input);
      }
      if (this.awaitResult !== undefined)
      {
        return this.awaitResult;
      }
      return {
        schema_version: 1,
        event: "deadline",
        run_id: input.run_id,
        sequence: input.after_sequence,
        phase: "ready",
        elapsed_ms: 0,
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
    async closeRun(input: XagentCloseInput): Promise<CloseRunResult>
    {
      recorder.Record("closeRun", input);
      closeRunCalls.push(input);
      if (this.closeRunError !== undefined)
      {
        throw this.closeRunError;
      }
      closed.push(input.run_id);
      runs.delete(input.run_id);
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
          rendererPath: "/service/checkout/projects/agents/utils/dispatch-prompt",
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
    renderer_path: "/service/checkout/projects/agents/utils/dispatch-prompt",
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

test("Start surfaces SddPromptError structured codes through structuredErrorFromUnknown", async () =>
{
  const { manager, store, runManager } = CreateManagerHarness({
    render: async () =>
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

  assert.equal(store.reserved.length, 0);
  assert.equal(runManager.created.length, 0);
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

test("Followup fix rejects when findings file is missing or empty", async () =>
{
  const missingHarness = CreateManagerHarness({
    readFile: async (filePath: string) =>
    {
      if (filePath === x_FindingsPath)
      {
        throw new Error("ENOENT");
      }
      return x_BriefText;
    },
  });
  await StartAndClearOpenTurn(missingHarness);

  await assert.rejects(
    () => missingHarness.manager.Followup({
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
  assert.equal(missingHarness.recorder.Names().includes("submit"), false);
  assert.equal(missingHarness.recorder.Names().includes("formatFix"), false);

  const emptyHarness = CreateManagerHarness({
    readFile: async (filePath: string) =>
    {
      if (filePath === x_FindingsPath)
      {
        return "  \n";
      }
      return x_BriefText;
    },
  });
  await StartAndClearOpenTurn(emptyHarness);

  await assert.rejects(
    () => emptyHarness.manager.Followup({
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
  assert.equal(emptyHarness.recorder.Names().includes("submit"), false);
});

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
      report: x_ReportPath,
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
      report: x_ReportPath,
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
    report: x_ReportPath,
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
            rendererPath: "/service/checkout/projects/agents/utils/dispatch-prompt",
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
          rendererPath: "/service/checkout/projects/agents/utils/dispatch-prompt",
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
    report: x_ReportPath,
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
      report: x_ReportPath,
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
      report: x_ReportPath,
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
      report: x_ReportPath,
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
      report: x_ReportPath,
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
      report: x_ReportPath,
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
      report: x_ReportPath,
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

test("MessageGeneric passes SDD and non-SDD messages through alike", async () =>
{
  const harness = CreateManagerHarness();
  await StartAndClearOpenTurn(harness);

  // Raw messaging used to be rejected for SDD runs to stop a fix round being
  // dispatched as unstructured prose. Work turns still go through
  // Start/Followup; a raw message is conversation and is delivered as-is.
  const sdd = await harness.manager.MessageGeneric({
    run_id: x_AgentId,
    text: "quick clarification, not a fix round",
  });
  assert.equal(sdd.run_id, x_AgentId);
  assert.equal(harness.runManager.messageCalls.length, 1);
  assert.equal(harness.store.prepared.length, 0);

  const nonSdd = await harness.manager.MessageGeneric({
    run_id: "xrun_20260727000000000_00nonssd",
    text: "ordinary follow-up",
  });
  assert.equal(nonSdd.run_id, "xrun_20260727000000000_00nonssd");
  assert.equal(harness.runManager.messageCalls.length, 2);
  assert.equal(harness.runManager.messageCalls[1]?.text, "ordinary follow-up");
});

const x_SanitizedReport = "sanitized report";

function CompletionResult(overrides: Partial<AwaitRunResult> = {}): AwaitRunResult
{
  return {
    schema_version: 1,
    event: "turn.completed",
    run_id: x_AgentId,
    sequence: 42,
    phase: "ready",
    elapsed_ms: 12,
    report: { text: x_SanitizedReport },
    ...overrides,
  };
}

test("Await persists report before returning completion", async () =>
{
  const harness = CreateManagerHarness();
  await harness.manager.Start(ImplementerStartInput());
  harness.recorder.calls.length = 0;
  harness.runManager.awaitResult = CompletionResult();

  const result = await harness.manager.Await({
    agent_id: x_AgentId,
    after_sequence: 7,
    deadline_seconds: 7000,
  });

  assert.deepEqual(harness.recorder.Names(), ["awaitRun", "MarkCompleted"]);
  assert.deepEqual(harness.store.completed, [
    {
      agentId: x_AgentId,
      turnNumber: 1,
      reportText: x_SanitizedReport,
      completedSequence: 42,
    },
  ]);
  assert.equal(result.report?.text, x_SanitizedReport);
  assert.equal(result.sequence, 42);
  assert.equal(harness.store.openTurns.has(x_AgentId), false);
  assert.equal(harness.runManager.awaitCalls[0]?.run_id, x_AgentId);
  assert.equal(harness.runManager.awaitCalls[0]?.after_sequence, 7);
});

test("Await MarkCompleted failure returns sdd_persistence_failed without completion and retry records it", async () =>
{
  const harness = CreateManagerHarness();
  await harness.manager.Start(ImplementerStartInput());
  harness.recorder.calls.length = 0;
  harness.runManager.awaitResult = CompletionResult();
  harness.store.markCompletedError = new SddStoreError("disk full");

  await assert.rejects(
    () => harness.manager.Await({
      agent_id: x_AgentId,
      after_sequence: 7,
      deadline_seconds: 7000,
    }),
    (error: unknown) =>
    {
      assert.ok(error instanceof ToolValidationError);
      assert.equal(error.structured.error, "sdd_persistence_failed");
      return true;
    },
  );
  assert.equal(harness.store.completed.length, 0);
  assert.equal(harness.store.openTurns.get(x_AgentId)?.status, "running");
  assert.deepEqual(harness.recorder.Names(), ["awaitRun", "MarkCompleted"]);

  harness.store.markCompletedError = undefined;
  harness.recorder.calls.length = 0;

  const retried = await harness.manager.Await({
    agent_id: x_AgentId,
    after_sequence: 7,
    deadline_seconds: 7000,
  });

  assert.equal(retried.report?.text, x_SanitizedReport);
  assert.equal(retried.sequence, 42);
  assert.deepEqual(harness.store.completed, [
    {
      agentId: x_AgentId,
      turnNumber: 1,
      reportText: x_SanitizedReport,
      completedSequence: 42,
    },
  ]);
});

test("Await deadline and attention do not complete the open turn", async () =>
{
  const harness = CreateManagerHarness();
  await harness.manager.Start(ImplementerStartInput());
  harness.recorder.calls.length = 0;
  harness.runManager.awaitResult = {
    schema_version: 1,
    event: "deadline",
    run_id: x_AgentId,
    sequence: 7,
    phase: "running",
    elapsed_ms: 5,
    reason: "await_deadline",
  };

  const deadline = await harness.manager.Await({
    agent_id: x_AgentId,
    after_sequence: 7,
    deadline_seconds: 7000,
  });
  assert.equal(deadline.event, "deadline");
  assert.equal(harness.store.completed.length, 0);
  assert.equal(harness.store.openTurns.get(x_AgentId)?.status, "running");
  assert.equal(harness.recorder.Names().includes("MarkCompleted"), false);

  harness.runManager.awaitResult = {
    schema_version: 1,
    event: "attention",
    run_id: x_AgentId,
    sequence: 9,
    phase: "running",
    elapsed_ms: 1,
  };
  const attention = await harness.manager.Await({
    agent_id: x_AgentId,
    after_sequence: 7,
    deadline_seconds: 7000,
  });
  assert.equal(attention.event, "attention");
  assert.equal(harness.store.completed.length, 0);
  assert.equal(harness.store.openTurns.get(x_AgentId)?.status, "running");
});

test("Await refuses to bind a stale replayed completion onto a newer running turn", async () =>
{
  const harness = CreateManagerHarness();
  await harness.manager.Start(ImplementerStartInput());
  harness.runManager.awaitResult = CompletionResult({ sequence: 42 });
  await harness.manager.Await({
    agent_id: x_AgentId,
    after_sequence: 7,
    deadline_seconds: 7000,
  });
  assert.deepEqual(harness.store.completed, [
    {
      agentId: x_AgentId,
      turnNumber: 1,
      reportText: x_SanitizedReport,
      completedSequence: 42,
    },
  ]);

  harness.runManager.sequence = 50;
  await harness.manager.Followup({
    kind: "fix",
    agent_id: x_AgentId,
    round: 1,
    findings: x_FindingsPath,
    findings_text: x_FindingsText,
    tests: ["dist/tests/sdd_manager.test.js"],
    report: x_ReportPath,
  });
  assert.equal(harness.store.openTurns.get(x_AgentId)?.status, "running");
  assert.equal(harness.store.openTurns.get(x_AgentId)?.resume_sequence, 50);
  assert.equal(harness.store.openTurns.get(x_AgentId)?.turn_number, 2);

  harness.recorder.calls.length = 0;
  harness.runManager.awaitResult = CompletionResult({
    sequence: 42,
    report: { text: x_SanitizedReport },
  });

  const replayed = await harness.manager.Await({
    agent_id: x_AgentId,
    after_sequence: 7,
    deadline_seconds: 7000,
  });

  assert.equal(replayed.sequence, 42);
  assert.equal(replayed.report?.text, x_SanitizedReport);
  assert.equal(harness.recorder.Names().includes("MarkCompleted"), false);
  assert.equal(harness.store.completed.length, 1);
  assert.equal(harness.store.openTurns.get(x_AgentId)?.status, "running");
  assert.equal(harness.store.openTurns.get(x_AgentId)?.turn_number, 2);
  assert.equal(harness.store.openTurns.get(x_AgentId)?.resume_sequence, 50);
  const turn1 = harness.store.turnsByAgent.get(x_AgentId)?.find((turn) => turn.turn_number === 1);
  assert.equal(turn1?.status, "completed");
  assert.equal(turn1?.report_text, x_SanitizedReport);
  assert.equal(turn1?.completed_sequence, 42);
});

test("Await does not MarkCompleted while the open turn is still prepared", async () =>
{
  const harness = CreateManagerHarness();
  await StartAndClearOpenTurn(harness);
  harness.store.PrepareFollowup({
    agentId: x_AgentId,
    kind: "fix",
    round: 1,
    briefPath: x_BriefPath,
    briefText: x_BriefText,
    reportPath: x_ReportPath,
    findingsPath: x_FindingsPath,
    findingsText: x_FindingsText,
  });
  assert.equal(harness.store.openTurns.get(x_AgentId)?.status, "prepared");

  harness.recorder.calls.length = 0;
  harness.runManager.awaitResult = CompletionResult({ sequence: 42 });

  const result = await harness.manager.Await({
    agent_id: x_AgentId,
    after_sequence: 7,
    deadline_seconds: 7000,
  });

  assert.equal(result.report?.text, x_SanitizedReport);
  assert.equal(harness.recorder.Names().includes("MarkCompleted"), false);
  assert.equal(harness.store.completed.length, 0);
  assert.equal(harness.store.openTurns.get(x_AgentId)?.status, "prepared");
});

test("Await treats an already-recorded identical completed_sequence as success", async () =>
{
  const harness = CreateManagerHarness();
  await harness.manager.Start(ImplementerStartInput());
  harness.runManager.awaitResult = CompletionResult({ sequence: 42 });
  await harness.manager.Await({
    agent_id: x_AgentId,
    after_sequence: 7,
    deadline_seconds: 7000,
  });

  harness.recorder.calls.length = 0;
  harness.runManager.awaitResult = CompletionResult({ sequence: 42 });
  const again = await harness.manager.Await({
    agent_id: x_AgentId,
    after_sequence: 7,
    deadline_seconds: 7000,
  });

  assert.equal(again.report?.text, x_SanitizedReport);
  assert.equal(again.sequence, 42);
  assert.equal(harness.recorder.Names().includes("MarkCompleted"), false);
  assert.equal(harness.store.completed.length, 1);
});

test("AwaitGeneric persists report for SDD-owned runs and leaves non-SDD await unchanged", async () =>
{
  const harness = CreateManagerHarness();
  await harness.manager.Start(ImplementerStartInput());
  harness.recorder.calls.length = 0;
  harness.runManager.awaitResult = CompletionResult();

  const sddResult = await harness.manager.AwaitGeneric({
    run_id: x_AgentId,
    after_sequence: 7,
    deadline_seconds: 7000,
  });
  assert.equal(sddResult.report?.text, x_SanitizedReport);
  assert.deepEqual(harness.store.completed, [
    {
      agentId: x_AgentId,
      turnNumber: 1,
      reportText: x_SanitizedReport,
      completedSequence: 42,
    },
  ]);

  harness.recorder.calls.length = 0;
  harness.runManager.awaitResult = {
    schema_version: 1,
    event: "turn.completed",
    run_id: "xrun_20260727000000000_00nonssd",
    sequence: 3,
    phase: "ready",
    elapsed_ms: 1,
    report: { text: "generic report" },
  };
  const nonSdd = await harness.manager.AwaitGeneric({
    run_id: "xrun_20260727000000000_00nonssd",
    after_sequence: 1,
    deadline_seconds: 7000,
  });
  assert.equal(nonSdd.report?.text, "generic report");
  assert.equal(harness.recorder.Names().includes("MarkCompleted"), false);
  assert.equal(harness.store.completed.length, 1);
});

test("Close closes provider first then MarkClosed; provider failure leaves closed_at unset", async () =>
{
  const harness = CreateManagerHarness();
  await harness.manager.Start(ImplementerStartInput());
  harness.store.openTurns.delete(x_AgentId);
  harness.recorder.calls.length = 0;

  const closed = await harness.manager.Close({ agent_id: x_AgentId });
  assert.deepEqual(closed, { agent_id: x_AgentId, closed: true });
  assert.deepEqual(harness.recorder.Names(), ["closeRun", "MarkClosed"]);
  assert.notEqual(harness.store.sessions.get(x_AgentId)?.closed_at, null);
  assert.equal(harness.store.closed.length, 1);
  assert.equal(harness.runManager.closeRunCalls[0]?.run_id, x_AgentId);

  const failHarness = CreateManagerHarness();
  await failHarness.manager.Start(ImplementerStartInput());
  failHarness.store.openTurns.delete(x_AgentId);
  failHarness.runManager.closeRunError = new Error("provider close failed");
  failHarness.recorder.calls.length = 0;

  await assert.rejects(
    () => failHarness.manager.Close({ agent_id: x_AgentId }),
    /provider close failed/,
  );
  assert.deepEqual(failHarness.recorder.Names(), ["closeRun"]);
  assert.equal(failHarness.store.sessions.get(x_AgentId)?.closed_at, null);
  assert.equal(failHarness.store.closed.length, 0);
});

test("CloseGeneric records ledger close for SDD runs and leaves non-SDD close unchanged", async () =>
{
  const harness = CreateManagerHarness();
  await harness.manager.Start(ImplementerStartInput());
  harness.store.openTurns.delete(x_AgentId);
  harness.recorder.calls.length = 0;

  const sddClosed = await harness.manager.CloseGeneric({ run_id: x_AgentId });
  assert.deepEqual(sddClosed, { run_id: x_AgentId, closed: true });
  assert.deepEqual(harness.recorder.Names(), ["closeRun", "MarkClosed"]);
  assert.ok(harness.store.sessions.get(x_AgentId)?.closed_at);

  harness.recorder.calls.length = 0;
  const nonSdd = await harness.manager.CloseGeneric({
    run_id: "xrun_20260727000000000_00nonssd",
  });
  assert.deepEqual(nonSdd, { run_id: "xrun_20260727000000000_00nonssd", closed: true });
  assert.deepEqual(harness.recorder.Names(), ["closeRun"]);
  assert.equal(harness.store.closed.length, 1);
});

test("ReconcileTerminalRuns abandons only unresolved reportless terminal turns", async () =>
{
  const harness = CreateManagerHarness();
  const abandonedId = x_AgentId;
  const failedId = "xrun_20260727000000000_failed01";
  const liveId = "xrun_20260727000000000_live0001";
  const completedPhaseId = "xrun_20260727000000000_done0001";

  await harness.manager.Start(ImplementerStartInput());

  harness.store.ReserveInitial({
    agentId: failedId,
    planName: "2026-07-26-xagent-sdd-mode",
    planPath: x_PlanPath,
    cwd: x_CanonicalCwd,
    taskNumber: 4,
    agent: "grok-4.5",
    harness: "cursor",
    effort: "high",
    role: "implementer",
    briefPath: x_BriefPath,
    briefText: x_BriefText,
  });
  harness.store.MarkRunning(failedId, 1, 3);

  harness.store.ReserveInitial({
    agentId: liveId,
    planName: "2026-07-26-xagent-sdd-mode",
    planPath: x_PlanPath,
    cwd: x_CanonicalCwd,
    taskNumber: 4,
    agent: "grok-4.5",
    harness: "cursor",
    effort: "high",
    role: "implementer",
    briefPath: x_BriefPath,
    briefText: x_BriefText,
  });
  harness.store.MarkRunning(liveId, 1, 4);

  // A closed-but-completed provider phase must leave a still-running ledger
  // turn open so the normal await path can persist the delivered report.
  //
  harness.store.ReserveInitial({
    agentId: completedPhaseId,
    planName: "2026-07-26-xagent-sdd-mode",
    planPath: x_PlanPath,
    cwd: x_CanonicalCwd,
    taskNumber: 4,
    agent: "grok-4.5",
    harness: "cursor",
    effort: "high",
    role: "implementer",
    briefPath: x_BriefPath,
    briefText: x_BriefText,
    reportPath: x_ReportPath,
  });
  harness.store.MarkRunning(completedPhaseId, 1, 5);

  harness.store.ReconcileTerminalRuns(new Map([
    [abandonedId, "abandoned"],
    [failedId, "failed"],
    [liveId, "running"],
    [completedPhaseId, "completed"],
  ]));

  assert.equal(harness.store.openTurns.has(abandonedId), false);
  assert.equal(harness.store.openTurns.has(failedId), false);
  assert.equal(harness.store.openTurns.get(liveId)?.status, "running");
  assert.equal(harness.store.openTurns.get(completedPhaseId)?.status, "running");

  const abandonedTurn = harness.store.turnsByAgent.get(abandonedId)?.at(-1);
  const failedTurn = harness.store.turnsByAgent.get(failedId)?.at(-1);
  const completedPhaseTurn = harness.store.turnsByAgent.get(completedPhaseId)?.at(-1);
  assert.equal(abandonedTurn?.status, "abandoned");
  assert.equal(failedTurn?.status, "abandoned");
  assert.equal(completedPhaseTurn?.status, "running");
  assert.equal(completedPhaseTurn?.report_text, null);
});

test("Await rejects a delivered report when no open turn can record it", async () =>
{
  const harness = CreateManagerHarness();
  await harness.manager.Start(ImplementerStartInput());
  harness.store.openTurns.delete(x_AgentId);
  harness.recorder.calls.length = 0;
  harness.runManager.awaitResult = CompletionResult({ sequence: 42 });

  await assert.rejects(
    () => harness.manager.Await({
      agent_id: x_AgentId,
      after_sequence: 7,
      deadline_seconds: 7000,
    }),
    (error: unknown) =>
    {
      assert.ok(error instanceof ToolValidationError);
      assert.equal(error.structured.error, "sdd_report_unbound");
      return true;
    },
  );
  assert.equal(harness.recorder.Names().includes("MarkCompleted"), false);
  assert.equal(harness.store.completed.length, 0);
});

test("Followup recovers brief and report paths from the ledger after a service restart", async () =>
{
  const harness = CreateManagerHarness();
  await StartAndClearOpenTurn(harness);

  // A restarted service keeps the durable ledger but loses every in-process
  // artifact cache. Before the ledger fallback this rejected with
  // sdd_followup_missing_paths and stranded a live SDD session.
  const restarted = CreateSddManager({
    store: harness.store,
    runManager: harness.runManager,
    repoRoot: "/tmp/service-repo",
    async canonicalizeCwd(): Promise<string>
    {
      return x_CanonicalCwd;
    },
    async readFile(): Promise<string>
    {
      return x_FindingsText;
    },
  });

  const result = await restarted.Followup({
    kind: "fix",
    agent_id: x_AgentId,
    round: 1,
    findings: x_FindingsPath,
    findings_text: x_FindingsText,
    tests: ["dist/tests/sdd_manager.test.js"],
    report: x_ReportPath,
  });

  assert.equal(result.agent_id, x_AgentId);
  assert.equal(result.turn_number, 2);
  assert.equal(harness.store.prepared.at(-1)?.briefPath, x_BriefPath);
  assert.equal(harness.store.prepared.at(-1)?.reportPath, x_ReportPath);
  assert.ok(harness.runManager.submitted.at(-1)?.text.includes(x_BriefPath));
  assert.ok(harness.runManager.submitted.at(-1)?.text.includes(x_ReportPath));
});

test("MessageGeneric chit-chats with an SDD run instead of rejecting it", async () =>
{
  const harness = CreateManagerHarness();
  await StartAndClearOpenTurn(harness);

  const result = await harness.manager.MessageGeneric({
    run_id: x_AgentId,
    text: "Which marketplace source type should you use?",
  });

  assert.equal(result.run_id, x_AgentId);
  assert.ok(harness.runManager.messageCalls.at(-1)?.text.includes("marketplace source type"));
  assert.equal(harness.store.prepared.length, 0, "chit-chat must not create a work turn");
});

test("a conversational reply returns unpersisted instead of failing to bind", async () =>
{
  const harness = CreateManagerHarness();
  await StartAndClearOpenTurn(harness);
  await harness.manager.MessageGeneric({ run_id: x_AgentId, text: "quick question" });

  harness.runManager.awaitResult = CompletionResult({ sequence: 42 });
  const result = await harness.manager.Await({
    agent_id: x_AgentId,
    after_sequence: 7,
    deadline_seconds: 7000,
  });

  assert.ok(result.report?.text);
  assert.equal(harness.store.completed.length, 0, "a reply is not a work-turn report");
  assert.equal(harness.recorder.Names().includes("MarkCompleted"), false);
});

test("a work turn still refuses a report it cannot record", async () =>
{
  const harness = CreateManagerHarness();
  await harness.manager.Start(ImplementerStartInput());
  harness.store.openTurns.delete(x_AgentId);
  harness.runManager.awaitResult = CompletionResult({ sequence: 42 });

  await assert.rejects(
    () => harness.manager.Await({
      agent_id: x_AgentId,
      after_sequence: 7,
      deadline_seconds: 7000,
    }),
    (error: unknown) =>
    {
      assert.ok(error instanceof ToolValidationError);
      assert.equal(error.structured.error, "sdd_report_unbound");
      return true;
    },
  );
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

test("a controller note is appended to a fix follow-up", async () =>
{
  const note = "Ignore the stray build output in projects/synth; it is not yours.";
  const harness = CreateManagerHarness();
  await StartAndClearOpenTurn(harness);

  await harness.manager.Followup({
    kind: "fix",
    agent_id: x_AgentId,
    round: 1,
    findings: x_FindingsPath,
    findings_text: x_FindingsText,
    tests: ["dist/tests/sdd_manager.test.js"],
    report: x_ReportPath,
    note,
  });

  const submitted = harness.runManager.submitted.at(-1)?.text ?? "";
  assert.ok(submitted.includes(x_FindingsText), "findings must survive");
  assert.ok(submitted.includes("## Controller Note"));
  assert.ok(submitted.includes(note));
});

test("a controller note cannot smuggle a run id to the worker", () =>
{
  const rejected = ImplementerStartSchema.safeParse({
    ...ImplementerStartInput(),
    note: "Resume against xrun_20260727192847117_b30af348 when done.",
  });
  assert.equal(rejected.success, false);
});

test("a raw message is refused while a work turn is still open", async () =>
{
  const harness = CreateManagerHarness();
  await harness.manager.Start(ImplementerStartInput());

  await assert.rejects(
    () => harness.manager.MessageGeneric({ run_id: x_AgentId, text: "status?" }),
    (error: unknown) =>
    {
      assert.ok(error instanceof ToolValidationError);
      assert.equal(error.structured.error, "sdd_turn_in_flight");
      return true;
    },
  );
  assert.equal(harness.runManager.messageCalls.length, 0);
});

test("a failed message does not disarm the report-binding guard", async () =>
{
  const harness = CreateManagerHarness();
  await StartAndClearOpenTurn(harness);
  harness.runManager.messageError = new Error("invalid_phase");

  await assert.rejects(
    () => harness.manager.MessageGeneric({ run_id: x_AgentId, text: "never delivered" }),
  );

  // The session must still refuse to bind an unbindable work-turn report.
  harness.runManager.awaitResult = CompletionResult({ sequence: 42 });
  await assert.rejects(
    () => harness.manager.Await({
      agent_id: x_AgentId,
      after_sequence: 7,
      deadline_seconds: 7000,
    }),
    (error: unknown) =>
    {
      assert.ok(error instanceof ToolValidationError);
      assert.equal(error.structured.error, "sdd_report_unbound");
      return true;
    },
  );
});
