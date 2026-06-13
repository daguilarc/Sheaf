import test from "node:test";
import assert from "node:assert/strict";

import { ParseUnifiedDiff } from "../src/diffParser.js";
import {
  BuildVirtualHunkDocument,
  HunkIdToVirtualSpan,
  ParseVirtualUri,
  RealLineToVirtualLine,
  VirtualLineToContext,
  VirtualUriFor,
} from "../src/virtualHunkDocument.js";

test("VirtualUriFor round trips repo and file identity", () => {
  const uri = VirtualUriFor("/Users/joyo/Some Repo", "src/example file.ts");

  assert.equal(uri.includes("?"), false);
  assert.deepEqual(ParseVirtualUri(uri), {
    repoRoot: "/Users/joyo/Some Repo",
    file: "src/example file.ts",
  });
});

test("ParseVirtualUri tolerates legacy VS Code query serialization", () => {
  const uri = "sheaf-hunks://review//private/tmp/repo?file%3Dprivate%2Fsrc%2FFileWriter.hpp";

  assert.deepEqual(ParseVirtualUri(uri), {
    repoRoot: "/private/tmp/repo",
    file: "private/src/FileWriter.hpp",
  });
});

test("BuildVirtualHunkDocument renders uneven replacements as added block then deleted block", () => {
  const hunks = Hunks(`diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -2,3 +2,4 @@
-old one
-old two
-old three
+new one
+new two
+new three
+new four
 keep
`);

  const document = BuildVirtualHunkDocument(
    "/repo",
    "src/example.ts",
    "header\nnew one\nnew two\nnew three\nnew four\nkeep\ntail\n",
    hunks,
  );

  assert.deepEqual(document.text.split("\n"), [
    "header",
    "new one",
    "new two",
    "new three",
    "new four",
    "old one",
    "old two",
    "old three",
    "keep",
    "tail",
  ]);
  assert.deepEqual(document.rows.slice(1, 8).map((row) => row.kind), [
    "added",
    "added",
    "added",
    "added",
    "deleted",
    "deleted",
    "deleted",
  ]);
  assert.deepEqual(document.rows.slice(1, 8).map((row) => row.virtualLine), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(document.rows.slice(5, 8).map((row) => row.source), ["synthetic", "synthetic", "synthetic"]);
});

test("virtual mapping returns row context, hunk spans, and real-line rows", () => {
  const hunks = Hunks(`diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -2,2 +2,2 @@
-old line
+new line
 keep
`);
  const hunk = hunks[0];
  assert.ok(hunk);

  const document = BuildVirtualHunkDocument("/repo", "src/example.ts", "header\nnew line\nkeep\ntail\n", hunks);
  const addedRow = VirtualLineToContext(document, 1);
  const deletedRow = VirtualLineToContext(document, 2);
  const span = HunkIdToVirtualSpan(document, hunk.id);

  assert.equal(addedRow?.kind, "added");
  assert.equal(addedRow?.realLine, 2);
  assert.equal(addedRow?.hunkId, hunk.id);
  assert.equal(deletedRow?.kind, "deleted");
  assert.equal(deletedRow?.realLine, null);
  assert.equal(deletedRow?.oldLine, 2);
  assert.deepEqual(span?.addedVirtualRange, { start: 1, endExclusive: 2 });
  assert.deepEqual(span?.deletedVirtualRange, { start: 2, endExclusive: 3 });
  assert.equal(span?.virtualStartLine, 1);
  assert.equal(span?.virtualEndLineExclusive, 4);
  assert.equal(RealLineToVirtualLine(document, 3), 3);
  assert.equal(RealLineToVirtualLine(document, 50), null);
});

test("deletion-only hunks insert deleted rows at the new-file position", () => {
  const hunks = Hunks(`diff --git a/src/delete.ts b/src/delete.ts
index 1111111..2222222 100644
--- a/src/delete.ts
+++ b/src/delete.ts
@@ -2,2 +2,0 @@
-removed one
-removed two
`);

  const document = BuildVirtualHunkDocument("/repo", "src/delete.ts", "header\nnext\ntail\n", hunks);

  assert.deepEqual(document.text.split("\n"), [
    "header",
    "removed one",
    "removed two",
    "next",
    "tail",
  ]);
  assert.deepEqual(document.hunks[0]?.addedVirtualRange, null);
  assert.deepEqual(document.hunks[0]?.deletedVirtualRange, { start: 1, endExclusive: 3 });
  assert.equal(RealLineToVirtualLine(document, 2), 3);
});

function Hunks(diff: string)
{
  return ParseUnifiedDiff(diff).values().next().value ?? [];
}
