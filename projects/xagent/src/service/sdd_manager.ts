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
  ReserveInitialInput,
  SddAgentStore,
  SddStartRole,
  SddStore,
} from "./sdd_store.js";
import {
  canonicalizeWorkingDirectory,
  type CreateRunOptions,
  type ListRunsResult,
  type XagentRunManager,
} from "./run_manager.js";
import {
  ToolValidationError,
  type StructuredToolError,
  type XagentListInput,
  type XagentSddFollowupInput,
  type XagentSddStartInput,
} from "./tool_schemas.js";

export type XagentSddStartResult = {
  readonly agent_id: string;
  readonly sequence: number;
  readonly prompt_path: string;
  readonly renderer_path: string;
  readonly brief_path: string;
  readonly report_path?: string;
};

export type XagentSddFollowupResult = {
  readonly agent_id: string;
  readonly sequence: number;
};

export type SddRunManagerPort = {
  allocateRunId(): string;
  create(options: CreateRunOptions): Promise<{ readonly runId: string }>;
  start(runId: string): Promise<void>;
  submit(runId: string, text: string): Promise<void>;
  inspect(runId: string): { readonly phase: string; readonly sequence: number } | undefined;
  close(runId: string): Promise<void>;
  has(runId: string): boolean;
  listOwnedRuns(input: XagentListInput): Promise<ListRunsResult>;
};

export type SddManager = {
  Start(input: XagentSddStartInput): Promise<XagentSddStartResult>;
  Followup(input: XagentSddFollowupInput): Promise<XagentSddFollowupResult>;
  ListGeneric(input: XagentListInput): Promise<ListRunsResult>;
};

export type SddManagerDeps = {
  // TRANSITIONAL: Start still writes v1 turn rows until the Start rewrite lands.
  // This narrows to plain SddAgentStore in that task. MarkFailed is included
  // because Start's failure path still calls it; the plan Pick list omitted it.
  //
  readonly store: SddAgentStore & Pick<
    SddStore,
    "MarkRunning" | "ReserveInitial" | "GetSession" | "MarkFailed"
  >;
  readonly runManager: SddRunManagerPort;
  readonly repoRoot: string;
  readonly canonicalizeCwd?: (cwd: string) => Promise<string>;
  readonly readFile?: (filePath: string) => Promise<string>;
  readonly renderPrompt?: (input: RenderSddPromptInput) => Promise<RenderedSddPrompt>;
  readonly formatFix?: (input: FormatFixFollowupInput) => string;
};

const x_ControllerNoteHeading = "## Controller Note";

function AppendControllerNote(promptText: string, note: string | undefined): string
{
  if (note === undefined || note.trim() === "")
  {
    return promptText;
  }
  return `${promptText.trimEnd()}\n\n${x_ControllerNoteHeading}\n\n${note.trim()}\n`;
}

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

function RoleAllowsFollowup(role: SddStartRole, kind: "fix" | "re-review"): boolean
{
  if (kind === "fix")
  {
    return role === "implementer" || role === "fixer";
  }
  return role === "reviewer" || role === "re-reviewer";
}

function RecoveryRoleFor(role: SddStartRole): "fixer" | "re-reviewer"
{
  return role === "implementer" || role === "fixer" ? "fixer" : "re-reviewer";
}

export function CreateSddManager(deps: SddManagerDeps): SddManager
{
  const store = deps.store;
  const runManager = deps.runManager;
  const canonicalizeCwd = deps.canonicalizeCwd ?? canonicalizeWorkingDirectory;
  const read = deps.readFile ?? ((filePath: string) => readFile(filePath, "utf8"));
  const renderPrompt = deps.renderPrompt ?? ((input: RenderSddPromptInput) => RenderSddPrompt(input));
  const formatFix = deps.formatFix ?? FormatFixFollowup;

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
      await runManager.submit(
        agentId,
        AppendControllerNote(rendered.prompt.text, input.note),
      );
      store.MarkRunning(agentId, 1, resumeSequence);
      return {
        agent_id: agentId,
        sequence: resumeSequence,
        prompt_path: rendered.metadata.promptPath,
        // Surfaced so a controller working in a worktree can see that the
        // prompt was rendered by the service checkout's renderer, not the
        // branch's.
        //
        renderer_path: rendered.metadata.rendererPath,
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
    const agent = store.Get(input.agent_id);
    if (agent === undefined)
    {
      throw StructuredFailure({
        error: "unknown_sdd_agent",
        message: `Unknown SDD agent: ${input.agent_id}`,
        details: { agent_id: input.agent_id },
      });
    }
    if (!RoleAllowsFollowup(agent.role, input.kind))
    {
      throw StructuredFailure({
        error: "sdd_followup_role_mismatch",
        message: `Follow-up kind ${input.kind} is not valid for role ${agent.role}.`,
        details: { agent_id: input.agent_id, role: agent.role, kind: input.kind },
      });
    }
    // Liveness is a run-manager fact, never a ledger fact: v1's
    // sdd_session_terminal asked the ledger whether the agent was usable and
    // got a stale answer. The dead end is now a signpost at the recovery path.
    //
    const inspection = runManager.has(input.agent_id)
      ? runManager.inspect(input.agent_id)
      : undefined;
    if (inspection === undefined)
    {
      throw StructuredFailure({
        error: "sdd_agent_not_live",
        message:
          `SDD agent ${input.agent_id} is not live; dispatch a fresh `
          + `${RecoveryRoleFor(agent.role)} for the same plan and task.`,
        details: {
          agent_id: input.agent_id,
          role: agent.role,
          plan_path: agent.plan_path,
          task: agent.task,
          recovery: { tool: "xagent_sdd_start", role: RecoveryRoleFor(agent.role) },
        },
      });
    }

    let promptText = "";
    if (input.kind === "fix")
    {
      await ReadRequiredText(read, input.findings, "SDD findings");
      promptText = formatFix({
        round: input.round,
        briefPath: agent.brief_path,
        findingsPath: input.findings,
        findingsText: input.findings_text,
        tests: input.tests,
        reportPath: input.report,
      });
    }
    else
    {
      if (agent.task === null)
      {
        throw StructuredFailure({
          error: "sdd_followup_role_mismatch",
          message: "Re-review requires a task-scoped reviewer agent.",
          details: { agent_id: input.agent_id, role: agent.role },
        });
      }
      await ReadRequiredText(read, input.findings, "SDD findings");
      const rendered = await renderPrompt({
        role: "re-review",
        repoRoot: deps.repoRoot,
        cwd: agent.cwd,
        plan: agent.plan_path,
        task: agent.task,
        round: input.round,
        brief: agent.brief_path,
        findings: input.findings,
        report: input.report,
        base: input.base,
        head: input.head,
        ...(input.diff === undefined ? {} : { diff: input.diff }),
      });
      promptText = rendered.prompt.text;
    }

    const sequence = inspection.sequence;
    await runManager.submit(
      input.agent_id,
      AppendControllerNote(promptText, input.note),
    );
    return { agent_id: input.agent_id, sequence };
  }

  return {
    Start,
    Followup,
    // Bare run ids are not enough to recover from a lost start response: the
    // incident's controller would have seen several live `cursor` rows and
    // still not known which was the Task 4 implementer. Join the SDD ledger so
    // a row identifies itself.
    //
    async ListGeneric(input: XagentListInput): Promise<ListRunsResult>
    {
      const listed = await runManager.listOwnedRuns(input);
      const runs = listed.runs.map((run) =>
      {
        const session = store.GetSession(run.run_id);
        if (session === undefined)
        {
          return run;
        }
        return {
          ...run,
          sdd: {
            role: session.role,
            plan: session.plan_name,
            cwd: session.cwd,
            agent: session.agent,
            closed: session.closed_at !== null,
            ...(session.task_number === null ? {} : { task: session.task_number }),
          },
        };
      });
      return { runs };
    },
  };
}

export function AsSddRunManagerPort(runManager: XagentRunManager): SddRunManagerPort
{
  return runManager;
}
