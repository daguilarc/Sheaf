import { execFile, spawn } from "node:child_process";
import { dirname, isAbsolute, relative } from "node:path";
import { promisify } from "node:util";

import { ParseNameOnlyList, ParseUnifiedDiff } from "./diffParser.js";
import type { Hunk } from "./types.js";

const execFileAsync = promisify(execFile);

export interface GitAdapter
{
  findRepositoryRoot(filePath: string): Promise<string | null>;
  listChangedFiles(repoRoot: string): Promise<string[]>;
  loadUnstagedHunks(repoRoot: string, file?: string): Promise<Map<string, Hunk[]>>;
  applyPatch(repoRoot: string, patch: string, options: ApplyPatchOptions): Promise<void>;
}

export interface ApplyPatchOptions
{
  cached?: boolean;
  reverse?: boolean;
}

export class CliGitAdapter implements GitAdapter
{
  async findRepositoryRoot(filePath: string): Promise<string | null>
  {
    const cwd = isAbsolute(filePath) ? dirname(filePath) : filePath;
    try
    {
      const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
      return stdout.trim() || null;
    }
    catch
    {
      return null;
    }
  }

  async listChangedFiles(repoRoot: string): Promise<string[]>
  {
    const { stdout } = await execFileAsync("git", ["diff", "--name-only"], { cwd: repoRoot });
    return ParseNameOnlyList(stdout);
  }

  async loadUnstagedHunks(repoRoot: string, file?: string): Promise<Map<string, Hunk[]>>
  {
    const args = ["diff", "--no-ext-diff", "--", ...(file === undefined ? [] : [file])];
    const { stdout } = await execFileAsync("git", args, { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });
    return ParseUnifiedDiff(stdout);
  }

  async applyPatch(repoRoot: string, patch: string, options: ApplyPatchOptions): Promise<void>
  {
    const args = ["apply", "--whitespace=nowarn"];
    if (options.cached === true)
    {
      args.push("--cached");
    }
    if (options.reverse === true)
    {
      args.push("--reverse");
    }

    await SpawnWithInput("git", args, repoRoot, patch);
  }
}

export function ToRepoRelative(repoRoot: string, absPath: string): string
{
  return relative(repoRoot, absPath).split("\\").join("/");
}

async function SpawnWithInput(command: string, args: string[], cwd: string, input: string): Promise<void>
{
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0)
      {
        resolve();
      }
      else
      {
        reject(new Error(stderr.trim() || `${command} ${args.join(" ")} failed with exit code ${code}`));
      }
    });
    child.stdin.end(input);
  });
}
