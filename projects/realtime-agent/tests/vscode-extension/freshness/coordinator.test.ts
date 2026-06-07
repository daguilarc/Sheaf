import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import type { StructuredContextMessage } from "realtime-agent-lib";

import { ChatModel } from "../../../src/vscode-extension/src/chat/chatModel.js";
import { FreshnessCoordinator } from "../../../src/vscode-extension/src/freshness/freshnessCoordinator.js";
import { FreshnessService } from "../../../src/vscode-extension/src/freshness/freshnessService.js";
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

test("coordinator hooks no-op safely before attach", () =>
{
  const c = new FreshnessCoordinator();
  c.hooks.markFileObserved("a.ts");
  c.hooks.markViewportObserved("a.ts");
  c.hooks.markCursorObserved("a.ts");
  const g = c.hooks.beginAgentMutation();
  g.end();
});

test("coordinator routes hook calls to attached service and detaches cleanly", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-fr-coord-"));
  try
  {
    const pushes: StructuredContextMessage[] = [];
    const session = CreateSessionHarness(pushes);
    const host = new FakeVscodeFreshnessHost(tmp);
    const chat = new ChatModel();
    const svc = new FreshnessService(session as never, chat, CreateLog() as never, host);
    svc.attachListeners();

    const c = new FreshnessCoordinator();
    c.hooks.markFileObserved("z.ts");
    assert.equal(pushes.length, 0);

    c.attach(svc);
    c.hooks.markFileObserved("z.ts");
    host.fireDidChangeTextDocument(host.makeDocument("z.ts", "typescript"));
    assert.equal(pushes.length, 1);

    c.detach();
    c.hooks.markFileObserved("z.ts");
    host.fireDidChangeTextDocument(host.makeDocument("z.ts", "typescript"));
    assert.equal(pushes.length, 1);

    const svc2 = new FreshnessService(session as never, chat, CreateLog() as never, host);
    svc2.attachListeners();
    c.attach(svc2);
    c.hooks.markFileObserved("z.ts");
    host.fireDidChangeTextDocument(host.makeDocument("z.ts", "typescript"));
    assert.equal(pushes.length, 2);
    c.detach();
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
