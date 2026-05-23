import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { BuildVscodeToolCallSet } from "../../src/tools/callSetBuilder.js";
import type { CodeReadResult, ToolError } from "../../src/tools/types.js";
import { IsToolError } from "../../src/tools/types.js";
import { NoOpFreshnessHooks } from "../../src/tools/types.js";
import { MemoryEditorAccess } from "../helpers/memoryEditorAccess.js";

test("code_read full file and range", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-cr-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    mem.SeedFile("hi.txt", ["a", "b", "c"]);
    const set = BuildVscodeToolCallSet({ editorAccess: mem, freshness: NoOpFreshnessHooks });
    const tool = set.tools.find((t) => t.name === "code_read");
    assert.ok(tool !== undefined);

    const fullRaw = (await tool!.callback({ file: "hi.txt" }, { sessionId: "s", toolCallId: "c" })) as
      | CodeReadResult
      | ToolError;
    assert.ok(!IsToolError(fullRaw));
    const full = fullRaw as CodeReadResult;
    assert.equal(full.lineCount, 3);
    assert.equal(full.startLine, 1);
    assert.equal(full.endLine, 3);

    const partRaw = (await tool!.callback(
      { file: "hi.txt", startLine: 2, endLine: 2 },
      { sessionId: "s", toolCallId: "c" },
    )) as CodeReadResult | ToolError;
    assert.ok(!IsToolError(partRaw));
    const part = partRaw as CodeReadResult;
    assert.deepEqual(part.lines, [{ line: 2, text: "b" }]);

    const missing = (await tool!.callback({ file: "nope.txt" }, { sessionId: "s", toolCallId: "c" })) as
      | CodeReadResult
      | ToolError;
    assert.ok(IsToolError(missing));
    assert.equal(missing.code, "file_not_found");
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("code_read directory yields path_is_directory", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-cr2-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    mem.SeedDirectory("d");
    const set = BuildVscodeToolCallSet({ editorAccess: mem, freshness: NoOpFreshnessHooks });
    const tool = set.tools.find((t) => t.name === "code_read")!;
    const r = (await tool.callback({ file: "d" }, { sessionId: "s", toolCallId: "c" })) as ToolError | CodeReadResult;
    assert.ok(IsToolError(r));
    assert.equal(r.code, "path_is_directory");
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("code_read binary NUL sniff", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-cr3-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    mem.SeedFile("bin.txt", [`a${String.fromCharCode(0)}b`]);
    const set = BuildVscodeToolCallSet({ editorAccess: mem, freshness: NoOpFreshnessHooks });
    const tool = set.tools.find((t) => t.name === "code_read")!;
    const r = (await tool.callback({ file: "bin.txt" }, { sessionId: "s", toolCallId: "c" })) as ToolError | CodeReadResult;
    assert.ok(IsToolError(r));
    assert.equal(r.code, "binary_file");
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("code_read empty file", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-cr4-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    mem.SeedFile("empty.txt", []);
    const set = BuildVscodeToolCallSet({ editorAccess: mem, freshness: NoOpFreshnessHooks });
    const tool = set.tools.find((t) => t.name === "code_read")!;
    const rRaw = (await tool.callback({ file: "empty.txt" }, { sessionId: "s", toolCallId: "c" })) as
      | CodeReadResult
      | ToolError;
    assert.ok(!IsToolError(rRaw));
    const r = rRaw as CodeReadResult;
    assert.equal(r.lineCount, 0);
    assert.deepEqual(r.lines, []);
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
