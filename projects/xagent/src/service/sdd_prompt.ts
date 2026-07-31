import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  ResolveFaultProvenance,
  SurfaceFieldFor,
} from "./dispatch_manifest.js";

const execFileAsync = promisify(execFile);

export type SddPromptFailure = {
  readonly error: string;
  readonly message: string;
  readonly details?: unknown;
};

export class SddPromptError extends Error {
  readonly structured: SddPromptFailure;
  readonly error: string;
  readonly details?: unknown;

  constructor(structured: SddPromptFailure) {
    super(structured.message);
    this.name = "SddPromptError";
    this.structured = structured;
    this.error = structured.error;
    if (structured.details !== undefined) {
      this.details = structured.details;
    }
  }
}

export type RenderSddPromptInput =
  | {
      readonly role: "implementer";
      readonly repoRoot: string;
      readonly cwd: string;
      readonly plan: string;
      readonly task: number;
      readonly name: string;
      readonly brief: string;
      readonly reportOut?: string;
      readonly context?: string;
      readonly templatesRoot?: string;
    }
  | {
      readonly role: "task-reviewer";
      readonly repoRoot: string;
      readonly cwd: string;
      readonly plan: string;
      readonly task: number;
      readonly brief: string;
      readonly implementerReport: string;
      readonly base: string;
      readonly head: string;
      readonly constraints?: string;
      readonly diff?: string;
      readonly templatesRoot?: string;
    }
  | {
      readonly role: "re-review";
      readonly repoRoot: string;
      readonly cwd: string;
      readonly plan: string;
      readonly task: number;
      readonly round: number;
      readonly brief: string;
      readonly findings: string;
      readonly fixerReport: string;
      readonly base: string;
      readonly head: string;
      readonly diff?: string;
      readonly templatesRoot?: string;
      // Distinguishes a fresh re-reviewer start from a follow-up continuation
      // so trailer classification can apply ledger provenance (xsvc-18).
      //
      readonly dispatchVariant?: "re-reviewer" | "followup:re-review";
      readonly runId?: string;
    }
  | {
      readonly role: "code-reviewer";
      readonly repoRoot: string;
      readonly cwd: string;
      readonly plan: string;
      readonly reviewBrief: string;
      readonly description: string;
      readonly base: string;
      readonly head: string;
      readonly templatesRoot?: string;
    };

export type RenderedSddPromptMetadata = {
  readonly promptPath: string;
  readonly rendererPath: string;
  readonly briefPath?: string;
  readonly reportPath?: string;
  readonly findingsPath?: string;
};

export type RenderedSddPrompt = {
  readonly prompt: {
    readonly path: string;
    readonly text: string;
  };
  readonly metadata: RenderedSddPromptMetadata;
};

export type FormatFixFollowupInput = {
  readonly round: number;
  readonly briefPath: string;
  readonly findingsPath: string;
  readonly findingsText: string;
  readonly tests: readonly string[];
  readonly reportPath: string;
};

export type SddPromptRuntime = {
  readonly pythonExecutable?: string;
  readonly execFile?: (
    file: string,
    args: readonly string[],
    options: { cwd: string; maxBuffer: number },
  ) => Promise<{ stdout: string; stderr: string }>;
  readonly readFile?: (filePath: string) => Promise<string>;
  readonly access?: (filePath: string) => Promise<void>;
};

const x_TrustedRendererRelativePath = path.join("projects", "agents", "utils", "dispatch-prompt");

function TrustedRendererPath(repoRoot: string): string {
  return path.join(repoRoot, x_TrustedRendererRelativePath);
}

// The renderer is resolved from the service checkout ONLY. The run cwd is a
// worker-writable worktree, so a `projects/agents/utils/dispatch-prompt` found
// there is attacker-controlled code, not a newer renderer — see the sentinel
// script in tests/sdd_prompt.test.ts. Working in a worktree therefore renders
// with the service checkout's renderer and templates even when the branch
// carries its own; that mismatch is reported rather than fixed here, because
// closing it means deciding how a worktree renderer could ever be trusted.
//
async function ResolveRendererPath(
  input: RenderSddPromptInput,
  checkAccess: (filePath: string) => Promise<void>,
): Promise<string> {
  const rendererPath = TrustedRendererPath(input.repoRoot);
  try {
    await checkAccess(rendererPath);
  }
  catch {
    throw new SddPromptError({
      error: "sdd_renderer_missing",
      message: "Trusted dispatch-prompt renderer is unavailable.",
      details: { searched: [rendererPath] },
    });
  }
  return rendererPath;
}

function DispatchVariantFor(input: RenderSddPromptInput): string {
  switch (input.role) {
    case "implementer":
      return "implementer";
    case "task-reviewer":
      return "reviewer:task";
    case "code-reviewer":
      return "reviewer:branch";
    case "re-review":
      return input.dispatchVariant ?? "re-reviewer";
  }
}

function BuildDispatchArgs(input: RenderSddPromptInput): {
  readonly args: string[];
  readonly suppliedOptions: Set<string>;
} {
  const args = [input.role, "--plan", input.plan];
  const suppliedOptions = new Set<string>(["--plan"]);
  if (input.templatesRoot !== undefined) {
    args.push("--templates-root", input.templatesRoot);
  }

  switch (input.role) {
    case "implementer":
      args.push("--task", String(input.task));
      suppliedOptions.add("--task");
      args.push("--name", input.name);
      suppliedOptions.add("--name");
      args.push("--brief", input.brief);
      suppliedOptions.add("--brief");
      if (input.reportOut !== undefined) {
        args.push("--report", input.reportOut);
        suppliedOptions.add("--report");
      }
      if (input.context !== undefined) {
        args.push("--context", input.context);
        suppliedOptions.add("--context");
      }
      return { args, suppliedOptions };
    case "task-reviewer":
      args.push("--task", String(input.task));
      suppliedOptions.add("--task");
      args.push("--brief", input.brief);
      suppliedOptions.add("--brief");
      args.push("--report", input.implementerReport);
      suppliedOptions.add("--report");
      args.push("--base", input.base);
      suppliedOptions.add("--base");
      args.push("--head", input.head);
      suppliedOptions.add("--head");
      if (input.constraints !== undefined) {
        args.push("--constraints", input.constraints);
        suppliedOptions.add("--constraints");
      }
      if (input.diff !== undefined) {
        args.push("--diff", input.diff);
        suppliedOptions.add("--diff");
      }
      return { args, suppliedOptions };
    case "re-review":
      args.push("--task", String(input.task));
      suppliedOptions.add("--task");
      args.push("--round", String(input.round));
      suppliedOptions.add("--round");
      args.push("--brief", input.brief);
      suppliedOptions.add("--brief");
      args.push("--findings", input.findings);
      suppliedOptions.add("--findings");
      args.push("--report", input.fixerReport);
      suppliedOptions.add("--report");
      args.push("--base", input.base);
      suppliedOptions.add("--base");
      args.push("--head", input.head);
      suppliedOptions.add("--head");
      if (input.diff !== undefined) {
        args.push("--diff", input.diff);
        suppliedOptions.add("--diff");
      }
      // Follow-up re-review sources plan/task/brief from the ledger row.
      //
      if (input.dispatchVariant === "followup:re-review") {
        suppliedOptions.delete("--plan");
        suppliedOptions.delete("--task");
        suppliedOptions.delete("--brief");
      }
      return { args, suppliedOptions };
    case "code-reviewer":
      args.push("--description", input.description);
      suppliedOptions.add("--description");
      args.push("--requirements", `@${input.reviewBrief}`);
      suppliedOptions.add("--requirements");
      args.push("--base", input.base);
      suppliedOptions.add("--base");
      args.push("--head", input.head);
      suppliedOptions.add("--head");
      return { args, suppliedOptions };
  }
}

const x_RendererFaultCodes = new Set([
  "no_such_file",
  "empty_file",
  "parent_missing",
  "not_accepted",
  "required_missing",
]);

const x_PathFaults = new Set(["no_such_file", "empty_file", "parent_missing"]);

function LedgerArtifactFor(option: string): "plan" | "brief" | null {
  if (option === "--plan") {
    return "plan";
  }
  if (option === "--brief") {
    return "brief";
  }
  return null;
}

function ClassifyRendererFault(
  stderr: string,
  input: RenderSddPromptInput,
  suppliedOptions: ReadonlySet<string>,
): SddPromptError | null {
  const lines = stderr.split(/\r?\n/).filter((line) => line.trim() !== "");
  const last = lines.at(-1);
  if (last === undefined) {
    return null;
  }
  let body: { error?: string; option?: string; path?: string };
  try {
    body = JSON.parse(last) as { error?: string; option?: string; path?: string };
  }
  catch {
    return null;
  }
  if (body.error === undefined || !x_RendererFaultCodes.has(body.error)) {
    return null;
  }
  const option = body.option ?? "";
  const variant = DispatchVariantFor(input);
  const provenance = ResolveFaultProvenance(variant, option, suppliedOptions);
  if (provenance === null) {
    return null;
  }
  if (provenance === "derived") {
    return null;
  }
  if (provenance === "ledger") {
    if (input.role !== "re-review" || input.runId === undefined) {
      return null;
    }
    const artifact = LedgerArtifactFor(option);
    if (artifact === null) {
      return null;
    }
    return new SddPromptError({
      error: "sdd_stored_artifact_missing",
      message: "A stored SDD artifact required for this follow-up is missing.",
      details: {
        run_id: input.runId,
        artifact,
        path: body.path ?? (artifact === "plan" ? input.plan : input.brief),
        plan: input.plan,
        task: input.task,
        recovery: { tool: "xagent_sdd_start", role: "re-reviewer" },
      },
    });
  }
  // The renderer only knows --report; the caller sent implementer_report.
  // A null field means an option the facade never sends — stay opaque rather
  // than leak renderer vocabulary (xsvc-18).
  //
  const field = SurfaceFieldFor(variant, option);
  if (field === null) {
    return null;
  }
  return new SddPromptError({
    error: "sdd_renderer_bad_input",
    message: "dispatch-prompt rejected an input argument.",
    details: x_PathFaults.has(body.error) && body.path !== undefined
      ? { reason: body.error, field, path: body.path }
      : { reason: body.error, field },
  });
}

function ResolveBriefPath(input: RenderSddPromptInput): string | undefined {
  switch (input.role) {
    case "implementer":
    case "task-reviewer":
    case "re-review":
      return input.brief;
    case "code-reviewer":
      return input.reviewBrief;
  }
}

function ResolveReportPath(input: RenderSddPromptInput): string | undefined {
  switch (input.role) {
    case "implementer":
      return input.reportOut;
    case "task-reviewer":
      return input.implementerReport;
    case "re-review":
      return input.fixerReport;
    case "code-reviewer":
      return undefined;
  }
}

function ResolveFindingsPath(input: RenderSddPromptInput): string | undefined {
  if (input.role === "re-review") {
    return input.findings;
  }
  return undefined;
}

export function FormatFixFollowup(input: FormatFixFollowupInput): string {
  const tests = input.tests.join(", ");
  return [
    `Fix round ${input.round}.`,
    `Read the original brief at ${input.briefPath}.`,
    `Read and address only the open findings at ${input.findingsPath}.`,
    "",
    input.findingsText,
    "",
    `Run these covering tests: ${tests}.`,
    `Append the fix report to ${input.reportPath}.`,
    `Return only the short Superpowers status contract.`,
  ].join("\n");
}

export type FormatFixDispatchInput = FormatFixFollowupInput & {
  readonly planPath: string;
  readonly task: number;
};

// A fresh fixer gets the same instructions as a same-agent fix continuation,
// preceded by the identity a continuation gets from provider context. Pinning
// the shared tail keeps the two prompts from drifting apart.
//
export function FormatFixDispatch(input: FormatFixDispatchInput): string {
  const { planPath, task, ...continuation } = input;
  return [
    `You are a fixer for task ${task} of plan ${planPath}.`,
    "You are a fresh agent: read the brief and the findings before changing anything.",
    "",
    FormatFixFollowup(continuation),
  ].join("\n");
}

export async function RenderSddPrompt(
  input: RenderSddPromptInput,
  runtime: SddPromptRuntime = {},
): Promise<RenderedSddPrompt> {
  const pythonExecutable = runtime.pythonExecutable ?? "python3";
  const exec = runtime.execFile ?? (async (file, args, options) => {
    const result = await execFileAsync(file, args, options);
    return {
      stdout: typeof result.stdout === "string" ? result.stdout : String(result.stdout),
      stderr: typeof result.stderr === "string" ? result.stderr : String(result.stderr),
    };
  });
  const read = runtime.readFile ?? ((filePath: string) => readFile(filePath, "utf8"));
  const checkAccess = runtime.access ?? ((filePath: string) => access(filePath));

  const rendererPath = await ResolveRendererPath(input, checkAccess);

  const { args, suppliedOptions } = BuildDispatchArgs(input);
  let stdout = "";
  try {
    const result = await exec(pythonExecutable, [rendererPath, ...args], {
      cwd: input.cwd,
      maxBuffer: 1024 * 1024,
    });
    stdout = result.stdout;
  }
  catch (error) {
    const execError = error as NodeJS.ErrnoException & {
      code?: string | number;
      stderr?: string;
    };
    if (execError.code === "ENOENT") {
      throw new SddPromptError({
        error: "sdd_python_missing",
        message: "Python 3 is unavailable for SDD prompt rendering.",
      });
    }
    // dispatch-prompt's stderr can echo brief or plan body text, so none of it
    // may reach the controller (see the leak guard in sdd_prompt.test.ts).
    // Classify the one failure that is both common and actionable instead, and
    // emit a fixed string that quotes nothing.
    //
    const stderr = typeof execError.stderr === "string" ? execError.stderr : "";
    if (stderr.includes("could not resolve a Superpowers template")) {
      throw new SddPromptError({
        error: "sdd_templates_missing",
        message:
          "Superpowers templates are not installed where dispatch-prompt looks. "
          + "Reinstall the Superpowers package or set SUPERPOWERS_TEMPLATES_ROOT.",
      });
    }
    const classified = ClassifyRendererFault(stderr, input, suppliedOptions);
    if (classified !== null) {
      throw classified;
    }
    throw new SddPromptError({
      error: "sdd_renderer_failed",
      message: "dispatch-prompt exited with a non-zero status.",
      details: {
        exitCode: execError.code,
      },
    });
  }

  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    throw new SddPromptError({
      error: "sdd_renderer_output_invalid",
      message: "dispatch-prompt produced no output path on stdout.",
    });
  }
  if (lines.length > 1) {
    throw new SddPromptError({
      error: "sdd_renderer_output_invalid",
      message: "dispatch-prompt must print exactly one output path on stdout.",
    });
  }

  const promptPath = lines[0]!;
  if (!path.isAbsolute(promptPath)) {
    throw new SddPromptError({
      error: "sdd_renderer_output_invalid",
      message: "dispatch-prompt must print an absolute output path on stdout.",
    });
  }

  let promptText = "";
  try {
    promptText = await read(promptPath);
  }
  catch {
    throw new SddPromptError({
      error: "sdd_prompt_unreadable",
      message: "Rendered SDD prompt file is unreadable.",
    });
  }

  const briefPath = ResolveBriefPath(input);
  const reportPath = ResolveReportPath(input);
  const findingsPath = ResolveFindingsPath(input);

  return {
    prompt: {
      path: promptPath,
      text: promptText,
    },
    metadata: {
      promptPath,
      rendererPath,
      ...(briefPath === undefined ? {} : { briefPath }),
      ...(reportPath === undefined ? {} : { reportPath }),
      ...(findingsPath === undefined ? {} : { findingsPath }),
    },
  };
}
