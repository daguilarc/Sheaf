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
  unavailableReason?: string;
}

export interface ChatManifestHistory
{
  messageCount: number;
  lastSequence: number;
}

export interface ChatManifestPi
{
  sessionFile: string;
  extensionVersion: string;
}

export interface RepositoryMetadata
{
  repoId: string;
  name: string;
  path: string;
  discoveredAt: string;
}

export interface WorkspaceMetadata
{
  repoId: string;
  workspaceId: string;
  kind: "main" | "worktree";
  path: string;
  displayName: string;
  branch?: string;
  head?: string;
  bare?: boolean;
  detached?: boolean;
  discoveredAt: string;
}

export interface ChatManifest
{
  schemaVersion: number;
  repoId: string;
  workspaceId: string;
  chatId: string;
  repositoryPath: string;
  workspacePath: string;
  chatName: string;
  description: string;
  rootDirectory: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  model: ModelReference;
  pi: ChatManifestPi;
  history: ChatManifestHistory;
}

export interface ProvisionalChat
{
  repoId: string;
  workspaceId: string;
  chatId: string;
  repositoryPath: string;
  workspacePath: string;
  rootDirectory: string;
  model: ModelReference;
  createdAt?: string;
}

export type ProvisionalSession = ProvisionalChat;

export interface AllocatedChatShell
{
  repoId: string;
  workspaceId: string;
  chatId: string;
  provisionalChat: ProvisionalChat;
  sessionFilePath: string;
  historyFilePath: string;
}

export interface WriteInitialManifestInput
{
  repoId: string;
  workspaceId: string;
  chatId: string;
  repositoryPath: string;
  workspacePath: string;
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

export interface WorkspaceEditorViewport
{
  scrollTop: number;
}

export interface WorkspaceEditorNavigationState
{
  point: number;
  mark: number | null;
  markActive: boolean;
  line?: number;
  column?: number;
  before?: string;
  after?: string;
}

export interface WorkspaceEditorState
{
  tabs: string[];
  selectedPath: string | null;
  expandedDirectories: string[];
  viewports: Record<string, WorkspaceEditorViewport>;
  navigation: Record<string, WorkspaceEditorNavigationState>;
}

export type AguiEventPayload = Record<string, unknown>;
