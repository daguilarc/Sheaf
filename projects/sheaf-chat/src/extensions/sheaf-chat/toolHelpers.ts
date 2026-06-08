import { PathEscapeError } from "./errors.js";
import type { RootPolicy } from "./pathPolicy.js";
import type { ScopedToolContext, ToolAgentResult } from "./types.js";

export async function ResolveScopedPath(
  policy: RootPolicy,
  inputPath: string,
  options?: { allowMissing?: boolean },
): Promise<string>
{
  return policy.ResolveInputPath(inputPath, options);
}

export function HandlePathEscape(
  context: ScopedToolContext,
  toolName: string,
  error: unknown,
): ToolErrorResult | null
{
  if (!(error instanceof PathEscapeError))
  {
    return null;
  }

  context.audit.LogEscapeAttempt({
    inputPath: error.inputPath,
    reason: error.reason,
    tool: toolName,
  });

  return {
    content: [
      {
        type: "text" as const,
        text: `Path is outside the session root: ${error.inputPath}`,
      },
    ],
    details: { code: error.code, reason: error.reason },
    isError: true,
  };
}

export interface ToolErrorResult extends ToolAgentResult
{
  isError: true;
}

export function ToolError(message: string, details: Record<string, unknown> = {}): ToolErrorResult
{
  return {
    content: [{ type: "text" as const, text: message }],
    details,
    isError: true,
  };
}

export function ToolSuccess(text: string, details: Record<string, unknown> = {})
{
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

const x_defaultMaxLines = 2000;
const x_defaultMaxBytes = 50 * 1024;

export function TruncateTextHead(text: string): {
  content: string;
  truncated: boolean;
  outputLines: number;
  totalLines: number;
}
{
  const lines = text.split("\n");
  const totalLines = lines.length;
  let outputLines = 0;
  let byteCount = 0;
  const selected: string[] = [];

  for (const line of lines)
  {
    const lineBytes = Buffer.byteLength(line, "utf-8") + (selected.length > 0 ? 1 : 0);

    if (selected.length >= x_defaultMaxLines)
    {
      break;
    }

    if (byteCount + lineBytes > x_defaultMaxBytes && selected.length > 0)
    {
      break;
    }

    selected.push(line);
    byteCount += lineBytes;
    outputLines += 1;
  }

  const truncated = outputLines < totalLines;

  return {
    content: selected.join("\n"),
    truncated,
    outputLines,
    totalLines,
  };
}

export function FormatNumberedLines(lines: string[], startLine: number): string
{
  const width = String(startLine + lines.length - 1).length;

  return lines
    .map((line, index) => {
      const lineNumber = String(startLine + index).padStart(width, " ");
      return `${lineNumber}|${line}`;
    })
    .join("\n");
}

export const x_treeDefaultIgnores = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
  "target",
  "vendor",
  ".next",
  ".turbo",
  "coverage",
  ".pytest_cache",
  ".mypy_cache",
  ".tox",
  "out",
];
