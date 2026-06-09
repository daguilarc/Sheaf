import { appendFile, access, open, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import readline from "node:readline";

import type { AllocatedSessionShell, ModelReference, SessionLogEntry } from "../shared/types.js";
import type { ChatEnvelope, CreateChatEnvelopeInput } from "../shared/envelope.js";
import { CreateChatEnvelope } from "../shared/envelope.js";
import { StorageError } from "./errors.js";
import { ReadManifest, UpdateManifest } from "./manifests.js";
import { EnsurePileExists } from "./piles.js";
import {
  ResolveHistoryFilePath,
  ResolveProvisionalFilePath,
  ResolveRootDirectory,
  ResolveSessionFilePath,
  type StoragePaths,
} from "./paths.js";
import { ValidateSessionId } from "./validation.js";

export const x_defaultExtensionVersion = "0.1.0";

interface ProvisionalSessionRecord
{
  rootDirectory: string;
  model: ModelReference;
  createdAt: string;
}

const x_sequenceLocks = new Map<string, Promise<void>>();
const x_latestSequences = new Map<string, number>();
const x_tailReadChunkBytes = 64 * 1024;

function SessionKey(pile: string, sessionId: string): string
{
  return `${pile}\u0000${sessionId}`;
}

async function WithSessionLock<T>(
  pile: string,
  sessionId: string,
  operation: () => Promise<T>,
): Promise<T>
{
  const key = SessionKey(pile, sessionId);
  const previous = x_sequenceLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) =>
  {
    release = resolve;
  });
  const tail = previous.then(() => current);
  x_sequenceLocks.set(key, tail);

  await previous;

  try
  {
    return await operation();
  }
  finally
  {
    release();
    if (x_sequenceLocks.get(key) === tail)
    {
      x_sequenceLocks.delete(key);
    }
  }
}

function ParseSessionLogEntry(line: string): SessionLogEntry | null
{
  const trimmed = line.trim();

  if (trimmed.length === 0)
  {
    return null;
  }

  try
  {
    return JSON.parse(trimmed) as SessionLogEntry;
  }
  catch
  {
    return null;
  }
}

export async function ReadAllSessionLogEntries(
  paths: StoragePaths,
  pile: string,
  sessionId: string,
): Promise<SessionLogEntry[]>
{
  const historyPath = ResolveHistoryFilePath(paths, pile, sessionId);

  let raw: string;

  try
  {
    raw = await readFile(historyPath, "utf8");
  }
  catch
  {
    return [];
  }

  const entries: SessionLogEntry[] = [];

  for (const line of raw.split("\n"))
  {
    const entry = ParseSessionLogEntry(line);

    if (entry !== null)
    {
      entries.push(entry);
    }
  }

  entries.sort((left, right) => left.sequence - right.sequence);
  return entries;
}

export async function ReadLatestSequence(
  paths: StoragePaths,
  pile: string,
  sessionId: string,
): Promise<number>
{
  const entries = await ReadAllSessionLogEntries(paths, pile, sessionId);

  if (entries.length === 0)
  {
    return 0;
  }

  return entries[entries.length - 1].sequence;
}

function LastLine(raw: string): string | null
{
  const trimmedEnd = raw.replace(/\n+$/, "");

  if (trimmedEnd.length === 0)
  {
    return null;
  }

  const newlineIndex = trimmedEnd.lastIndexOf("\n");
  return newlineIndex === -1 ? trimmedEnd : trimmedEnd.slice(newlineIndex + 1);
}

async function ReadLatestSequenceFromHistoryTail(historyPath: string): Promise<number>
{
  let file;

  try
  {
    file = await open(historyPath, "r");
  }
  catch
  {
    return 0;
  }

  try
  {
    const stats = await file.stat();

    if (stats.size === 0)
    {
      return 0;
    }

    let bytesToRead = Math.min(x_tailReadChunkBytes, stats.size);

    while (bytesToRead <= stats.size)
    {
      const buffer = Buffer.alloc(bytesToRead);
      await file.read(buffer, 0, bytesToRead, stats.size - bytesToRead);
      const latestLine = LastLine(buffer.toString("utf8"));

      if (latestLine !== null)
      {
        const entry = ParseSessionLogEntry(latestLine);

        if (entry !== null)
        {
          return entry.sequence;
        }
      }

      if (bytesToRead === stats.size)
      {
        break;
      }

      bytesToRead = Math.min(bytesToRead * 2, stats.size);
    }
  }
  finally
  {
    await file.close();
  }

  return 0;
}

async function ReadLatestSequenceFromManifest(
  paths: StoragePaths,
  pile: string,
  sessionId: string,
): Promise<number>
{
  try
  {
    const manifest = await ReadManifest(paths, pile, sessionId);
    return manifest.history.lastSequence;
  }
  catch (error)
  {
    if (error instanceof StorageError && error.code === "manifest_not_found")
    {
      return 0;
    }

    throw error;
  }
}

async function InitializeLatestSequence(
  paths: StoragePaths,
  pile: string,
  sessionId: string,
): Promise<number>
{
  const key = SessionKey(pile, sessionId);
  const cached = x_latestSequences.get(key);

  if (cached !== undefined)
  {
    return cached;
  }

  const historyPath = ResolveHistoryFilePath(paths, pile, sessionId);
  const [manifestSequence, tailSequence] = await Promise.all([
    ReadLatestSequenceFromManifest(paths, pile, sessionId),
    ReadLatestSequenceFromHistoryTail(historyPath),
  ]);
  const latestSequence = Math.max(manifestSequence, tailSequence);
  x_latestSequences.set(key, latestSequence);
  return latestSequence;
}

async function StreamSessionLogEntries(
  historyPath: string,
  onEntry: (entry: SessionLogEntry) => void | Promise<void>,
): Promise<void>
{
  try
  {
    await access(historyPath);
  }
  catch
  {
    return;
  }

  const stream = createReadStream(historyPath, { encoding: "utf8" });
  const lineReader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  try
  {
    for await (const line of lineReader)
    {
      const entry = ParseSessionLogEntry(line);

      if (entry !== null)
      {
        await onEntry(entry);
      }
    }
  }
  finally
  {
    lineReader.close();
    stream.destroy();
  }
}

export async function AllocateSessionShell(
  paths: StoragePaths,
  pile: string,
  rootDirectory: string,
  model: ModelReference,
): Promise<AllocatedSessionShell>
{
  await EnsurePileExists(paths, pile);
  const sessionId = ValidateSessionId(randomUUID().replace(/-/g, ""));
  const absoluteRoot = ResolveRootDirectory(paths.repoRoot, rootDirectory);
  const sessionFilePath = ResolveSessionFilePath(paths, pile, sessionId);
  const historyFilePath = ResolveHistoryFilePath(paths, pile, sessionId);
  const provisionalFilePath = ResolveProvisionalFilePath(paths, pile, sessionId);
  const provisionalRecord: ProvisionalSessionRecord = {
    rootDirectory: absoluteRoot,
    model,
    createdAt: new Date().toISOString(),
  };

  await writeFile(sessionFilePath, "", "utf8");
  await writeFile(historyFilePath, "", "utf8");
  await writeFile(
    provisionalFilePath,
    `${JSON.stringify(provisionalRecord, null, 2)}\n`,
    "utf8",
  );

  return {
    pile,
    sessionId,
    provisionalSession: {
      rootDirectory: absoluteRoot,
      model,
    },
    sessionFilePath,
    historyFilePath,
  };
}

export interface AppendEnvelopeInput extends Omit<CreateChatEnvelopeInput, "sequence">
{
  sequence?: number;
}

export async function AppendEnvelope(
  paths: StoragePaths,
  pile: string,
  sessionId: string,
  input: AppendEnvelopeInput,
): Promise<ChatEnvelope>
{
  const validatedSessionId = ValidateSessionId(sessionId);

  return WithSessionLock(pile, validatedSessionId, async () =>
  {
    const historyPath = ResolveHistoryFilePath(paths, pile, validatedSessionId);
    const latestSequence = await InitializeLatestSequence(paths, pile, validatedSessionId);
    const sequence = input.sequence ?? latestSequence + 1;

    if (sequence <= latestSequence)
    {
      throw new StorageError(
        "invalid_sequence",
        `sequence ${sequence} is not greater than latest ${latestSequence}`,
      );
    }

    const envelope = CreateChatEnvelope({
      ...input,
      pile,
      sessionId: validatedSessionId,
      sequence,
    });
    const entry: SessionLogEntry = {
      sequence,
      envelope,
    };

    await appendFile(historyPath, `${JSON.stringify(entry)}\n`, "utf8");
    x_latestSequences.set(SessionKey(pile, validatedSessionId), sequence);

    try
    {
      await UpdateManifest(paths, pile, validatedSessionId, {
        lastSequence: sequence,
      });
    }
    catch (error)
    {
      if (!(error instanceof StorageError && error.code === "manifest_not_found"))
      {
        throw error;
      }
    }

    return envelope;
  });
}

export async function CollectSessionLogEntries(
  paths: StoragePaths,
  pile: string,
  sessionId: string,
): Promise<SessionLogEntry[]>
{
  const historyPath = ResolveHistoryFilePath(paths, pile, sessionId);
  const entries: SessionLogEntry[] = [];

  await StreamSessionLogEntries(historyPath, (entry) =>
  {
    entries.push(entry);
  });

  entries.sort((left, right) => left.sequence - right.sequence);
  return entries;
}
