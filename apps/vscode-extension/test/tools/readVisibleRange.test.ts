import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { BuildVscodeToolCallSet } from "../../src/tools/callSetBuilder.js";
import type { ReadVisibleRangeResult, ToolError } from "../../src/tools/types.js";
import { IsToolError } from "../../src/tools/types.js";
import { NoOpFreshnessHooks } from "../../src/tools/types.js";
import { MemoryEditorAccess } from "../helpers/memoryEditorAccess.js";

test("read_visible_range clamps and includes cursor", () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-rvr-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    mem.SeedFile("f.txt", ["L0", "L1", "L2"]);
    mem.SetActiveFile("f.txt", 1, 0);
    const tool = BuildVscodeToolCallSet({ editorAccess: mem, freshness: NoOpFreshnessHooks }).tools.find(
      (t) => t.name === "read_visible_range",
    )!;

    const rRaw = tool.callback({ linesAbove: 10, linesBelow: 10 }, { sessionId: "s", toolCallId: "c" }) as
      | ReadVisibleRangeResult
      | ToolError;
    assert.ok(!IsToolError(rRaw));
    const r = rRaw as ReadVisibleRangeResult;
    assert.equal(r.lines[0]?.line, 1);
    assert.equal(r.lines.at(-1)?.line, 3);
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("read_visible_range no active editor", () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-rvr2-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    mem.SeedFile("f.txt", ["x"]);
    const tool = BuildVscodeToolCallSet({ editorAccess: mem, freshness: NoOpFreshnessHooks }).tools.find(
      (t) => t.name === "read_visible_range",
    )!;
    const r = tool.callback({ linesAbove: 1, linesBelow: 1 }, { sessionId: "s", toolCallId: "c" }) as
      | ReadVisibleRangeResult
      | ToolError;
    assert.ok(IsToolError(r));
    assert.equal(r.code, "no_active_editor");
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
