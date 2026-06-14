import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  RepositoryMetadata,
  WorkspaceEditorState,
  WorkspaceMetadata,
} from "../shared/types.js";
import { StorageError } from "./errors.js";
import {
  ResolveRepositoryDirectory,
  ResolveRepositoryMetadataPath,
  ResolveWorkspaceDirectory,
  ResolveWorkspaceEditorStatePath,
  ResolveWorkspaceMetadataPath,
  type StoragePaths,
} from "./paths.js";
import { ValidateRepoId, ValidateWorkspaceId } from "./validation.js";

const execFileAsync = promisify(execFile);

export const x_emptyWorkspaceEditorState: WorkspaceEditorState = {
  tabs: [],
  selectedPath: null,
  expandedDirectories: [],
  viewports: {},
};

export function IdForCanonicalPath(canonicalPath: string): string
{
  return createHash("sha256").update(canonicalPath).digest("base64url");
}

async function CanonicalPath(candidate: string): Promise<string>
{
  return realpath(path.resolve(candidate));
}

async function GitOutput(cwd: string, args: string[]): Promise<string>
{
  const result = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });

  return result.stdout.trim();
}

async function TryGitOutput(cwd: string, args: string[]): Promise<string | null>
{
  try
  {
    return await GitOutput(cwd, args);
  }
  catch
  {
    return null;
  }
}

async function WriteJson(filePath: string, value: unknown): Promise<void>
{
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

// Compare metadata ignoring the volatile `discoveredAt` stamp so that a
// rediscovery that produces identical stable fields does not rewrite the file.
function StableMetadata(value: unknown): string
{
  if (value === null || typeof value !== "object")
  {
    return "";
  }

  const { discoveredAt: _discoveredAt, ...rest } = value as Record<string, unknown>;
  return JSON.stringify(rest, Object.keys(rest).sort());
}

async function WriteMetadataIfChanged(filePath: string, metadata: unknown): Promise<void>
{
  try
  {
    const existing = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (StableMetadata(existing) === StableMetadata(metadata))
    {
      return;
    }
  }
  catch
  {
    // Missing or unreadable cache file -> write below.
  }

  await WriteJson(filePath, metadata);
}

async function ReadCachedRepositoryMetadata(
  paths: StoragePaths,
  repoId: string,
): Promise<RepositoryMetadata | null>
{
  try
  {
    return JSON.parse(
      await readFile(ResolveRepositoryMetadataPath(paths, repoId), "utf8"),
    ) as RepositoryMetadata;
  }
  catch
  {
    return null;
  }
}

async function ReadCachedWorkspaceMetadata(
  paths: StoragePaths,
  repoId: string,
  workspaceId: string,
): Promise<WorkspaceMetadata | null>
{
  try
  {
    return JSON.parse(
      await readFile(ResolveWorkspaceMetadataPath(paths, repoId, workspaceId), "utf8"),
    ) as WorkspaceMetadata;
  }
  catch
  {
    return null;
  }
}

export async function CacheRepositoryMetadata(
  paths: StoragePaths,
  metadata: RepositoryMetadata,
): Promise<void>
{
  await mkdir(ResolveRepositoryDirectory(paths, metadata.repoId), { recursive: true });
  await WriteMetadataIfChanged(ResolveRepositoryMetadataPath(paths, metadata.repoId), metadata);
}

export async function CacheWorkspaceMetadata(
  paths: StoragePaths,
  metadata: WorkspaceMetadata,
): Promise<void>
{
  await mkdir(ResolveWorkspaceDirectory(paths, metadata.repoId, metadata.workspaceId), {
    recursive: true,
  });
  await WriteMetadataIfChanged(
    ResolveWorkspaceMetadataPath(paths, metadata.repoId, metadata.workspaceId),
    metadata,
  );
}

export async function ReadRepositoryMetadata(
  paths: StoragePaths,
  repoId: string,
): Promise<RepositoryMetadata>
{
  const validatedRepoId = ValidateRepoId(repoId);

  try
  {
    return JSON.parse(
      await readFile(ResolveRepositoryMetadataPath(paths, validatedRepoId), "utf8"),
    ) as RepositoryMetadata;
  }
  catch
  {
    throw new StorageError("not_found", `repository not found: ${validatedRepoId}`);
  }
}

export async function ReadWorkspaceMetadata(
  paths: StoragePaths,
  repoId: string,
  workspaceId: string,
): Promise<WorkspaceMetadata>
{
  const validatedRepoId = ValidateRepoId(repoId);
  const validatedWorkspaceId = ValidateWorkspaceId(workspaceId);

  try
  {
    return JSON.parse(
      await readFile(
        ResolveWorkspaceMetadataPath(paths, validatedRepoId, validatedWorkspaceId),
        "utf8",
      ),
    ) as WorkspaceMetadata;
  }
  catch
  {
    throw new StorageError("not_found", `workspace not found: ${validatedWorkspaceId}`);
  }
}

function RepositoryMetadataFromPath(canonicalPath: string): RepositoryMetadata
{
  return {
    repoId: IdForCanonicalPath(canonicalPath),
    name: path.basename(canonicalPath),
    path: canonicalPath,
    discoveredAt: new Date().toISOString(),
  };
}

export async function ListRepositories(
  paths: StoragePaths,
  homeDirectory = homedir(),
): Promise<RepositoryMetadata[]>
{
  let children: string[];

  try
  {
    children = await readdir(homeDirectory);
  }
  catch
  {
    return [];
  }

  const repositories: RepositoryMetadata[] = [];

  for (const child of children)
  {
    const childPath = path.join(homeDirectory, child);

    let childStat;

    try
    {
      childStat = await stat(childPath);
    }
    catch
    {
      continue;
    }

    if (!childStat.isDirectory())
    {
      continue;
    }

    let canonicalChild: string;

    try
    {
      canonicalChild = await CanonicalPath(childPath);
    }
    catch
    {
      continue;
    }

    const topLevel = await TryGitOutput(canonicalChild, ["rev-parse", "--show-toplevel"]);

    if (topLevel === null)
    {
      continue;
    }

    let canonicalTopLevel: string;

    try
    {
      canonicalTopLevel = await CanonicalPath(topLevel);
    }
    catch
    {
      continue;
    }

    if (canonicalTopLevel !== canonicalChild)
    {
      continue;
    }

    const metadata = RepositoryMetadataFromPath(canonicalChild);
    repositories.push(metadata);
    await CacheRepositoryMetadata(paths, metadata);
  }

  repositories.sort((left, right) => left.name.localeCompare(right.name));
  return repositories;
}

interface ParsedWorktree
{
  path: string;
  branch?: string;
  head?: string;
  bare?: boolean;
  detached?: boolean;
}

export function ParseGitWorktreePorcelain(raw: string): ParsedWorktree[]
{
  const records: ParsedWorktree[] = [];
  let current: ParsedWorktree | null = null;

  for (const line of raw.split(/\r?\n/))
  {
    if (line.trim().length === 0)
    {
      if (current !== null)
      {
        records.push(current);
        current = null;
      }

      continue;
    }

    const spaceIndex = line.indexOf(" ");
    const key = spaceIndex < 0 ? line : line.slice(0, spaceIndex);
    const value = spaceIndex < 0 ? "" : line.slice(spaceIndex + 1);

    if (key === "worktree")
    {
      if (current !== null)
      {
        records.push(current);
      }

      current = { path: value };
      continue;
    }

    if (current === null)
    {
      continue;
    }

    if (key === "branch")
    {
      current.branch = value.replace(/^refs\/heads\//, "");
    }
    else if (key === "HEAD")
    {
      current.head = value;
    }
    else if (key === "bare")
    {
      current.bare = true;
    }
    else if (key === "detached")
    {
      current.detached = true;
    }
  }

  if (current !== null)
  {
    records.push(current);
  }

  return records;
}

function WorkspaceDisplayName(worktree: ParsedWorktree, canonicalPath: string): string
{
  if (worktree.branch !== undefined && worktree.branch.length > 0)
  {
    return worktree.branch;
  }

  if (worktree.head !== undefined && worktree.head.length >= 7)
  {
    return `${path.basename(canonicalPath)} @ ${worktree.head.slice(0, 7)}`;
  }

  return path.basename(canonicalPath);
}

export async function ListWorkspaces(
  paths: StoragePaths,
  repoId: string,
): Promise<WorkspaceMetadata[]>
{
  const repository = await ResolveRepository(paths, repoId);
  const raw = await GitOutput(repository.path, ["worktree", "list", "--porcelain"]);
  const parsed = ParseGitWorktreePorcelain(raw);
  const workspaces: WorkspaceMetadata[] = [];

  for (const [index, worktree] of parsed.entries())
  {
    let canonicalWorkspacePath: string;

    try
    {
      canonicalWorkspacePath = await CanonicalPath(worktree.path);
    }
    catch
    {
      continue;
    }

    const workspace: WorkspaceMetadata = {
      repoId: repository.repoId,
      workspaceId: IdForCanonicalPath(canonicalWorkspacePath),
      kind: index === 0 ? "main" : "worktree",
      path: canonicalWorkspacePath,
      displayName: WorkspaceDisplayName(worktree, canonicalWorkspacePath),
      discoveredAt: new Date().toISOString(),
    };

    if (worktree.branch !== undefined)
    {
      workspace.branch = worktree.branch;
    }

    if (worktree.head !== undefined)
    {
      workspace.head = worktree.head;
    }

    if (worktree.bare !== undefined)
    {
      workspace.bare = worktree.bare;
    }

    if (worktree.detached !== undefined || worktree.branch === undefined)
    {
      workspace.detached = worktree.detached ?? worktree.branch === undefined;
    }

    workspaces.push(workspace);
    await CacheWorkspaceMetadata(paths, workspace);
  }

  return workspaces;
}

// Resolve a known repository id from cached metadata; only fall back to a full
// home-directory scan on a cache miss. Full discovery belongs to the repository
// picker endpoint, not to every workspace-scoped request.
export async function ResolveRepository(
  paths: StoragePaths,
  repoId: string,
): Promise<RepositoryMetadata>
{
  const validatedRepoId = ValidateRepoId(repoId);

  const cached = await ReadCachedRepositoryMetadata(paths, validatedRepoId);
  if (cached !== null)
  {
    return cached;
  }

  const repositories = await ListRepositories(paths);
  const discovered = repositories.find((repository) => repository.repoId === validatedRepoId);

  if (discovered !== undefined)
  {
    return discovered;
  }

  return ReadRepositoryMetadata(paths, validatedRepoId);
}

// Resolve a known workspace id from cached metadata; only fall back to worktree
// discovery on a cache miss. Worktree discovery belongs to the workspace picker
// endpoint, not to chat listing, file browsing, history, or editor-state saves.
export async function ResolveWorkspace(
  paths: StoragePaths,
  repoId: string,
  workspaceId: string,
): Promise<WorkspaceMetadata>
{
  const validatedRepoId = ValidateRepoId(repoId);
  const validatedWorkspaceId = ValidateWorkspaceId(workspaceId);

  const cached = await ReadCachedWorkspaceMetadata(paths, validatedRepoId, validatedWorkspaceId);
  if (cached !== null)
  {
    return cached;
  }

  try
  {
    const workspaces = await ListWorkspaces(paths, validatedRepoId);
    const discovered = workspaces.find(
      (workspace) => workspace.workspaceId === validatedWorkspaceId,
    );

    if (discovered !== undefined)
    {
      return discovered;
    }
  }
  catch
  {
    // Fall through to the cached read, which raises not_found.
  }

  return ReadWorkspaceMetadata(paths, validatedRepoId, validatedWorkspaceId);
}

function NormalizeWorkspaceRelativePath(value: unknown, label: string): string
{
  if (typeof value !== "string")
  {
    throw new StorageError("invalid_request", `${label} must be a string`);
  }

  const trimmed = value.trim().replace(/\\/g, "/");

  if (trimmed.length === 0)
  {
    throw new StorageError("invalid_request", `${label} must not be empty`);
  }

  if (trimmed.includes("\0") || path.isAbsolute(trimmed) || /^[a-zA-Z]:/.test(trimmed))
  {
    throw new StorageError("path_escape", `${label} must be relative to the workspace root`);
  }

  const normalized = path.posix.normalize(trimmed);

  if (normalized === ".." || normalized.startsWith("../"))
  {
    throw new StorageError("path_escape", `${label} must be relative to the workspace root`);
  }

  return normalized === "" ? "." : normalized;
}

export function NormalizeWorkspaceEditorState(input: unknown): WorkspaceEditorState
{
  if (input === null || typeof input !== "object" || Array.isArray(input))
  {
    throw new StorageError("invalid_request", "editor state must be an object");
  }

  const record = input as Record<string, unknown>;
  const tabs = Array.isArray(record.tabs)
    ? record.tabs.map((tab) => NormalizeWorkspaceRelativePath(tab, "tab"))
    : [];
  const expandedDirectories = Array.isArray(record.expandedDirectories)
    ? record.expandedDirectories.map((directory) =>
      NormalizeWorkspaceRelativePath(directory, "expanded directory"))
    : [];
  const selectedPath =
    record.selectedPath === null || record.selectedPath === undefined
      ? null
      : NormalizeWorkspaceRelativePath(record.selectedPath, "selectedPath");
  const viewports: Record<string, { scrollTop: number }> = {};

  if (
    record.viewports !== undefined &&
    (record.viewports === null || typeof record.viewports !== "object" || Array.isArray(record.viewports))
  )
  {
    throw new StorageError("invalid_request", "viewports must be an object");
  }

  for (const [rawPath, rawViewport] of Object.entries(
    (record.viewports as Record<string, unknown> | undefined) ?? {},
  ))
  {
    const viewportPath = NormalizeWorkspaceRelativePath(rawPath, "viewport path");

    if (rawViewport === null || typeof rawViewport !== "object" || Array.isArray(rawViewport))
    {
      throw new StorageError("invalid_request", "viewport must be an object");
    }

    const scrollTop = (rawViewport as { scrollTop?: unknown }).scrollTop;
    viewports[viewportPath] = {
      scrollTop: typeof scrollTop === "number" && Number.isFinite(scrollTop)
        ? Math.max(0, Math.floor(scrollTop))
        : 0,
    };
  }

  return {
    tabs: Array.from(new Set(tabs)),
    selectedPath,
    expandedDirectories: Array.from(new Set(expandedDirectories)),
    viewports,
  };
}

export async function ReadWorkspaceEditorState(
  paths: StoragePaths,
  repoId: string,
  workspaceId: string,
): Promise<WorkspaceEditorState>
{
  await ResolveWorkspace(paths, repoId, workspaceId);

  try
  {
    const raw = await readFile(ResolveWorkspaceEditorStatePath(paths, repoId, workspaceId), "utf8");
    return NormalizeWorkspaceEditorState(JSON.parse(raw));
  }
  catch (error)
  {
    if (error instanceof StorageError)
    {
      throw error;
    }

    return x_emptyWorkspaceEditorState;
  }
}

export async function WriteWorkspaceEditorState(
  paths: StoragePaths,
  repoId: string,
  workspaceId: string,
  input: unknown,
): Promise<WorkspaceEditorState>
{
  await ResolveWorkspace(paths, repoId, workspaceId);
  const state = NormalizeWorkspaceEditorState(input);
  await WriteJson(ResolveWorkspaceEditorStatePath(paths, repoId, workspaceId), state);
  return state;
}
