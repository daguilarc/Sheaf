import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { WebSocket } from "ws";

import {
  CreateWorkspaceChatViaApi,
  RequestJson,
  type TestServerHandle,
  WithTestServer,
} from "./helpers.js";

const ExecFile = promisify(execFile);

function WsUrl(baseUrl: string, repoId: string, workspaceId: string): string
{
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws/agent-review";
  url.search = "";
  url.searchParams.set("repo", repoId);
  url.searchParams.set("workspace", workspaceId);
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
  handle: TestServerHandle,
): Promise<{
  repoId: string;
  workspaceId: string;
  chatId: string;
  repoRoot: string;
  filePath: string;
}>
{
  const repoRoot = handle.agentManager.storagePaths.repoRoot;
  const demoRoot = path.join(repoRoot, "projects/demo");
  const created = await CreateWorkspaceChatViaApi(handle, demoRoot);
  const filePath = path.join(demoRoot, "app.ts");

  await mkdir(demoRoot, { recursive: true });
  await Git(repoRoot, ["init"]);
  await Git(repoRoot, ["config", "user.email", "test@example.com"]);
  await Git(repoRoot, ["config", "user.name", "Test User"]);
  await writeFile(filePath, "one\ntwo\nthree\n", "utf8");
  await Git(repoRoot, ["add", "projects/demo/app.ts"]);
  await Git(repoRoot, ["commit", "-m", "initial"]);
  await writeFile(filePath, "one\ntwo changed\nthree\n", "utf8");

  return { ...created, repoRoot, filePath };
}

test("Agent Review availability reports Git hunks under the workspace root", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const { repoId, workspaceId } = await CreateGitReviewSession(handle);
    const response = await RequestJson(
      handle.baseUrl,
      "GET",
      `/api/repositories/${encodeURIComponent(repoId)}/workspaces/${encodeURIComponent(workspaceId)}/agent-review`,
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
  await WithTestServer(async (handle) =>
  {
    const { repoId, workspaceId, repoRoot, filePath } =
      await CreateGitReviewSession(handle);
    const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));

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

async function CreateMultiHunkReviewSession(
  handle: TestServerHandle,
): Promise<{ repoId: string; workspaceId: string }>
{
  const repoRoot = handle.agentManager.storagePaths.repoRoot;
  const demoRoot = path.join(repoRoot, "projects/demo");
  const created = await CreateWorkspaceChatViaApi(handle, demoRoot);

  await mkdir(demoRoot, { recursive: true });
  await Git(repoRoot, ["init"]);
  await Git(repoRoot, ["config", "user.email", "test@example.com"]);
  await Git(repoRoot, ["config", "user.name", "Test User"]);

  const base = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`);
  const alphaPath = path.join(demoRoot, "alpha.ts");
  const betaPath = path.join(demoRoot, "beta.ts");
  await writeFile(alphaPath, `${base.join("\n")}\n`, "utf8");
  await writeFile(betaPath, `${base.join("\n")}\n`, "utf8");
  await Git(repoRoot, ["add", "."]);
  await Git(repoRoot, ["commit", "-m", "initial"]);

  // alpha.ts: two changes far apart -> two separate hunks. beta.ts: one hunk.
  const alpha = base.slice();
  alpha[1] = "line 2 changed";
  alpha[26] = "line 27 changed";
  await writeFile(alphaPath, `${alpha.join("\n")}\n`, "utf8");
  const beta = base.slice();
  beta[14] = "line 15 changed";
  await writeFile(betaPath, `${beta.join("\n")}\n`, "utf8");

  return { repoId: created.repoId, workspaceId: created.workspaceId };
}

test("Agent Review WebSocket navigates between hunks and files", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const { repoId, workspaceId } = await CreateMultiHunkReviewSession(handle);
    const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));

    await new Promise<void>((resolve, reject) =>
    {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });

    const bootstrap = await WaitForFrame(socket, "bootstrap");
    const first = bootstrap.state.currentHunk;
    // Three hunks across two files: alpha.ts (x2), beta.ts (x1).
    assert.equal(first.file, "projects/demo/alpha.ts");
    assert.equal(first.hunkIndex, 0);
    assert.equal(first.hunkCount, 3);
    assert.equal(first.fileCount, 2);

    // Next hunk: advance to the second hunk in the same file.
    socket.send(JSON.stringify({ type: "command", id: "next-1", action: "nextHunk" }));
    const afterNextHunk = await WaitForFrame(socket, "command_result");
    assert.equal(afterNextHunk.result.ok, true);
    assert.equal(afterNextHunk.state.currentHunk.file, "projects/demo/alpha.ts");
    assert.equal(afterNextHunk.state.currentHunk.hunkIndex, 1);
    assert.notEqual(afterNextHunk.state.currentHunk.hunkId, first.hunkId);

    // Next file: advance to the first hunk of the next file.
    socket.send(JSON.stringify({ type: "command", id: "nextfile-1", action: "nextFile" }));
    const afterNextFile = await WaitForFrame(socket, "command_result");
    assert.equal(afterNextFile.result.ok, true);
    assert.equal(afterNextFile.state.currentHunk.file, "projects/demo/beta.ts");

    // Previous file: move back into the first file.
    socket.send(JSON.stringify({ type: "command", id: "prevfile-1", action: "previousFile" }));
    const afterPrevFile = await WaitForFrame(socket, "command_result");
    assert.equal(afterPrevFile.result.ok, true);
    assert.equal(afterPrevFile.state.currentHunk.file, "projects/demo/alpha.ts");

    await new Promise<void>((resolve) =>
    {
      socket.once("close", () => resolve());
      socket.close();
    });
  });
});
