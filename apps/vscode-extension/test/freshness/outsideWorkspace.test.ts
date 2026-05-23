import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import type { StructuredContextMessage } from "realtime-agent-lib";

import { ChatModel } from "../../src/chat/chatModel.js";
import { FreshnessService } from "../../src/freshness/freshnessService.js";
import { FakeVscodeFreshnessHost } from "../helpers/fakeVscodeEvents.js";

function CreateLog()
{
  return {
    Line: () => {},
    Error: () => {},
  };
}

function CreateSessionHarness(pushes: StructuredContextMessage[])
{
  return {
    sessionId: "test-session",
    sendAudioFrame: () => {},
    commitAudio: async () => ({ status: "sent" as const }),
    createResponse: async () => ({ status: "sent" as const }),
    commitAudioAndCreateResponse: async () => ({ status: "sent" as const }),
    sendTextMessage: async () => ({ status: "sent" as const }),
    sendStructuredContext: async (message: StructuredContextMessage) =>
    {
      pushes.push(message);
      return { status: "sent" as const };
    },
    sendRealtimeEvent: async () => ({ status: "sent" as const }),
    clearAudioBuffer: async () => ({ status: "sent" as const }),
    stop: async () => ({}) as import("realtime-agent-lib").SessionRow,
  };
}

function MakeOutsidePath(): string
{
  // Build an absolute path that is unambiguously outside any temp workspace
  // root we create in these tests. We point at a sibling of the OS tmpdir so
  // production-style `asRelativePath` behavior (returning a non-empty
  // absolute path) would otherwise leak it as a "relative" value.
  //
  return path.join(os.tmpdir(), "sheaf-fr-outside-fixtures", "elsewhere.ts");
}

test("outside-workspace tab switch after observation does not push viewport or cursor", () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-fr-out0-"));
  try
  {
    const pushes: StructuredContextMessage[] = [];
    const session = CreateSessionHarness(pushes);
    const host = new FakeVscodeFreshnessHost(tmp);
    const inside = host.makeEditor("a.ts");
    const outside = host.makeOutsideEditor(MakeOutsidePath());

    const svc = new FreshnessService(session as never, new ChatModel(), CreateLog() as never, host);
    svc.attachListeners();

    host.fireDidChangeActiveTextEditor(inside);
    svc.markViewportObserved("a.ts");
    svc.markCursorObserved("a.ts");

    host.fireDidChangeActiveTextEditor(outside);

    const viewport = pushes.filter((p) => p.kind === "viewport_changed_since_last_check");
    const cursor = pushes.filter((p) => p.kind === "cursor_changed_since_last_check");
    assert.equal(viewport.length, 0);
    assert.equal(cursor.length, 0);

    for (const p of pushes)
    {
      const file = (p.payload as { file?: string }).file ?? "";
      assert.ok(!path.isAbsolute(file), `payload.file must not be absolute: ${file}`);
      assert.ok(!file.includes(".."), `payload.file must not contain '..': ${file}`);
    }
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("outside-workspace document change does not push file freshness", () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-fr-out1-"));
  try
  {
    const pushes: StructuredContextMessage[] = [];
    const session = CreateSessionHarness(pushes);
    const host = new FakeVscodeFreshnessHost(tmp);
    const outsideAbs = MakeOutsidePath();

    const svc = new FreshnessService(session as never, new ChatModel(), CreateLog() as never, host);
    svc.attachListeners();

    svc.markFileObserved(outsideAbs);
    host.fireDidChangeTextDocument(host.makeOutsideDocument(outsideAbs, "typescript"));

    assert.equal(pushes.length, 0);
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("outside-workspace visible-range and selection changes do not push", () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-fr-out2-"));
  try
  {
    const pushes: StructuredContextMessage[] = [];
    const session = CreateSessionHarness(pushes);
    const host = new FakeVscodeFreshnessHost(tmp);
    const inside = host.makeEditor("a.ts");
    const outside = host.makeOutsideEditor(MakeOutsidePath());

    const svc = new FreshnessService(session as never, new ChatModel(), CreateLog() as never, host);
    svc.attachListeners();

    host.fireDidChangeActiveTextEditor(inside);
    svc.markViewportObserved("a.ts");
    svc.markCursorObserved("a.ts");

    host.setActiveEditor(outside);
    host.fireDidChangeTextEditorVisibleRanges(outside);
    host.fireDidChangeTextEditorSelection(outside);

    const viewport = pushes.filter((p) => p.kind === "viewport_changed_since_last_check");
    const cursor = pushes.filter((p) => p.kind === "cursor_changed_since_last_check");
    assert.equal(viewport.length, 0);
    assert.equal(cursor.length, 0);
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("no workspace roots: every file URI is treated as outside-workspace", () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-fr-out3-"));
  try
  {
    const pushes: StructuredContextMessage[] = [];
    const session = CreateSessionHarness(pushes);
    const host = new FakeVscodeFreshnessHost(tmp);
    host.clearWorkspaceRoots();
    const ed = host.makeEditor("a.ts");

    const svc = new FreshnessService(session as never, new ChatModel(), CreateLog() as never, host);
    svc.attachListeners();

    svc.markFileObserved("a.ts");
    host.fireDidChangeActiveTextEditor(ed);
    host.setActiveEditor(ed);
    host.fireDidChangeTextDocument(host.makeDocument("a.ts", "typescript"));
    host.fireDidChangeTextEditorVisibleRanges(ed);
    host.fireDidChangeTextEditorSelection(ed);

    assert.equal(pushes.length, 0);
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("multi-root workspace: files in any configured root produce relative pushes", () =>
{
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-fr-out4a-"));
  const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-fr-out4b-"));
  try
  {
    const pushes: StructuredContextMessage[] = [];
    const session = CreateSessionHarness(pushes);
    const host = new FakeVscodeFreshnessHost(tmpA);
    host.setWorkspaceRoots([tmpA, tmpB]);

    const svc = new FreshnessService(session as never, new ChatModel(), CreateLog() as never, host);
    svc.attachListeners();

    const absInB = path.join(tmpB, "nested", "b.ts");
    svc.markFileObserved("nested/b.ts");
    host.fireDidChangeTextDocument(host.makeOutsideDocument(absInB, "typescript"));

    assert.equal(pushes.length, 1);
    assert.equal(pushes[0]!.kind, "file_changed_since_last_read");
    assert.equal((pushes[0]!.payload as { file: string }).file, "nested/b.ts");
  }
  finally
  {
    fs.rmSync(tmpA, { recursive: true, force: true });
    fs.rmSync(tmpB, { recursive: true, force: true });
  }
});
