import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

import {
  FormatFixDispatch,
  FormatFixFollowup,
  RenderSddPrompt,
  type FormatFixDispatchInput,
  type FormatFixFollowupInput,
  type RenderedSddPrompt,
  type RenderSddPromptInput,
} from "./sdd_prompt.js";
import type {
  SddAgentRecord,
  SddAgentStore,
  SddStartRole,
} from "./sdd_store.js";
import {
  canonicalizeWorkingDirectory,
  waitForTurnRunning,
  type CreateRunOptions,
  type ListRunsResult,
  type XagentListEntry,
  type XagentListRow,
  type XagentRunManager,
  type XagentSddListFields,
} from "./run_manager.js";
import {
  ToolValidationError,
  type StructuredToolError,
  type XagentListInput,
  type XagentSddFollowupInput,
  type XagentSddStartInput,
} from "./tool_schemas.js";

export type XagentSddStartResult = {
  readonly run_id: string;
  readonly sequence: number;
  readonly brief_path: string;
  readonly report_out_path?: string;
  readonly prompt_path?: string;
  readonly renderer_path?: string;
};

export type XagentSddFollowupResult = {
  readonly run_id: string;
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
  readonly store: SddAgentStore;
  readonly runManager: SddRunManagerPort;
  readonly repoRoot: string;
  readonly canonicalizeCwd?: (cwd: string) => Promise<string>;
  readonly resolveArtifactPath?: (filePath: string) => Promise<string>;
  readonly readFile?: (filePath: string) => Promise<string>;
  readonly renderPrompt?: (input: RenderSddPromptInput) => Promise<RenderedSddPrompt>;
  readonly formatFix?: (input: FormatFixFollowupInput) => string;
  readonly formatFixDispatch?: (input: FormatFixDispatchInput) => string;
};

function DerivePlanName(planPath: string): string
{
  return path.basename(planPath, path.extname(planPath));
}

function SddListFields(agent: SddAgentRecord): XagentSddListFields
{
  return {
    role: agent.role,
    plan: DerivePlanName(agent.plan_path),
    ...(agent.task === null ? {} : { task: agent.task }),
    cwd: agent.cwd,
    brief_path: agent.brief_path,
    dispatched_at: agent.dispatched_at,
  };
}

function EntryOrderKey(entry: XagentListEntry): string
{
  return "run_missing" in entry ? entry.sdd.dispatched_at : entry.created_at;
}

const x_ControllerNoteHeading = "## Controller Note";
const x_TerminalRunPhases = new Set([
  "completed",
  "failed",
  "cancelled",
  "abandoned",
]);

function AppendControllerNote(promptText: string, note: string | undefined): string
{
  if (note === undefined || note.trim() === "")
  {
    return promptText;
  }
  return `${promptText.trimEnd()}\n\n${x_ControllerNoteHeading}\n\n${note.trim()}\n`;
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

// Same realpath basis as canonicalizeWorkingDirectory. report_out need not
// exist yet, so missing paths resolve through the nearest existing ancestor.
//
async function ResolveArtifactPath(filePath: string): Promise<string>
{
  try
  {
    return await realpath(filePath);
  }
  catch
  {
    const segments: string[] = [];
    let current = path.resolve(filePath);
    for (;;)
    {
      const parent = path.dirname(current);
      segments.unshift(path.basename(current));
      if (parent === current)
      {
        return path.resolve(filePath);
      }
      try
      {
        return path.join(await realpath(parent), ...segments);
      }
      catch
      {
        current = parent;
      }
    }
  }
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

function BuildRenderInput(
  input: Exclude<XagentSddStartInput, { role: "fixer" }>,
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
      reportOut: input.report_out,
      ...(input.context === undefined ? {} : { context: input.context }),
    };
  }
  if (input.role === "reviewer")
  {
    // Task presence selects the template: v1's task-reviewer / code-reviewer
    // split collapses into one role here and re-expands at the renderer.
    // Start is callable without the Zod refinement, so enforce the same
    // task/report/description rules here rather than trusting `!`.
    //
    if (input.task === undefined)
    {
      if (input.description === undefined)
      {
        throw StructuredFailure({
          error: "invalid_tool_input",
          message: "reviewer without a task requires description (whole-branch review)",
        });
      }
      return {
        role: "code-reviewer",
        repoRoot,
        cwd,
        plan: input.plan,
        reviewBrief: input.brief,
        description: input.description,
        base: input.base,
        head: input.head,
      };
    }
    if (input.implementer_report === undefined)
    {
      throw StructuredFailure({
        error: "invalid_tool_input",
        message: "reviewer with a task requires implementer_report",
      });
    }
    return {
      role: "task-reviewer",
      repoRoot,
      cwd,
      plan: input.plan,
      task: input.task,
      brief: input.brief,
      implementerReport: input.implementer_report,
      base: input.base,
      head: input.head,
      ...(input.constraints === undefined ? {} : { constraints: input.constraints }),
      ...(input.diff === undefined ? {} : { diff: input.diff }),
    };
  }
  return {
    role: "re-review",
    repoRoot,
    cwd,
    plan: input.plan,
    task: input.task,
    round: input.round,
    brief: input.brief,
    findings: input.findings,
    fixerReport: input.fixer_report,
    base: input.base,
    head: input.head,
    ...(input.diff === undefined ? {} : { diff: input.diff }),
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
  const resolveArtifactPath = deps.resolveArtifactPath ?? ResolveArtifactPath;
  const read = deps.readFile ?? ((filePath: string) => readFile(filePath, "utf8"));
  const renderPrompt = deps.renderPrompt ?? ((input: RenderSddPromptInput) => RenderSddPrompt(input));
  const formatFix = deps.formatFix ?? FormatFixFollowup;
  const formatFixDispatch = deps.formatFixDispatch ?? FormatFixDispatch;

  async function Start(input: XagentSddStartInput): Promise<XagentSddStartResult>
  {
    // xsvc-6: canonicalize and validate before anything is written anywhere.
    //
    const cwd = await canonicalizeCwd(input.cwd);
    const briefText = await ReadRequiredText(read, input.brief, "SDD brief");

    let promptText = "";
    let promptPath = "";
    let rendererPath = "";
    // `fixer` has no dispatch-prompt renderer role; its text is formatted in
    // TypeScript so it stays byte-identical to the same-agent continuation.
    // Narrow on role rather than treating a missing render input as fixer —
    // BuildRenderInput has no exhaustiveness check for a future fifth role.
    //
    if (input.role === "fixer")
    {
      await ReadRequiredText(read, input.findings, "SDD findings");
      promptText = formatFixDispatch({
        planPath: input.plan,
        task: input.task,
        round: input.round,
        briefPath: input.brief,
        findingsPath: input.findings,
        findingsText: input.findings_text,
        tests: input.tests,
        reportPath: input.report_out,
      });
    }
    else
    {
      const rendered = await renderPrompt(BuildRenderInput(input, deps.repoRoot, cwd));
      promptText = rendered.prompt.text;
      promptPath = rendered.metadata.promptPath;
      rendererPath = rendered.metadata.rendererPath;
    }

    const runId = runManager.allocateRunId();

    // The row is written before the run exists. If anything after this throws,
    // the row stands as an immutable dispatch-failure tombstone: v1's
    // MarkFailed has no v2 analogue, because there is no status to write.
    //
    try
    {
      store.Insert({
        agentId: runId,
        planPath: input.plan,
        ...(input.task === undefined ? {} : { task: input.task }),
        role: input.role,
        briefPath: input.brief,
        briefText,
        cwd,
      });
    }
    catch (error)
    {
      if (error instanceof ToolValidationError)
      {
        throw error;
      }
      throw PersistenceFailed("Unable to record the SDD dispatch.", {
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    let created = false;
    try
    {
      await runManager.create({
        runId,
        harness: input.harness,
        mode: "subagent",
        cwd,
        model: input.model,
        thinkingLevel: input.effort,
        ...(input.policy === undefined ? {} : { policy: input.policy }),
      });
      created = true;
      await runManager.start(runId);
      // Snapshot the ready-state cursor before the turn starts so a controller
      // awaiting from the returned sequence observes running through
      // completion, matching startRun / messageRun.
      //
      const inspection = runManager.inspect(runId);
      if (inspection === undefined)
      {
        throw new Error(`SDD run disappeared after start: ${runId}`);
      }
      const startSequence = inspection.sequence;
      // Supervisor.submit resolves at turn completion, not acceptance. Detach
      // it and return once the turn is durably running — same pattern as
      // startRun — so MCP clients are not held past their timeout.
      //
      const submitPromise = runManager.submit(
        runId,
        AppendControllerNote(promptText, input.note),
      );
      void submitPromise.catch(() => {});
      await waitForTurnRunning(runManager, runId, submitPromise);
      const reportOutPath = input.role === "implementer" || input.role === "fixer"
        ? input.report_out
        : undefined;
      const briefPath = await resolveArtifactPath(input.brief);
      const result: {
        run_id: string;
        sequence: number;
        brief_path: string;
        report_out_path?: string;
        prompt_path?: string;
        renderer_path?: string;
      } = {
        run_id: runId,
        sequence: startSequence,
        brief_path: briefPath,
      };
      if (reportOutPath !== undefined)
      {
        result.report_out_path = await resolveArtifactPath(reportOutPath);
      }
      if (promptPath !== "")
      {
        result.prompt_path = promptPath;
        result.renderer_path = rendererPath;
      }
      return result;
    }
    catch (error)
    {
      // Closes only failures that surface before this function returns
      // (create/start/early submit). A submit that fails after return is a
      // durable failed event, as with startRun, and cannot be closed here.
      //
      if (created)
      {
        await runManager.close(runId).catch(() => {});
      }
      throw error;
    }
  }

  async function Followup(input: XagentSddFollowupInput): Promise<XagentSddFollowupResult>
  {
    const agent = store.Get(input.run_id);
    if (agent === undefined)
    {
      throw StructuredFailure({
        error: "unknown_sdd_agent",
        message: `Unknown SDD agent: ${input.run_id}`,
        details: { run_id: input.run_id },
      });
    }
    if (!RoleAllowsFollowup(agent.role, input.kind))
    {
      throw StructuredFailure({
        error: "sdd_followup_role_mismatch",
        message: `Follow-up kind ${input.kind} is not valid for role ${agent.role}.`,
        details: { run_id: input.run_id, role: agent.role, kind: input.kind },
      });
    }
    // Liveness is a run-manager fact, never a ledger fact: v1's
    // sdd_session_terminal asked the ledger whether the agent was usable and
    // got a stale answer. A tracked-but-terminal run is still dead — inspect
    // returns an object for every phase, so phase must be checked here or the
    // controller gets a bare supervisor Error instead of a recovery signpost.
    //
    const inspection = runManager.has(input.run_id)
      ? runManager.inspect(input.run_id)
      : undefined;
    if (
      inspection === undefined
      || x_TerminalRunPhases.has(inspection.phase)
    )
    {
      throw StructuredFailure({
        error: "sdd_agent_not_live",
        message:
          `SDD agent ${input.run_id} is not live; dispatch a fresh `
          + `${RecoveryRoleFor(agent.role)} for the same plan and task.`,
        details: {
          run_id: input.run_id,
          role: agent.role,
          plan: agent.plan_path,
          task: agent.task,
          recovery: { tool: "xagent_sdd_start", role: RecoveryRoleFor(agent.role) },
        },
      });
    }
    // Fail closed: `ready` is the only phase Supervisor.submit accepts, so
    // anything else is refused with a structured error rather than being
    // passed through to become a bare invalidPhase Error. Written as
    // "not ready" rather than an explicit busy set so a future phase cannot
    // fall through both sets and reopen that path.
    //
    if (inspection.phase !== "ready")
    {
      throw StructuredFailure({
        error: "sdd_agent_busy",
        message:
          `SDD agent ${input.run_id} is mid-turn; await its completion `
          + "before submitting another follow-up.",
        details: {
          run_id: input.run_id,
          phase: inspection.phase,
          // xagent_await, not xagent_sdd_await: Task 4 deleted the SDD await
          // facade. Naming a tool the server does not register is the same
          // dead-end this error exists to replace.
          //
          recovery: { tool: "xagent_await" },
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
        reportPath: input.report_out,
      });
    }
    else
    {
      if (agent.task === null)
      {
        throw StructuredFailure({
          error: "sdd_followup_task_required",
          message: "Re-review requires a task-scoped reviewer agent.",
          details: {
            run_id: input.run_id,
            role: agent.role,
            kind: input.kind,
          },
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
        fixerReport: input.fixer_report,
        base: input.base,
        head: input.head,
        ...(input.diff === undefined ? {} : { diff: input.diff }),
      });
      promptText = rendered.prompt.text;
    }

    // Ready-state cursor, captured before submit advances the sequence.
    //
    const startSequence = inspection.sequence;
    const submitPromise = runManager.submit(
      input.run_id,
      AppendControllerNote(promptText, input.note),
    );
    void submitPromise.catch(() => {});
    await waitForTurnRunning(runManager, input.run_id, submitPromise);
    return { run_id: input.run_id, sequence: startSequence };
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
      // Missing-ness is existence of a run record, not membership in the
      // caller's filtered/truncated page — live_only and limit must not mint
      // fabricated tombstones for completed or off-page runs (xsvc-13).
      //
      // One read, not two. listOwnedRuns parses every run's metadata before
      // filtering, so `limit` is only an in-memory slice — the caller's page is
      // derivable from the unfiltered result. Reading twice would repeat a
      // directory-wide scan and open a skew window between the two reads.
      //
      const existing = await runManager.listOwnedRuns({
        live_only: false,
        limit: Number.MAX_SAFE_INTEGER,
      });
      const seen = new Set(existing.runs.map((run) => run.run_id));
      // ListRunsResult is the widened union because this method returns
      // tombstones, but the run manager itself only ever produces real rows.
      // The guard states that rather than asserting it with a cast.
      //
      const realRuns = existing.runs.filter(
        (run): run is XagentListRow => !("run_missing" in run),
      );
      const page = realRuns
        .filter((run) => !input.live_only || run.live)
        .slice(0, input.limit);
      const rows: XagentListEntry[] = page.map((run) =>
      {
        const agent = store.Get(run.run_id);
        if (agent === undefined)
        {
          return run;
        }
        return { ...run, sdd: SddListFields(agent) };
      });
      // A ledger row with no run record is a dispatch that never became a run.
      // It is a parallel shape, not an XagentListRow with fabricated phase,
      // sequence, or liveness fields — there is no run record to read them from.
      //
      for (const agent of store.ListAll())
      {
        if (seen.has(agent.agent_id))
        {
          continue;
        }
        rows.push({
          run_id: agent.agent_id,
          run_missing: true,
          sdd: SddListFields(agent),
        });
      }
      // Equal order keys keep insertion order (reals first, then tombstones).
      //
      rows.sort((left, right) => EntryOrderKey(right).localeCompare(EntryOrderKey(left)));
      return { runs: rows.slice(0, input.limit) };
    },
  };
}

export function AsSddRunManagerPort(runManager: XagentRunManager): SddRunManagerPort
{
  return runManager;
}
