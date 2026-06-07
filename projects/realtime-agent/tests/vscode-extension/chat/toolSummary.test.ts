import assert from "node:assert/strict";
import { test } from "node:test";

import { FormatToolCallSummary } from "../../../src/vscode-extension/src/chat/toolSummary.js";

test("code_read renders line range", () =>
{
  assert.equal(
    FormatToolCallSummary(
      "code_read",
      JSON.stringify({ file: "src/example.ts", startLine: 40, endLine: 90 }),
    ),
    "Reading src/example.ts lines 40-90",
  );
});

test("code_read without line range", () =>
{
  assert.equal(FormatToolCallSummary("code_read", JSON.stringify({ file: "README.md" })), "Reading README.md");
});

test("list_files with directory", () =>
{
  assert.equal(
    FormatToolCallSummary("list_files", JSON.stringify({ directory: "src" })),
    "Listing files in src",
  );
});

test("rgrep includes path when present", () =>
{
  assert.equal(
    FormatToolCallSummary(
      "rgrep",
      JSON.stringify({ pattern: "TODO", path: "apps" }),
    ),
    "Searching TODO in apps",
  );
});

test("modifyFile includes file and line", () =>
{
  assert.equal(
    FormatToolCallSummary(
      "modifyFile",
      JSON.stringify({ start: { file: "lib/util.ts", line: 3, character: 0 } }),
    ),
    "Editing lib/util.ts at line 3",
  );
});

test("unknown tool falls back to name", () =>
{
  assert.equal(FormatToolCallSummary("future_tool", "{}"), "future_tool");
});
