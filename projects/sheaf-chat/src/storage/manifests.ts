import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  ChatManifest,
  UpdateManifestInput,
  WriteInitialManifestInput,
} from "../shared/types.js";
import { x_manifestSchemaVersion } from "../shared/types.js";
import { StorageError } from "./errors.js";
import {
  ManifestSessionFileReference,
  ResolveChatsDirectory,
  ResolveManifestFilePath,
  type StoragePaths,
} from "./paths.js";
import { ResolveRepository, ResolveWorkspace } from "./repositories.js";
import { ValidateChatId } from "./validation.js";

function ParseManifest(
  raw: string,
  repoId: string,
  workspaceId: string,
  chatId: string,
): ChatManifest
{
  let parsed: ChatManifest;

  try
  {
    parsed = JSON.parse(raw) as ChatManifest;
  }
  catch
  {
    throw new StorageError("invalid_manifest", "manifest is not valid JSON");
  }

  if (
    parsed.repoId !== repoId ||
    parsed.workspaceId !== workspaceId ||
    parsed.chatId !== chatId
  )
  {
    throw new StorageError("invalid_manifest", "manifest identity does not match request");
  }

  return parsed;
}

export async function ReadManifest(
  paths: StoragePaths,
  repoId: string,
  workspaceId: string,
  chatId: string,
): Promise<ChatManifest>
{
  const validatedChatId = ValidateChatId(chatId);
  const manifestPath = ResolveManifestFilePath(paths, repoId, workspaceId, validatedChatId);

  let raw: string;

  try
  {
    raw = await readFile(manifestPath, "utf8");
  }
  catch
  {
    throw new StorageError(
      "manifest_not_found",
      `manifest not found for chat ${validatedChatId}`,
    );
  }

  return ParseManifest(raw, repoId, workspaceId, validatedChatId);
}

export async function ListChatManifests(
  paths: StoragePaths,
  repoId: string,
  workspaceId: string,
): Promise<ChatManifest[]>
{
  await ResolveWorkspace(paths, repoId, workspaceId);
  const chatsDirectory = ResolveChatsDirectory(paths, repoId, workspaceId);
  let entries: string[];

  try
  {
    entries = await readdir(chatsDirectory);
  }
  catch
  {
    return [];
  }

  const manifests: ChatManifest[] = [];

  for (const entry of entries)
  {
    if (!entry.endsWith(".manifest.json"))
    {
      continue;
    }

    const chatId = entry.slice(0, -".manifest.json".length);

    try
    {
      ValidateChatId(chatId);
      manifests.push(await ReadManifest(paths, repoId, workspaceId, chatId));
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
): Promise<ChatManifest>
{
  const repoId = input.repoId;
  const workspaceId = input.workspaceId;
  const chatId = input.chatId;
  const repositoryPath = input.repositoryPath;
  const workspacePath = input.workspacePath;
  await ResolveRepository(paths, repoId).catch(() => undefined);
  await ResolveWorkspace(paths, repoId, workspaceId).catch(() => undefined);
  const validatedChatId = ValidateChatId(chatId);
  const manifestPath = ResolveManifestFilePath(
    paths,
    repoId,
    workspaceId,
    validatedChatId,
  );
  const now = new Date().toISOString();
  const manifest: ChatManifest = {
    schemaVersion: x_manifestSchemaVersion,
    repoId,
    workspaceId,
    chatId: validatedChatId,
    repositoryPath,
    workspacePath,
    chatName: input.chatName,
    description: input.description,
    rootDirectory: input.rootDirectory,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    model: input.model,
    pi: {
      sessionFile: ManifestSessionFileReference(
        paths.repoRoot,
        repoId,
        workspaceId,
        validatedChatId,
      ),
      extensionVersion: input.extensionVersion,
    },
    history: {
      messageCount: input.messageCount ?? 0,
      lastSequence: input.lastSequence ?? 0,
    },
  };

  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export async function UpdateManifest(
  paths: StoragePaths,
  repoId: string,
  workspaceId: string,
  chatId: string,
  update: UpdateManifestInput,
): Promise<ChatManifest>
{
  const manifest = await ReadManifest(paths, repoId, workspaceId, chatId);
  const updated: ChatManifest = {
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

  const manifestPath = ResolveManifestFilePath(paths, repoId, workspaceId, chatId);
  await writeFile(manifestPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  return updated;
}

export async function ManifestExists(
  paths: StoragePaths,
  repoId: string,
  workspaceId: string,
  chatId: string,
): Promise<boolean>
{
  try
  {
    await readFile(ResolveManifestFilePath(paths, repoId, workspaceId, chatId), "utf8");
    return true;
  }
  catch
  {
    return false;
  }
}
