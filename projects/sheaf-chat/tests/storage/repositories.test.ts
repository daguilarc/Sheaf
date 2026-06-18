import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  CacheRepositoryMetadata,
  CacheWorkspaceMetadata,
  IdForCanonicalPath,
  ListRepositories,
  ListWorkspaces,
  NormalizeWorkspaceEditorState,
  ParseGitWorktreePorcelain,
  ReadRepositoryMetadata,
  ReadWorkspaceEditorState,
  ResolveRepository,
  ResolveWorkspace,
  WriteWorkspaceEditorState,
} from "../../src/storage/repositories.js";
import { ResolveRepositoryMetadataPath } from "../../src/storage/paths.js";
import { StorageError } from "../../src/storage/errors.js";
import { WithTempStorage } from "./helpers.js";

const execFileAsync = promisify(execFile);

async function Git(cwd: string, args: string[]): Promise<void>
{
  await execFileAsync("git", args, { cwd });
}

async function WithTempHome<T>(callback: (home: string) => Promise<T>): Promise<T>
{
  const home = await mkdtemp(path.join(tmpdir(), "sheaf-chat-home-"));

  try
  {
    return await callback(home);
  }
  finally
  {
    await rm(home, { recursive: true, force: true });
  }
}

test("IdForCanonicalPath is stable and path-safe", () =>
{
  const id = IdForCanonicalPath("/tmp/example");
  assert.equal(id, IdForCanonicalPath("/tmp/example"));
  assert.match(id, /^[A-Za-z0-9_-]{16,128}$/);
});

test("ListRepositories discovers only direct home child Git roots and caches metadata", async () =>
{
  await WithTempStorage(async (paths) =>
    WithTempHome(async (home) =>
    {
      const direct = path.join(home, "direct");
      const container = path.join(home, "src");
      const nested = path.join(container, "nested");
      await mkdir(direct, { recursive: true });
      await mkdir(nested, { recursive: true });
      await Git(direct, ["init"]);
      await Git(nested, ["init"]);

      const repositories = await ListRepositories(paths, home);
      assert.deepEqual(
        repositories.map((repository) => repository.name),
        ["direct"],
      );

      const cached = await ReadRepositoryMetadata(paths, repositories[0]!.repoId);
      assert.equal(cached.path, repositories[0]!.path);
    }));
});

test("ParseGitWorktreePorcelain prefers branch display metadata", () =>
{
  const parsed = ParseGitWorktreePorcelain(
    [
      "worktree /repo/main",
      "HEAD 1234567890abcdef",
      "branch refs/heads/main",
      "",
      "worktree /repo/feature",
      "HEAD abcdef1234567890",
      "branch refs/heads/feature/demo",
      "",
      "worktree /repo/detached",
      "HEAD fedcba9876543210",
      "detached",
    ].join("\n"),
  );

  assert.equal(parsed.length, 3);
  assert.equal(parsed[0]?.branch, "main");
  assert.equal(parsed[1]?.branch, "feature/demo");
  assert.equal(parsed[2]?.detached, true);
});

test("ListWorkspaces returns main worktree with branch display name", async () =>
{
  await WithTempStorage(async (paths) =>
    WithTempHome(async (home) =>
    {
      const repo = path.join(home, "repo");
      await mkdir(repo, { recursive: true });
      await Git(repo, ["init", "-b", "main"]);
      await writeFile(path.join(repo, "README.md"), "hello\n", "utf8");
      await Git(repo, ["add", "README.md"]);
      await Git(repo, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"]);

      const [repository] = await ListRepositories(paths, home);
      assert.ok(repository);
      const workspaces = await ListWorkspaces(paths, repository.repoId);
      assert.equal(workspaces.length, 1);
      assert.equal(workspaces[0]?.kind, "main");
      assert.equal(workspaces[0]?.displayName, "main");
      assert.equal(workspaces[0]?.branch, "main");
    }));
});

test("resolve reads cached metadata by id without rediscovery or rewriting", async () =>
{
  await WithTempStorage(async (paths) =>
    WithTempHome(async (home) =>
    {
      const originalHome = process.env.HOME;
      process.env.HOME = home; // empty home: any discovery fallback finds nothing

      try
      {
        // Cache a repository/workspace whose path is not discoverable under home,
        // so a fallback to discovery could not produce it.
        const repoPath = path.join(tmpdir(), "sheaf-chat-elsewhere-repo");
        const repository = {
          repoId: IdForCanonicalPath(repoPath),
          name: "elsewhere-repo",
          path: repoPath,
          discoveredAt: "2026-06-08T00:00:00.000Z",
        };
        const workspace = {
          repoId: repository.repoId,
          workspaceId: IdForCanonicalPath(repoPath),
          kind: "main" as const,
          path: repoPath,
          displayName: "main",
          discoveredAt: "2026-06-08T00:00:00.000Z",
        };
        await CacheRepositoryMetadata(paths, repository);
        await CacheWorkspaceMetadata(paths, workspace);

        // Resolve returns the cached metadata (discovery would find nothing).
        const resolvedRepo = await ResolveRepository(paths, repository.repoId);
        assert.equal(resolvedRepo.path, repoPath);
        const resolvedWorkspace = await ResolveWorkspace(
          paths,
          repository.repoId,
          workspace.workspaceId,
        );
        assert.equal(resolvedWorkspace.path, repoPath);

        // Re-caching identical stable metadata (only discoveredAt differs) does not rewrite.
        const repoFile = ResolveRepositoryMetadataPath(paths, repository.repoId);
        const before = await readFile(repoFile, "utf8");
        await CacheRepositoryMetadata(paths, {
          ...repository,
          discoveredAt: "2026-06-09T00:00:00.000Z",
        });
        assert.equal(await readFile(repoFile, "utf8"), before);

        // Unknown id after a cache miss raises not_found.
        await assert.rejects(
          () => ResolveRepository(paths, IdForCanonicalPath("/no/such/repo")),
          (error: unknown) => error instanceof StorageError && error.code === "not_found",
        );
      }
      finally
      {
        if (originalHome === undefined)
        {
          delete process.env.HOME;
        }
        else
        {
          process.env.HOME = originalHome;
        }
      }
    }));
});

test("workspace editor state normalizes paths and rejects escapes", async () =>
{
  await WithTempStorage(async (paths) =>
    WithTempHome(async (home) =>
    {
      const repo = path.join(home, "repo");
      await mkdir(repo, { recursive: true });
      await Git(repo, ["init", "-b", "main"]);
      const [repository] = await ListRepositories(paths, home);
      const [workspace] = await ListWorkspaces(paths, repository!.repoId);

      const state = await WriteWorkspaceEditorState(
        paths,
        repository!.repoId,
        workspace!.workspaceId,
        {
          tabs: ["README.md", "./README.md"],
          selectedPath: "src/index.ts",
          expandedDirectories: [".", "src"],
          viewports: {
            "README.md": { scrollTop: 12.9 },
          },
          navigation: {
            "README.md": {
              point: 9.8,
              mark: 2.1,
              markActive: true,
              line: 1.2,
              column: 4.6,
              before: "heading",
              after: " body",
            },
          },
        },
      );
      assert.deepEqual(state.tabs, ["README.md"]);
      assert.equal(state.viewports["README.md"]?.scrollTop, 12);
      assert.deepEqual(state.navigation["README.md"], {
        point: 9,
        mark: 2,
        markActive: true,
        line: 1,
        column: 4,
        before: "heading",
        after: " body",
      });
      assert.deepEqual(
        await ReadWorkspaceEditorState(paths, repository!.repoId, workspace!.workspaceId),
        state,
      );

      assert.throws(
        () => NormalizeWorkspaceEditorState({ tabs: ["../escape"] }),
        (error: unknown) => error instanceof StorageError && error.code === "path_escape",
      );
    }));
});
