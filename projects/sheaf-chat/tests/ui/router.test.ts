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
  parseRoute: () => { screen: string; pile?: string; sessionId?: string };
  buildWebSocketUrl: (pile: string, sessionId: string, after?: number) => string;
  createEnvelope: (
    kind: string,
    pile: string,
    sessionId: string,
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

test("router parses piles, sessions, and chat routes", () =>
{
  const { api, location } = LoadSheafChatApp();

  location.hash = "#/";
  assert.equal(api.parseRoute().screen, "piles");

  location.hash = "#/piles/demo";
  const sessionsRoute = api.parseRoute();
  assert.equal(sessionsRoute.screen, "sessions");
  assert.equal(sessionsRoute.pile, "demo");

  location.hash = "#/piles/demo/sessions/sess-1";
  const chatRoute = api.parseRoute();
  assert.equal(chatRoute.screen, "chat");
  assert.equal(chatRoute.pile, "demo");
  assert.equal(chatRoute.sessionId, "sess-1");
});

test("buildWebSocketUrl includes reconnect after sequence", () =>
{
  const { api } = LoadSheafChatApp();
  const url = api.buildWebSocketUrl("default", "sess-1", 42);
  assert.match(url, /^ws:\/\/127\.0\.0\.1:9004\/ws\/chat\?/);
  assert.match(url, /p=default/);
  assert.match(url, /session=sess-1/);
  assert.match(url, /after=42/);
  assert.match(url, /client=/);
});

test("createEnvelope builds protocol frames", () =>
{
  const { api } = LoadSheafChatApp();
  const envelope = api.createEnvelope("client.user_message", "default", "sess-1", {
    text: "hello",
  });
  assert.equal(envelope.v, 1);
  assert.equal(envelope.kind, "client.user_message");
  assert.equal(envelope.pile, "default");
  assert.equal(envelope.sessionId, "sess-1");
  assert.deepEqual(envelope.payload, { text: "hello" });
});
