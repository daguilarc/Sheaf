import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRealtimeConnectionHeaders,
  buildRealtimeConnectionUrl,
  DEFAULT_REALTIME_BASE_URL,
  RealtimeClient,
  RealtimeTransportError,
  type RealtimeEvent,
} from "../../src/index.js";

import { CreateFakeWebSocketFactory, FakeWebSocket } from "./helpers.js";

test("buildRealtimeConnectionUrl includes encoded model query parameter", () =>
{
  assert.equal(
    buildRealtimeConnectionUrl("gpt-realtime-2"),
    `${DEFAULT_REALTIME_BASE_URL}?model=gpt-realtime-2`,
  );
  assert.equal(
    buildRealtimeConnectionUrl("model/with space", "wss://example.test/realtime?foo=bar"),
    "wss://example.test/realtime?foo=bar&model=model%2Fwith%20space",
  );
});

test("buildRealtimeConnectionHeaders includes bearer auth and optional safety identifier", () =>
{
  assert.deepEqual(buildRealtimeConnectionHeaders("test-key"), {
    Authorization: "Bearer test-key",
  });

  assert.deepEqual(buildRealtimeConnectionHeaders("test-key", "user-123"), {
    Authorization: "Bearer test-key",
    "OpenAI-Safety-Identifier": "user-123",
  });
});

test("RealtimeClient connect uses expected URL and headers", async () =>
{
  const sockets: FakeWebSocket[] = [];
  const client = new RealtimeClient({
    apiKey: "secret",
    model: "gpt-realtime-2",
    safetyIdentifier: "operator-1",
    webSocketFactory: CreateFakeWebSocketFactory(sockets),
  });

  const connectPromise = client.connect();
  assert.equal(sockets.length, 1);

  const socket = sockets[0];
  assert.ok(socket !== undefined);
  assert.equal(socket.connectRecord.url, `${DEFAULT_REALTIME_BASE_URL}?model=gpt-realtime-2`);
  assert.deepEqual(socket.connectRecord.headers, {
    Authorization: "Bearer secret",
    "OpenAI-Safety-Identifier": "operator-1",
  });

  socket.open();
  await connectPromise;
});

test("RealtimeClient send serializes structured events on an open socket", async () =>
{
  const sockets: FakeWebSocket[] = [];
  const client = new RealtimeClient({
    apiKey: "secret",
    model: "gpt-realtime-2",
    webSocketFactory: CreateFakeWebSocketFactory(sockets),
  });

  const connectPromise = client.connect();
  const socket = sockets[0];
  assert.ok(socket !== undefined);
  socket.open();
  await connectPromise;

  const outgoing: RealtimeEvent = {
    type: "response.create",
    response: {
      modalities: ["text"],
    },
  };

  client.send(outgoing);
  assert.equal(socket.sentMessages.length, 1);
  assert.deepEqual(JSON.parse(socket.sentMessages[0] ?? "{}"), outgoing);
});

test("RealtimeClient parses incoming JSON and emits events", async () =>
{
  const sockets: FakeWebSocket[] = [];
  const client = new RealtimeClient({
    apiKey: "secret",
    model: "gpt-realtime-2",
    webSocketFactory: CreateFakeWebSocketFactory(sockets),
  });

  const connectPromise = client.connect();
  const socket = sockets[0];
  assert.ok(socket !== undefined);
  socket.open();
  await connectPromise;

  const received: RealtimeEvent[] = [];
  client.onEvent((event) =>
  {
    received.push(event);
  });

  socket.receiveMessage(
    JSON.stringify({
      type: "session.created",
      session: { id: "sess_123" },
    }),
  );

  assert.equal(received.length, 1);
  assert.equal(received[0]?.type, "session.created");
});

test("RealtimeClient reports invalid incoming JSON as a transport error", async () =>
{
  const sockets: FakeWebSocket[] = [];
  const client = new RealtimeClient({
    apiKey: "secret",
    model: "gpt-realtime-2",
    webSocketFactory: CreateFakeWebSocketFactory(sockets),
  });

  const connectPromise = client.connect();
  const socket = sockets[0];
  assert.ok(socket !== undefined);
  socket.open();
  await connectPromise;

  const errors: Error[] = [];
  client.onError((error) =>
  {
    errors.push(error);
  });

  socket.receiveMessage("not-json");
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof RealtimeTransportError);
});

test("RealtimeClient close shuts down the socket", async () =>
{
  const sockets: FakeWebSocket[] = [];
  const client = new RealtimeClient({
    apiKey: "secret",
    model: "gpt-realtime-2",
    webSocketFactory: CreateFakeWebSocketFactory(sockets),
  });

  const connectPromise = client.connect();
  const socket = sockets[0];
  assert.ok(socket !== undefined);
  socket.open();
  await connectPromise;

  let closed = false;
  client.onClose(() =>
  {
    closed = true;
  });

  client.close();
  assert.equal(closed, true);
  assert.equal(socket.readyState, 3);
});
