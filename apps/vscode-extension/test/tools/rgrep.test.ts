import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { BuildVscodeToolCallSet } from "../../src/tools/callSetBuilder.js";
import type { RgrepResult, ToolError } from "../../src/tools/types.js";
import { IsToolError } from "../../src/tools/types.js";
import { NoOpFreshnessHooks } from "../../src/tools/types.js";
import { MemoryEditorAccess } from "../helpers/memoryEditorAccess.js";

test("rgrep finds matches with context and truncation", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-rg-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    mem.SeedFile("a.ts", ["aaa", "bbb TODO", "ccc"]);
    const tool = BuildVscodeToolCallSet({ editorAccess: mem, freshness: NoOpFreshnessHooks }).tools.find(
      (t) => t.name === "rgrep",
    )!;

    const rRaw = (await tool.callback(
      { pattern: "TODO", contextLinesBefore: 1, contextLinesAfter: 1 },
      { sessionId: "s", toolCallId: "c" },
    )) as RgrepResult | ToolError;
    assert.ok(!IsToolError(rRaw));
    const r = rRaw as RgrepResult;
    assert.equal(r.matches.length, 1);
    assert.equal(r.matches[0]?.line, 2);
    assert.ok(r.matches[0]?.contextBefore?.length === 1);

    const truncRaw = (await tool.callback({ pattern: "b", maxMatches: 1 }, { sessionId: "s", toolCallId: "c" })) as
      | RgrepResult
      | ToolError;
    assert.ok(!IsToolError(truncRaw));
    const trunc = truncRaw as RgrepResult;
    assert.equal(trunc.truncated, true);
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("rgrep invalid pattern", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-rg2-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    const tool = BuildVscodeToolCallSet({ editorAccess: mem, freshness: NoOpFreshnessHooks }).tools.find(
      (t) => t.name === "rgrep",
    )!;
    const r = (await tool.callback({ pattern: "[" }, { sessionId: "s", toolCallId: "c" })) as RgrepResult | ToolError;
    assert.ok(IsToolError(r));
    assert.equal(r.code, "invalid_pattern");
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("rgrep case sensitivity", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-rg3-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    mem.SeedFile("x.txt", ["AbC"]);
    const tool = BuildVscodeToolCallSet({ editorAccess: mem, freshness: NoOpFreshnessHooks }).tools.find(
      (t) => t.name === "rgrep",
    )!;

    const sensitiveRaw = (await tool.callback({ pattern: "x", caseSensitive: true }, { sessionId: "s", toolCallId: "c" })) as
      | RgrepResult
      | ToolError;
    assert.ok(!IsToolError(sensitiveRaw));
    const sensitive = sensitiveRaw as RgrepResult;
    assert.equal(sensitive.matches.length, 0);

    const insensitiveRaw = (await tool.callback(
      { pattern: "a", caseSensitive: false },
      { sessionId: "s", toolCallId: "c" },
    )) as RgrepResult | ToolError;
    assert.ok(!IsToolError(insensitiveRaw));
    const insensitive = insensitiveRaw as RgrepResult;
    assert.equal(insensitive.matches.length, 1);
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
