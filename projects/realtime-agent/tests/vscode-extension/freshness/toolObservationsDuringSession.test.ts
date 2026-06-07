import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import type { StructuredContextMessage } from "realtime-agent-lib";

import { ChatModel } from "../../../src/vscode-extension/src/chat/chatModel.js";
import { FreshnessCoordinator } from "../../../src/vscode-extension/src/freshness/freshnessCoordinator.js";
import { FreshnessService } from "../../../src/vscode-extension/src/freshness/freshnessService.js";
import { BuildVscodeToolCallSet } from "../../../src/vscode-extension/src/tools/callSetBuilder.js";
import type { CodeReadResult, ToolError } from "../../../src/vscode-extension/src/tools/types.js";
import { IsToolError } from "../../../src/vscode-extension/src/tools/types.js";
import { FakeVscodeFreshnessHost } from "../helpers/fakeVscodeEvents.js";
import { MemoryEditorAccess } from "../helpers/memoryEditorAccess.js";

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

test("code_read through coordinator-backed hooks updates file freshness", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-fr-tool-"));
  try
  {
    const pushes: StructuredContextMessage[] = [];
    const session = CreateSessionHarness(pushes);
    const host = new FakeVscodeFreshnessHost(tmp);
    const coordinator = new FreshnessCoordinator();
    const mem = new MemoryEditorAccess(tmp);
    mem.SeedFile("tracked.txt", ["hello"]);

    const toolSet = BuildVscodeToolCallSet({
      editorAccess: mem,
      freshness: coordinator.hooks,
    });

    const svc = new FreshnessService(session as never, new ChatModel(), CreateLog() as never, host);
    svc.attachListeners();
    coordinator.attach(svc);

    const tool = toolSet.tools.find((t) => t.name === "code_read");
    assert.ok(tool !== undefined);

    const out = (await tool!.callback({ file: "tracked.txt" }, { sessionId: "s", toolCallId: "c" })) as
      | CodeReadResult
      | ToolError;
    assert.ok(!IsToolError(out));

    host.fireDidChangeTextDocument(host.makeDocument("tracked.txt", "plaintext"));

    const filePushes = pushes.filter((p) => p.kind === "file_changed_since_last_read");
    assert.equal(filePushes.length, 1);
    assert.equal((filePushes[0]!.payload as { file: string }).file, "tracked.txt");
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
