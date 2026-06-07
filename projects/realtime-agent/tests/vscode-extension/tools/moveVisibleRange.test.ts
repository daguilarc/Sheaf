import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { BuildVscodeToolCallSet } from "../../../src/vscode-extension/src/tools/callSetBuilder.js";
import type { MoveVisibleRangeResult, ToolError } from "../../../src/vscode-extension/src/tools/types.js";
import { IsToolError } from "../../../src/vscode-extension/src/tools/types.js";
import { NoOpFreshnessHooks } from "../../../src/vscode-extension/src/tools/types.js";
import { MemoryEditorAccess } from "../helpers/memoryEditorAccess.js";

test("move_visible_range relative preserves cursor line", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-mvr-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    mem.SeedFile("f.txt", ["L0", "L1", "L2", "L3", "L4"]);
    mem.SetActiveFile("f.txt", 2, 0);
    const tool = BuildVscodeToolCallSet({ editorAccess: mem, freshness: NoOpFreshnessHooks }).tools.find(
      (t) => t.name === "move_visible_range",
    )!;

    const rRaw = (await tool.callback({ target: { mode: "relative", lineDelta: 1 } }, { sessionId: "s", toolCallId: "c" })) as
      | MoveVisibleRangeResult
      | ToolError;
    assert.ok(!IsToolError(rRaw));
    const r = rRaw as MoveVisibleRangeResult;
    assert.equal(r.cursor.line, 3);
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("move_visible_range returnVisibleRange when cursor outside viewport", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-mvr2-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    const lines = Array.from({ length: 40 }, (_, i) => `L${i}`);
    mem.SeedFile("big.txt", lines);
    mem.SetActiveFile("big.txt", 5, 0);
    const tool = BuildVscodeToolCallSet({ editorAccess: mem, freshness: NoOpFreshnessHooks }).tools.find(
      (t) => t.name === "move_visible_range",
    )!;

    const rRaw = (await tool.callback(
      {
        target: { mode: "relative", lineDelta: 20 },
        returnVisibleRange: { linesAbove: 1, linesBelow: 1 },
      },
      { sessionId: "s", toolCallId: "c" },
    )) as MoveVisibleRangeResult | ToolError;
    assert.ok(!IsToolError(rRaw));
    const r = rRaw as MoveVisibleRangeResult;
    assert.ok(r.visibleRange !== undefined);
    assert.equal(r.cursor.line, 6);
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
