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

function ViewportPushes(pushes: StructuredContextMessage[]): StructuredContextMessage[]
{
  return pushes.filter((p) => p.kind === "viewport_changed_since_last_check");
}

function CursorPushes(pushes: StructuredContextMessage[]): StructuredContextMessage[]
{
  return pushes.filter((p) => p.kind === "cursor_changed_since_last_check");
}

test("pre-observation tab switches do not emit viewport or cursor pushes", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-fr-tab0-"));
  try
  {
    const pushes: StructuredContextMessage[] = [];
    const session = CreateSessionHarness(pushes);
    const host = new FakeVscodeFreshnessHost(tmp);
    const a = host.makeEditor("a.ts");
    const b = host.makeEditor("b.ts");

    const svc = new FreshnessService(session as never, new ChatModel(), CreateLog() as never, host);
    svc.attachListeners();

    host.fireDidChangeActiveTextEditor(undefined);
    host.fireDidChangeActiveTextEditor(a);
    host.fireDidChangeActiveTextEditor(b);

    assert.equal(ViewportPushes(pushes).length, 0);
    assert.equal(CursorPushes(pushes).length, 0);
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("post-observation user tab switch emits one viewport and one cursor push for new file", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-fr-tab1-"));
  try
  {
    const pushes: StructuredContextMessage[] = [];
    const session = CreateSessionHarness(pushes);
    const host = new FakeVscodeFreshnessHost(tmp);
    const a = host.makeEditor("a.ts");
    const b = host.makeEditor("b.ts");

    const svc = new FreshnessService(session as never, new ChatModel(), CreateLog() as never, host);
    svc.attachListeners();

    host.fireDidChangeActiveTextEditor(a);
    svc.markViewportObserved("a.ts");
    svc.markCursorObserved("a.ts");

    host.fireDidChangeActiveTextEditor(b);

    assert.equal(ViewportPushes(pushes).length, 1);
    assert.equal(CursorPushes(pushes).length, 1);
    assert.equal((ViewportPushes(pushes)[0]!.payload as { file: string }).file, "b.ts");
    assert.equal((CursorPushes(pushes)[0]!.payload as { file: string }).file, "b.ts");
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("second tab switch before re-observe does not emit additional viewport or cursor pushes", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-fr-tab2-"));
  try
  {
    const pushes: StructuredContextMessage[] = [];
    const session = CreateSessionHarness(pushes);
    const host = new FakeVscodeFreshnessHost(tmp);
    const a = host.makeEditor("a.ts");
    const b = host.makeEditor("b.ts");
    const c = host.makeEditor("c.ts");

    const svc = new FreshnessService(session as never, new ChatModel(), CreateLog() as never, host);
    svc.attachListeners();

    host.fireDidChangeActiveTextEditor(a);
    svc.markViewportObserved("a.ts");
    svc.markCursorObserved("a.ts");

    host.fireDidChangeActiveTextEditor(b);
    host.fireDidChangeActiveTextEditor(c);

    assert.equal(ViewportPushes(pushes).length, 1);
    assert.equal(CursorPushes(pushes).length, 1);
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("re-observe on new active file reopens notification gate for tab switches", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-fr-tab3-"));
  try
  {
    const pushes: StructuredContextMessage[] = [];
    const session = CreateSessionHarness(pushes);
    const host = new FakeVscodeFreshnessHost(tmp);
    const a = host.makeEditor("a.ts");
    const b = host.makeEditor("b.ts");
    const c = host.makeEditor("c.ts");

    const svc = new FreshnessService(session as never, new ChatModel(), CreateLog() as never, host);
    svc.attachListeners();

    host.fireDidChangeActiveTextEditor(a);
    svc.markViewportObserved("a.ts");
    svc.markCursorObserved("a.ts");
    host.fireDidChangeActiveTextEditor(b);

    svc.markViewportObserved("b.ts");
    svc.markCursorObserved("b.ts");
    host.fireDidChangeActiveTextEditor(c);

    assert.equal(ViewportPushes(pushes).length, 2);
    assert.equal(CursorPushes(pushes).length, 2);
    assert.equal((ViewportPushes(pushes)[1]!.payload as { file: string }).file, "c.ts");
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("agent-originated active editor change is suppressed while mutation guard is held", () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-fr-tab4-"));
  try
  {
    const pushes: StructuredContextMessage[] = [];
    const session = CreateSessionHarness(pushes);
    const host = new FakeVscodeFreshnessHost(tmp);
    const a = host.makeEditor("a.ts");
    const b = host.makeEditor("b.ts");

    const svc = new FreshnessService(session as never, new ChatModel(), CreateLog() as never, host);
    svc.attachListeners();

    host.fireDidChangeActiveTextEditor(a);
    svc.markViewportObserved("a.ts");
    svc.markCursorObserved("a.ts");

    const guard = svc.beginAgentMutation();
    host.fireDidChangeActiveTextEditor(b);
    guard.end();

    assert.equal(ViewportPushes(pushes).length, 0);
    assert.equal(CursorPushes(pushes).length, 0);
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("closing all editors after observation emits viewport and cursor pushes with prior file payload", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-fr-tab5-"));
  try
  {
    const pushes: StructuredContextMessage[] = [];
    const session = CreateSessionHarness(pushes);
    const host = new FakeVscodeFreshnessHost(tmp);
    const a = host.makeEditor("a.ts");

    const svc = new FreshnessService(session as never, new ChatModel(), CreateLog() as never, host);
    svc.attachListeners();

    host.fireDidChangeActiveTextEditor(a);
    svc.markViewportObserved("a.ts");
    svc.markCursorObserved("a.ts");

    host.fireDidChangeActiveTextEditor(undefined);

    assert.equal(ViewportPushes(pushes).length, 1);
    assert.equal(CursorPushes(pushes).length, 1);
    assert.equal((ViewportPushes(pushes)[0]!.payload as { file: string }).file, "a.ts");

    host.fireDidChangeActiveTextEditor(undefined);
    assert.equal(ViewportPushes(pushes).length, 1);
    assert.equal(CursorPushes(pushes).length, 1);
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
