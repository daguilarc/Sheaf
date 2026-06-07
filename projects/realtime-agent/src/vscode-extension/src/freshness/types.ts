export interface FileFreshnessState
{
  file: string;
  changedSinceLastRead: boolean;
  notificationSent: boolean;
}

export interface ViewportFreshnessState
{
  currentFile: string | null;
  everObserved: boolean;
  changedSinceLastCheck: boolean;
  notificationSent: boolean;
}

export interface CursorFreshnessState
{
  currentFile: string | null;
  everObserved: boolean;
  changedSinceLastCheck: boolean;
  notificationSent: boolean;
}

export interface AgentMutationGuard
{
  end(): void;
}

export interface FreshnessHooks
{
  markFileObserved(file: string): void;
  markViewportObserved(file: string): void;
  markCursorObserved(file: string): void;
  beginAgentMutation(): AgentMutationGuard;
}
