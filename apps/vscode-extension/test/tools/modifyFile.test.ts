import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { ToolRegistry } from "realtime-agent-lib";

import { FormatToolCallSummary } from "../../src/chat/toolSummary.js";
import { BuildVscodeToolCallSet } from "../../src/tools/callSetBuilder.js";
import type { CodePosition, ModifyFileResult, ToolError } from "../../src/tools/types.js";
import { IsToolError, NoOpFreshnessHooks } from "../../src/tools/types.js";
import type { FreshnessHooks } from "../../src/freshness/types.js";
import type { OpenedTextDocument } from "../../src/tools/editorAccessTypes.js";
import { MemoryEditorAccess } from "../helpers/memoryEditorAccess.js";

const x_expectedToolNames = [
  "code_read",
  "list_files",
  "rgrep",
  "read_visible_range",
  "set_cursor_position",
  "move_visible_range",
  "modifyFile",
];

function FindModifyFileTool(set: ReturnType<typeof BuildVscodeToolCallSet>)
{
  const tool = set.tools.find((t) => t.name === "modifyFile");
  assert.ok(tool !== undefined);
  return tool;
}

function ComputeEditWindow(
  doc: OpenedTextDocument,
  startLine0: number,
  startCharacter0: number,
  endLine0: number,
  endCharacter0: number,
): { target: string; before: string; after: string }
{
  const beforeStartLine0 = Math.max(0, startLine0 - 3);
  const afterEndLine0 = Math.min(doc.lineCount - 1, endLine0 + 3);
  return {
    target: doc.getTextRange0(startLine0, startCharacter0, endLine0, endCharacter0),
    before: doc.getTextRange0(beforeStartLine0, 0, startLine0, startCharacter0),
    after: doc.getTextRange0(
      endLine0,
      endCharacter0,
      afterEndLine0,
      doc.lineEndCharacter0(afterEndLine0),
    ),
  };
}

function Pos1(file: string, line: number, character: number): CodePosition
{
  return { file, line, character };
}

function DelayImmediate(): Promise<void>
{
  return new Promise((resolve) => setImmediate(resolve));
}

test("BuildVscodeToolCallSet exposes sheaf VS Code with modifyFile registered", () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-mf-set-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    const set = BuildVscodeToolCallSet({ editorAccess: mem, freshness: NoOpFreshnessHooks });
    assert.equal(set.name, "sheaf VS Code");
    assert.deepEqual(set.tools.map((t) => t.name), x_expectedToolNames);

    const registry = ToolRegistry.FromToolCallSet(set);
    assert.ok(registry.Resolve("modifyFile") !== undefined);
    assert.ok(registry.Resolve("code_read") !== undefined);
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("modifyFile single-line replacement", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-mf1-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    mem.SeedFile("a.txt", ["hello world"]);
    const set = BuildVscodeToolCallSet({ editorAccess: mem, freshness: NoOpFreshnessHooks });
    const tool = FindModifyFileTool(set);
    const abs = path.join(tmp, "a.txt");
    const doc = await mem.OpenTextDocument(abs, "a.txt");
    assert.ok(!IsToolError(doc));
    const window = ComputeEditWindow(doc, 0, 6, 0, 11);

    const result = (await tool!.callback(
      {
        start: Pos1("a.txt", 1, 6),
        end: Pos1("a.txt", 1, 11),
        exactText: window.target,
        replacementText: "there",
        contextBeforeText: window.before,
        contextAfterText: window.after,
      },
      { sessionId: "s", toolCallId: "c" },
    )) as ModifyFileResult | ToolError;
    assert.ok(!IsToolError(result));
    const ok = result as ModifyFileResult;
    assert.equal(ok.file, "a.txt");
    assert.equal(ok.insertedText, "there");
    assert.equal(ok.replacedText, "world");

    const afterDoc = await mem.OpenTextDocument(abs, "a.txt");
    assert.ok(!IsToolError(afterDoc));
    assert.equal(afterDoc.getText(), "hello there");
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("modifyFile multi-line replacement", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-mf2-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    mem.SeedFile("b.txt", ["line one", "line two", "line three"]);
    const set = BuildVscodeToolCallSet({ editorAccess: mem, freshness: NoOpFreshnessHooks });
    const tool = FindModifyFileTool(set);
    const abs = path.join(tmp, "b.txt");
    const doc = await mem.OpenTextDocument(abs, "b.txt");
    assert.ok(!IsToolError(doc));
    const window = ComputeEditWindow(doc, 0, 5, 2, 4);

    const result = (await tool!.callback(
      {
        start: Pos1("b.txt", 1, 5),
        end: Pos1("b.txt", 3, 4),
        exactText: window.target,
        replacementText: "middle",
        contextBeforeText: window.before,
        contextAfterText: window.after,
      },
      { sessionId: "s", toolCallId: "c" },
    )) as ModifyFileResult | ToolError;
    assert.ok(!IsToolError(result));

    const afterDoc = await mem.OpenTextDocument(abs, "b.txt");
    assert.ok(!IsToolError(afterDoc));
    assert.equal(afterDoc.getText(), "line middle three");
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("modifyFile zero-length insertion at cursor", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-mf3-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    mem.SeedFile("c.txt", ["ab", "cd"]);
    const set = BuildVscodeToolCallSet({ editorAccess: mem, freshness: NoOpFreshnessHooks });
    const tool = FindModifyFileTool(set);
    const abs = path.join(tmp, "c.txt");
    const doc = await mem.OpenTextDocument(abs, "c.txt");
    assert.ok(!IsToolError(doc));
    const window = ComputeEditWindow(doc, 1, 1, 1, 1);

    const result = (await tool!.callback(
      {
        start: Pos1("c.txt", 2, 1),
        end: Pos1("c.txt", 2, 1),
        exactText: "",
        replacementText: "X",
        contextBeforeText: window.before,
        contextAfterText: window.after,
      },
      { sessionId: "s", toolCallId: "c" },
    )) as ModifyFileResult | ToolError;
    assert.ok(!IsToolError(result));

    const afterDoc = await mem.OpenTextDocument(abs, "c.txt");
    assert.ok(!IsToolError(afterDoc));
    assert.equal(afterDoc.getText(), "ab\ncXd");
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("modifyFile allows fewer than three before lines at file start", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-mf4-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    mem.SeedFile("top.txt", ["first", "second", "third", "fourth"]);
    const set = BuildVscodeToolCallSet({ editorAccess: mem, freshness: NoOpFreshnessHooks });
    const tool = FindModifyFileTool(set);
    const abs = path.join(tmp, "top.txt");
    const doc = await mem.OpenTextDocument(abs, "top.txt");
    assert.ok(!IsToolError(doc));
    const window = ComputeEditWindow(doc, 0, 0, 0, 5);

    const result = (await tool!.callback(
      {
        start: Pos1("top.txt", 1, 0),
        end: Pos1("top.txt", 1, 5),
        exactText: window.target,
        replacementText: "ONE",
        contextBeforeText: window.before,
        contextAfterText: window.after,
      },
      { sessionId: "s", toolCallId: "c" },
    )) as ModifyFileResult | ToolError;
    assert.ok(!IsToolError(result));

    const afterDoc = await mem.OpenTextDocument(abs, "top.txt");
    assert.ok(!IsToolError(afterDoc));
    assert.equal(afterDoc.lineTextAt0(0), "ONE");
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("modifyFile allows fewer than three after lines at file end", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-mf5-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    mem.SeedFile("end.txt", ["alpha", "beta", "gamma"]);
    const set = BuildVscodeToolCallSet({ editorAccess: mem, freshness: NoOpFreshnessHooks });
    const tool = FindModifyFileTool(set);
    const abs = path.join(tmp, "end.txt");
    const doc = await mem.OpenTextDocument(abs, "end.txt");
    assert.ok(!IsToolError(doc));
    const line0 = doc.lineCount - 1;
    const endChar = doc.lineEndCharacter0(line0);
    const window = ComputeEditWindow(doc, line0, 0, line0, endChar);

    const result = (await tool!.callback(
      {
        start: Pos1("end.txt", line0 + 1, 0),
        end: Pos1("end.txt", line0 + 1, endChar),
        exactText: window.target,
        replacementText: "OMEGA",
        contextBeforeText: window.before,
        contextAfterText: window.after,
      },
      { sessionId: "s", toolCallId: "c" },
    )) as ModifyFileResult | ToolError;
    assert.ok(!IsToolError(result));

    const afterDoc = await mem.OpenTextDocument(abs, "end.txt");
    assert.ok(!IsToolError(afterDoc));
    assert.equal(afterDoc.lineTextAt0(line0), "OMEGA");
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("modifyFile file_mismatch when start and end files differ", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-mf6-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    mem.SeedFile("one.txt", ["a"]);
    mem.SeedFile("two.txt", ["b"]);
    const tool = FindModifyFileTool(BuildVscodeToolCallSet({ editorAccess: mem, freshness: NoOpFreshnessHooks }));

    const result = (await tool!.callback(
      {
        start: Pos1("one.txt", 1, 0),
        end: Pos1("two.txt", 1, 1),
        exactText: "",
        replacementText: "x",
        contextBeforeText: "",
        contextAfterText: "",
      },
      { sessionId: "s", toolCallId: "c" },
    )) as ToolError;
    assert.ok(IsToolError(result));
    assert.equal(result.code, "file_mismatch");
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("modifyFile invalid_position for bad lines, characters, and ordering", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-mf7-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    mem.SeedFile("pos.txt", ["abc"]);
    const tool = FindModifyFileTool(BuildVscodeToolCallSet({ editorAccess: mem, freshness: NoOpFreshnessHooks }));

    const zeroLine = (await tool!.callback(
      {
        start: Pos1("pos.txt", 0, 0),
        end: Pos1("pos.txt", 1, 0),
        exactText: "",
        replacementText: "",
        contextBeforeText: "",
        contextAfterText: "",
      },
      { sessionId: "s", toolCallId: "c" },
    )) as ToolError;
    assert.ok(IsToolError(zeroLine));
    assert.equal(zeroLine.code, "invalid_position");

    const negativeChar = (await tool!.callback(
      {
        start: Pos1("pos.txt", 1, -1),
        end: Pos1("pos.txt", 1, 0),
        exactText: "",
        replacementText: "",
        contextBeforeText: "",
        contextAfterText: "",
      },
      { sessionId: "s", toolCallId: "c" },
    )) as ToolError;
    assert.ok(IsToolError(negativeChar));
    assert.equal(negativeChar.code, "invalid_position");

    const outOfRange = (await tool!.callback(
      {
        start: Pos1("pos.txt", 99, 0),
        end: Pos1("pos.txt", 99, 0),
        exactText: "",
        replacementText: "",
        contextBeforeText: "",
        contextAfterText: "",
      },
      { sessionId: "s", toolCallId: "c" },
    )) as ToolError;
    assert.ok(IsToolError(outOfRange));
    assert.equal(outOfRange.code, "invalid_position");

    const startAfterEnd = (await tool!.callback(
      {
        start: Pos1("pos.txt", 1, 3),
        end: Pos1("pos.txt", 1, 1),
        exactText: "bc",
        replacementText: "",
        contextBeforeText: "a",
        contextAfterText: "",
      },
      { sessionId: "s", toolCallId: "c" },
    )) as ToolError;
    assert.ok(IsToolError(startAfterEnd));
    assert.equal(startAfterEnd.code, "invalid_position");
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("modifyFile mismatch errors leave buffer unchanged and include compact details", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-mf8-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    mem.SeedFile("m.txt", ["keep", "this", "text"]);
    const tool = FindModifyFileTool(BuildVscodeToolCallSet({ editorAccess: mem, freshness: NoOpFreshnessHooks }));
    const abs = path.join(tmp, "m.txt");
    const beforeDoc = await mem.OpenTextDocument(abs, "m.txt");
    assert.ok(!IsToolError(beforeDoc));
    const beforeText = beforeDoc.getText();
    const window = ComputeEditWindow(beforeDoc, 1, 0, 1, 4);

    const expectedMismatch = (await tool!.callback(
      {
        start: Pos1("m.txt", 2, 0),
        end: Pos1("m.txt", 2, 4),
        exactText: "WRONG",
        replacementText: "ok",
        contextBeforeText: window.before,
        contextAfterText: window.after,
      },
      { sessionId: "s", toolCallId: "c" },
    )) as ToolError;
    assert.ok(IsToolError(expectedMismatch));
    assert.equal(expectedMismatch.code, "expected_text_mismatch");
    assert.equal(expectedMismatch.details?.mismatchCategory, "target");
    assert.equal(expectedMismatch.details?.expectedLength, 5);
    assert.equal(expectedMismatch.details?.actualLength, 4);
    assert.equal(typeof expectedMismatch.details?.actualPreview, "string");
    assert.ok((expectedMismatch.details?.actualPreview as string).length <= 160);

    const beforeMismatch = (await tool!.callback(
      {
        start: Pos1("m.txt", 2, 0),
        end: Pos1("m.txt", 2, 4),
        exactText: window.target,
        replacementText: "ok",
        contextBeforeText: "BAD",
        contextAfterText: window.after,
      },
      { sessionId: "s", toolCallId: "c" },
    )) as ToolError;
    assert.ok(IsToolError(beforeMismatch));
    assert.equal(beforeMismatch.code, "context_before_mismatch");

    const afterMismatch = (await tool!.callback(
      {
        start: Pos1("m.txt", 2, 0),
        end: Pos1("m.txt", 2, 4),
        exactText: window.target,
        replacementText: "ok",
        contextBeforeText: window.before,
        contextAfterText: "BAD",
      },
      { sessionId: "s", toolCallId: "c" },
    )) as ToolError;
    assert.ok(IsToolError(afterMismatch));
    assert.equal(afterMismatch.code, "context_after_mismatch");

    const afterDoc = await mem.OpenTextDocument(abs, "m.txt");
    assert.ok(!IsToolError(afterDoc));
    assert.equal(afterDoc.getText(), beforeText);
    assert.ok(!afterDoc.getText().includes("ok"));
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("modifyFile successful edit uses freshness mutation guard", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-mf9-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    mem.SeedFile("fresh.txt", ["alpha beta"]);
    const abs = path.join(tmp, "fresh.txt");
    const doc = await mem.OpenTextDocument(abs, "fresh.txt");
    assert.ok(!IsToolError(doc));
    const window = ComputeEditWindow(doc, 0, 6, 0, 10);

    let mutationBegan = false;
    let mutationEnded = false;
    let observedFile: string | undefined;
    const hooks: FreshnessHooks = {
      markFileObserved(file: string)
      {
        observedFile = file;
      },
      markViewportObserved() {},
      markCursorObserved() {},
      beginAgentMutation()
      {
        mutationBegan = true;
        return {
          end()
          {
            mutationEnded = true;
          },
        };
      },
    };

    const tool = FindModifyFileTool(BuildVscodeToolCallSet({ editorAccess: mem, freshness: hooks }));
    const result = (await tool!.callback(
      {
        start: Pos1("fresh.txt", 1, 6),
        end: Pos1("fresh.txt", 1, 10),
        exactText: window.target,
        replacementText: "gamma",
        contextBeforeText: window.before,
        contextAfterText: window.after,
      },
      { sessionId: "s", toolCallId: "c" },
    )) as ModifyFileResult | ToolError;
    assert.ok(!IsToolError(result));
    assert.equal(mutationBegan, true);
    assert.equal(observedFile, "fresh.txt");

    await DelayImmediate();
    assert.equal(mutationEnded, true);
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("modifyFile mismatch does not begin agent mutation", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-mf10-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    mem.SeedFile("nomut.txt", ["stay"]);
    let mutationBegan = false;
    const hooks: FreshnessHooks = {
      markFileObserved() {},
      markViewportObserved() {},
      markCursorObserved() {},
      beginAgentMutation()
      {
        mutationBegan = true;
        return { end: () => {} };
      },
    };

    const tool = FindModifyFileTool(BuildVscodeToolCallSet({ editorAccess: mem, freshness: hooks }));
    const result = (await tool!.callback(
      {
        start: Pos1("nomut.txt", 1, 0),
        end: Pos1("nomut.txt", 1, 4),
        exactText: "gone",
        replacementText: "x",
        contextBeforeText: "",
        contextAfterText: "",
      },
      { sessionId: "s", toolCallId: "c" },
    )) as ToolError;
    assert.ok(IsToolError(result));
    assert.equal(mutationBegan, false);
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("FormatToolCallSummary summarizes modifyFile", () =>
{
  assert.equal(
    FormatToolCallSummary(
      "modifyFile",
      JSON.stringify({ start: { file: "src/a.ts", line: 12, character: 0 } }),
    ),
    "Editing src/a.ts at line 12",
  );
});
