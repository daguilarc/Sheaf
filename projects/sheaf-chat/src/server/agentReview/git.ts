import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  IsPathWithinRoot,
  ToRootRelativePathFromCanonical,
} from "../../extensions/sheaf-chat/pathPolicy.js";
import { StorageError } from "../../storage/errors.js";
import type {
  AgentReviewAvailability,
  AgentReviewFileSummary,
  AgentReviewHunk,
  AgentReviewInlineFile,
  AgentReviewInlineRow,
  AgentReviewInlineRowKind,
} from "./types.js";

export interface AgentReviewGitState
{
  availability: AgentReviewAvailability;
  hunks: AgentReviewHunk[];
  files: AgentReviewFileSummary[];
  inlineFiles: AgentReviewInlineFile[];
}

export interface AgentReviewMutationResult
{
  ok: boolean;
  error?: string;
}

interface ParsedFileDiff
{
  file: string;
  headerLines: string[];
  hunks: ParsedHunkDiff[];
}

interface ParsedHunkDiff
{
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: ParsedHunkLine[];
  rawLines: string[];
  hunkId?: string;
}

interface ParsedHunkLine
{
  kind: AgentReviewInlineRowKind;
  text: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

function Sha256(value: string): string
{
  return createHash("sha256").update(value).digest("hex");
}

// Test-only seam: awaited before each git invocation so tests can hold git work
// in flight deterministically and exercise teardown draining. Never set outside
// tests.
let g_beforeRunGitForTests: (() => Promise<void>) | null = null;

export function SetAgentReviewGitHookForTests(hook: (() => Promise<void>) | null): void
{
  g_beforeRunGitForTests = hook;
}

async function RunGit(cwd: string, args: string[], input?: string): Promise<string>
{
  if (g_beforeRunGitForTests !== null)
  {
    await g_beforeRunGitForTests();
  }

  return new Promise((resolve, reject) =>
  {
    const child = spawn("git", args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) =>
    {
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) =>
    {
      stderr.push(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) =>
    {
      const output = Buffer.concat(stdout).toString("utf8");
      if (code === 0)
      {
        resolve(output);
        return;
      }

      const errorText = Buffer.concat(stderr).toString("utf8").trim();
      reject(new Error(errorText || `git exited with status ${code ?? "unknown"}`));
    });

    if (input !== undefined)
    {
      child.stdin.end(input);
    }
    else
    {
      child.stdin.end();
    }
  });
}

function SplitDiffBlocks(diffText: string): string[]
{
  const blocks: string[] = [];
  const marker = "diff --git ";
  let cursor = diffText.indexOf(marker);

  while (cursor >= 0)
  {
    const next = diffText.indexOf(`\n${marker}`, cursor + marker.length);
    if (next < 0)
    {
      blocks.push(diffText.slice(cursor));
      break;
    }

    blocks.push(diffText.slice(cursor, next + 1));
    cursor = next + 1;
  }

  return blocks;
}

function ParseFileDiff(block: string): ParsedFileDiff | null
{
  if (/^Binary files /m.test(block) || /^GIT binary patch$/m.test(block))
  {
    return null;
  }

  const rawLines = block.replace(/\n$/, "").split("\n");
  const plusLine = rawLines.find((line) => line.startsWith("+++ "));
  const file = plusLine?.startsWith("+++ b/")
    ? plusLine.slice("+++ b/".length)
    : undefined;

  if (file === undefined || file === "/dev/null")
  {
    return null;
  }

  const firstHunkIndex = rawLines.findIndex((line) => line.startsWith("@@ "));
  if (firstHunkIndex < 0)
  {
    return null;
  }

  const headerLines = rawLines.slice(0, firstHunkIndex);
  const hunkBodies: string[][] = [];
  let current: string[] = [];

  for (let index = firstHunkIndex; index < rawLines.length; index += 1)
  {
    const line = rawLines[index] ?? "";
    if (line.startsWith("@@ ") && current.length > 0)
    {
      hunkBodies.push(current);
      current = [];
    }
    current.push(line);
  }

  if (current.length > 0)
  {
    hunkBodies.push(current);
  }

  const hunks = hunkBodies
    .map(ParseHunkDiff)
    .filter((hunk): hunk is ParsedHunkDiff => hunk !== null);

  if (hunks.length === 0)
  {
    return null;
  }

  return {
    file,
    headerLines,
    hunks,
  };
}

function ParseHunkDiff(rawLines: string[]): ParsedHunkDiff | null
{
  const header = rawLines[0] ?? "";
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header);
  if (match === null)
  {
    return null;
  }

  const oldStart = Number(match[1]);
  const oldCount = match[2] === undefined ? 1 : Number(match[2]);
  const newStart = Number(match[3]);
  const newCount = match[4] === undefined ? 1 : Number(match[4]);
  let oldLineNumber = oldStart;
  let newLineNumber = newStart;
  const lines: ParsedHunkLine[] = [];

  for (const rawLine of rawLines.slice(1))
  {
    if (rawLine.startsWith("\\"))
    {
      continue;
    }

    const prefix = rawLine.slice(0, 1);
    const text = rawLine.slice(1);
    if (prefix === " ")
    {
      lines.push({
        kind: "context",
        text,
        oldLineNumber,
        newLineNumber,
      });
      oldLineNumber += 1;
      newLineNumber += 1;
    }
    else if (prefix === "-")
    {
      lines.push({
        kind: "deletion",
        text,
        oldLineNumber,
      });
      oldLineNumber += 1;
    }
    else if (prefix === "+")
    {
      lines.push({
        kind: "addition",
        text,
        newLineNumber,
      });
      newLineNumber += 1;
    }
  }

  return {
    header,
    oldStart,
    oldCount,
    newStart,
    newCount,
    lines,
    rawLines,
  };
}

function BuildHunks(
  repoRoot: string,
  sessionRoot: string,
  parsedFiles: ParsedFileDiff[],
): { hunks: AgentReviewHunk[]; files: AgentReviewFileSummary[] }
{
  const files = parsedFiles.map((file) => ({
    file: file.file,
    hunkCount: file.hunks.length,
  }));
  const totalHunks = parsedFiles.reduce((sum, file) => sum + file.hunks.length, 0);
  const hunks: AgentReviewHunk[] = [];

  for (let fileIndex = 0; fileIndex < parsedFiles.length; fileIndex += 1)
  {
    const file = parsedFiles[fileIndex]!;
    for (let localHunkIndex = 0; localHunkIndex < file.hunks.length; localHunkIndex += 1)
    {
      const hunk = file.hunks[localHunkIndex]!;
      const patch = [...file.headerLines, ...hunk.rawLines].join("\n") + "\n";
      const patchHash = Sha256(patch);
      const globalIndex = hunks.length;
      const header = hunk.header;
      const hunkId = `${file.file}:${globalIndex}:${patchHash.slice(0, 16)}`;
      hunk.hunkId = hunkId;

      hunks.push({
        sourceProvider: "sheaf-chat",
        repoRoot,
        sessionRoot,
        file: file.file,
        hunkId,
        hunkIndex: globalIndex,
        hunkCount: totalHunks,
        fileIndex,
        fileCount: parsedFiles.length,
        header,
        patchHash,
        patch,
      });
    }
  }

  return {
    hunks,
    files,
  };
}

function SplitContentLines(content: string): string[]
{
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "")
  {
    lines.pop();
  }
  return lines;
}

function RowID(file: string, kind: AgentReviewInlineRowKind, lineNumber: number, index: number): string
{
  return `${file}:${kind}:${lineNumber}:${index}`;
}

async function BuildInlineFiles(
  repoRoot: string,
  sessionRoot: string,
  parsedFiles: ParsedFileDiff[],
): Promise<AgentReviewInlineFile[]>
{
  const inlineFiles: AgentReviewInlineFile[] = [];

  for (const file of parsedFiles)
  {
    const absoluteFile = path.resolve(repoRoot, file.file);
    if (!IsPathWithinRoot(absoluteFile, sessionRoot))
    {
      continue;
    }

    let content: string;
    try
    {
      content = await readFile(absoluteFile, "utf8");
    }
    catch
    {
      continue;
    }

    const worktreeLines = SplitContentLines(content);
    const rows: AgentReviewInlineRow[] = [];
    let nextNewLineNumber = 1;
    let rowIndex = 0;

    const PushCurrentFileContextUntil = (exclusiveNewLineNumber: number): void =>
    {
      while (
        nextNewLineNumber < exclusiveNewLineNumber &&
        nextNewLineNumber <= worktreeLines.length
      )
      {
        rows.push({
          id: RowID(file.file, "context", nextNewLineNumber, rowIndex),
          kind: "context",
          text: worktreeLines[nextNewLineNumber - 1] ?? "",
          newLineNumber: nextNewLineNumber,
        });
        nextNewLineNumber += 1;
        rowIndex += 1;
      }
    };

    for (const hunk of file.hunks)
    {
      const insertionNewLineNumber = hunk.newCount === 0
        ? hunk.newStart + 1
        : hunk.newStart;
      PushCurrentFileContextUntil(insertionNewLineNumber);

      for (const line of hunk.lines)
      {
        const lineNumber = line.newLineNumber ?? line.oldLineNumber ?? rowIndex;
        rows.push({
          id: `${hunk.hunkId ?? file.file}:${line.kind}:${lineNumber}:${rowIndex}`,
          kind: line.kind,
          text: line.text,
          hunkId: hunk.hunkId,
          oldLineNumber: line.oldLineNumber,
          newLineNumber: line.newLineNumber,
        });
        if (line.newLineNumber !== undefined)
        {
          nextNewLineNumber = Math.max(nextNewLineNumber, line.newLineNumber + 1);
        }
        rowIndex += 1;
      }
    }

    PushCurrentFileContextUntil(worktreeLines.length + 1);
    inlineFiles.push({
      file: file.file,
      rows,
    });
  }

  return inlineFiles;
}

function FormatSessionPathspec(repoRoot: string, sessionRoot: string): string
{
  const relative = path.relative(repoRoot, sessionRoot).split(path.sep).join("/");
  return relative.length === 0 ? "." : relative;
}

export async function ResolveAgentReviewAvailability(
  sessionRootDirectory: string,
): Promise<AgentReviewAvailability>
{
  let sessionRoot: string;
  try
  {
    sessionRoot = await realpath(path.resolve(sessionRootDirectory));
  }
  catch (error)
  {
    return {
      available: false,
      repoRoot: null,
      sessionRoot: null,
      sessionRootRelativeToRepo: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  try
  {
    const repoRoot = (await RunGit(sessionRoot, ["rev-parse", "--show-toplevel"])).trim();
    const canonicalRepoRoot = await realpath(repoRoot);

    if (!IsPathWithinRoot(sessionRoot, canonicalRepoRoot))
    {
      return {
        available: false,
        repoRoot: null,
        sessionRoot,
        sessionRootRelativeToRepo: null,
        reason: "session root is outside the Git repository",
      };
    }

    return {
      available: true,
      repoRoot: canonicalRepoRoot,
      sessionRoot,
      sessionRootRelativeToRepo: ToRootRelativePathFromCanonical(canonicalRepoRoot, sessionRoot),
    };
  }
  catch
  {
    return {
      available: false,
      repoRoot: null,
      sessionRoot,
      sessionRootRelativeToRepo: null,
      reason: "session root is not inside a Git repository",
    };
  }
}

export async function LoadAgentReviewGitState(
  sessionRootDirectory: string,
): Promise<AgentReviewGitState>
{
  const availability = await ResolveAgentReviewAvailability(sessionRootDirectory);

  if (!availability.available || availability.repoRoot === null || availability.sessionRoot === null)
  {
    return {
      availability,
      hunks: [],
      files: [],
      inlineFiles: [],
    };
  }

  const pathspec = FormatSessionPathspec(availability.repoRoot, availability.sessionRoot);
  const diffText = await RunGit(availability.repoRoot, [
    "diff",
    "--no-ext-diff",
    "--unified=0",
    "--",
    pathspec,
  ]);
  const parsedFiles = SplitDiffBlocks(diffText)
    .map(ParseFileDiff)
    .filter((file): file is ParsedFileDiff => file !== null);
  const { hunks, files } = BuildHunks(
    availability.repoRoot,
    availability.sessionRoot,
    parsedFiles,
  );
  const inlineFiles = await BuildInlineFiles(
    availability.repoRoot,
    availability.sessionRoot,
    parsedFiles,
  );

  return {
    availability,
    hunks,
    files,
    inlineFiles,
  };
}

export async function ReadAgentReviewIndexFile(
  repoRoot: string,
  file: string,
): Promise<string>
{
  return RunGit(repoRoot, ["show", `:${file}`]);
}

export async function WriteAgentReviewIndexFile(
  repoRoot: string,
  file: string,
  content: string,
): Promise<void>
{
  const indexEntry = await RunGit(repoRoot, ["ls-files", "-s", "--", file]);
  const entries = indexEntry.split("\n")
    .map((candidate) => /^(\d+)\s+[0-9a-fA-F]+\s+(\d+)\t/.exec(candidate))
    .filter((match): match is RegExpExecArray => match !== null);
  if (entries.length === 0)
  {
    throw new Error("index file is missing");
  }

  const unmerged = entries.some((entry) => entry[2] !== "0");
  const stageZero = entries.find((entry) => entry[2] === "0");
  if (unmerged || stageZero === undefined)
  {
    throw new Error("index file is unmerged");
  }

  const mode = stageZero[1]!;
  const objectId = (await RunGit(repoRoot, ["hash-object", "-w", "--stdin"], content)).trim();
  await RunGit(repoRoot, ["update-index", "--index-info"], `${mode} ${objectId} 0\t${file}\n`);
}

export function AssertReviewHunkUnderSession(hunk: AgentReviewHunk): void
{
  const absoluteFile = path.resolve(hunk.repoRoot, hunk.file);
  if (!IsPathWithinRoot(absoluteFile, hunk.sessionRoot))
  {
    throw new StorageError("path_escape", "hunk path must be relative to the session root");
  }
}

export async function ApplyAgentReviewPatch(
  repoRoot: string,
  action: "stage" | "unstage" | "revert" | "restore",
  patch: string,
): Promise<AgentReviewMutationResult>
{
  const args =
    action === "stage"
      ? ["apply", "--cached", "--unidiff-zero", "--whitespace=nowarn", "-"]
      : action === "unstage"
        ? ["apply", "--cached", "--reverse", "--unidiff-zero", "--whitespace=nowarn", "-"]
        : action === "revert"
          ? ["apply", "--reverse", "--unidiff-zero", "--whitespace=nowarn", "-"]
          : ["apply", "--unidiff-zero", "--whitespace=nowarn", "-"];

  try
  {
    await RunGit(repoRoot, args, patch);
    return { ok: true };
  }
  catch (error)
  {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
