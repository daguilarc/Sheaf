import test from "node:test";
import assert from "node:assert/strict";

import { PlanInlineHunkDecorations } from "../src/decorationPlanner.js";
import { ParseUnifiedDiff } from "../src/diffParser.js";
import type { PaneState } from "../src/types.js";

const diff = `diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,3 +1,4 @@
 const a = 1;
+const added = true;
 const b = 2;
 const c = 3;
@@ -10,2 +11,2 @@
-old line
+new line
 keep
`;

test("PlanInlineHunkDecorations marks current and non-current added ranges", () => {
  const hunks = ParseUnifiedDiff(diff).get("src/example.ts") ?? [];
  const plan = PlanInlineHunkDecorations(State(hunks, hunks[1]?.id ?? ""));

  assert.equal(plan.addedRanges.length, 2);
  assert.equal(plan.addedRanges[0]?.current, false);
  assert.equal(plan.addedRanges[1]?.current, true);
  assert.equal(plan.revealLine, 10);
});

test("PlanInlineHunkDecorations groups replacement deleted text", () => {
  const hunks = ParseUnifiedDiff(diff).get("src/example.ts") ?? [];
  const plan = PlanInlineHunkDecorations(State(hunks, hunks[1]?.id ?? ""));

  const currentDeleted = plan.deletedBlocks.find((block) => block.current);
  assert.equal(currentDeleted?.text, "- old line");
  assert.equal(currentDeleted?.anchorLine, 10);
  assert.equal(currentDeleted?.attachment, "after");
});

function State(hunks: PaneState["hunks"], currentHunkId: string): PaneState
{
  const currentHunk = hunks.find((hunk) => hunk.id === currentHunkId) ?? null;
  return {
    windowId: "window-1",
    focused: true,
    paneOpen: currentHunk !== null,
    repoRoot: "/repo",
    file: "src/example.ts",
    fileIndex: 0,
    fileCount: 1,
    hunkIndex: currentHunk?.index ?? -1,
    hunkCount: currentHunk?.count ?? 0,
    hunks,
    currentHunkId,
    currentHunk,
    currentHunkReview: currentHunk === null
      ? null
      : {
        repoRoot: "/repo",
        file: currentHunk.file,
        hunkId: currentHunk.id,
        hunkIndex: currentHunk.index,
        hunkCount: currentHunk.count,
        header: currentHunk.header,
        patchHash: currentHunk.patchHash,
        patch: currentHunk.patch,
      },
    actions: {
      canGoUp: false,
      canGoDown: false,
      canGoPrevFile: false,
      canGoNextFile: false,
      canStage: true,
      canRevert: true,
      canUndo: false,
    },
  };
}
