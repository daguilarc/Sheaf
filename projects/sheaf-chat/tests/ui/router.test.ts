import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const x_packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sheafChatJsPath = path.join(x_packageRoot, "src", "ui", "sheaf-chat.js");

interface SheafChatTestApi
{
  parseRoute: () => {
    screen: string;
    repoId?: string;
    workspaceId?: string;
    chatId?: string;
  };
  buildWebSocketUrl: (
    repoId: string,
    workspaceId: string,
    chatId: string,
    after?: number,
  ) => string;
  createEnvelope: (
    kind: string,
    repoId: string,
    workspaceId: string,
    chatId: string,
    payload: unknown,
  ) => Record<string, unknown>;
}

function LoadSheafChatApp(): { api: SheafChatTestApi; location: { hash: string } }
{
  const source = fs.readFileSync(sheafChatJsPath, "utf8");
  const location = {
    hash: "#/",
    protocol: "http:",
    host: "127.0.0.1:9004",
  };
  const context: Record<string, unknown> = {
    console,
    setTimeout,
    clearTimeout,
    URLSearchParams,
    addEventListener: () => undefined,
    localStorage: {
      getItem: () => null,
      setItem: () => undefined,
    },
    crypto: {
      randomUUID: () => "test-uuid",
    },
    document: {
      readyState: "complete",
      addEventListener: () => undefined,
      getElementById: () => null,
    },
    location,
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  const app = context.SheafChatApp as { _test: SheafChatTestApi };
  return { api: app._test, location };
}

test("router parses repository, workspace, and chat routes", () =>
{
  const { api, location } = LoadSheafChatApp();

  location.hash = "#/";
  assert.equal(api.parseRoute().screen, "repositories");

  location.hash = "#/repositories/repo-1";
  const workspacesRoute = api.parseRoute();
  assert.equal(workspacesRoute.screen, "workspaces");
  assert.equal(workspacesRoute.repoId, "repo-1");

  location.hash = "#/repositories/repo-1/workspaces/workspace-1";
  const workspaceRoute = api.parseRoute();
  assert.equal(workspaceRoute.screen, "workspace");
  assert.equal(workspaceRoute.repoId, "repo-1");
  assert.equal(workspaceRoute.workspaceId, "workspace-1");

  location.hash = "#/repositories/repo-1/workspaces/workspace-1/chats/chat-1";
  const chatRoute = api.parseRoute();
  assert.equal(chatRoute.screen, "chat");
  assert.equal(chatRoute.repoId, "repo-1");
  assert.equal(chatRoute.workspaceId, "workspace-1");
  assert.equal(chatRoute.chatId, "chat-1");
});

test("buildWebSocketUrl includes reconnect after sequence", () =>
{
  const { api } = LoadSheafChatApp();
  const url = api.buildWebSocketUrl("repo-1", "workspace-1", "chat-1", 42);
  assert.match(url, /^ws:\/\/127\.0\.0\.1:9004\/ws\/chat\?/);
  assert.match(url, /repo=repo-1/);
  assert.match(url, /workspace=workspace-1/);
  assert.match(url, /chat=chat-1/);
  assert.match(url, /after=42/);
  assert.match(url, /client=/);
});

test("createEnvelope builds protocol frames", () =>
{
  const { api } = LoadSheafChatApp();
  const envelope = api.createEnvelope(
    "client.user_message",
    "repo-1",
    "workspace-1",
    "chat-1",
    { text: "hello" },
  );
  assert.equal(envelope.v, 1);
  assert.equal(envelope.kind, "client.user_message");
  assert.equal(envelope.repoId, "repo-1");
  assert.equal(envelope.workspaceId, "workspace-1");
  assert.equal(envelope.chatId, "chat-1");
  assert.deepEqual(envelope.payload, { text: "hello" });
});
