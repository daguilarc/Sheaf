import { randomUUID } from "node:crypto";

export const x_chatEnvelopeVersion = 1;

export interface ChatEnvelope
{
  v: typeof x_chatEnvelopeVersion;
  kind: string;
  id: string;
  pile: string;
  sessionId: string;
  clientId?: string;
  sequence?: number;
  timestamp: string;
  payload?: unknown;
}

export interface CreateChatEnvelopeInput
{
  kind: string;
  pile: string;
  sessionId: string;
  clientId?: string;
  sequence?: number;
  payload?: unknown;
  id?: string;
  timestamp?: string;
}

export function CreateChatEnvelope(input: CreateChatEnvelopeInput): ChatEnvelope
{
  const envelope: ChatEnvelope = {
    v: x_chatEnvelopeVersion,
    kind: input.kind,
    id: input.id ?? randomUUID(),
    pile: input.pile,
    sessionId: input.sessionId,
    timestamp: input.timestamp ?? new Date().toISOString(),
  };

  if (input.clientId !== undefined)
  {
    envelope.clientId = input.clientId;
  }

  if (input.sequence !== undefined)
  {
    envelope.sequence = input.sequence;
  }

  if (input.payload !== undefined)
  {
    envelope.payload = input.payload;
  }

  return envelope;
}
