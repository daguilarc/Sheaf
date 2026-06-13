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

export type HunkDisplayLineKind = "context" | "added" | "deleted";

export interface HunkDisplayLine
{
  kind: HunkDisplayLineKind;
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface HunkDisplayBlock
{
  kind: "added" | "deleted";
  lines: HunkDisplayLine[];
  anchorNewLine: number;
  attachment: "before" | "after";
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
  displayLines: HunkDisplayLine[];
  displayBlocks: HunkDisplayBlock[];
  patch: string;
  patchHash: string;
}

export interface HunkReviewContext
{
  repoRoot: string;
  file: string;
  hunkId: string;
  hunkIndex: number;
  hunkCount: number;
  header: string;
  patchHash: string;
  patch: string;
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
  hunks: Hunk[];
  currentHunkId: string | null;
  currentHunk: Hunk | null;
  currentHunkReview: HunkReviewContext | null;
  actions: ActionAvailability;
}

export interface CommandReviewFacts
{
  revertedHunk?: HunkReviewContext;
  restoredRevertedHunk?: HunkReviewContext;
}

export type CommandResult =
  | { ok: true; action: HunkAction; state: PaneState; reviewFacts?: CommandReviewFacts }
  | { ok: false; action: HunkAction; error: string; state: PaneState };
