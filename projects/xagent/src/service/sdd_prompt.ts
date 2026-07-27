import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

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
      readonly report?: string;
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
      readonly report: string;
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
      readonly report: string;
      readonly base: string;
      readonly head: string;
      readonly diff?: string;
      readonly templatesRoot?: string;
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

function BuildDispatchArgs(input: RenderSddPromptInput): string[] {
  const args = [input.role, "--plan", input.plan];
  if (input.templatesRoot !== undefined) {
    args.push("--templates-root", input.templatesRoot);
  }

  switch (input.role) {
    case "implementer":
      args.push("--task", String(input.task));
      args.push("--name", input.name);
      args.push("--brief", input.brief);
      if (input.report !== undefined) {
        args.push("--report", input.report);
      }
      if (input.context !== undefined) {
        args.push("--context", input.context);
      }
      return args;
    case "task-reviewer":
      args.push("--task", String(input.task));
      args.push("--brief", input.brief);
      args.push("--report", input.report);
      args.push("--base", input.base);
      args.push("--head", input.head);
      if (input.constraints !== undefined) {
        args.push("--constraints", input.constraints);
      }
      if (input.diff !== undefined) {
        args.push("--diff", input.diff);
      }
      return args;
    case "re-review":
      args.push("--task", String(input.task));
      args.push("--round", String(input.round));
      args.push("--brief", input.brief);
      args.push("--findings", input.findings);
      args.push("--report", input.report);
      args.push("--base", input.base);
      args.push("--head", input.head);
      if (input.diff !== undefined) {
        args.push("--diff", input.diff);
      }
      return args;
    case "code-reviewer":
      args.push("--description", input.description);
      args.push("--requirements", `@${input.reviewBrief}`);
      args.push("--base", input.base);
      args.push("--head", input.head);
      return args;
  }
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
      return input.report;
    case "task-reviewer":
    case "re-review":
      return input.report;
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

  const rendererPath = TrustedRendererPath(input.repoRoot);
  try {
    await checkAccess(rendererPath);
  }
  catch {
    throw new SddPromptError({
      error: "sdd_renderer_missing",
      message: "Trusted dispatch-prompt renderer is unavailable.",
    });
  }

  const args = BuildDispatchArgs(input);
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
    };
    if (execError.code === "ENOENT") {
      throw new SddPromptError({
        error: "sdd_python_missing",
        message: "Python 3 is unavailable for SDD prompt rendering.",
      });
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
      ...(briefPath === undefined ? {} : { briefPath }),
      ...(reportPath === undefined ? {} : { reportPath }),
      ...(findingsPath === undefined ? {} : { findingsPath }),
    },
  };
}
