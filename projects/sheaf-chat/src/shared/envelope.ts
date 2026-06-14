import { randomUUID } from "node:crypto";

export const x_chatEnvelopeVersion = 1;

export interface ChatEnvelope
{
  v: typeof x_chatEnvelopeVersion;
  kind: string;
  id: string;
  repoId: string;
  workspaceId: string;
  chatId: string;
  clientId?: string;
  sequence?: number;
  timestamp: string;
  payload?: unknown;
}

export interface CreateChatEnvelopeInput
{
  kind: string;
  repoId: string;
  workspaceId: string;
  chatId: string;
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
    repoId: input.repoId,
    workspaceId: input.workspaceId,
    chatId: input.chatId,
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
