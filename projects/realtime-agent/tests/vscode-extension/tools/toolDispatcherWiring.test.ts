import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { ToolDispatcher, ToolRegistry } from "realtime-agent-lib";

import { BuildVscodeToolCallSet } from "../../../src/vscode-extension/src/tools/callSetBuilder.js";
import { NoOpFreshnessHooks } from "../../../src/vscode-extension/src/tools/types.js";
import { MemoryEditorAccess } from "../helpers/memoryEditorAccess.js";

test("ToolDispatcher emits function_call_output then response.create for tool success", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-tdw-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    mem.SeedFile("x.txt", ["hi"]);
    const set = BuildVscodeToolCallSet({ editorAccess: mem, freshness: NoOpFreshnessHooks });
    const registry = ToolRegistry.FromToolCallSet(set);
    const sent: unknown[] = [];
    const dispatcher = new ToolDispatcher({
      sessionId: "sid",
      registry,
      sendContext: {
        sendOutgoingEvent: (e) =>
        {
          sent.push(e);
        },
        enqueueResponseCreate: async () =>
        {
          sent.push({ type: "response.create" });
          return { status: "sent" as const };
        },
      },
      responseAfterOutput: "always",
    });

    dispatcher.Enqueue({ callId: "call1", name: "code_read", argumentsJson: JSON.stringify({ file: "x.txt" }) });
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(sent.length >= 2);
    const first = sent[0] as { item?: { type?: string } };
    assert.equal(first.item?.type, "function_call_output");
    assert.equal((sent[1] as { type?: string }).type, "response.create");
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("ToolDispatcher emits function_call_output then response.create for ToolError result", async () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-tdw2-"));
  try
  {
    const mem = new MemoryEditorAccess(tmp);
    const set = BuildVscodeToolCallSet({ editorAccess: mem, freshness: NoOpFreshnessHooks });
    const registry = ToolRegistry.FromToolCallSet(set);
    const sent: unknown[] = [];
    const dispatcher = new ToolDispatcher({
      sessionId: "sid",
      registry,
      sendContext: {
        sendOutgoingEvent: (e) =>
        {
          sent.push(e);
        },
        enqueueResponseCreate: async () =>
        {
          sent.push({ type: "response.create" });
          return { status: "sent" as const };
        },
      },
      responseAfterOutput: "always",
    });

    dispatcher.Enqueue({ callId: "call2", name: "code_read", argumentsJson: JSON.stringify({ file: "missing.txt" }) });
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(sent.length >= 2);
    const item = (sent[0] as { item?: { type?: string; output?: string } }).item;
    assert.equal(item?.type, "function_call_output");
    const payload = JSON.parse(item?.output ?? "{}") as { code?: string };
    assert.equal(payload.code, "file_not_found");
    assert.equal((sent[1] as { type?: string }).type, "response.create");
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
