import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { PileSummary } from "../shared/types.js";
import { StorageError } from "./errors.js";
import {
  AssertPilePathWithinRoot,
  CreateStoragePaths,
  ResolveManifestFilePath,
  ResolvePileDirectory,
  type StoragePaths,
} from "./paths.js";
import { ValidatePileName } from "./validation.js";

export type { StoragePaths };

async function ReadManifestUpdatedAt(manifestPath: string): Promise<string | null>
{
  try
  {
    const manifestStat = await stat(manifestPath);
    return manifestStat.mtime.toISOString();
  }
  catch
  {
    return null;
  }
}

export async function CreatePile(paths: StoragePaths, pile: string): Promise<PileSummary>
{
  const validatedPile = ValidatePileName(pile);
  const pileDirectory = ResolvePileDirectory(paths, validatedPile);
  await mkdir(pileDirectory, { recursive: true });
  await AssertPilePathWithinRoot(paths, pileDirectory);

  return {
    pile: validatedPile,
    sessionCount: 0,
    latestUpdatedAt: null,
  };
}

export async function ListPiles(paths: StoragePaths): Promise<PileSummary[]>
{
  await mkdir(paths.pilesDir, { recursive: true });

  let entries: string[];

  try
  {
    entries = await readdir(paths.pilesDir);
  }
  catch
  {
    return [];
  }

  const summaries: PileSummary[] = [];

  for (const entry of entries)
  {
    let validatedPile: string;

    try
    {
      validatedPile = ValidatePileName(entry);
    }
    catch
    {
      continue;
    }

    const pileDirectory = path.join(paths.pilesDir, validatedPile);
    const pileStat = await stat(pileDirectory);

    if (!pileStat.isDirectory())
    {
      continue;
    }

    let sessionCount = 0;
    let latestUpdatedAt: string | null = null;
    const pileEntries = await readdir(pileDirectory);

    for (const pileEntry of pileEntries)
    {
      if (!pileEntry.endsWith(".manifest.json"))
      {
        continue;
      }

      sessionCount += 1;
      const manifestPath = path.join(pileDirectory, pileEntry);
      const updatedAt = await ReadManifestUpdatedAt(manifestPath);

      if (updatedAt !== null && (latestUpdatedAt === null || updatedAt > latestUpdatedAt))
      {
        latestUpdatedAt = updatedAt;
      }
    }

    summaries.push({
      pile: validatedPile,
      sessionCount,
      latestUpdatedAt,
    });
  }

  summaries.sort((left, right) => left.pile.localeCompare(right.pile));
  return summaries;
}

export async function EnsurePileExists(paths: StoragePaths, pile: string): Promise<void>
{
  const validatedPile = ValidatePileName(pile);
  const pileDirectory = ResolvePileDirectory(paths, validatedPile);

  try
  {
    const pileStat = await stat(pileDirectory);

    if (!pileStat.isDirectory())
    {
      throw new StorageError("pile_not_found", `pile not found: ${validatedPile}`);
    }
  }
  catch (error)
  {
    if (error instanceof StorageError)
    {
      throw error;
    }

    throw new StorageError("pile_not_found", `pile not found: ${validatedPile}`);
  }

  await AssertPilePathWithinRoot(paths, pileDirectory);
}

export async function ManifestExists(
  paths: StoragePaths,
  pile: string,
  sessionId: string,
): Promise<boolean>
{
  try
  {
    await stat(ResolveManifestFilePath(paths, pile, sessionId));
    return true;
  }
  catch
  {
    return false;
  }
}
