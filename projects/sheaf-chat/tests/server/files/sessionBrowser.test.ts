import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CreateRootPolicy } from "../../../src/extensions/sheaf-chat/pathPolicy.js";
import { StorageError } from "../../../src/storage/errors.js";
import {
  ListSessionDirectory,
  ResolveBrowserRelativePath,
} from "../../../src/server/files/sessionBrowser.js";

test("ResolveBrowserRelativePath rejects absolute browser inputs even when RootPolicy accepts them", async () =>
{
  const policy = await CreateRootPolicy(path.resolve("."));
  const absoluteInsideRoot = path.join(policy.canonicalRoot, "inside.txt");

  await assert.rejects(
    () => ResolveBrowserRelativePath(policy, absoluteInsideRoot),
    (error: unknown) =>
      error instanceof StorageError && error.code === "path_escape",
  );
});

test("ListSessionDirectory reports in-root symlinks at their own entry path", async () =>
{
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "sheaf-browser-"));

  try
  {
    const docsDirectory = path.join(rootDirectory, "docs");
    const subDirectory = path.join(docsDirectory, "sub");
    const linkPath = path.join(docsDirectory, "link");

    await mkdir(subDirectory, { recursive: true });
    await symlink(subDirectory, linkPath, "dir");

    const policy = await CreateRootPolicy(rootDirectory);
    const listing = await ListSessionDirectory(policy, "docs");
    const linkEntry = listing.entries.find((entry) => entry.name === "link");

    assert.ok(linkEntry);
    assert.equal(linkEntry.path, "docs/link");
    assert.equal(path.posix.basename(linkEntry.path), linkEntry.name);
    assert.equal(linkEntry.kind, "directory");

    assert.ok(listing.entries.some((entry) => entry.path === "docs/sub"));
    assert.equal(
      new Set(listing.entries.map((entry) => entry.path)).size,
      listing.entries.length,
    );
  }
  finally
  {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});
