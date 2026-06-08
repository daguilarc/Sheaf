import assert from "node:assert/strict";
import test from "node:test";

import type { ChatEnvelope } from "../../../src/shared/envelope.js";
import { mapUserMessageToAgui } from "../../../src/agui/mapper.js";
import { AgentLifecycleState } from "../../../src/shared/types.js";
import { AppendEnvelope } from "../../../src/storage/sessionLog.js";
import { CreateStoragePaths } from "../../../src/storage/paths.js";
import {
  BuildWsUrl,
  ConnectWebSocket,
  CreateBlankSessionViaApi,
  DrainConnection,
  CreateClientEnvelope,
  CreateFakeTimers,
  ResolveOpenAiTestModel,
  SendClientFrame,
  WaitForCondition,
  WaitForEnvelope,
  WaitForOpenOrReject,
  WithWebSocket,
  WithWebSocketTestServer,
} from "./helpers.js";

test("WebSocket connection sends server.hello then server.caught_up", async () =>
{
  await WithWebSocketTestServer(async (handle) =>
  {
    const session = await CreateBlankSessionViaApi(handle);
    const url = BuildWsUrl(handle, session.pile, session.sessionId, { clientId: "browser-1" });

    await WithWebSocket(url, async (_socket, bootstrap) =>
    {
      assert.equal(bootstrap[0]?.kind, "server.hello");

      const hello = bootstrap.find((entry) => entry.kind === "server.hello");

      assert.ok(hello);
      assert.equal(hello?.pile, session.pile);
      assert.equal(hello?.sessionId, session.sessionId);
      assert.equal(hello?.clientId, "browser-1");

      const payload = hello?.payload as {
        connectionId: string;
        manifest: unknown;
        provisionalSession: { rootDirectory: string; model: { provider: string; id: string } };
        latestSequence: number;
        historyWindow: { oldestSequence: number | null; newestSequence: number | null };
        models: unknown[];
        activeModel: { provider: string; id: string };
      };

      assert.match(payload.connectionId, /^[0-9a-f-]{36}$/);
      assert.equal(payload.manifest, null);
      assert.ok(payload.provisionalSession);
      assert.ok(Array.isArray(payload.models));
      assert.ok(payload.activeModel.provider.length > 0);
      assert.equal(bootstrap[bootstrap.length - 1]?.kind, "server.caught_up");
      assert.equal(
        bootstrap.some((entry) => entry.kind === "agent.status" || entry.kind === "agui.event"),
        false,
      );
    });
  });
});

test("WebSocket rejects invalid pile and session query parameters", async () =>
{
  await WithWebSocketTestServer(async (handle) =>
  {
    const invalidPile = await WaitForOpenOrReject(
      `${handle.wsBaseUrl}/ws/chat?p=../evil&session=abc123`,
    );
    assert.equal(invalidPile.ok, false);
    if (!invalidPile.ok)
    {
      assert.equal(invalidPile.status, 400);
    }

    const missingSession = await WaitForOpenOrReject(
      `${handle.wsBaseUrl}/ws/chat?p=default`,
    );
    assert.equal(missingSession.ok, false);

    const missingSessionFile = await WaitForOpenOrReject(
      `${handle.wsBaseUrl}/ws/chat?p=default&session=notasession`,
    );
    assert.equal(missingSessionFile.ok, false);
    if (!missingSessionFile.ok)
    {
      assert.equal(missingSessionFile.status, 404);
    }
  });
});

test("new session first user message is broadcast with AGUI events", async () =>
{
  await WithWebSocketTestServer(async (handle) =>
  {
    const session = await CreateBlankSessionViaApi(handle);
    const url = BuildWsUrl(handle, session.pile, session.sessionId);

    await WithWebSocket(url, async (socket) =>
    {
      SendClientFrame(
        socket,
        CreateClientEnvelope(
          "client.user_message",
          session.pile,
          session.sessionId,
          {
            messageId: "user-msg-1",
            text: "Hello agent",
            attachments: [],
            steer: true,
          },
          "frame-user-1",
        ),
      );

      const userBroadcast = await WaitForEnvelope(
        socket,
        (envelope) => envelope.kind === "chat.user_message",
      );
      const aguiStart = await WaitForEnvelope(
        socket,
        (envelope) =>
          envelope.kind === "agui.event" &&
          (envelope.payload as { type?: string }).type === "TEXT_MESSAGE_START",
      );

      assert.ok(userBroadcast.sequence !== undefined);
      assert.equal((userBroadcast.payload as { messageId: string }).messageId, "user-msg-1");
      assert.equal((userBroadcast.payload as { text: string }).text, "Hello agent");
      assert.ok(aguiStart.sequence !== undefined);
      assert.ok(aguiStart.sequence! > userBroadcast.sequence!);

      const fake = [...handle.fakeSessions.values()][0];
      assert.ok(fake);
      await WaitForCondition(() => fake.promptCalls.length === 1);
      assert.equal(fake.promptCalls[0]?.text, "Hello agent");
    });
  });
});

test("two clients on the same session receive identical broadcasts", async () =>
{
  await WithWebSocketTestServer(async (handle) =>
  {
    const session = await CreateBlankSessionViaApi(handle);
    const urlA = BuildWsUrl(handle, session.pile, session.sessionId, { clientId: "client-a" });
    const urlB = BuildWsUrl(handle, session.pile, session.sessionId, { clientId: "client-b" });

    const connectedA = await ConnectWebSocket(urlA);
    const connectedB = await ConnectWebSocket(urlB);
    const socketA = connectedA.socket;
    const socketB = connectedB.socket;

    try
    {
      await DrainConnection(socketA);
      await DrainConnection(socketB);

      const collectedA: ChatEnvelope[] = [];
      const collectedB: ChatEnvelope[] = [];
      const collectorA = (data: Buffer) =>
      {
        collectedA.push(JSON.parse(data.toString()) as ChatEnvelope);
      };
      const collectorB = (data: Buffer) =>
      {
        collectedB.push(JSON.parse(data.toString()) as ChatEnvelope);
      };
      socketA.on("message", collectorA);
      socketB.on("message", collectorB);

      SendClientFrame(
        socketA,
        CreateClientEnvelope(
          "client.user_message",
          session.pile,
          session.sessionId,
          {
            messageId: "shared-msg-1",
            text: "visible to both",
          },
        ),
      );

      await WaitForCondition(
        () =>
          collectedA.some((envelope) => envelope.kind === "chat.user_message") &&
          collectedB.some((envelope) => envelope.kind === "chat.user_message"),
      );

      socketA.off("message", collectorA);
      socketB.off("message", collectorB);

      const broadcastA = collectedA.find((envelope) => envelope.kind === "chat.user_message");
      const broadcastB = collectedB.find((envelope) => envelope.kind === "chat.user_message");

      assert.ok(broadcastA);
      assert.ok(broadcastB);
      assert.equal(broadcastA.sequence, broadcastB.sequence);
      assert.deepEqual(broadcastA.payload, broadcastB.payload);
    }
    finally
    {
      socketA.close();
      socketB.close();
    }
  });
});

test("duplicate client.user_message by messageId does not create duplicate broadcasts", async () =>
{
  await WithWebSocketTestServer(async (handle) =>
  {
    const session = await CreateBlankSessionViaApi(handle);
    const url = BuildWsUrl(handle, session.pile, session.sessionId);

    await WithWebSocket(url, async (socket) =>
    {
      const frame = CreateClientEnvelope(
        "client.user_message",
        session.pile,
        session.sessionId,
        {
          messageId: "retry-msg",
          text: "only once",
        },
      );

      SendClientFrame(socket, frame);
      await WaitForEnvelope(socket, (envelope) => envelope.kind === "chat.user_message");
      SendClientFrame(socket, frame);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const received: ChatEnvelope[] = [];
      const listener = (data: Buffer) =>
      {
        received.push(JSON.parse(data.toString()) as ChatEnvelope);
      };
      socket.on("message", listener);
      await new Promise((resolve) => setTimeout(resolve, 50));
      socket.off("message", listener);

      const userMessages = received.filter((entry) => entry.kind === "chat.user_message");
      assert.equal(userMessages.length, 0);

      const fake = [...handle.fakeSessions.values()][0];
      assert.equal(fake?.promptCalls.length, 1);
    });
  });
});

test("reconnect with after replays missed envelopes before server.caught_up", async () =>
{
  await WithWebSocketTestServer(async (handle) =>
  {
    const session = await CreateBlankSessionViaApi(handle);
    const storagePaths = CreateStoragePaths(handle.config.repoRoot);

    await AppendEnvelope(storagePaths, session.pile, session.sessionId, {
      kind: "chat.user_message",
      pile: session.pile,
      sessionId: session.sessionId,
      payload: {
        messageId: "stored-1",
        text: "stored message",
      },
    });

    await AppendEnvelope(storagePaths, session.pile, session.sessionId, {
      kind: "agui.event",
      pile: session.pile,
      sessionId: session.sessionId,
      payload: {
        type: "TEXT_MESSAGE_START",
        messageId: "stored-1",
        role: "user",
      },
    });

    const url = BuildWsUrl(handle, session.pile, session.sessionId, { after: 1 });

    await WithWebSocket(url, async (_socket, bootstrap) =>
    {
      const replayed = bootstrap.filter(
        (entry) => entry.kind === "agui.event" || entry.kind === "chat.user_message",
      );

      assert.equal(replayed.length, 1);
      assert.equal(replayed[0]?.sequence, 2);
      assert.equal(replayed[0]?.kind, "agui.event");
    });
  });
});

test("client.history_request returns history.page for before and after cursors", async () =>
{
  await WithWebSocketTestServer(async (handle) =>
  {
    const session = await CreateBlankSessionViaApi(handle);
    const storagePaths = CreateStoragePaths(handle.config.repoRoot);

    for (let index = 1; index <= 3; index += 1)
    {
      await AppendEnvelope(storagePaths, session.pile, session.sessionId, {
        kind: "chat.user_message",
        pile: session.pile,
        sessionId: session.sessionId,
        payload: {
          messageId: `msg-${index}`,
          text: `message ${index}`,
        },
      });
    }

    const url = BuildWsUrl(handle, session.pile, session.sessionId);

    await WithWebSocket(url, async (socket) =>
    {
      SendClientFrame(
        socket,
        CreateClientEnvelope(
          "client.history_request",
          session.pile,
          session.sessionId,
          {
            before: 3,
            limit: 10,
            prefer: "snapshots",
          },
          "history-before",
        ),
      );

      const beforePage = await WaitForEnvelope(
        socket,
        (envelope) => envelope.kind === "history.page",
      );
      const beforePayload = beforePage.payload as {
        requestId: string;
        direction: string;
        messages: unknown[];
        hasMoreBefore: boolean;
      };

      assert.equal(beforePayload.requestId, "history-before");
      assert.equal(beforePayload.direction, "before");
      assert.ok(beforePayload.messages.length >= 1);

      SendClientFrame(
        socket,
        CreateClientEnvelope(
          "client.history_request",
          session.pile,
          session.sessionId,
          {
            after: 1,
            limit: 10,
            prefer: "events",
          },
          "history-after",
        ),
      );

      const afterPage = await WaitForEnvelope(
        socket,
        (envelope) =>
          envelope.kind === "history.page" &&
          (envelope.payload as { requestId?: string }).requestId === "history-after",
      );
      const afterPayload = afterPage.payload as {
        direction: string;
        events: unknown[];
        hasMoreAfter: boolean;
      };

      assert.equal(afterPayload.direction, "after");
      assert.ok(afterPayload.events.length >= 1);
    });
  });
});

test("client.history_request events mode does not duplicate stored user AGUI events", async () =>
{
  await WithWebSocketTestServer(async (handle) =>
  {
    const session = await CreateBlankSessionViaApi(handle);
    const storagePaths = CreateStoragePaths(handle.config.repoRoot);
    const messageId = "stored-user-with-agui";

    await AppendEnvelope(storagePaths, session.pile, session.sessionId, {
      kind: "chat.user_message",
      pile: session.pile,
      sessionId: session.sessionId,
      payload: {
        messageId,
        text: "stored user text",
      },
    });

    for (const event of mapUserMessageToAgui({ messageId, text: "stored user text" }))
    {
      await AppendEnvelope(storagePaths, session.pile, session.sessionId, {
        kind: "agui.event",
        pile: session.pile,
        sessionId: session.sessionId,
        payload: event,
      });
    }

    const url = BuildWsUrl(handle, session.pile, session.sessionId);

    await WithWebSocket(url, async (socket) =>
    {
      SendClientFrame(
        socket,
        CreateClientEnvelope(
          "client.history_request",
          session.pile,
          session.sessionId,
          {
            after: 0,
            limit: 10,
            prefer: "events",
          },
          "history-events-no-duplicates",
        ),
      );

      const page = await WaitForEnvelope(
        socket,
        (envelope) =>
          envelope.kind === "history.page" &&
          (envelope.payload as { requestId?: string }).requestId === "history-events-no-duplicates",
      );
      const payload = page.payload as { events: Array<{ type?: string; messageId?: string }> };
      const userTextEvents = payload.events.filter((event) => event.messageId === messageId);

      assert.deepEqual(
        userTextEvents.map((event) => event.type),
        ["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END"],
      );
    });
  });
});

test("live broadcasts continue while history request is served", async () =>
{
  await WithWebSocketTestServer(async (handle) =>
  {
    const session = await CreateBlankSessionViaApi(handle);
    const storagePaths = CreateStoragePaths(handle.config.repoRoot);

    for (let index = 1; index <= 5; index += 1)
    {
      await AppendEnvelope(storagePaths, session.pile, session.sessionId, {
        kind: "chat.user_message",
        pile: session.pile,
        sessionId: session.sessionId,
        payload: {
          messageId: `bulk-${index}`,
          text: `bulk ${index}`,
        },
      });
    }

    const url = BuildWsUrl(handle, session.pile, session.sessionId);
    const connected = await ConnectWebSocket(url);
    const socket = connected.socket;

    try
    {
      await DrainConnection(socket);

      SendClientFrame(
        socket,
        CreateClientEnvelope(
          "client.history_request",
          session.pile,
          session.sessionId,
          {
            before: 5,
            limit: 50,
            prefer: "events",
          },
        ),
      );

      SendClientFrame(
        socket,
        CreateClientEnvelope(
          "client.user_message",
          session.pile,
          session.sessionId,
          {
            messageId: "live-during-history",
            text: "live while paging",
          },
        ),
      );

      const fake = [...handle.fakeSessions.values()][0];
      assert.ok(fake);

      const collected: ChatEnvelope[] = [];
      const collector = (data: Buffer) =>
      {
        collected.push(JSON.parse(data.toString()) as ChatEnvelope);
      };
      socket.on("message", collector);

      await WaitForCondition(
        () =>
          collected.some((envelope) => envelope.kind === "history.page") &&
          fake.promptCalls.some((call) => call.text === "live while paging"),
      );

      socket.off("message", collector);

      const historyPage = collected.find((envelope) => envelope.kind === "history.page");
      const liveBroadcast = collected.find(
        (envelope) =>
          envelope.kind === "chat.user_message" &&
          (envelope.payload as { messageId?: string }).messageId === "live-during-history",
      );

      assert.ok(historyPage);
      assert.ok(liveBroadcast);
      assert.ok(liveBroadcast.sequence !== undefined);
      assert.ok(historyPage.sequence === undefined);
      assert.equal((liveBroadcast.payload as { text: string }).text, "live while paging");
    }
    finally
    {
      socket.close();
    }
  });
});

test("client.model_select updates active model and broadcasts model.changed", async () =>
{
  await WithWebSocketTestServer(async (handle) =>
  {
    const session = await CreateBlankSessionViaApi(handle);
    const url = BuildWsUrl(handle, session.pile, session.sessionId);
    const model = ResolveOpenAiTestModel(handle.agentManager);

    await WithWebSocket(url, async (socket) =>
    {
      SendClientFrame(
        socket,
        CreateClientEnvelope(
          "client.model_select",
          session.pile,
          session.sessionId,
          {
            provider: model.provider,
            id: model.id,
            applyTo: "next_turn",
          },
        ),
      );

      const modelChanged = await WaitForEnvelope(
        socket,
        (envelope) => envelope.kind === "model.changed",
      );

      assert.deepEqual(
        (modelChanged.payload as { model: { provider: string; id: string } }).model,
        model,
      );

      const fake = [...handle.fakeSessions.values()][0];
      assert.deepEqual(fake?.model, model);
    });
  });
});

test("client.cancel aborts the active turn", async () =>
{
  await WithWebSocketTestServer(async (handle) =>
  {
    const session = await CreateBlankSessionViaApi(handle);
    const url = BuildWsUrl(handle, session.pile, session.sessionId);

    await WithWebSocket(url, async (socket) =>
    {
      const fake = [...handle.fakeSessions.values()][0];
      assert.ok(fake);
      fake.setStreaming(true);

      SendClientFrame(
        socket,
        CreateClientEnvelope("client.cancel", session.pile, session.sessionId),
      );

      await WaitForCondition(() => fake.abortCalls === 1);
    });
  });
});

test("client.ping receives server.pong", async () =>
{
  await WithWebSocketTestServer(async (handle) =>
  {
    const session = await CreateBlankSessionViaApi(handle);
    const url = BuildWsUrl(handle, session.pile, session.sessionId);

    await WithWebSocket(url, async (socket) =>
    {
      SendClientFrame(
        socket,
        CreateClientEnvelope("client.ping", session.pile, session.sessionId, undefined, "ping-1"),
      );

      const pong = await WaitForEnvelope(socket, (envelope) => envelope.kind === "server.pong");
      assert.equal((pong.payload as { requestId: string }).requestId, "ping-1");
    });
  });
});

test("concurrent user messages are sequenced monotonically", async () =>
{
  await WithWebSocketTestServer(async (handle) =>
  {
    const session = await CreateBlankSessionViaApi(handle);
    const url = BuildWsUrl(handle, session.pile, session.sessionId);

    await WithWebSocket(url, async (socket) =>
    {
      SendClientFrame(
        socket,
        CreateClientEnvelope(
          "client.user_message",
          session.pile,
          session.sessionId,
          { messageId: "concurrent-a", text: "A" },
        ),
      );
      SendClientFrame(
        socket,
        CreateClientEnvelope(
          "client.user_message",
          session.pile,
          session.sessionId,
          { messageId: "concurrent-b", text: "B" },
        ),
      );

      const first = await WaitForEnvelope(
        socket,
        (envelope) =>
          envelope.kind === "chat.user_message" &&
          (envelope.payload as { messageId?: string }).messageId === "concurrent-a",
      );
      const second = await WaitForEnvelope(
        socket,
        (envelope) =>
          envelope.kind === "chat.user_message" &&
          (envelope.payload as { messageId?: string }).messageId === "concurrent-b",
      );

      assert.ok(first.sequence !== undefined);
      assert.ok(second.sequence !== undefined);
      assert.ok(second.sequence! > first.sequence!);
    });
  });
});

test("socket liveness uses connection id and disconnect releases idle broadcaster", async () =>
{
  const timers = CreateFakeTimers();

  await WithWebSocketTestServer(async (handle) =>
  {
    const session = await CreateBlankSessionViaApi(handle);
    const key = { pile: session.pile, sessionId: session.sessionId };
    const url = BuildWsUrl(handle, session.pile, session.sessionId);
    const connected = await ConnectWebSocket(url);

    const statusOpen = handle.agentManager.getStatus(key);
    assert.equal(statusOpen?.connectedClientCount, 1);
    assert.ok(handle.broadcasterRegistry.Get(key));

    timers.Advance(1500);

    const fake = [...handle.fakeSessions.values()][0];
    assert.equal(handle.agentManager.getStatus(key)?.state, AgentLifecycleState.Active);
    assert.equal(fake?.disposed, false);

    connected.socket.close();

    await WaitForCondition(() => handle.broadcasterRegistry.Get(key) === undefined);

    const statusBefore = handle.agentManager.getStatus(key);
    assert.ok(statusBefore);
    assert.equal(statusBefore?.connectedClientCount, 0);

    timers.Advance(1500);

    await new Promise((resolve) => setTimeout(resolve, 20));

    const statusAfter = handle.agentManager.getStatus(key);

    assert.equal(statusAfter?.state, AgentLifecycleState.Cold);
    assert.equal(fake?.disposed, true);
  }, { idleOffloadSeconds: 1, timers });
});
