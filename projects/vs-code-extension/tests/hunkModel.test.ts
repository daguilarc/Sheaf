import test from "node:test";
import assert from "node:assert/strict";

import type { GitAdapter, ApplyPatchOptions } from "../src/gitAdapter.js";
import { HunkModel, type ActiveFile, type HunkModelHost } from "../src/hunkModel.js";
import type { Hunk, PaneState } from "../src/types.js";

function MakeHunk(file: string, index: number, count: number): Hunk
{
  return {
    id: `${file}:${index}`,
    file,
    index,
    count,
    header: `@@ -${index + 1},1 +${index + 1},1 @@`,
    oldRange: { start: index + 1, lines: 1 },
    newRange: { start: index + 1, lines: 1 },
    displayLines: [
      { kind: "deleted", text: "old", oldLine: index + 1, newLine: null },
      { kind: "added", text: "new", oldLine: null, newLine: index + 1 },
    ],
    displayBlocks: [
      { kind: "added", anchorNewLine: index + 1, attachment: "before", lines: [{ kind: "added", text: "new", oldLine: null, newLine: index + 1 }] },
      { kind: "deleted", anchorNewLine: index + 1, attachment: "after", lines: [{ kind: "deleted", text: "old", oldLine: index + 1, newLine: null }] },
    ],
    patch: `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -${index + 1},1 +${index + 1},1 @@\n-old\n+new\n`,
    patchHash: `hash${index}`,
  };
}

class FakeGit implements GitAdapter
{
  changedFiles = ["a.ts", "b.ts"];
  hunks = new Map<string, Hunk[]>([
    ["a.ts", [MakeHunk("a.ts", 0, 2), MakeHunk("a.ts", 1, 2)]],
    ["b.ts", [MakeHunk("b.ts", 0, 1)]],
  ]);
  applied: Array<{ patch: string; options: ApplyPatchOptions }> = [];
  failApply = false;

  async findRepositoryRoot(): Promise<string | null>
  {
    return "/repo";
  }

  async listChangedFiles(): Promise<string[]>
  {
    return this.changedFiles;
  }

  async loadUnstagedHunks(): Promise<Map<string, Hunk[]>>
  {
    return new Map([...this.hunks].map(([file, hunks]) => [file, hunks.map((hunk) => ({ ...hunk }))]));
  }

  async applyPatch(_repoRoot: string, patch: string, options: ApplyPatchOptions): Promise<void>
  {
    if (this.failApply)
    {
      throw new Error("patch failed");
    }
    this.applied.push({ patch, options });
  }
}

class FakeHost implements HunkModelHost
{
  activeFile: ActiveFile | null = { absPath: "/repo/a.ts", relativePath: "a.ts" };
  states: PaneState[] = [];
  rendered: Array<{ state: PaneState; reveal: boolean }> = [];
  cleared = 0;
  openedFiles: string[] = [];

  async getActiveFile(): Promise<ActiveFile | null>
  {
    return this.activeFile;
  }

  async openFile(_repoRoot: string, relativePath: string): Promise<void>
  {
    this.openedFiles.push(relativePath);
    this.activeFile = { absPath: `/repo/${relativePath}`, relativePath };
  }

  publishState(state: PaneState): void
  {
    this.states.push(state);
  }

  renderReviewSurface(state: PaneState, options: { reveal: boolean } = { reveal: false }): void
  {
    this.rendered.push({ state, reveal: options.reveal });
  }

  clearReviewSurface(): void
  {
    this.cleared += 1;
  }
}

test("HunkModel computes current hunk and navigation availability", async () => {
  const git = new FakeGit();
  const host = new FakeHost();
  const model = new HunkModel("window-1", git, host);

  const state = await model.recompute(true);

  assert.equal(state.paneOpen, true);
  assert.equal(state.file, "a.ts");
  assert.equal(state.hunkIndex, 0);
  assert.equal(state.hunkCount, 2);
  assert.equal(state.hunks.length, 2);
  assert.equal(state.currentHunkId, "a.ts:0");
  assert.deepEqual(state.currentHunkReview, {
    repoRoot: "/repo",
    file: "a.ts",
    hunkId: "a.ts:0",
    hunkIndex: 0,
    hunkCount: 2,
    header: "@@ -1,1 +1,1 @@",
    patchHash: "hash0",
    patch: git.hunks.get("a.ts")?.[0]?.patch,
  });
  assert.equal(state.actions.canGoDown, true);
  assert.equal(state.actions.canGoNextFile, true);
  assert.equal(host.rendered.length, 1);
  assert.equal(host.rendered[0]?.reveal, false);
});

test("HunkModel navigates hunks and files", async () => {
  const git = new FakeGit();
  const host = new FakeHost();
  const model = new HunkModel("window-1", git, host);
  await model.recompute(true);

  const nextHunk = await model.run("nextHunk");
  assert.equal(nextHunk.ok, true);
  assert.equal(nextHunk.state.hunkIndex, 1);
  assert.equal(host.rendered.at(-1)?.reveal, true);

  const nextFile = await model.run("nextFile");
  assert.equal(nextFile.ok, true);
  assert.equal(nextFile.state.file, "b.ts");
  assert.deepEqual(host.openedFiles, ["b.ts"]);
  assert.equal(host.rendered.at(-1)?.reveal, true);
});

test("HunkModel stages, reverts, and clears undo on failed undo", async () => {
  const git = new FakeGit();
  const host = new FakeHost();
  const model = new HunkModel("window-1", git, host);
  await model.recompute(true);

  await model.run("stage");
  assert.equal(git.applied.at(-1)?.options.cached, true);
  assert.equal(model.getState().actions.canUndo, true);

  git.failApply = true;
  const undo = await model.run("undo");
  assert.equal(undo.ok, false);
  assert.equal(undo.state.actions.canUndo, false);
});

test("HunkModel reports review facts for revert and undo revert only", async () => {
  const git = new FakeGit();
  const host = new FakeHost();
  const model = new HunkModel("window-1", git, host);
  await model.recompute(true);

  const stage = await model.run("stage");
  assert.equal(stage.ok, true);
  if (stage.ok)
  {
    assert.equal(stage.reviewFacts, undefined);
  }

  const undoStage = await model.run("undo");
  assert.equal(undoStage.ok, true);
  if (undoStage.ok)
  {
    assert.equal(undoStage.reviewFacts, undefined);
  }

  const revert = await model.run("revert");
  assert.equal(revert.ok, true);
  if (revert.ok)
  {
    assert.equal(revert.reviewFacts?.revertedHunk?.hunkId, "a.ts:0");
    assert.equal(revert.reviewFacts?.revertedHunk?.patchHash, "hash0");
  }

  const undoRevert = await model.run("undo");
  assert.equal(undoRevert.ok, true);
  if (undoRevert.ok)
  {
    assert.equal(undoRevert.reviewFacts?.restoredRevertedHunk?.hunkId, "a.ts:0");
    assert.equal(undoRevert.reviewFacts?.restoredRevertedHunk?.patchHash, "hash0");
  }
});

test("HunkModel hides pane with no active hunks", async () => {
  const git = new FakeGit();
  const host = new FakeHost();
  git.hunks = new Map();
  const model = new HunkModel("window-1", git, host);

  const state = await model.recompute(true);

  assert.equal(state.paneOpen, false);
  assert.equal(host.cleared, 1);
});
