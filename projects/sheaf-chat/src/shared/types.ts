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

export type AguiEventPayload = Record<string, unknown>;
