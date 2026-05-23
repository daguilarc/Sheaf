import assert from "node:assert/strict";
import { test } from "node:test";

import type { StructuredContextMessage } from "realtime-agent-lib";

import { FormatContextPushSummary } from "../../src/chat/contextSummary.js";

test("FormatContextPushSummary prefers explicit summary", () =>
{
  const message: StructuredContextMessage = {
    kind: "file_changed_since_last_read",
    source: "vscode",
    payload: { file: "src/example.ts" },
    summary: "src/example.ts changed since last read",
  };
  assert.equal(FormatContextPushSummary(message), "src/example.ts changed since last read");
});

test("FormatContextPushSummary falls back to kind label", () =>
{
  const message: StructuredContextMessage = {
    kind: "viewport_changed_since_last_check",
    source: "vscode",
    payload: { file: "src/example.ts" },
  };
  assert.equal(FormatContextPushSummary(message), "Context: viewport_changed_since_last_check");
});

test("FormatContextPushSummary handles cursor_changed_since_last_check with summary", () =>
{
  const message: StructuredContextMessage = {
    kind: "cursor_changed_since_last_check",
    source: "vscode",
    payload: { file: "src/example.ts" },
    summary: "Cursor position changed since last check",
  };
  assert.equal(FormatContextPushSummary(message), "Cursor position changed since last check");
});
