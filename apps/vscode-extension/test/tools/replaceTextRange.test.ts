import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { IsToolError } from "../../src/tools/types.js";
import { MemoryEditorAccess } from "../helpers/memoryEditorAccess.js";

test("ReplaceTextRange replaces a single-line range", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-rtr-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    mem.SeedFile("a.txt", ["hello world"]);
    const abs = path.join(tmp, "a.txt");

    const result = await mem.ReplaceTextRange(
      abs,
      "a.txt",
      { startLine0: 0, startCharacter0: 6, endLine0: 0, endCharacter0: 11 },
      "there",
    );
    assert.deepEqual(result, { accepted: true });

    const doc = await mem.OpenTextDocument(abs, "a.txt");
    assert.ok(!IsToolError(doc));
    assert.equal(doc.getText(), "hello there");
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("ReplaceTextRange replaces a multi-line range preserving newlines", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-rtr2-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    mem.SeedFile("b.txt", ["line one", "line two", "line three"]);
    const abs = path.join(tmp, "b.txt");

    const result = await mem.ReplaceTextRange(
      abs,
      "b.txt",
      { startLine0: 0, startCharacter0: 5, endLine0: 2, endCharacter0: 4 },
      "middle",
    );
    assert.deepEqual(result, { accepted: true });

    const doc = await mem.OpenTextDocument(abs, "b.txt");
    assert.ok(!IsToolError(doc));
    assert.equal(doc.getText(), "line middle three");
    assert.equal(doc.lineCount, 1);
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("ReplaceTextRange inserts text when start equals end", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-rtr3-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    mem.SeedFile("c.txt", ["ab", "cd"]);
    const abs = path.join(tmp, "c.txt");

    const result = await mem.ReplaceTextRange(
      abs,
      "c.txt",
      { startLine0: 1, startCharacter0: 1, endLine0: 1, endCharacter0: 1 },
      "X",
    );
    assert.deepEqual(result, { accepted: true });

    const doc = await mem.OpenTextDocument(abs, "c.txt");
    assert.ok(!IsToolError(doc));
    assert.equal(doc.getText(), "ab\ncXd");
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("ReplaceTextRange rejects invalid positions without mutating buffer", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-rtr4-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    mem.SeedFile("d.txt", ["keep"]);
    const abs = path.join(tmp, "d.txt");
    const before = (await mem.OpenTextDocument(abs, "d.txt"));
    assert.ok(!IsToolError(before));
    const beforeText = before.getText();

    const result = await mem.ReplaceTextRange(
      abs,
      "d.txt",
      { startLine0: 99, startCharacter0: 0, endLine0: 99, endCharacter0: 0 },
      "nope",
    );
    assert.ok(IsToolError(result));
    assert.equal(result.code, "invalid_position");

    const after = await mem.OpenTextDocument(abs, "d.txt");
    assert.ok(!IsToolError(after));
    assert.equal(after.getText(), beforeText);
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("OpenedTextDocument buffer helpers read exact ranges", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-rtr5-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    mem.SeedFile("e.txt", ["alpha", "beta", "gamma"]);
    const abs = path.join(tmp, "e.txt");
    const doc = await mem.OpenTextDocument(abs, "e.txt");
    assert.ok(!IsToolError(doc));

    assert.equal(doc.getTextRange0(0, 1, 2, 3), "lpha\nbeta\ngam");
    assert.equal(doc.lineEndCharacter0(1), 4);
    assert.ok(doc.positionIsValid0(1, 4));
    assert.ok(!doc.positionIsValid0(1, 5));
    assert.equal(doc.offsetAt0(1, 0), 6);
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
