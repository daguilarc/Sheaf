import type { ActionAvailability, CommandResult, Hunk, HunkAction, PaneState } from "./types.js";
import type { GitAdapter } from "./gitAdapter.js";

export interface ActiveFile
{
  absPath: string;
  relativePath: string;
}

export interface HunkModelHost
{
  getActiveFile(): Promise<ActiveFile | null>;
  openFile(repoRoot: string, relativePath: string): Promise<void>;
  publishState(state: PaneState): void;
  showPane(state: PaneState): void;
  hidePane(state: PaneState): void;
}

interface UndoEntry
{
  kind: "stage" | "revert";
  repoRoot: string;
  file: string;
  patch: string;
}

export class HunkModel
{
  private repoRoot: string | null = null;
  private changedFiles: string[] = [];
  private hunksByFile = new Map<string, Hunk[]>();
  private currentFile: string | null = null;
  private currentHunkId: string | null = null;
  private undoStack: UndoEntry[] = [];
  private focused = false;

  constructor(
    private readonly windowId: string,
    private readonly git: GitAdapter,
    private readonly host: HunkModelHost,
  )
  {
  }

  async recompute(focused: boolean): Promise<PaneState>
  {
    this.focused = focused;
    const activeFile = await this.host.getActiveFile();
    if (activeFile === null)
    {
      return this.setEmpty();
    }

    const repoRoot = await this.git.findRepositoryRoot(activeFile.absPath);
    if (repoRoot === null)
    {
      return this.setEmpty();
    }

    const previousHunkId = this.currentHunkId;
    this.repoRoot = repoRoot;
    this.changedFiles = await this.git.listChangedFiles(repoRoot);
    this.hunksByFile = await this.git.loadUnstagedHunks(repoRoot);
    this.currentFile = activeFile.relativePath;

    const hunks = this.hunksByFile.get(this.currentFile) ?? [];
    if (hunks.length === 0)
    {
      this.currentHunkId = null;
      const state = this.state();
      this.host.hidePane(state);
      this.host.publishState(state);
      return state;
    }

    const preserved = previousHunkId === null ? undefined : hunks.find((hunk) => hunk.id === previousHunkId);
    this.currentHunkId = preserved?.id ?? hunks[0]?.id ?? null;
    const state = this.state();
    this.host.showPane(state);
    this.host.publishState(state);
    return state;
  }

  getState(): PaneState
  {
    return this.state();
  }

  async run(action: HunkAction): Promise<CommandResult>
  {
    try
    {
      switch (action)
      {
      case "previousHunk":
        this.moveHunk(-1);
        break;
      case "nextHunk":
        this.moveHunk(1);
        break;
      case "previousFile":
        await this.moveFile(-1);
        break;
      case "nextFile":
        await this.moveFile(1);
        break;
      case "stage":
        await this.stageCurrentHunk();
        break;
      case "revert":
        await this.revertCurrentHunk();
        break;
      case "undo":
        await this.undo();
        break;
      }

      const state = this.state();
      this.host.publishState(state);
      return { ok: true, action, state };
    }
    catch (error)
    {
      const state = this.state();
      return { ok: false, action, error: error instanceof Error ? error.message : String(error), state };
    }
  }

  private moveHunk(delta: number): void
  {
    const hunks = this.currentHunks();
    const current = this.currentHunk();
    if (current === null)
    {
      return;
    }
    const nextIndex = current.index + delta;
    if (nextIndex < 0 || nextIndex >= hunks.length)
    {
      return;
    }
    this.currentHunkId = hunks[nextIndex]?.id ?? this.currentHunkId;
  }

  private async moveFile(delta: number): Promise<void>
  {
    if (this.repoRoot === null || this.currentFile === null)
    {
      return;
    }

    const filesWithHunks = this.filesWithHunks();
    const index = filesWithHunks.indexOf(this.currentFile);
    const nextIndex = index + delta;
    if (index < 0 || nextIndex < 0 || nextIndex >= filesWithHunks.length)
    {
      return;
    }

    const nextFile = filesWithHunks[nextIndex] ?? this.currentFile;
    this.currentFile = nextFile;
    this.currentHunkId = this.hunksByFile.get(nextFile)?.[0]?.id ?? null;
    await this.host.openFile(this.repoRoot, nextFile);
  }

  private async stageCurrentHunk(): Promise<void>
  {
    const hunk = this.requireCurrentHunk();
    const repoRoot = this.requireRepoRoot();
    await this.git.applyPatch(repoRoot, hunk.patch, { cached: true });
    this.undoStack.push({ kind: "stage", repoRoot, file: hunk.file, patch: hunk.patch });
  }

  private async revertCurrentHunk(): Promise<void>
  {
    const hunk = this.requireCurrentHunk();
    const repoRoot = this.requireRepoRoot();
    await this.git.applyPatch(repoRoot, hunk.patch, { reverse: true });
    this.undoStack.push({ kind: "revert", repoRoot, file: hunk.file, patch: hunk.patch });
  }

  private async undo(): Promise<void>
  {
    const entry = this.undoStack.pop();
    if (entry === undefined)
    {
      return;
    }

    try
    {
      if (entry.kind === "stage")
      {
        await this.git.applyPatch(entry.repoRoot, entry.patch, { cached: true, reverse: true });
      }
      else
      {
        await this.git.applyPatch(entry.repoRoot, entry.patch, {});
      }
    }
    catch (error)
    {
      this.undoStack = [];
      throw error;
    }
  }

  private setEmpty(): PaneState
  {
    this.repoRoot = null;
    this.changedFiles = [];
    this.hunksByFile = new Map();
    this.currentFile = null;
    this.currentHunkId = null;
    const state = this.state();
    this.host.hidePane(state);
    this.host.publishState(state);
    return state;
  }

  private state(): PaneState
  {
    const currentHunk = this.currentHunk();
    const filesWithHunks = this.filesWithHunks();
    const fileIndex = this.currentFile === null ? -1 : filesWithHunks.indexOf(this.currentFile);
    const actions = this.actions(currentHunk, filesWithHunks, fileIndex);

    return {
      windowId: this.windowId,
      focused: this.focused,
      paneOpen: currentHunk !== null,
      repoRoot: this.repoRoot,
      file: this.currentFile,
      fileIndex,
      fileCount: filesWithHunks.length,
      hunkIndex: currentHunk?.index ?? -1,
      hunkCount: currentHunk?.count ?? 0,
      currentHunk,
      actions,
    };
  }

  private actions(currentHunk: Hunk | null, filesWithHunks: string[], fileIndex: number): ActionAvailability
  {
    return {
      canGoUp: currentHunk !== null && currentHunk.index > 0,
      canGoDown: currentHunk !== null && currentHunk.index < currentHunk.count - 1,
      canGoPrevFile: currentHunk !== null && fileIndex > 0,
      canGoNextFile: currentHunk !== null && fileIndex >= 0 && fileIndex < filesWithHunks.length - 1,
      canStage: currentHunk !== null,
      canRevert: currentHunk !== null,
      canUndo: this.undoStack.length > 0,
    };
  }

  private filesWithHunks(): string[]
  {
    return this.changedFiles.filter((file) => (this.hunksByFile.get(file)?.length ?? 0) > 0);
  }

  private currentHunks(): Hunk[]
  {
    return this.currentFile === null ? [] : this.hunksByFile.get(this.currentFile) ?? [];
  }

  private currentHunk(): Hunk | null
  {
    if (this.currentHunkId === null)
    {
      return null;
    }
    return this.currentHunks().find((hunk) => hunk.id === this.currentHunkId) ?? null;
  }

  private requireCurrentHunk(): Hunk
  {
    const hunk = this.currentHunk();
    if (hunk === null)
    {
      throw new Error("No current hunk.");
    }
    return hunk;
  }

  private requireRepoRoot(): string
  {
    if (this.repoRoot === null)
    {
      throw new Error("No repository root.");
    }
    return this.repoRoot;
  }
}
