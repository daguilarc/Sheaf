import assert from "node:assert/strict";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { StorageError } from "../../src/storage/errors.js";
import {
  AssertPathWithinRoot,
  ResolveRepositoryDirectory,
  ResolveRootDirectory,
} from "../../src/storage/paths.js";
import { WithTempStorage } from "./helpers.js";

test("ResolveRootDirectory stores absolute paths for relative inputs", async () =>
{
  await WithTempStorage(async (paths) =>
  {
    const resolved = ResolveRootDirectory(paths.repoRoot, "projects/example-app");
    assert.equal(resolved, path.resolve(paths.repoRoot, "projects/example-app"));
    assert.ok(path.isAbsolute(resolved));
  });
});

test("ResolveRepositoryDirectory rejects traversal through generated ids", async () =>
{
  await WithTempStorage(async (paths) =>
  {
    assert.throws(
      () => ResolveRepositoryDirectory(paths, "../escape"),
      (error: unknown) => error instanceof StorageError,
    );
  });
});

test("AssertPathWithinRoot rejects symlink escapes from the repositories root", async () =>
{
  await WithTempStorage(async (paths) =>
  {
    await mkdir(paths.repositoriesDir, { recursive: true });
    const outsideDir = path.join(paths.repoRoot, "outside");
    const linkPath = path.join(paths.repositoriesDir, "linked");
    await mkdir(outsideDir, { recursive: true });
    await writeFile(path.join(outsideDir, "secret.txt"), "nope", "utf8");
    await symlink(outsideDir, linkPath, "dir");

    await assert.rejects(
      () => AssertPathWithinRoot(linkPath, paths.repositoriesDir),
      (error: unknown) => error instanceof StorageError && error.code === "path_escape",
    );
  });
});
