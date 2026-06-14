import assert from "node:assert/strict";
import test from "node:test";

import {
  CreateChatEnvelope,
  x_chatEnvelopeVersion,
} from "../src/shared/envelope.js";

test("CreateChatEnvelope builds spec-compliant frames", () =>
{
  const envelope = CreateChatEnvelope({
    kind: "client.user_message",
    repoId: "repo_123456789012",
    workspaceId: "workspace_123456",
    chatId: "chat_123456789012",
    clientId: "browser-1",
    payload: {
      messageId: "msg-1",
      text: "hello",
    },
    id: "frame-1",
    timestamp: "2026-06-08T00:00:00.000Z",
  });

  assert.equal(envelope.v, x_chatEnvelopeVersion);
  assert.equal(envelope.kind, "client.user_message");
  assert.equal(envelope.id, "frame-1");
  assert.equal(envelope.repoId, "repo_123456789012");
  assert.equal(envelope.workspaceId, "workspace_123456");
  assert.equal(envelope.chatId, "chat_123456789012");
  assert.equal("pile" in envelope, false);
  assert.equal("sessionId" in envelope, false);
  assert.equal(envelope.clientId, "browser-1");
  assert.equal(envelope.sequence, undefined);
  assert.equal(envelope.timestamp, "2026-06-08T00:00:00.000Z");
  assert.deepEqual(envelope.payload, {
    messageId: "msg-1",
    text: "hello",
  });
});

test("CreateChatEnvelope generates id and timestamp when omitted", () =>
{
  const envelope = CreateChatEnvelope({
    kind: "server.hello",
    repoId: "repo_123456789012",
    workspaceId: "workspace_123456",
    chatId: "chat_123456789012",
    sequence: 7,
  });

  assert.equal(envelope.v, 1);
  assert.match(envelope.id, /^[0-9a-f-]{36}$/);
  assert.match(envelope.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(envelope.sequence, 7);
});
