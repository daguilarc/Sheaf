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
  type SddAgentStore,
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

function CreateFakeAgentStore(
  recorder: ReturnType<typeof CreateOrderRecorder>,
  record: SddAgentRecord | undefined,
): SddAgentStore & Pick<SddStore, "GetSession"> & {
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
    GetSession(_agentId: string): SddSessionRecord | undefined
    {
      throw new Error("CreateFakeAgentStore.GetSession is not used by current manager tests");
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

test("ReconcileTerminalRuns abandons only unresolved reportless terminal turns", () =>
{
  // Manager Start no longer writes v1 turns; seed the fake v1 store directly.
  //
  const recorder = CreateOrderRecorder();
  const store = CreateFakeStore(recorder);
  const abandonedId = x_AgentId;
  const failedId = "xrun_20260727000000000_failed01";
  const liveId = "xrun_20260727000000000_live0001";
  const completedPhaseId = "xrun_20260727000000000_done0001";

  store.ReserveInitial({
    agentId: abandonedId,
    planName: "2026-07-26-xagent-sdd-mode",
    planPath: x_PlanPath,
    cwd: x_CanonicalCwd,
    taskNumber: 3,
    agent: "grok-4.5",
    harness: "cursor",
    effort: "high",
    role: "implementer",
    briefPath: x_BriefPath,
    briefText: x_BriefText,
  });
  store.MarkRunning(abandonedId, 1, 7);

  store.ReserveInitial({
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
  store.MarkRunning(failedId, 1, 3);

  store.ReserveInitial({
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
  store.MarkRunning(liveId, 1, 4);

  // A closed-but-completed provider phase must leave a still-running ledger
  // turn open so the normal await path can persist the delivered report.
  //
  store.ReserveInitial({
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
  store.MarkRunning(completedPhaseId, 1, 5);

  store.ReconcileTerminalRuns(new Map([
    [abandonedId, "abandoned"],
    [failedId, "failed"],
    [liveId, "running"],
    [completedPhaseId, "completed"],
  ]));

  assert.equal(store.openTurns.has(abandonedId), false);
  assert.equal(store.openTurns.has(failedId), false);
  assert.equal(store.openTurns.get(liveId)?.status, "running");
  assert.equal(store.openTurns.get(completedPhaseId)?.status, "running");

  const abandonedTurn = store.turnsByAgent.get(abandonedId)?.at(-1);
  const failedTurn = store.turnsByAgent.get(failedId)?.at(-1);
  const completedPhaseTurn = store.turnsByAgent.get(completedPhaseId)?.at(-1);
  assert.equal(abandonedTurn?.status, "abandoned");
  assert.equal(failedTurn?.status, "abandoned");
  assert.equal(completedPhaseTurn?.status, "running");
  assert.equal(completedPhaseTurn?.report_text, null);
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
