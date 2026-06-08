import { EventEmitter } from "node:events";

import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import {
  AgentLifecycleState,
  type ModelReference,
  type SessionManifest,
} from "../shared/types.js";

export interface SessionKey
{
  pile: string;
  sessionId: string;
}

export type ModelApplyTo = "next_turn" | "current_turn";

export interface UserMessageSubmission
{
  messageId: string;
  text: string;
  attachments?: unknown[];
  steer?: boolean;
}

export interface AgentStatusSnapshot
{
  key: SessionKey;
  state: AgentLifecycleState;
  model: ModelReference;
  rootDirectory: string;
  connectedClientCount: number;
  manifestPresent: boolean;
  isStreaming: boolean;
  activeRunCount: number;
  activeToolCount: number;
  manifest?: SessionManifest;
  provisionalRootDirectory?: string;
  error?: string;
}

export type LifecycleEventName =
  | "status"
  | "model"
  | "userMessageAccepted"
  | "agentEvent"
  | "manifestUpdated"
  | "error";

export interface LifecycleStatusEvent
{
  key: SessionKey;
  state: AgentLifecycleState;
  previousState?: AgentLifecycleState;
}

export interface LifecycleModelEvent
{
  key: SessionKey;
  model: ModelReference;
  applyTo: ModelApplyTo;
}

export interface LifecycleUserMessageAcceptedEvent
{
  key: SessionKey;
  message: UserMessageSubmission;
}

export interface LifecycleAgentEvent
{
  key: SessionKey;
  event: AgentSessionEvent;
}

export interface LifecycleManifestUpdatedEvent
{
  key: SessionKey;
  manifest: SessionManifest;
}

export interface LifecycleErrorEvent
{
  key: SessionKey;
  code: string;
  message: string;
  fatal?: boolean;
}

export interface LifecycleEventMap
{
  status: LifecycleStatusEvent;
  model: LifecycleModelEvent;
  userMessageAccepted: LifecycleUserMessageAcceptedEvent;
  agentEvent: LifecycleAgentEvent;
  manifestUpdated: LifecycleManifestUpdatedEvent;
  error: LifecycleErrorEvent;
}

const x_keySeparator = "\u0000";

export function FormatSessionKey(key: SessionKey): string
{
  return `${key.pile}${x_keySeparator}${key.sessionId}`;
}

export function ParseSessionKey(encoded: string): SessionKey
{
  const separatorIndex = encoded.indexOf(x_keySeparator);

  if (separatorIndex < 0)
  {
    throw new Error(`invalid session key: ${encoded}`);
  }

  return {
    pile: encoded.slice(0, separatorIndex),
    sessionId: encoded.slice(separatorIndex + 1),
  };
}

export class LifecycleEmitter extends EventEmitter
{
  EmitStatus(event: LifecycleStatusEvent): void
  {
    this.emit("status", event);
  }

  EmitModel(event: LifecycleModelEvent): void
  {
    this.emit("model", event);
  }

  EmitUserMessageAccepted(event: LifecycleUserMessageAcceptedEvent): void
  {
    this.emit("userMessageAccepted", event);
  }

  EmitAgentEvent(event: LifecycleAgentEvent): void
  {
    this.emit("agentEvent", event);
  }

  EmitManifestUpdated(event: LifecycleManifestUpdatedEvent): void
  {
    this.emit("manifestUpdated", event);
  }

  EmitError(event: LifecycleErrorEvent): void
  {
    this.emit("error", event);
  }

  On<TEvent extends LifecycleEventName>(
    eventName: TEvent,
    listener: (event: LifecycleEventMap[TEvent]) => void,
  ): () => void
  {
    this.on(eventName, listener);

    return () =>
    {
      this.off(eventName, listener);
    };
  }
}
