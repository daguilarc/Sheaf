import assert from "node:assert/strict";
import test from "node:test";

import { BuildChatWebSocketUrl } from "../../../src/server/websockets.js";

test("BuildChatWebSocketUrl builds required query parameters", () =>
{
  assert.equal(
    BuildChatWebSocketUrl({
      pile: "default",
      sessionId: "abc123",
    }),
    "/ws/chat?p=default&session=abc123",
  );
});

test("BuildChatWebSocketUrl includes optional client and after parameters", () =>
{
  assert.equal(
    BuildChatWebSocketUrl({
      pile: "work",
      sessionId: "sess1",
      clientId: "browser-1",
      after: 42,
    }),
    "/ws/chat?p=work&session=sess1&client=browser-1&after=42",
  );
});
