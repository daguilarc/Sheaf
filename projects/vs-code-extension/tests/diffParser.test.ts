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
  assert.match(hunks?.[0]?.patchHash ?? "", /^[0-9a-f]{16}$/);
  assert.match(hunks?.[0]?.patch ?? "", /^diff --git/m);
});

test("ParseNameOnlyList drops empty lines", () => {
  assert.deepEqual(ParseNameOnlyList("a.ts\n\nb.ts\n"), ["a.ts", "b.ts"]);
});
