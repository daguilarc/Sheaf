import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { PathEscapeError } from "../../src/extensions/sheaf-chat/errors.js";
import { CreateRootPolicy } from "../../src/extensions/sheaf-chat/pathPolicy.js";

async function WithPolicy<T>(
  setup: (rootDirectory: string, outsideDirectory: string) => Promise<void>,
  callback: (policy: Awaited<ReturnType<typeof CreateRootPolicy>>, rootDirectory: string) => Promise<T>,
): Promise<T>
{
  const parent = await mkdtemp(path.join(tmpdir(), "sheaf-chat-policy-"));
  const rootDirectory = path.join(parent, "root");
  const outsideDirectory = path.join(parent, "outside");
  await mkdir(rootDirectory, { recursive: true });
  await mkdir(outsideDirectory, { recursive: true });

  try
  {
    await setup(rootDirectory, outsideDirectory);
    const policy = await CreateRootPolicy(rootDirectory);
    return await callback(policy, rootDirectory);
  }
  finally
  {
    await rm(parent, { recursive: true, force: true });
  }
}

test("CreateRootPolicy resolves root-relative paths and renders relative display paths", async () =>
{
  await WithPolicy(
    async (rootDirectory) =>
    {
      await writeFile(path.join(rootDirectory, "a.txt"), "hello", "utf-8");
    },
    async (policy, rootDirectory) =>
    {
      const resolved = await policy.ResolveInputPath("a.txt");
      assert.equal(path.basename(resolved), "a.txt");
      assert.equal(policy.ToRootRelativePath(resolved), "a.txt");
      assert.equal(policy.ToRootRelativePath(policy.canonicalRoot), ".");
    },
  );
});

test("CreateRootPolicy rejects parent traversal and absolute paths outside root", async () =>
{
  await WithPolicy(
    async (rootDirectory, outsideDirectory) =>
    {
      await writeFile(path.join(outsideDirectory, "secret.txt"), "secret", "utf-8");
      await writeFile(path.join(rootDirectory, "inside.txt"), "inside", "utf-8");
    },
    async (policy, rootDirectory) =>
    {
      await assert.rejects(
        () => policy.ResolveInputPath("../outside/secret.txt"),
        (error: unknown) => error instanceof PathEscapeError,
      );

      const outsideFile = path.resolve(rootDirectory, "../outside/secret.txt");
      await assert.rejects(
        () => policy.ResolveInputPath(outsideFile),
        (error: unknown) => error instanceof PathEscapeError,
      );
    },
  );
});

test("CreateRootPolicy rejects symlink escapes and backslash traversal input", async () =>
{
  await WithPolicy(
    async (rootDirectory, outsideDirectory) =>
    {
      await writeFile(path.join(outsideDirectory, "secret.txt"), "secret", "utf-8");
      await symlink(
        path.join(outsideDirectory, "secret.txt"),
        path.join(rootDirectory, "escape-link"),
      );
    },
    async (policy) =>
    {
      await assert.rejects(
        () => policy.ResolveInputPath("escape-link"),
        (error: unknown) => error instanceof PathEscapeError,
      );

      await assert.rejects(
        () => policy.ResolveInputPath("nested\\..\\escape-link"),
        (error: unknown) => error instanceof PathEscapeError,
      );
    },
  );
});

test("CreateRootPolicy canonicalizes through realpath before asserting within root", async () =>
{
  await WithPolicy(
    async (rootDirectory) =>
    {
      const nested = path.join(rootDirectory, "nested");
      await mkdir(nested, { recursive: true });
      await writeFile(path.join(nested, "file.txt"), "data", "utf-8");
      await symlink(nested, path.join(rootDirectory, "alias"), "dir");
    },
    async (policy) =>
    {
      const resolved = await policy.ResolveInputPath("alias/file.txt");
      const canonical = await realpath(resolved);
      assert.equal(policy.ToRootRelativePath(canonical), "nested/file.txt");
    },
  );
});
