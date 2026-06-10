import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { CreateRootPolicy } from "../../../src/extensions/sheaf-chat/pathPolicy.js";
import { StorageError } from "../../../src/storage/errors.js";
import { ResolveBrowserRelativePath } from "../../../src/server/files/sessionBrowser.js";

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
