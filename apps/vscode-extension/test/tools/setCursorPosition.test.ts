import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { BuildVscodeToolCallSet } from "../../src/tools/callSetBuilder.js";
import type { SetCursorPositionResult, ToolError } from "../../src/tools/types.js";
import { IsToolError } from "../../src/tools/types.js";
import { NoOpFreshnessHooks } from "../../src/tools/types.js";
import { MemoryEditorAccess } from "../helpers/memoryEditorAccess.js";

test("set_cursor_position absolute opens and clamps character", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-scp-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    mem.SeedFile("f.txt", ["ab"]);
    const tool = BuildVscodeToolCallSet({ editorAccess: mem, freshness: NoOpFreshnessHooks }).tools.find(
      (t) => t.name === "set_cursor_position",
    )!;

    const rRaw = (await tool.callback(
      {
        target: { mode: "absolute", file: "f.txt", line: 1, character: 99 },
        returnVisibleRange: { linesAbove: 0, linesBelow: 0 },
      },
      { sessionId: "s", toolCallId: "c" },
    )) as SetCursorPositionResult | ToolError;
    assert.ok(!IsToolError(rRaw));
    const r = rRaw as SetCursorPositionResult;
    assert.equal(r.cursor.line, 1);
    assert.equal(r.cursor.character, 2);
    assert.ok(r.visibleRange !== undefined);
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("set_cursor_position relative requires active editor", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-scp2-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    mem.SeedFile("f.txt", ["a"]);
    const tool = BuildVscodeToolCallSet({ editorAccess: mem, freshness: NoOpFreshnessHooks }).tools.find(
      (t) => t.name === "set_cursor_position",
    )!;
    const r = (await tool.callback({ target: { mode: "relative", lineDelta: 0 } }, { sessionId: "s", toolCallId: "c" })) as
      | SetCursorPositionResult
      | ToolError;
    assert.ok(IsToolError(r));
    assert.equal(r.code, "no_active_editor");
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
