import assert from "node:assert/strict";
import test from "node:test";

import { DictatorClient, type DictatorCommand } from "../src/dictatorClient.js";
import type { CommandResult, PaneState } from "../src/types.js";

test("DictatorClient posts state, command results, and disconnect", async () => {
  const posts: Array<{ path: string; body: unknown }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (init?.method === "POST")
    {
      posts.push({
        path: new URL(url).pathname,
        body: JSON.parse(String(init.body)),
      });
      return new Response("{}", { status: 200 });
    }

    const command: DictatorCommand = { id: "cmd-1", action: "stage" };
    return new Response(JSON.stringify(command), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try
  {
    const results: CommandResult[] = [];
    const client = new DictatorClient("http://127.0.0.1:9003", "window-1", async (command) => {
      const result: CommandResult = { ok: true, action: command.action, state: state() };
      results.push(result);
      return result;
    });

    await client.publishState(state());
    await (client as unknown as { pollCommand(): Promise<void> }).pollCommand();
    client.stop();
    await Promise.resolve();

    assert.equal(posts[0]?.path, "/api/vscode-hunk/state");
    assert.equal(posts[1]?.path, "/api/vscode-hunk/command-result");
    assert.deepEqual(posts[1]?.body, {
      commandId: "cmd-1",
      windowId: "window-1",
      result: results[0],
    });
    assert.equal(posts[2]?.path, "/api/vscode-hunk/disconnect");
  }
  finally
  {
    globalThis.fetch = originalFetch;
  }
});

function state(): PaneState
{
  return {
    windowId: "window-1",
    focused: true,
    paneOpen: true,
    repoRoot: "/tmp/repo",
    file: "src/app.ts",
    fileIndex: 0,
    fileCount: 1,
    hunkIndex: 0,
    hunkCount: 1,
    currentHunk: {
      id: "src/app.ts:0:abc",
      file: "src/app.ts",
      index: 0,
      count: 1,
      header: "@@ -1 +1 @@",
      oldRange: { start: 1, lines: 1 },
      newRange: { start: 1, lines: 1 },
      patchHash: "abc",
      patch: "",
    },
    actions: {
      canGoUp: false,
      canGoDown: false,
      canGoPrevFile: false,
      canGoNextFile: false,
      canStage: true,
      canRevert: true,
      canUndo: false,
    },
  };
}
