import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import type { StructuredContextMessage } from "realtime-agent-lib";

import { ChatModel } from "../../src/chat/chatModel.js";
import { FreshnessService } from "../../src/freshness/freshnessService.js";
import { FakeVscodeFreshnessHost } from "../helpers/fakeVscodeEvents.js";

function DelayImmediate(): Promise<void>
{
  return new Promise((resolve) => setImmediate(resolve));
}

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

test("file: observe then change pushes once; second change suppressed until re-observe", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-fr-file-"));
  try
  {
    const pushes: StructuredContextMessage[] = [];
    const session = CreateSessionHarness(pushes);
    const host = new FakeVscodeFreshnessHost(tmp);
    const svc = new FreshnessService(session as never, new ChatModel(), CreateLog() as never, host);
    svc.attachListeners();

    svc.markFileObserved("src/a.ts");
    host.fireDidChangeTextDocument(host.makeDocument("src/a.ts", "typescript"));
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0]!.kind, "file_changed_since_last_read");

    host.fireDidChangeTextDocument(host.makeDocument("src/a.ts", "typescript"));
    assert.equal(pushes.length, 1);

    svc.markFileObserved("src/a.ts");
    host.fireDidChangeTextDocument(host.makeDocument("src/a.ts", "typescript"));
    assert.equal(pushes.length, 2);
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("file: multiple files tracked independently", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-fr-file2-"));
  try
  {
    const pushes: StructuredContextMessage[] = [];
    const session = CreateSessionHarness(pushes);
    const host = new FakeVscodeFreshnessHost(tmp);
    const svc = new FreshnessService(session as never, new ChatModel(), CreateLog() as never, host);
    svc.attachListeners();

    svc.markFileObserved("a.ts");
    svc.markFileObserved("b.ts");
    host.fireDidChangeTextDocument(host.makeDocument("a.ts", "typescript"));
    host.fireDidChangeTextDocument(host.makeDocument("b.ts", "typescript"));
    assert.equal(pushes.length, 2);
    const files = new Set(pushes.map((p) => (p.payload as { file: string }).file));
    assert.deepEqual(files, new Set(["a.ts", "b.ts"]));
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("file: git pseudo-documents ignored", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-fr-git-"));
  try
  {
    const pushes: StructuredContextMessage[] = [];
    const session = CreateSessionHarness(pushes);
    const host = new FakeVscodeFreshnessHost(tmp);
    const svc = new FreshnessService(session as never, new ChatModel(), CreateLog() as never, host);
    svc.attachListeners();

    svc.markFileObserved("x.ts");
    host.fireDidChangeTextDocument(host.makeDocument("x.ts", "git"));
    assert.equal(pushes.length, 0);
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
