import type { ChatEnvelope } from "./envelope.js";

export const x_manifestSchemaVersion = 1;

export enum AgentLifecycleState
{
  Cold = "cold",
  Starting = "starting",
  Active = "active",
  Idle = "idle",
  Stopping = "stopping",
  Failed = "failed",
}

export interface ModelReference
{
  provider: string;
  id: string;
}

export interface ModelMetadata extends ModelReference
{
  displayName?: string;
  contextTokens?: number;
  available: boolean;
}

export interface SessionManifestHistory
{
  messageCount: number;
  lastSequence: number;
}

export interface SessionManifestPi
{
  sessionFile: string;
  extensionVersion: string;
}

export interface SessionManifest
{
  schemaVersion: number;
  pile: string;
  sessionId: string;
  chatName: string;
  description: string;
  rootDirectory: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  model: ModelReference;
  pi: SessionManifestPi;
  history: SessionManifestHistory;
}

export interface PileSummary
{
  pile: string;
  sessionCount: number;
  latestUpdatedAt: string | null;
}

export interface ProvisionalSession
{
  rootDirectory: string;
  model: ModelReference;
}

export interface AllocatedSessionShell
{
  pile: string;
  sessionId: string;
  provisionalSession: ProvisionalSession;
  sessionFilePath: string;
  historyFilePath: string;
}

export interface WriteInitialManifestInput
{
  pile: string;
  sessionId: string;
  chatName: string;
  description: string;
  rootDirectory: string;
  model: ModelReference;
  extensionVersion: string;
  messageCount?: number;
  lastSequence?: number;
}

export interface UpdateManifestInput
{
  chatName?: string;
  description?: string;
  rootDirectory?: string;
  model?: ModelReference;
  lastOpenedAt?: string;
  messageCount?: number;
  lastSequence?: number;
}

export type HistoryPageDirection = "before" | "after" | "latest";

export interface HistoryPageRequest
{
  before?: number;
  after?: number;
  limit?: number;
  prefer?: "snapshots" | "events";
}

export interface HistoryPage
{
  direction: HistoryPageDirection;
  envelopes: ChatEnvelope[];
  oldestSequence: number | null;
  newestSequence: number | null;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
}

export interface SessionLogEntry
{
  sequence: number;
  envelope: ChatEnvelope;
}

export type AguiEventPayload = Record<string, unknown>;
