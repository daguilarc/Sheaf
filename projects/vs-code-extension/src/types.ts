export type HunkAction =
  | "previousHunk"
  | "nextHunk"
  | "previousFile"
  | "nextFile"
  | "stage"
  | "revert"
  | "undo";

export interface HunkRange
{
  start: number;
  lines: number;
}

export interface Hunk
{
  id: string;
  file: string;
  index: number;
  count: number;
  header: string;
  oldRange: HunkRange;
  newRange: HunkRange;
  patch: string;
  patchHash: string;
}

export interface ActionAvailability
{
  canGoUp: boolean;
  canGoDown: boolean;
  canGoPrevFile: boolean;
  canGoNextFile: boolean;
  canStage: boolean;
  canRevert: boolean;
  canUndo: boolean;
}

export interface PaneState
{
  windowId: string;
  focused: boolean;
  paneOpen: boolean;
  repoRoot: string | null;
  file: string | null;
  fileIndex: number;
  fileCount: number;
  hunkIndex: number;
  hunkCount: number;
  currentHunk: Hunk | null;
  actions: ActionAvailability;
}

export type CommandResult =
  | { ok: true; action: HunkAction; state: PaneState }
  | { ok: false; action: HunkAction; error: string; state: PaneState };
