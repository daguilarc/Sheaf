import test from "node:test";
import assert from "node:assert/strict";

import { ParseNameOnlyList, ParseUnifiedDiff } from "../src/diffParser.js";

const sampleDiff = `diff --git a/src/example.ts b/src/example.ts
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

test("ParseUnifiedDiff returns ordered hunks with identity metadata", () => {
  const parsed = ParseUnifiedDiff(sampleDiff);
  const hunks = parsed.get("src/example.ts");

  assert.equal(hunks?.length, 2);
  assert.equal(hunks?.[0]?.index, 0);
  assert.equal(hunks?.[0]?.count, 2);
  assert.equal(hunks?.[0]?.oldRange.start, 1);
  assert.equal(hunks?.[0]?.newRange.start, 1);
  assert.deepEqual(hunks?.[0]?.displayLines.map((line) => line.kind), ["context", "added", "context", "context"]);
  assert.match(hunks?.[0]?.patchHash ?? "", /^[0-9a-f]{16}$/);
  assert.match(hunks?.[0]?.patch ?? "", /^diff --git/m);
});

test("ParseUnifiedDiff groups replacement display blocks as added then deleted at new position", () => {
  const parsed = ParseUnifiedDiff(sampleDiff);
  const hunk = parsed.get("src/example.ts")?.[1];

  assert.deepEqual(hunk?.displayBlocks.map((block) => block.kind), ["added", "deleted"]);
  assert.deepEqual(hunk?.displayBlocks[0]?.lines.map((line) => line.text), ["new line"]);
  assert.deepEqual(hunk?.displayBlocks[1]?.lines.map((line) => line.text), ["old line"]);
  assert.equal(hunk?.displayBlocks[1]?.anchorNewLine, 11);
  assert.equal(hunk?.displayBlocks[1]?.attachment, "after");
});

test("ParseUnifiedDiff handles deletion-only hunks", () => {
  const parsed = ParseUnifiedDiff(`diff --git a/src/remove.ts b/src/remove.ts
index 1111111..2222222 100644
--- a/src/remove.ts
+++ b/src/remove.ts
@@ -2,2 +2,0 @@
-gone one
-gone two
`);
  const hunk = parsed.get("src/remove.ts")?.[0];

  assert.equal(hunk?.newRange.lines, 0);
  assert.deepEqual(hunk?.displayBlocks.map((block) => block.kind), ["deleted"]);
  assert.deepEqual(hunk?.displayBlocks[0]?.lines.map((line) => line.text), ["gone one", "gone two"]);
  assert.equal(hunk?.displayBlocks[0]?.attachment, "before");
});

test("ParseNameOnlyList drops empty lines", () => {
  assert.deepEqual(ParseNameOnlyList("a.ts\n\nb.ts\n"), ["a.ts", "b.ts"]);
});
