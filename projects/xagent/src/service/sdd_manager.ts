import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  FormatFixFollowup,
  RenderSddPrompt,
  type FormatFixFollowupInput,
  type RenderedSddPrompt,
  type RenderSddPromptInput,
} from "./sdd_prompt.js";
import type {
  PrepareFollowupInput,
  ReserveInitialInput,
  SddRole,
  SddStore,
} from "./sdd_store.js";
import { SddStoreError } from "./sdd_store.js";
import {
  canonicalizeWorkingDirectory,
  type AwaitRunResult,
  type CloseRunResult,
  type CreateRunOptions,
  type MessageRunResult,
  type XagentRunManager,
} from "./run_manager.js";
import {
  ToolValidationError,
  type StructuredToolError,
  type XagentAwaitInput,
  type XagentCloseInput,
  type XagentMessageInput,
  type XagentSddAwaitInput,
  type XagentSddCloseInput,
  type XagentSddFollowupInput,
  type XagentSddStartInput,
} from "./tool_schemas.js";

export type XagentSddStartResult = {
  readonly agent_id: string;
  readonly sequence: number;
  readonly prompt_path: string;
  readonly brief_path: string;
  readonly report_path?: string;
};

export type XagentSddFollowupResult = {
  readonly agent_id: string;
  readonly sequence: number;
  readonly turn_number: number;
};

export type XagentSddAwaitResult = AwaitRunResult;

export type XagentSddCloseResult = {
  readonly agent_id: string;
  readonly closed: true;
};

export type SddRunManagerPort = {
  allocateRunId(): string;
  create(options: CreateRunOptions): Promise<{ readonly runId: string }>;
  start(runId: string): Promise<void>;
  submit(runId: string, text: string): Promise<void>;
  inspect(runId: string): { readonly phase: string; readonly sequence: number } | undefined;
  close(runId: string): Promise<void>;
  has(runId: string): boolean;
  messageRun(input: XagentMessageInput): Promise<MessageRunResult>;
  awaitRun(input: XagentAwaitInput, signal?: AbortSignal): Promise<AwaitRunResult>;
  closeRun(input: XagentCloseInput): Promise<CloseRunResult>;
};

export type SddManager = {
  Start(input: XagentSddStartInput): Promise<XagentSddStartResult>;
  Followup(input: XagentSddFollowupInput): Promise<XagentSddFollowupResult>;
  Await(input: XagentSddAwaitInput, signal?: AbortSignal): Promise<XagentSddAwaitResult>;
  Close(input: XagentSddCloseInput): Promise<XagentSddCloseResult>;
  MessageGeneric(input: XagentMessageInput): Promise<MessageRunResult>;
  AwaitGeneric(input: XagentAwaitInput, signal?: AbortSignal): Promise<AwaitRunResult>;
  CloseGeneric(input: XagentCloseInput): Promise<CloseRunResult>;
};

export type SddManagerDeps = {
  readonly store: SddStore;
  readonly runManager: SddRunManagerPort;
  readonly repoRoot: string;
  readonly canonicalizeCwd?: (cwd: string) => Promise<string>;
  readonly readFile?: (filePath: string) => Promise<string>;
  readonly renderPrompt?: (input: RenderSddPromptInput) => Promise<RenderedSddPrompt>;
  readonly formatFix?: (input: FormatFixFollowupInput) => string;
  readonly clock?: () => Date;
};

type SessionArtifacts = {
  readonly briefPath: string;
  readonly briefText: string;
  readonly reportPath?: string;
};

function DerivePlanName(planPath: string): string
{
  return path.basename(planPath, path.extname(planPath));
}

function StructuredFailure(structured: StructuredToolError): ToolValidationError
{
  return new ToolValidationError(structured);
}

function PersistenceFailed(message: string, details?: unknown): ToolValidationError
{
  return StructuredFailure({
    error: "sdd_persistence_failed",
    message,
    ...(details === undefined ? {} : { details }),
  });
}

function FollowupRequired(runId: string): ToolValidationError
{
  return StructuredFailure({
    error: "sdd_followup_required",
    message: "SDD-owned runs must use xagent_sdd_followup instead of xagent_message.",
    details: {
      run_id: runId,
      tool: "xagent_sdd_followup",
    },
  });
}

function HasDeliveredReport(
  result: AwaitRunResult,
): result is AwaitRunResult & { readonly report: { readonly text: string } }
{
  return result.report !== undefined
    && typeof result.report.text === "string";
}

async function ReadRequiredText(
  read: (filePath: string) => Promise<string>,
  filePath: string,
  label: string,
): Promise<string>
{
  let text = "";
  try
  {
    text = await read(filePath);
  }
  catch
  {
    throw StructuredFailure({
      error: "sdd_artifact_unreadable",
      message: `${label} is unreadable.`,
      details: { path: filePath },
    });
  }
  if (text.trim().length === 0)
  {
    throw StructuredFailure({
      error: "sdd_artifact_empty",
      message: `${label} must be non-empty.`,
      details: { path: filePath },
    });
  }
  return text;
}

function BriefPathForStart(input: XagentSddStartInput): string
{
  if (input.role === "code-reviewer")
  {
    return input.review_brief;
  }
  return input.brief;
}

function ReportPathForStart(input: XagentSddStartInput): string | undefined
{
  if (input.role === "implementer" || input.role === "task-reviewer")
  {
    return input.report;
  }
  return undefined;
}

function BuildRenderInput(
  input: XagentSddStartInput,
  repoRoot: string,
  cwd: string,
): RenderSddPromptInput
{
  if (input.role === "implementer")
  {
    return {
      role: "implementer",
      repoRoot,
      cwd,
      plan: input.plan,
      task: input.task,
      name: input.name,
      brief: input.brief,
      ...(input.report === undefined ? {} : { report: input.report }),
      ...(input.context === undefined ? {} : { context: input.context }),
    };
  }
  if (input.role === "task-reviewer")
  {
    return {
      role: "task-reviewer",
      repoRoot,
      cwd,
      plan: input.plan,
      task: input.task,
      brief: input.brief,
      report: input.report,
      base: input.base,
      head: input.head,
      ...(input.constraints === undefined ? {} : { constraints: input.constraints }),
      ...(input.diff === undefined ? {} : { diff: input.diff }),
    };
  }
  return {
    role: "code-reviewer",
    repoRoot,
    cwd,
    plan: input.plan,
    reviewBrief: input.review_brief,
    description: input.description,
    base: input.base,
    head: input.head,
  };
}

function RoleAllowsFollowup(role: SddRole, kind: "fix" | "re-review"): boolean
{
  if (kind === "fix")
  {
    return role === "implementer";
  }
  return role === "task-reviewer";
}

export function CreateSddManager(deps: SddManagerDeps): SddManager
{
  const store = deps.store;
  const runManager = deps.runManager;
  const canonicalizeCwd = deps.canonicalizeCwd ?? canonicalizeWorkingDirectory;
  const read = deps.readFile ?? ((filePath: string) => readFile(filePath, "utf8"));
  const renderPrompt = deps.renderPrompt ?? ((input: RenderSddPromptInput) => RenderSddPrompt(input));
  const formatFix = deps.formatFix ?? FormatFixFollowup;
  const clock = deps.clock ?? (() => new Date());
  const artifactsByAgent = new Map<string, SessionArtifacts>();

  async function PersistReportBeforeReturn(
    agentId: string,
    result: AwaitRunResult,
  ): Promise<AwaitRunResult>
  {
    if (!HasDeliveredReport(result))
    {
      return result;
    }
    const reportText = result.report.text;

    function AlreadyRecorded(): boolean
    {
      const recorded = store.GetTurnByCompletedSequence(agentId, result.sequence);
      return recorded !== undefined
        && recorded.report_text === reportText;
    }

    if (AlreadyRecorded())
    {
      return result;
    }

    const openTurn = store.GetOpenTurn(agentId);
    if (openTurn === undefined)
    {
      throw StructuredFailure({
        error: "sdd_report_unbound",
        message: "Delivered SDD report has no matching open turn to record.",
        details: {
          agent_id: agentId,
          sequence: result.sequence,
        },
      });
    }
    if (
      openTurn.status !== "running"
      || openTurn.resume_sequence === null
      || result.sequence <= openTurn.resume_sequence
    )
    {
      return result;
    }

    try
    {
      store.MarkCompleted(agentId, openTurn.turn_number, reportText, result.sequence);
    }
    catch (error)
    {
      if (AlreadyRecorded())
      {
        return result;
      }
      if (error instanceof ToolValidationError)
      {
        throw error;
      }
      throw PersistenceFailed("Unable to persist SDD turn report before return.", {
        cause: error instanceof Error ? error.message : String(error),
        agent_id: agentId,
        sequence: result.sequence,
      });
    }
    return result;
  }

  async function CloseAfterProvider(agentId: string): Promise<CloseRunResult>
  {
    const closed = await runManager.closeRun({ run_id: agentId });
    try
    {
      store.MarkClosed(agentId, clock().toISOString());
    }
    catch (error)
    {
      if (error instanceof ToolValidationError)
      {
        throw error;
      }
      throw PersistenceFailed("Unable to record SDD session close after provider close.", {
        cause: error instanceof Error ? error.message : String(error),
        agent_id: agentId,
      });
    }
    return closed;
  }

  async function Start(input: XagentSddStartInput): Promise<XagentSddStartResult>
  {
    const cwd = await canonicalizeCwd(input.cwd);
    const briefPath = BriefPathForStart(input);
    const briefText = await ReadRequiredText(read, briefPath, "SDD brief");
    const rendered = await renderPrompt(BuildRenderInput(input, deps.repoRoot, cwd));
    const agentId = runManager.allocateRunId();
    const reportPath = ReportPathForStart(input);
    const reserveInput: ReserveInitialInput = {
      agentId,
      planName: DerivePlanName(input.plan),
      planPath: input.plan,
      cwd,
      ...(input.role === "code-reviewer" ? {} : { taskNumber: input.task }),
      agent: input.agent,
      harness: input.harness,
      effort: input.effort,
      role: input.role,
      briefPath,
      briefText,
      ...(reportPath === undefined ? {} : { reportPath }),
    };

    try
    {
      store.ReserveInitial(reserveInput);
    }
    catch (error)
    {
      if (error instanceof ToolValidationError)
      {
        throw error;
      }
      throw PersistenceFailed("Unable to reserve SDD session.", {
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    artifactsByAgent.set(agentId, {
      briefPath,
      briefText,
      ...(reportPath === undefined ? {} : { reportPath }),
    });

    let created = false;
    try
    {
      await runManager.create({
        runId: agentId,
        harness: input.harness,
        mode: "subagent",
        cwd,
        model: input.agent,
        thinkingLevel: input.effort,
        ...(input.policy === undefined ? {} : { policy: input.policy }),
      });
      created = true;
      await runManager.start(agentId);
      const inspection = runManager.inspect(agentId);
      if (inspection === undefined)
      {
        throw new Error(`SDD run disappeared after start: ${agentId}`);
      }
      const resumeSequence = inspection.sequence;
      await runManager.submit(agentId, rendered.prompt.text);
      store.MarkRunning(agentId, 1, resumeSequence);
      return {
        agent_id: agentId,
        sequence: resumeSequence,
        prompt_path: rendered.metadata.promptPath,
        brief_path: briefPath,
        ...(reportPath === undefined ? {} : { report_path: reportPath }),
      };
    }
    catch (error)
    {
      try
      {
        store.MarkFailed(agentId, 1);
      }
      catch
      {
        // Best-effort failure transition after provider errors.
        //
      }
      if (created)
      {
        await runManager.close(agentId).catch(() => {});
      }
      throw error;
    }
  }

  async function Followup(input: XagentSddFollowupInput): Promise<XagentSddFollowupResult>
  {
    const session = store.GetSession(input.agent_id);
    if (session === undefined)
    {
      throw StructuredFailure({
        error: "unknown_sdd_agent",
        message: `Unknown SDD agent: ${input.agent_id}`,
        details: { agent_id: input.agent_id },
      });
    }
    if (session.closed_at !== null)
    {
      throw StructuredFailure({
        error: "sdd_session_closed",
        message: `SDD session is closed: ${input.agent_id}`,
        details: { agent_id: input.agent_id },
      });
    }
    if (!RoleAllowsFollowup(session.role, input.kind))
    {
      throw StructuredFailure({
        error: "sdd_followup_role_mismatch",
        message: `Follow-up kind ${input.kind} is not valid for role ${session.role}.`,
        details: {
          agent_id: input.agent_id,
          role: session.role,
          kind: input.kind,
        },
      });
    }
    if (store.GetOpenTurn(input.agent_id) !== undefined)
    {
      throw StructuredFailure({
        error: "sdd_turn_unresolved",
        message: `SDD session has an unresolved turn: ${input.agent_id}`,
        details: { agent_id: input.agent_id },
      });
    }
    if (!runManager.has(input.agent_id))
    {
      throw StructuredFailure({
        error: "sdd_session_terminal",
        message: `SDD provider session is not available: ${input.agent_id}`,
        details: { agent_id: input.agent_id },
      });
    }

    // The in-process map is a cache, not the source of truth: the ledger
    // already persists brief_path/brief_text/report_path for every turn.
    // Recovering from it means a service restart no longer turns every live
    // SDD session into `sdd_followup_missing_paths`.
    //
    let artifacts = artifactsByAgent.get(input.agent_id);
    if (artifacts === undefined)
    {
      const latest = store.GetLatestTurn(input.agent_id);
      if (latest !== undefined)
      {
        artifacts = {
          briefPath: latest.brief_path,
          briefText: latest.brief_text,
          ...(latest.report_path === null ? {} : { reportPath: latest.report_path }),
        };
        artifactsByAgent.set(input.agent_id, artifacts);
      }
    }
    if (artifacts === undefined)
    {
      throw StructuredFailure({
        error: "sdd_followup_missing_paths",
        message: `Unable to recover stored brief/report paths for ${input.agent_id}.`,
        details: { agent_id: input.agent_id },
      });
    }

    let promptText = "";
    let prepareInput: PrepareFollowupInput;

    if (input.kind === "fix")
    {
      if (artifacts.reportPath === undefined)
      {
        throw StructuredFailure({
          error: "sdd_report_path_required",
          message: "Fix follow-up requires a stored report path from the initial implementer turn.",
          details: {
            agent_id: input.agent_id,
            brief_path: artifacts.briefPath,
          },
        });
      }
      await ReadRequiredText(read, input.findings, "SDD findings");
      const reportPath = artifacts.reportPath;
      promptText = formatFix({
        round: input.round,
        briefPath: artifacts.briefPath,
        findingsPath: input.findings,
        findingsText: input.findings_text,
        tests: input.tests,
        reportPath,
      });
      prepareInput = {
        agentId: input.agent_id,
        kind: "fix",
        round: input.round,
        briefPath: artifacts.briefPath,
        briefText: artifacts.briefText,
        reportPath: artifacts.reportPath,
        findingsPath: input.findings,
        findingsText: input.findings_text,
      };
    }
    else
    {
      if (session.task_number === null)
      {
        throw StructuredFailure({
          error: "sdd_followup_role_mismatch",
          message: "Re-review requires a task-scoped reviewer session.",
          details: { agent_id: input.agent_id, role: session.role },
        });
      }
      if (artifacts.reportPath === undefined)
      {
        throw StructuredFailure({
          error: "sdd_report_path_required",
          message: "Re-review requires a stored report path from the initial reviewer turn.",
          details: {
            agent_id: input.agent_id,
            brief_path: artifacts.briefPath,
          },
        });
      }
      const reportPath = artifacts.reportPath;
      const findingsText = await ReadRequiredText(read, input.findings, "SDD findings");
      const rendered = await renderPrompt({
        role: "re-review",
        repoRoot: deps.repoRoot,
        cwd: session.cwd,
        plan: session.plan_path,
        task: session.task_number,
        round: input.round,
        brief: artifacts.briefPath,
        findings: input.findings,
        report: reportPath,
        base: input.base,
        head: input.head,
        ...(input.diff === undefined ? {} : { diff: input.diff }),
      });
      promptText = rendered.prompt.text;
      prepareInput = {
        agentId: input.agent_id,
        kind: "re_review",
        round: input.round,
        briefPath: artifacts.briefPath,
        briefText: artifacts.briefText,
        reportPath: artifacts.reportPath,
        findingsPath: input.findings,
        findingsText,
      };
    }

    let turnNumber = 0;
    try
    {
      turnNumber = store.PrepareFollowup(prepareInput);
    }
    catch (error)
    {
      if (error instanceof ToolValidationError)
      {
        throw error;
      }
      if (error instanceof SddStoreError && error.code === "open_turn")
      {
        throw StructuredFailure({
          error: "sdd_turn_unresolved",
          message: `SDD session has an unresolved turn: ${input.agent_id}`,
          details: { agent_id: input.agent_id },
        });
      }
      const message = error instanceof Error ? error.message : String(error);
      throw PersistenceFailed("Unable to prepare SDD follow-up turn.", {
        cause: message,
      });
    }

    const inspection = runManager.inspect(input.agent_id);
    if (inspection === undefined)
    {
      store.MarkFailed(input.agent_id, turnNumber);
      throw StructuredFailure({
        error: "sdd_session_terminal",
        message: `SDD provider session is not available: ${input.agent_id}`,
        details: { agent_id: input.agent_id },
      });
    }
    const resumeSequence = inspection.sequence;

    try
    {
      await runManager.submit(input.agent_id, promptText);
      store.MarkRunning(input.agent_id, turnNumber, resumeSequence);
      return {
        agent_id: input.agent_id,
        sequence: resumeSequence,
        turn_number: turnNumber,
      };
    }
    catch (error)
    {
      try
      {
        store.MarkFailed(input.agent_id, turnNumber);
      }
      catch
      {
        // Best-effort failure transition after submit errors.
        //
      }
      throw error;
    }
  }

  async function Await(
    input: XagentSddAwaitInput,
    signal?: AbortSignal,
  ): Promise<XagentSddAwaitResult>
  {
    const result = await runManager.awaitRun(
      {
        run_id: input.agent_id,
        after_sequence: input.after_sequence,
        deadline_seconds: input.deadline_seconds,
      },
      signal,
    );
    return PersistReportBeforeReturn(input.agent_id, result);
  }

  async function Close(input: XagentSddCloseInput): Promise<XagentSddCloseResult>
  {
    if (!store.IsSddAgent(input.agent_id))
    {
      throw StructuredFailure({
        error: "unknown_sdd_agent",
        message: `Unknown SDD agent: ${input.agent_id}`,
        details: { agent_id: input.agent_id },
      });
    }
    await CloseAfterProvider(input.agent_id);
    return {
      agent_id: input.agent_id,
      closed: true,
    };
  }

  return {
    Start,
    Followup,
    Await,
    Close,
    async MessageGeneric(input: XagentMessageInput): Promise<MessageRunResult>
    {
      if (store.IsSddAgent(input.run_id))
      {
        throw FollowupRequired(input.run_id);
      }
      return runManager.messageRun(input);
    },
    async AwaitGeneric(input: XagentAwaitInput, signal?: AbortSignal): Promise<AwaitRunResult>
    {
      const result = await runManager.awaitRun(input, signal);
      if (!store.IsSddAgent(input.run_id))
      {
        return result;
      }
      return PersistReportBeforeReturn(input.run_id, result);
    },
    async CloseGeneric(input: XagentCloseInput): Promise<CloseRunResult>
    {
      if (!store.IsSddAgent(input.run_id))
      {
        return runManager.closeRun(input);
      }
      return CloseAfterProvider(input.run_id);
    },
  };
}

export function AsSddRunManagerPort(runManager: XagentRunManager): SddRunManagerPort
{
  return runManager;
}
