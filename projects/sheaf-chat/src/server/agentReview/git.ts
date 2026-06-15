import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
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
} from "./types.js";

export interface AgentReviewGitState
{
  availability: AgentReviewAvailability;
  hunks: AgentReviewHunk[];
  files: AgentReviewFileSummary[];
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
  hunkBodies: string[][];
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

  return {
    file,
    headerLines,
    hunkBodies,
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
    hunkCount: file.hunkBodies.length,
  }));
  const totalHunks = parsedFiles.reduce((sum, file) => sum + file.hunkBodies.length, 0);
  const hunks: AgentReviewHunk[] = [];

  for (let fileIndex = 0; fileIndex < parsedFiles.length; fileIndex += 1)
  {
    const file = parsedFiles[fileIndex]!;
    for (let localHunkIndex = 0; localHunkIndex < file.hunkBodies.length; localHunkIndex += 1)
    {
      const hunkLines = file.hunkBodies[localHunkIndex]!;
      const patch = [...file.headerLines, ...hunkLines].join("\n") + "\n";
      const patchHash = Sha256(patch);
      const globalIndex = hunks.length;
      const header = hunkLines[0] ?? "";
      const hunkId = `${file.file}:${globalIndex}:${patchHash.slice(0, 16)}`;

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
    };
  }

  const pathspec = FormatSessionPathspec(availability.repoRoot, availability.sessionRoot);
  const diffText = await RunGit(availability.repoRoot, [
    "diff",
    "--no-ext-diff",
    "--unified=3",
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

  return {
    availability,
    hunks,
    files,
  };
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
      ? ["apply", "--cached", "--whitespace=nowarn", "-"]
      : action === "unstage"
        ? ["apply", "--cached", "--reverse", "--whitespace=nowarn", "-"]
        : action === "revert"
          ? ["apply", "--reverse", "--whitespace=nowarn", "-"]
          : ["apply", "--whitespace=nowarn", "-"];

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
