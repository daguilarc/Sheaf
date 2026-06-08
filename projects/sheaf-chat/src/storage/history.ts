import type { HistoryPage, HistoryPageRequest, SessionLogEntry } from "../shared/types.js";
import type { ChatEnvelope } from "../shared/envelope.js";
import { StorageError } from "./errors.js";
import { CollectSessionLogEntries } from "./sessionLog.js";
import type { StoragePaths } from "./paths.js";
import { ValidateSessionId } from "./validation.js";

export const x_defaultHistoryLimit = 50;
export const x_maxHistoryLimit = 200;

function ClampHistoryLimit(limit: number | undefined): number
{
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0)
  {
    return x_defaultHistoryLimit;
  }

  return Math.min(Math.floor(limit), x_maxHistoryLimit);
}

function EnvelopesFromEntries(entries: SessionLogEntry[]): ChatEnvelope[]
{
  return entries.map((entry) => entry.envelope);
}

function SequenceBounds(entries: SessionLogEntry[]): {
  oldestSequence: number | null;
  newestSequence: number | null;
}
{
  if (entries.length === 0)
  {
    return {
      oldestSequence: null,
      newestSequence: null,
    };
  }

  return {
    oldestSequence: entries[0].sequence,
    newestSequence: entries[entries.length - 1].sequence,
  };
}

function ValidateHistoryRequest(request: HistoryPageRequest): HistoryPageRequest
{
  const hasBefore = request.before !== undefined;
  const hasAfter = request.after !== undefined;

  if (hasBefore && hasAfter)
  {
    throw new StorageError(
      "invalid_history_request",
      "history request cannot include both before and after cursors",
    );
  }

  return request;
}

function BuildLatestPage(entries: SessionLogEntry[], limit: number): HistoryPage
{
  const pageEntries = entries.slice(Math.max(0, entries.length - limit));
  const bounds = SequenceBounds(pageEntries);
  const allBounds = SequenceBounds(entries);

  return {
    direction: "latest",
    envelopes: EnvelopesFromEntries(pageEntries),
    oldestSequence: bounds.oldestSequence,
    newestSequence: bounds.newestSequence ?? allBounds.newestSequence,
    hasMoreBefore: entries.length > pageEntries.length,
    hasMoreAfter: false,
  };
}

function BuildBeforePage(
  entries: SessionLogEntry[],
  before: number,
  limit: number,
): HistoryPage
{
  const olderEntries = entries.filter((entry) => entry.sequence < before);
  const pageEntries = olderEntries.slice(Math.max(0, olderEntries.length - limit));
  const bounds = SequenceBounds(pageEntries);
  const pageNewest = bounds.newestSequence;
  const hasMoreAfter =
    pageNewest !== null &&
    entries.some((entry) => entry.sequence > pageNewest && entry.sequence < before);

  return {
    direction: "before",
    envelopes: EnvelopesFromEntries(pageEntries),
    oldestSequence: bounds.oldestSequence,
    newestSequence: bounds.newestSequence,
    hasMoreBefore: olderEntries.length > pageEntries.length,
    hasMoreAfter,
  };
}

function BuildAfterPage(
  entries: SessionLogEntry[],
  after: number,
  limit: number,
): HistoryPage
{
  const newerEntries = entries.filter((entry) => entry.sequence > after);
  const pageEntries = newerEntries.slice(0, limit);
  const bounds = SequenceBounds(pageEntries);
  const allBounds = SequenceBounds(entries);

  return {
    direction: "after",
    envelopes: EnvelopesFromEntries(pageEntries),
    oldestSequence: bounds.oldestSequence,
    newestSequence: bounds.newestSequence ?? allBounds.newestSequence,
    hasMoreAfter: newerEntries.length > pageEntries.length,
    hasMoreBefore: false,
  };
}

export async function ReadHistoryPage(
  paths: StoragePaths,
  pile: string,
  sessionId: string,
  request: HistoryPageRequest = {},
): Promise<HistoryPage>
{
  const validatedSessionId = ValidateSessionId(sessionId);
  const validatedRequest = ValidateHistoryRequest(request);
  const limit = ClampHistoryLimit(validatedRequest.limit);
  const entries = await CollectSessionLogEntries(paths, pile, validatedSessionId);

  if (validatedRequest.before !== undefined)
  {
    return BuildBeforePage(entries, validatedRequest.before, limit);
  }

  if (validatedRequest.after !== undefined)
  {
    return BuildAfterPage(entries, validatedRequest.after, limit);
  }

  return BuildLatestPage(entries, limit);
}
