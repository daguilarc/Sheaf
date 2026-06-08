import type { ChatEnvelope } from "../shared/envelope.js";
import type { HistoryPageRequest, ModelReference } from "../shared/types.js";
import { StorageError } from "../storage/errors.js";

export const x_clientHelloKind = "client.hello";
export const x_clientUserMessageKind = "client.user_message";
export const x_clientHistoryRequestKind = "client.history_request";
export const x_clientModelSelectKind = "client.model_select";
export const x_clientAckKind = "client.ack";
export const x_clientCancelKind = "client.cancel";
export const x_clientStopGeneratingKind = "client.stop_generating";
export const x_clientPingKind = "client.ping";

export interface ClientHelloPayload
{
  supportsSnapshots?: boolean;
  supportsLazyHistory?: boolean;
  lastSeenSequence?: number;
}

export interface ClientUserMessagePayload
{
  messageId: string;
  text: string;
  attachments?: unknown[];
  steer?: boolean;
}

export interface ClientHistoryRequestPayload extends HistoryPageRequest
{
}

export interface ClientModelSelectPayload
{
  provider: string;
  id: string;
  applyTo?: "next_turn" | "current_turn";
}

export interface ClientAckPayload
{
  sequence: number;
}

export type ParsedClientFrame =
  | { kind: typeof x_clientHelloKind; frame: ChatEnvelope; payload: ClientHelloPayload }
  | { kind: typeof x_clientUserMessageKind; frame: ChatEnvelope; payload: ClientUserMessagePayload }
  | { kind: typeof x_clientHistoryRequestKind; frame: ChatEnvelope; payload: ClientHistoryRequestPayload }
  | { kind: typeof x_clientModelSelectKind; frame: ChatEnvelope; payload: ClientModelSelectPayload }
  | { kind: typeof x_clientAckKind; frame: ChatEnvelope; payload: ClientAckPayload }
  | { kind: typeof x_clientCancelKind; frame: ChatEnvelope }
  | { kind: typeof x_clientStopGeneratingKind; frame: ChatEnvelope }
  | { kind: typeof x_clientPingKind; frame: ChatEnvelope };

function IsRecord(value: unknown): value is Record<string, unknown>
{
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function RequireString(value: unknown, label: string): string
{
  if (typeof value !== "string" || value.trim().length === 0)
  {
    throw new StorageError("invalid_frame", `${label} is required`);
  }

  return value;
}

function ParseChatEnvelope(value: unknown): ChatEnvelope
{
  if (!IsRecord(value))
  {
    throw new StorageError("invalid_frame", "frame must be a JSON object");
  }

  if (value.v !== 1)
  {
    throw new StorageError("invalid_frame", "frame version must be 1");
  }

  if (typeof value.kind !== "string" || value.kind.length === 0)
  {
    throw new StorageError("invalid_frame", "frame kind is required");
  }

  if (typeof value.id !== "string" || value.id.length === 0)
  {
    throw new StorageError("invalid_frame", "frame id is required");
  }

  if (typeof value.pile !== "string" || value.pile.length === 0)
  {
    throw new StorageError("invalid_frame", "frame pile is required");
  }

  if (typeof value.sessionId !== "string" || value.sessionId.length === 0)
  {
    throw new StorageError("invalid_frame", "frame sessionId is required");
  }

  if (typeof value.timestamp !== "string" || value.timestamp.length === 0)
  {
    throw new StorageError("invalid_frame", "frame timestamp is required");
  }

  if (value.sequence !== undefined && typeof value.sequence !== "number")
  {
    throw new StorageError("invalid_frame", "frame sequence must be a number when present");
  }

  return value as unknown as ChatEnvelope;
}

function ParseUserMessagePayload(payload: unknown): ClientUserMessagePayload
{
  if (!IsRecord(payload))
  {
    throw new StorageError("invalid_frame", "client.user_message payload must be an object");
  }

  return {
    messageId: RequireString(payload.messageId, "messageId"),
    text: RequireString(payload.text, "text"),
    attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
    steer: payload.steer === true,
  };
}

function ParseHistoryRequestPayload(payload: unknown): ClientHistoryRequestPayload
{
  if (!IsRecord(payload))
  {
    throw new StorageError("invalid_frame", "client.history_request payload must be an object");
  }

  const request: ClientHistoryRequestPayload = {};

  if (payload.before !== undefined)
  {
    if (typeof payload.before !== "number" || !Number.isFinite(payload.before))
    {
      throw new StorageError("invalid_frame", "before must be a number");
    }

    request.before = payload.before;
  }

  if (payload.after !== undefined)
  {
    if (typeof payload.after !== "number" || !Number.isFinite(payload.after))
    {
      throw new StorageError("invalid_frame", "after must be a number");
    }

    request.after = payload.after;
  }

  if (payload.before !== undefined && payload.after !== undefined)
  {
    throw new StorageError(
      "invalid_history_request",
      "history request cannot include both before and after cursors",
    );
  }

  if (payload.limit !== undefined)
  {
    if (typeof payload.limit !== "number" || !Number.isFinite(payload.limit))
    {
      throw new StorageError("invalid_frame", "limit must be a number");
    }

    request.limit = payload.limit;
  }

  if (payload.prefer === "events" || payload.prefer === "snapshots")
  {
    request.prefer = payload.prefer;
  }
  else if (payload.prefer !== undefined)
  {
    throw new StorageError("invalid_frame", "prefer must be events or snapshots");
  }

  return request;
}

function ParseModelSelectPayload(payload: unknown): ClientModelSelectPayload
{
  if (!IsRecord(payload))
  {
    throw new StorageError("invalid_frame", "client.model_select payload must be an object");
  }

  const applyTo = payload.applyTo;

  if (applyTo !== undefined && applyTo !== "next_turn" && applyTo !== "current_turn")
  {
    throw new StorageError("invalid_frame", "applyTo must be next_turn or current_turn");
  }

  return {
    provider: RequireString(payload.provider, "provider"),
    id: RequireString(payload.id, "id"),
    applyTo: applyTo ?? "next_turn",
  };
}

function ParseAckPayload(payload: unknown): ClientAckPayload
{
  if (!IsRecord(payload))
  {
    throw new StorageError("invalid_frame", "client.ack payload must be an object");
  }

  if (typeof payload.sequence !== "number" || !Number.isFinite(payload.sequence))
  {
    throw new StorageError("invalid_frame", "sequence must be a number");
  }

  return {
    sequence: payload.sequence,
  };
}

function ParseHelloPayload(payload: unknown): ClientHelloPayload
{
  if (payload === undefined)
  {
    return {};
  }

  if (!IsRecord(payload))
  {
    throw new StorageError("invalid_frame", "client.hello payload must be an object");
  }

  const result: ClientHelloPayload = {};

  if (payload.supportsSnapshots === true)
  {
    result.supportsSnapshots = true;
  }

  if (payload.supportsLazyHistory === true)
  {
    result.supportsLazyHistory = true;
  }

  if (payload.lastSeenSequence !== undefined)
  {
    if (typeof payload.lastSeenSequence !== "number" || !Number.isFinite(payload.lastSeenSequence))
    {
      throw new StorageError("invalid_frame", "lastSeenSequence must be a number");
    }

    result.lastSeenSequence = payload.lastSeenSequence;
  }

  return result;
}

export function ParseClientFrame(raw: unknown): ParsedClientFrame
{
  const frame = ParseChatEnvelope(raw);
  const payload = frame.payload;

  switch (frame.kind)
  {
    case x_clientHelloKind:
      return {
        kind: x_clientHelloKind,
        frame,
        payload: ParseHelloPayload(payload),
      };

    case x_clientUserMessageKind:
      return {
        kind: x_clientUserMessageKind,
        frame,
        payload: ParseUserMessagePayload(payload),
      };

    case x_clientHistoryRequestKind:
      return {
        kind: x_clientHistoryRequestKind,
        frame,
        payload: ParseHistoryRequestPayload(payload),
      };

    case x_clientModelSelectKind:
      return {
        kind: x_clientModelSelectKind,
        frame,
        payload: ParseModelSelectPayload(payload),
      };

    case x_clientAckKind:
      return {
        kind: x_clientAckKind,
        frame,
        payload: ParseAckPayload(payload),
      };

    case x_clientCancelKind:
      return {
        kind: x_clientCancelKind,
        frame,
      };

    case x_clientStopGeneratingKind:
      return {
        kind: x_clientStopGeneratingKind,
        frame,
      };

    case x_clientPingKind:
      return {
        kind: x_clientPingKind,
        frame,
      };

    default:
      throw new StorageError("invalid_frame", `unsupported client frame kind: ${frame.kind}`);
  }
}

export function ToModelReference(payload: ClientModelSelectPayload): ModelReference
{
  return {
    provider: payload.provider,
    id: payload.id,
  };
}
