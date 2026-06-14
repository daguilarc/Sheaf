import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { WebSocket } from "ws";

import {
  RequestJson,
  ResolveOpenAiTestModel,
  WithTestServer,
} from "./helpers.js";

const ExecFile = promisify(execFile);

function WsUrl(baseUrl: string, pile: string, sessionId: string): string
{
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws/agent-review";
  url.search = "";
  url.searchParams.set("p", pile);
  url.searchParams.set("session", sessionId);
  url.searchParams.set("client", "test-client");
  return url.toString();
}

function WaitForFrame(socket: WebSocket, type: string): Promise<Record<string, any>>
{
  return new Promise((resolve, reject) =>
  {
    const onMessage = (raw: WebSocket.RawData): void =>
    {
      const frame = JSON.parse(raw.toString()) as Record<string, any>;
      if (frame.type !== type)
      {
        return;
      }
      socket.off("message", onMessage);
      resolve(frame);
    };
    socket.on("message", onMessage);
    socket.once("error", reject);
  });
}

async function Git(cwd: string, args: string[]): Promise<string>
{
  const result = await ExecFile("git", args, { cwd });
  return result.stdout;
}

async function CreateGitReviewSession(
  baseUrl: string,
  agentManager: import("../../../src/agents/manager.js").AgentManager,
): Promise<{ pile: string; sessionId: string; repoRoot: string; filePath: string }>
{
  const pile = "default";
  await RequestJson(baseUrl, "POST", "/api/piles", { pile });
  const created = await RequestJson(baseUrl, "POST", `/api/piles/${pile}/sessions`, {
    rootDirectory: "projects/demo",
    model: ResolveOpenAiTestModel(agentManager),
  });
  assert.equal(created.status, 201);

  const sessionId = (created.body as { sessionId: string }).sessionId;
  const repoRoot = agentManager.storagePaths.repoRoot;
  const demoRoot = path.join(repoRoot, "projects/demo");
  const filePath = path.join(demoRoot, "app.ts");

  await mkdir(demoRoot, { recursive: true });
  await Git(repoRoot, ["init"]);
  await Git(repoRoot, ["config", "user.email", "test@example.com"]);
  await Git(repoRoot, ["config", "user.name", "Test User"]);
  await writeFile(filePath, "one\ntwo\nthree\n", "utf8");
  await Git(repoRoot, ["add", "projects/demo/app.ts"]);
  await Git(repoRoot, ["commit", "-m", "initial"]);
  await writeFile(filePath, "one\ntwo changed\nthree\n", "utf8");

  return { pile, sessionId, repoRoot, filePath };
}

test("Agent Review availability reports Git hunks under the session root", async () =>
{
  await WithTestServer(async ({ baseUrl, agentManager }) =>
  {
    const { pile, sessionId } = await CreateGitReviewSession(baseUrl, agentManager);
    const response = await RequestJson(
      baseUrl,
      "GET",
      `/api/piles/${pile}/sessions/${sessionId}/agent-review`,
    );

    assert.equal(response.status, 200);
    const body = response.body as {
      available: boolean;
      currentHunk: { sourceProvider: string; file: string; patch: string } | null;
      files: Array<{ file: string; hunkCount: number }>;
      actions: { canStage: boolean; canRevert: boolean };
    };
    assert.equal(body.available, true);
    assert.equal(body.currentHunk?.sourceProvider, "sheaf-chat");
    assert.equal(body.currentHunk?.file, "projects/demo/app.ts");
    assert.match(body.currentHunk?.patch ?? "", /two changed/);
    assert.deepEqual(body.files, [{ file: "projects/demo/app.ts", hunkCount: 1 }]);
    assert.equal(body.actions.canStage, true);
    assert.equal(body.actions.canRevert, true);
  });
});

test("Agent Review WebSocket stages, reverts, and undoes current hunks", async () =>
{
  await WithTestServer(async ({ baseUrl, agentManager }) =>
  {
    const { pile, sessionId, repoRoot, filePath } =
      await CreateGitReviewSession(baseUrl, agentManager);
    const socket = new WebSocket(WsUrl(baseUrl, pile, sessionId));

    await new Promise<void>((resolve, reject) =>
    {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });

    const bootstrap = await WaitForFrame(socket, "bootstrap");
    const hunk = bootstrap.state.currentHunk;
    assert.equal(hunk.file, "projects/demo/app.ts");

    socket.send(JSON.stringify({
      type: "command",
      id: "stage-1",
      action: "stage",
      hunkId: hunk.hunkId,
      patchHash: hunk.patchHash,
    }));
    const stage = await WaitForFrame(socket, "command_result");
    assert.equal(stage.result.ok, true);
    assert.equal(stage.result.reviewFacts, undefined);
    assert.match(await Git(repoRoot, ["diff", "--cached", "--", "projects/demo/app.ts"]), /two changed/);
    assert.equal((await Git(repoRoot, ["diff", "--", "projects/demo/app.ts"])).trim(), "");

    socket.send(JSON.stringify({ type: "command", id: "undo-stage", action: "undo" }));
    const undoStage = await WaitForFrame(socket, "command_result");
    assert.equal(undoStage.result.ok, true);
    assert.equal((await Git(repoRoot, ["diff", "--cached", "--", "projects/demo/app.ts"])).trim(), "");
    assert.match(await Git(repoRoot, ["diff", "--", "projects/demo/app.ts"]), /two changed/);

    const stateAfterUndo = undoStage.state;
    const revertHunk = stateAfterUndo.currentHunk;
    socket.send(JSON.stringify({
      type: "command",
      id: "revert-1",
      action: "revert",
      hunkId: revertHunk.hunkId,
      patchHash: revertHunk.patchHash,
    }));
    const revert = await WaitForFrame(socket, "command_result");
    assert.equal(revert.result.ok, true);
    assert.equal(revert.result.reviewFacts.revertedHunk.file, "projects/demo/app.ts");
    assert.equal(await readFile(filePath, "utf8"), "one\ntwo\nthree\n");

    socket.send(JSON.stringify({ type: "command", id: "undo-revert", action: "undo" }));
    const undoRevert = await WaitForFrame(socket, "command_result");
    assert.equal(undoRevert.result.ok, true);
    assert.equal(
      undoRevert.result.reviewFacts.restoredRevertedHunk.file,
      "projects/demo/app.ts",
    );
    assert.equal(await readFile(filePath, "utf8"), "one\ntwo changed\nthree\n");

    await new Promise<void>((resolve) =>
    {
      socket.once("close", () => resolve());
      socket.close();
    });
  });
});
