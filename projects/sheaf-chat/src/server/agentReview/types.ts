export type AgentReviewAction =
  | "previousHunk"
  | "nextHunk"
  | "previousFile"
  | "nextFile"
  | "stage"
  | "revert"
  | "undo";

export interface AgentReviewActions
{
  canGoUp: boolean;
  canGoDown: boolean;
  canGoPrevFile: boolean;
  canGoNextFile: boolean;
  canStage: boolean;
  canRevert: boolean;
  canUndo: boolean;
}

export interface AgentReviewHunk
{
  sourceProvider: "sheaf-chat";
  repoRoot: string;
  sessionRoot: string;
  file: string;
  hunkId: string;
  hunkIndex: number;
  hunkCount: number;
  fileIndex: number;
  fileCount: number;
  header: string;
  patchHash: string;
  patch: string;
}

export interface AgentReviewFileSummary
{
  file: string;
  hunkCount: number;
}

export interface AgentReviewAvailability
{
  available: boolean;
  repoRoot: string | null;
  sessionRoot: string | null;
  sessionRootRelativeToRepo: string | null;
  reason?: string;
}

export interface AgentReviewState extends AgentReviewAvailability
{
  currentIndex: number;
  currentHunk: AgentReviewHunk | null;
  hunks: AgentReviewHunk[];
  files: AgentReviewFileSummary[];
  actions: AgentReviewActions;
  reviewDraft: AgentReviewDraftState;
  dictatorBridge: {
    connected: boolean;
    url: string | null;
    lastError: string | null;
  };
}

export type AgentReviewDraftEntryKind = "comment" | "rejected";

export interface AgentReviewDraftEntry
{
  kind: AgentReviewDraftEntryKind;
  hunk: AgentReviewHunk;
  text?: string;
}

export interface AgentReviewDraftState
{
  entries: AgentReviewDraftEntry[];
  visibleCommentHunkId: string | null;
  hasSerializedContent: boolean;
}

export interface AgentReviewCommandResult
{
  ok: boolean;
  action: AgentReviewAction;
  commandId?: string;
  error?: string;
  stale?: boolean;
}

export interface AgentReviewClientCommand
{
  type: "command";
  id?: string;
  action: AgentReviewAction;
  hunkId?: string;
  patchHash?: string;
}

export interface AgentReviewClientFocus
{
  type: "focus";
  hunkId?: string | null;
}

export interface AgentReviewClientComment
{
  type: "comment";
  hunkId: string;
  text: string;
}

export interface AgentReviewClientCommentFocus
{
  type: "comment_focus";
  hunkId: string;
}

export interface AgentReviewClientCommentBlur
{
  type: "comment_blur";
  hunkId: string;
}

export interface AgentReviewClientPresence
{
  type: "presence";
  focused: boolean;
}

export type AgentReviewClientFrame =
  | AgentReviewClientCommand
  | AgentReviewClientFocus
  | AgentReviewClientComment
  | AgentReviewClientCommentFocus
  | AgentReviewClientCommentBlur
  | AgentReviewClientPresence;

export type AgentReviewServerFrame =
  | { type: "bootstrap"; state: AgentReviewState }
  | { type: "state"; state: AgentReviewState }
  | { type: "focus_comment"; hunkId: string }
  | { type: "command_result"; result: AgentReviewCommandResult; state: AgentReviewState }
  | { type: "error"; code: string; message: string; requestId?: string };
