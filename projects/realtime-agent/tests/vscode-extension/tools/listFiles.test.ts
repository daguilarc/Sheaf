import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { BuildVscodeToolCallSet } from "../../../src/vscode-extension/src/tools/callSetBuilder.js";
import type { FileEntry, ListFilesResult, ToolError } from "../../../src/vscode-extension/src/tools/types.js";
import { IsToolError } from "../../../src/vscode-extension/src/tools/types.js";
import { NoOpFreshnessHooks } from "../../../src/vscode-extension/src/tools/types.js";
import { MemoryEditorAccess } from "../helpers/memoryEditorAccess.js";

test("list_files non-recursive lists immediate children", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-lf-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    mem.SeedFile("a.txt", ["x"]);
    mem.SeedDirectory("d");
    const tool = BuildVscodeToolCallSet({ editorAccess: mem, freshness: NoOpFreshnessHooks }).tools.find(
      (t) => t.name === "list_files",
    )!;

    const rRaw = (await tool.callback({ directory: "." }, { sessionId: "s", toolCallId: "c" })) as
      | ListFilesResult
      | ToolError;
    assert.ok(!IsToolError(rRaw));
    const r = rRaw as ListFilesResult;
    assert.equal(r.truncated, false);
    const names = r.entries.map((e: FileEntry) => e.path).sort();
    assert.ok(names.includes("a.txt"));
    assert.ok(names.includes("d"));
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("list_files recursive respects maxEntries", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-lf2-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    mem.SeedFile("a/1.txt", ["1"]);
    mem.SeedFile("a/2.txt", ["2"]);
    mem.SeedFile("a/3.txt", ["3"]);
    const tool = BuildVscodeToolCallSet({ editorAccess: mem, freshness: NoOpFreshnessHooks }).tools.find(
      (t) => t.name === "list_files",
    )!;

    const rRaw = (await tool.callback(
      { directory: "a", recursive: true, maxEntries: 2 },
      { sessionId: "s", toolCallId: "c" },
    )) as ListFilesResult | ToolError;
    assert.ok(!IsToolError(rRaw));
    const r = rRaw as ListFilesResult;
    assert.equal(r.truncated, true);
    assert.equal(r.entries.length, 2);
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("list_files hides dotfiles by default", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-lf3-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    mem.SeedFile(".hide", ["h"]);
    mem.SeedFile("show.txt", ["s"]);
    const tool = BuildVscodeToolCallSet({ editorAccess: mem, freshness: NoOpFreshnessHooks }).tools.find(
      (t) => t.name === "list_files",
    )!;

    const rRaw = (await tool.callback({ directory: "." }, { sessionId: "s", toolCallId: "c" })) as
      | ListFilesResult
      | ToolError;
    assert.ok(!IsToolError(rRaw));
    const r = rRaw as ListFilesResult;
    assert.ok(!r.entries.some((e: FileEntry) => e.path === ".hide"));
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
