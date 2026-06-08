import { readFile, readdir, writeFile } from "node:fs/promises";

import type {
  SessionManifest,
  UpdateManifestInput,
  WriteInitialManifestInput,
} from "../shared/types.js";
import { x_manifestSchemaVersion } from "../shared/types.js";
import { StorageError } from "./errors.js";
import { EnsurePileExists } from "./piles.js";
import {
  ManifestSessionFileReference,
  ResolveManifestFilePath,
  ResolvePileDirectory,
  type StoragePaths,
} from "./paths.js";
import { ValidateSessionId } from "./validation.js";

function ParseManifest(raw: string, pile: string, sessionId: string): SessionManifest
{
  let parsed: SessionManifest;

  try
  {
    parsed = JSON.parse(raw) as SessionManifest;
  }
  catch
  {
    throw new StorageError("invalid_manifest", "manifest is not valid JSON");
  }

  if (parsed.pile !== pile || parsed.sessionId !== sessionId)
  {
    throw new StorageError("invalid_manifest", "manifest identity does not match request");
  }

  return parsed;
}

export async function ReadManifest(
  paths: StoragePaths,
  pile: string,
  sessionId: string,
): Promise<SessionManifest>
{
  await EnsurePileExists(paths, pile);
  const validatedSessionId = ValidateSessionId(sessionId);
  const manifestPath = ResolveManifestFilePath(paths, pile, validatedSessionId);

  let raw: string;

  try
  {
    raw = await readFile(manifestPath, "utf8");
  }
  catch
  {
    throw new StorageError(
      "manifest_not_found",
      `manifest not found for session ${validatedSessionId}`,
    );
  }

  return ParseManifest(raw, pile, validatedSessionId);
}

export async function ListSessionManifests(
  paths: StoragePaths,
  pile: string,
): Promise<SessionManifest[]>
{
  await EnsurePileExists(paths, pile);
  const pileDirectory = ResolvePileDirectory(paths, pile);
  const entries = await readdir(pileDirectory);
  const manifests: SessionManifest[] = [];

  for (const entry of entries)
  {
    if (!entry.endsWith(".manifest.json"))
    {
      continue;
    }

    const sessionId = entry.slice(0, -".manifest.json".length);

    try
    {
      ValidateSessionId(sessionId);
      manifests.push(await ReadManifest(paths, pile, sessionId));
    }
    catch
    {
      continue;
    }
  }

  manifests.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return manifests;
}

export async function WriteInitialManifest(
  paths: StoragePaths,
  input: WriteInitialManifestInput,
): Promise<SessionManifest>
{
  await EnsurePileExists(paths, input.pile);
  const validatedSessionId = ValidateSessionId(input.sessionId);
  const manifestPath = ResolveManifestFilePath(paths, input.pile, validatedSessionId);
  const now = new Date().toISOString();
  const manifest: SessionManifest = {
    schemaVersion: x_manifestSchemaVersion,
    pile: input.pile,
    sessionId: validatedSessionId,
    chatName: input.chatName,
    description: input.description,
    rootDirectory: input.rootDirectory,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    model: input.model,
    pi: {
      sessionFile: ManifestSessionFileReference(paths.repoRoot, input.pile, validatedSessionId),
      extensionVersion: input.extensionVersion,
    },
    history: {
      messageCount: input.messageCount ?? 0,
      lastSequence: input.lastSequence ?? 0,
    },
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export async function UpdateManifest(
  paths: StoragePaths,
  pile: string,
  sessionId: string,
  update: UpdateManifestInput,
): Promise<SessionManifest>
{
  const manifest = await ReadManifest(paths, pile, sessionId);
  const updated: SessionManifest = {
    ...manifest,
    chatName: update.chatName ?? manifest.chatName,
    description: update.description ?? manifest.description,
    rootDirectory: update.rootDirectory ?? manifest.rootDirectory,
    model: update.model ?? manifest.model,
    lastOpenedAt: update.lastOpenedAt ?? manifest.lastOpenedAt,
    updatedAt: new Date().toISOString(),
    history: {
      messageCount: update.messageCount ?? manifest.history.messageCount,
      lastSequence: update.lastSequence ?? manifest.history.lastSequence,
    },
  };

  const manifestPath = ResolveManifestFilePath(paths, pile, sessionId);
  await writeFile(manifestPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  return updated;
}
