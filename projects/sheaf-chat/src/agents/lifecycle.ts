import { EventEmitter } from "node:events";

import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import {
  AgentLifecycleState,
  type ModelReference,
  type ChatManifest,
} from "../shared/types.js";

export interface ChatKey
{
  repoId: string;
  workspaceId: string;
  chatId: string;
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
  key: ChatKey;
  state: AgentLifecycleState;
  model: ModelReference;
  rootDirectory: string;
  connectedClientCount: number;
  manifestPresent: boolean;
  isStreaming: boolean;
  activeRunCount: number;
  activeToolCount: number;
  manifest?: ChatManifest;
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
  key: ChatKey;
  state: AgentLifecycleState;
  previousState?: AgentLifecycleState;
}

export interface LifecycleModelEvent
{
  key: ChatKey;
  model: ModelReference;
  applyTo: ModelApplyTo;
}

export interface LifecycleUserMessageAcceptedEvent
{
  key: ChatKey;
  message: UserMessageSubmission;
}

export interface LifecycleAgentEvent
{
  key: ChatKey;
  event: AgentSessionEvent;
}

export interface LifecycleManifestUpdatedEvent
{
  key: ChatKey;
  manifest: ChatManifest;
}

export interface LifecycleErrorEvent
{
  key: ChatKey;
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

export function FormatChatKey(key: ChatKey): string
{
  return `${KeyRepoId(key)}${x_keySeparator}${KeyWorkspaceId(key)}${x_keySeparator}${KeyChatId(key)}`;
}

export function KeyRepoId(key: ChatKey): string
{
  return key.repoId;
}

export function KeyWorkspaceId(key: ChatKey): string
{
  return key.workspaceId;
}

export function KeyChatId(key: ChatKey): string
{
  return key.chatId;
}

export function ParseChatKey(encoded: string): ChatKey
{
  const parts = encoded.split(x_keySeparator);

  if (parts.length !== 3)
  {
    throw new Error(`invalid chat key: ${encoded}`);
  }

  return {
    repoId: parts[0],
    workspaceId: parts[1],
    chatId: parts[2],
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
    if (this.listenerCount("error") === 0)
    {
      return;
    }

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
