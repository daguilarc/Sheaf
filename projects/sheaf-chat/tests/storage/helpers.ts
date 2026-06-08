import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { CreateStoragePaths, type StoragePaths } from "../../src/storage/paths.js";

export async function WithTempStorage<T>(
  callback: (paths: StoragePaths) => Promise<T>,
): Promise<T>
{
  const repoRoot = await mkdtemp(path.join(tmpdir(), "sheaf-chat-storage-"));

  try
  {
    return await callback(CreateStoragePaths(repoRoot));
  }
  finally
  {
    await rm(repoRoot, { recursive: true, force: true });
  }
}
