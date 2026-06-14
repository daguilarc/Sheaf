import assert from "node:assert/strict";
import test from "node:test";

import { BuildChatWebSocketUrl } from "../../../src/server/websockets.js";

test("BuildChatWebSocketUrl builds required query parameters", () =>
{
  assert.equal(
    BuildChatWebSocketUrl({
      repoId: "repo_123456789012",
      workspaceId: "workspace_123456",
      chatId: "chat_123456789012",
    }),
    "/ws/chat?repo=repo_123456789012&workspace=workspace_123456&chat=chat_123456789012",
  );
});

test("BuildChatWebSocketUrl includes optional client and after parameters", () =>
{
  assert.equal(
    BuildChatWebSocketUrl({
      repoId: "repo_123456789012",
      workspaceId: "workspace_123456",
      chatId: "chat_123456789012",
      clientId: "browser-1",
      after: 42,
    }),
    "/ws/chat?repo=repo_123456789012&workspace=workspace_123456&chat=chat_123456789012&client=browser-1&after=42",
  );
});
