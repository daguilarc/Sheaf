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

test("cursor: after markCursorObserved, selection change pushes once", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-fr-cur-"));
  try
  {
    const pushes: StructuredContextMessage[] = [];
    const session = CreateSessionHarness(pushes);
    const host = new FakeVscodeFreshnessHost(tmp);
    const ed = host.makeEditor("main.ts");
    host.setActiveEditor(ed);

    const svc = new FreshnessService(session as never, new ChatModel(), CreateLog() as never, host);
    svc.attachListeners();

    svc.markCursorObserved("main.ts");
    host.fireDidChangeTextEditorSelection(ed);
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0]!.kind, "cursor_changed_since_last_check");

    host.fireDidChangeTextEditorSelection(ed);
    assert.equal(pushes.length, 1);
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
