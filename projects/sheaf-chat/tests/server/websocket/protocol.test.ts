import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import WebSocket from "ws";

import type { ChatEnvelope } from "../../../src/shared/envelope.js";
import { mapUserMessageToAgui } from "../../../src/agui/mapper.js";
import { AgentLifecycleState } from "../../../src/shared/types.js";
import { AppendEnvelope, CollectSessionLogEntries } from "../../../src/storage/sessionLog.js";
import { CreateStoragePaths } from "../../../src/storage/paths.js";
import {
  AssertFileChangedPayload,
  BuildWsUrl,
  ConnectWebSocket,
  CreateBlankSessionViaApi,
  CreateSessionWithRoot,
  DrainConnection,
  CreateClientEnvelope,
  CreateFakeTimers,
  ResolveOpenAiTestModel,
  RunSessionEdit,
  SendClientFrame,
  WaitForCondition,
  WaitForEnvelope,
  WaitForOpenOrReject,
  WithWebSocket,
  WithWebSocketTestServer,
  WriteSessionFile,
} from "./helpers.js";

function CaptureConsoleError(): { lines: string[]; restore: () => void }
{
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) =>
  {
    lines.push(args.map((arg) => String(arg)).join(" "));
  };
  return {
    lines,
    restore: () =>
    {
      console.error = original;
    },
  };
}

function ParseServerLog(line: string): Record<string, unknown>
{
  return JSON.parse(line) as Record<string, unknown>;
}

test("WebSocket connection sends server.hello then server.caught_up", async () =>
{
  await WithWebSocketTestServer(async (handle) =>
  {
    const session = await CreateBlankSessionViaApi(handle);
    const url = BuildWsUrl(handle, session.repoId, session.workspaceId, session.chatId, { clientId: "browser-1" });

    await WithWebSocket(url, async (_socket, bootstrap) =>
    {
      assert.equal(bootstrap[0]?.kind, "server.hello");

      const hello = bootstrap.find((entry) => entry.kind === "server.hello");

      assert.ok(hello);
      assert.equal(hello?.repoId, session.repoId);
      assert.equal(hello?.chatId, session.chatId);
      assert.equal(hello?.clientId, "browser-1");

      const payload = hello?.payload as {
        connectionId: string;
        manifest: unknown;
        provisionalChat: { rootDirectory: string; model: { provider: string; id: string } };
        latestSequence: number;
        historyWindow: { oldestSequence: number | null; newestSequence: number | null };
        models: unknown[];
        activeModel: { provider: string; id: string };
      };

      assert.match(payload.connectionId, /^[0-9a-f-]{36}$/);
      assert.equal(payload.manifest, null);
      assert.ok(payload.provisionalChat);
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

test("WebSocket rejects invalid repo, workspace, and chat query parameters", async () =>
{
  await WithWebSocketTestServer(async (handle) =>
  {
    const invalidRepo = await WaitForOpenOrReject(
      `${handle.wsBaseUrl}/ws/chat?repo=../evil&workspace=workspace_123456&chat=chat_123456789012`,
    );
    assert.equal(invalidRepo.ok, false);
    if (!invalidRepo.ok)
    {
      assert.equal(invalidRepo.status, 400);
    }

    const missingChat = await WaitForOpenOrReject(
      `${handle.wsBaseUrl}/ws/chat?repo=repo_123456789012&workspace=workspace_123456`,
    );
    assert.equal(missingChat.ok, false);

    const missingChatFile = await WaitForOpenOrReject(
      `${handle.wsBaseUrl}/ws/chat?repo=repo_123456789012&workspace=workspace_123456&chat=chat_123456789012`,
    );
    assert.equal(missingChatFile.ok, false);
    if (!missingChatFile.ok)
    {
      assert.equal(missingChatFile.status, 404);
    }
  });
});

test("chat WebSocket handled frame errors are logged with request correlation", async () =>
{
  await WithWebSocketTestServer(async (handle) =>
  {
    const session = await CreateBlankSessionViaApi(handle);
    const url = BuildWsUrl(handle, session.repoId, session.workspaceId, session.chatId, { clientId: "test-client" });
    const connected = await ConnectWebSocket(url);
    const socket = connected.socket;
    const captured = CaptureConsoleError();

    try
    {
      await DrainConnection(socket);
      SendClientFrame(
        socket,
        CreateClientEnvelope(
          "client.ping",
          session.repoId,
          session.workspaceId,
          "different-chat",
          {},
          "wrong-chat-frame",
        ),
      );

      const error = await WaitForEnvelope(
        socket,
        (envelope) =>
          envelope.kind === "server.error" &&
          (envelope.payload as { requestId?: string }).requestId === "wrong-chat-frame",
      );
      assert.equal((error.payload as { code: string }).code, "invalid_frame");
      assert.equal(captured.lines.length, 1);
      const log = ParseServerLog(captured.lines[0]!);
      assert.equal(log.service, "sheaf-chat");
      assert.equal(log.event, "sheaf_chat.handled_error");
      assert.equal(log.feature, "chat-websocket");
      assert.equal(log.code, "invalid_frame");
      assert.equal(log.requestId, "wrong-chat-frame");
      assert.equal(log.repoId, session.repoId);
      assert.equal(log.workspaceId, session.workspaceId);
      assert.equal(log.chatId, session.chatId);
      assert.equal(log.clientId, "test-client");
      assert.equal(JSON.stringify(log).includes("different-chat"), false);
    }
    finally
    {
      captured.restore();
      socket.close();
    }
  });
});

test("new session first user message is broadcast with AGUI events", async () =>
{
  await WithWebSocketTestServer(async (handle) =>
  {
    const session = await CreateBlankSessionViaApi(handle);
    const url = BuildWsUrl(handle, session.repoId, session.workspaceId, session.chatId);

    await WithWebSocket(url, async (socket) =>
    {
      SendClientFrame(
        socket,
        CreateClientEnvelope(
          "client.user_message",
          session.repoId,
          session.workspaceId,
          session.chatId,
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

test("user message uses one stable id across echo and agui events and is delivered exactly once", async () =>
{
  await WithWebSocketTestServer(async (handle) =>
  {
    const session = await CreateBlankSessionViaApi(handle);
    const url = BuildWsUrl(handle, session.repoId, session.workspaceId, session.chatId);
    const connected = await ConnectWebSocket(url);
    const socket = connected.socket;

    const collected: ChatEnvelope[] = [];
    const collector = (data: WebSocket.RawData) =>
    {
      collected.push(JSON.parse(data.toString()) as ChatEnvelope);
    };
    socket.on("message", collector);

    try
    {
      await DrainConnection(socket);
      SendClientFrame(
        socket,
        CreateClientEnvelope(
          "client.user_message",
          session.repoId,
          session.workspaceId,
          session.chatId,
          { messageId: "stable-user-1", text: "Hello", attachments: [], steer: true },
          "frame-stable-1",
        ),
      );

      await WaitForCondition(() => collected.some((e) => e.kind === "chat.user_message"));
      await DrainConnection(socket);

      // The connection that submitted the message receives the echo exactly once
      // (the replay/live dedupe must not double-deliver it).
      const echoes = collected.filter((e) => e.kind === "chat.user_message");
      assert.equal(echoes.length, 1);
      assert.equal((echoes[0].payload as { messageId: string }).messageId, "stable-user-1");

      // Its agui text-message representation carries the same client id, so the
      // browser's optimistic echo, the live echo, and any replay reconcile to one.
      const userStarts = collected.filter(
        (e) =>
          e.kind === "agui.event" &&
          (e.payload as { type?: string }).type === "TEXT_MESSAGE_START" &&
          (e.payload as { role?: string }).role === "user",
      );
      assert.ok(userStarts.length >= 1);
      for (const event of userStarts)
      {
        assert.equal((event.payload as { messageId: string }).messageId, "stable-user-1");
      }
    }
    finally
    {
      socket.off("message", collector);
      socket.close();
    }
  });
});

test("two clients on the same session receive identical broadcasts", async () =>
{
  await WithWebSocketTestServer(async (handle) =>
  {
    const session = await CreateBlankSessionViaApi(handle);
    const urlA = BuildWsUrl(handle, session.repoId, session.workspaceId, session.chatId, { clientId: "client-a" });
    const urlB = BuildWsUrl(handle, session.repoId, session.workspaceId, session.chatId, { clientId: "client-b" });

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
          session.repoId,
          session.workspaceId,
          session.chatId,
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

test("sequential broadcasters do not duplicate persisted agent events", async () =>
{
  await WithWebSocketTestServer(async (handle) =>
  {
    const session = await CreateBlankSessionViaApi(handle);
    const key = { repoId: session.repoId, workspaceId: session.workspaceId, chatId: session.chatId };
    const urlA = BuildWsUrl(handle, session.repoId, session.workspaceId, session.chatId, { clientId: "client-a" });
    const connectedA = await ConnectWebSocket(urlA);

    connectedA.socket.close();
    await WaitForCondition(() => handle.broadcasterRegistry.Get(key) === undefined);

    const urlB = BuildWsUrl(handle, session.repoId, session.workspaceId, session.chatId, { clientId: "client-b" });
    const connectedB = await ConnectWebSocket(urlB);
    const socketB = connectedB.socket;
    const collectedB: ChatEnvelope[] = [];
    const collectorB = (data: Buffer) =>
    {
      collectedB.push(JSON.parse(data.toString()) as ChatEnvelope);
    };

    try
    {
      socketB.on("message", collectorB);

      const fake = [...handle.fakeSessions.values()][0];
      assert.ok(fake);
      const message = {
        role: "assistant",
        content: [],
        timestamp: 12345,
      } as unknown as AgentSession["messages"][number];
      fake.Emit({ type: "message_start", message });
      fake.Emit({
        type: "message_update",
        message,
        assistantMessageEvent: { type: "text_start", contentIndex: 0, partial: message } as never,
      });
      fake.Emit({
        type: "message_update",
        message,
        assistantMessageEvent: {
          type: "text_delta",
          contentIndex: 0,
          delta: "dedupe from pi",
          partial: message,
        } as never,
      });

      await WaitForCondition(() =>
        collectedB.some((envelope) =>
          envelope.kind === "agui.event" &&
          (envelope.payload as { type?: string; delta?: string }).type === "TEXT_MESSAGE_CONTENT" &&
          (envelope.payload as { type?: string; delta?: string }).delta === "dedupe from pi",
        ),
      );

      const storagePaths = CreateStoragePaths(handle.config.repoRoot);
      const entries = await CollectSessionLogEntries(storagePaths, session.repoId, session.workspaceId, session.chatId);
      const persistedTextEvents = entries.filter((entry) =>
        entry.envelope.kind === "agui.event" &&
        (entry.envelope.payload as { type?: string; delta?: string }).type === "TEXT_MESSAGE_CONTENT" &&
        (entry.envelope.payload as { type?: string; delta?: string }).delta === "dedupe from pi",
      );
      assert.equal(persistedTextEvents.length, 1);

      const liveTextEvents = collectedB.filter((envelope) =>
        envelope.kind === "agui.event" &&
        (envelope.payload as { type?: string; delta?: string }).type === "TEXT_MESSAGE_CONTENT" &&
        (envelope.payload as { type?: string; delta?: string }).delta === "dedupe from pi",
      );
      assert.equal(liveTextEvents.length, 1);
    }
    finally
    {
      socketB.off("message", collectorB);
      socketB.close();
    }
  });
});

test("duplicate client.user_message by messageId does not create duplicate broadcasts", async () =>
{
  await WithWebSocketTestServer(async (handle) =>
  {
    const session = await CreateBlankSessionViaApi(handle);
    const url = BuildWsUrl(handle, session.repoId, session.workspaceId, session.chatId);

    await WithWebSocket(url, async (socket) =>
    {
      const frame = CreateClientEnvelope(
        "client.user_message",
        session.repoId,
        session.workspaceId,
          session.chatId,
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

    await AppendEnvelope(storagePaths, session.repoId, session.workspaceId, session.chatId, {
      kind: "chat.user_message",
      repoId: session.repoId,
      workspaceId: session.workspaceId,
          chatId: session.chatId,
      payload: {
        messageId: "stored-1",
        text: "stored message",
      },
    });

    await AppendEnvelope(storagePaths, session.repoId, session.workspaceId, session.chatId, {
      kind: "agui.event",
      repoId: session.repoId,
      workspaceId: session.workspaceId,
          chatId: session.chatId,
      payload: {
        type: "TEXT_MESSAGE_START",
        messageId: "stored-1",
        role: "user",
      },
    });

    const url = BuildWsUrl(handle, session.repoId, session.workspaceId, session.chatId, { after: 1 });

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

test("client.history_request sent immediately after server.hello is handled", async () =>
{
  await WithWebSocketTestServer(async (handle) =>
  {
    const session = await CreateBlankSessionViaApi(handle);
    const storagePaths = CreateStoragePaths(handle.config.repoRoot);

    await AppendEnvelope(storagePaths, session.repoId, session.workspaceId, session.chatId, {
      kind: "agui.event",
      repoId: session.repoId,
      workspaceId: session.workspaceId,
          chatId: session.chatId,
      payload: {
        type: "TEXT_MESSAGE_START",
        messageId: "stored-1",
        role: "user",
      },
    });
    await AppendEnvelope(storagePaths, session.repoId, session.workspaceId, session.chatId, {
      kind: "agui.event",
      repoId: session.repoId,
      workspaceId: session.workspaceId,
          chatId: session.chatId,
      payload: {
        type: "TEXT_MESSAGE_CONTENT",
        messageId: "stored-1",
        delta: "stored message",
      },
    });
    await AppendEnvelope(storagePaths, session.repoId, session.workspaceId, session.chatId, {
      kind: "agui.event",
      repoId: session.repoId,
      workspaceId: session.workspaceId,
          chatId: session.chatId,
      payload: {
        type: "TEXT_MESSAGE_END",
        messageId: "stored-1",
      },
    });

    const url = BuildWsUrl(handle, session.repoId, session.workspaceId, session.chatId);
    const socket = new WebSocket(url);

    try
    {
      const page = await new Promise<ChatEnvelope>((resolve, reject) =>
      {
        const timeout = setTimeout(() =>
        {
          cleanup();
          reject(new Error("timed out waiting for early history page"));
        }, 3000);

        const cleanup = () =>
        {
          clearTimeout(timeout);
          socket.off("message", onMessage);
          socket.off("error", onError);
        };
        const onError = (error: Error) =>
        {
          cleanup();
          reject(error);
        };
        const onMessage = (data: WebSocket.RawData) =>
        {
          const envelope = JSON.parse(data.toString()) as ChatEnvelope;

          if (envelope.kind === "server.hello")
          {
            SendClientFrame(
              socket,
              CreateClientEnvelope(
                "client.history_request",
                session.repoId,
                session.workspaceId,
          session.chatId,
                {
                  limit: 80,
                  prefer: "snapshots",
                },
                "early-history",
              ),
            );
          }

          if (
            envelope.kind === "history.page" &&
            (envelope.payload as { requestId?: string }).requestId === "early-history"
          )
          {
            cleanup();
            resolve(envelope);
          }
        };

        socket.on("message", onMessage);
        socket.on("error", onError);
      });

      const payload = page.payload as { messages: unknown[] };
      assert.ok(payload.messages.length >= 1);
    }
    finally
    {
      socket.close();
    }
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
      await AppendEnvelope(storagePaths, session.repoId, session.workspaceId, session.chatId, {
        kind: "chat.user_message",
        repoId: session.repoId,
        workspaceId: session.workspaceId,
          chatId: session.chatId,
        payload: {
          messageId: `msg-${index}`,
          text: `message ${index}`,
        },
      });
    }

    const url = BuildWsUrl(handle, session.repoId, session.workspaceId, session.chatId);

    await WithWebSocket(url, async (socket) =>
    {
      SendClientFrame(
        socket,
        CreateClientEnvelope(
          "client.history_request",
          session.repoId,
          session.workspaceId,
          session.chatId,
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
          session.repoId,
          session.workspaceId,
          session.chatId,
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

    await AppendEnvelope(storagePaths, session.repoId, session.workspaceId, session.chatId, {
      kind: "chat.user_message",
      repoId: session.repoId,
      workspaceId: session.workspaceId,
          chatId: session.chatId,
      payload: {
        messageId,
        text: "stored user text",
      },
    });

    for (const event of mapUserMessageToAgui({ messageId, text: "stored user text" }))
    {
      await AppendEnvelope(storagePaths, session.repoId, session.workspaceId, session.chatId, {
        kind: "agui.event",
        repoId: session.repoId,
        workspaceId: session.workspaceId,
          chatId: session.chatId,
        payload: event,
      });
    }

    const url = BuildWsUrl(handle, session.repoId, session.workspaceId, session.chatId);

    await WithWebSocket(url, async (socket) =>
    {
      SendClientFrame(
        socket,
        CreateClientEnvelope(
          "client.history_request",
          session.repoId,
          session.workspaceId,
          session.chatId,
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
      await AppendEnvelope(storagePaths, session.repoId, session.workspaceId, session.chatId, {
        kind: "chat.user_message",
        repoId: session.repoId,
        workspaceId: session.workspaceId,
          chatId: session.chatId,
        payload: {
          messageId: `bulk-${index}`,
          text: `bulk ${index}`,
        },
      });
    }

    const url = BuildWsUrl(handle, session.repoId, session.workspaceId, session.chatId);
    const connected = await ConnectWebSocket(url);
    const socket = connected.socket;

    try
    {
      await DrainConnection(socket);

      SendClientFrame(
        socket,
        CreateClientEnvelope(
          "client.history_request",
          session.repoId,
          session.workspaceId,
          session.chatId,
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
          session.repoId,
          session.workspaceId,
          session.chatId,
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
    const url = BuildWsUrl(handle, session.repoId, session.workspaceId, session.chatId);
    const model = ResolveOpenAiTestModel(handle.agentManager);

    await WithWebSocket(url, async (socket) =>
    {
      SendClientFrame(
        socket,
        CreateClientEnvelope(
          "client.model_select",
          session.repoId,
          session.workspaceId,
          session.chatId,
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
    const url = BuildWsUrl(handle, session.repoId, session.workspaceId, session.chatId);

    await WithWebSocket(url, async (socket) =>
    {
      const fake = [...handle.fakeSessions.values()][0];
      assert.ok(fake);
      fake.setStreaming(true);

      SendClientFrame(
        socket,
        CreateClientEnvelope("client.cancel", session.repoId, session.workspaceId, session.chatId),
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
    const url = BuildWsUrl(handle, session.repoId, session.workspaceId, session.chatId);

    await WithWebSocket(url, async (socket) =>
    {
      SendClientFrame(
        socket,
        CreateClientEnvelope("client.ping", session.repoId, session.workspaceId, session.chatId, undefined, "ping-1"),
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
    const url = BuildWsUrl(handle, session.repoId, session.workspaceId, session.chatId);

    await WithWebSocket(url, async (socket) =>
    {
      SendClientFrame(
        socket,
        CreateClientEnvelope(
          "client.user_message",
          session.repoId,
          session.workspaceId,
          session.chatId,
          { messageId: "concurrent-a", text: "A" },
        ),
      );
      SendClientFrame(
        socket,
        CreateClientEnvelope(
          "client.user_message",
          session.repoId,
          session.workspaceId,
          session.chatId,
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
    const key = { repoId: session.repoId, workspaceId: session.workspaceId, chatId: session.chatId };
    const url = BuildWsUrl(handle, session.repoId, session.workspaceId, session.chatId);
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

test("file.changed broadcasts to all open sessions with the same root", async () =>
{
  await WithWebSocketTestServer(async (handle) =>
  {
    const rootDirectory = path.join(handle.config.repoRoot, "projects", "demo");
    const sessionA = await CreateSessionWithRoot(handle, rootDirectory);
    const sessionB = await CreateSessionWithRoot(handle, rootDirectory);
    const wsA = await ConnectWebSocket(
      BuildWsUrl(handle, sessionA.repoId, sessionA.workspaceId, sessionA.chatId, { clientId: "client-a" }),
    );
    const wsB = await ConnectWebSocket(
      BuildWsUrl(handle, sessionB.repoId, sessionB.workspaceId, sessionB.chatId, { clientId: "client-b" }),
    );

    try
    {
      await WriteSessionFile(rootDirectory, "docs/readme.md", "# Title\n");

      const envelopePromiseA = WaitForEnvelope(
        wsA.socket,
        (envelope) => envelope.kind === "file.changed",
      );
      const envelopePromiseB = WaitForEnvelope(
        wsB.socket,
        (envelope) => envelope.kind === "file.changed",
      );

      await RunSessionEdit(handle, sessionA, {
        path: "docs/readme.md",
        edits: [{ oldText: "# Title", newText: "# Updated" }],
      });

      const [envelopeA, envelopeB] = await Promise.all([envelopePromiseA, envelopePromiseB]);
      AssertFileChangedPayload(envelopeA, "docs/readme.md", handle.config.repoRoot);
      AssertFileChangedPayload(envelopeB, "docs/readme.md", handle.config.repoRoot);

      const updated = await readFile(path.join(rootDirectory, "docs/readme.md"), "utf-8");
      assert.equal(updated, "# Updated\n");
    }
    finally
    {
      wsA.socket.close();
      wsB.socket.close();
    }
  });
});

test("file.changed uses receiver-relative paths for parent and child roots", async () =>
{
  await WithWebSocketTestServer(async (handle) =>
  {
    const parentRoot = path.join(handle.config.repoRoot, "projects");
    const childRoot = path.join(handle.config.repoRoot, "projects", "demo");
    const parentSession = await CreateSessionWithRoot(handle, parentRoot);
    const childSession = await CreateSessionWithRoot(handle, childRoot);
    const parentWs = await ConnectWebSocket(
      BuildWsUrl(handle, parentSession.repoId, parentSession.workspaceId, parentSession.chatId, { clientId: "parent" }),
    );
    const childWs = await ConnectWebSocket(
      BuildWsUrl(handle, childSession.repoId, childSession.workspaceId, childSession.chatId, { clientId: "child" }),
    );

    try
    {
      await WriteSessionFile(childRoot, "docs/readme.md", "# Child\n");
      await WriteSessionFile(parentRoot, "other/sibling.md", "# Sibling\n");

      const childEnvelopePromise = WaitForEnvelope(
        childWs.socket,
        (envelope) => envelope.kind === "file.changed",
      );
      const parentEnvelopePromise = WaitForEnvelope(
        parentWs.socket,
        (envelope) => envelope.kind === "file.changed",
      );

      await RunSessionEdit(handle, childSession, {
        path: "docs/readme.md",
        edits: [{ oldText: "# Child", newText: "# Child Updated" }],
      });

      const [childEnvelope, parentEnvelope] = await Promise.all([
        childEnvelopePromise,
        parentEnvelopePromise,
      ]);
      AssertFileChangedPayload(childEnvelope, "docs/readme.md", handle.config.repoRoot);
      AssertFileChangedPayload(parentEnvelope, "demo/docs/readme.md", handle.config.repoRoot);

      const childSiblingPromise = WaitForEnvelope(
        childWs.socket,
        (envelope) =>
          envelope.kind === "file.changed" &&
          (envelope.payload as { path?: string }).path === "other/sibling.md",
        500,
      ).catch(() => null);

      await RunSessionEdit(handle, parentSession, {
        path: "other/sibling.md",
        edits: [{ oldText: "# Sibling", newText: "# Sibling Updated" }],
      });

      const parentSiblingEnvelope = await WaitForEnvelope(
        parentWs.socket,
        (envelope) =>
          envelope.kind === "file.changed" &&
          (envelope.payload as { path?: string }).path === "other/sibling.md",
      );
      AssertFileChangedPayload(parentSiblingEnvelope, "other/sibling.md", handle.config.repoRoot);
      assert.equal(await childSiblingPromise, null);
    }
    finally
    {
      parentWs.socket.close();
      childWs.socket.close();
    }
  });
});

test("file.changed is not sent to sessions with unrelated roots", async () =>
{
  await WithWebSocketTestServer(async (handle) =>
  {
    const demoRoot = path.join(handle.config.repoRoot, "projects", "demo");
    const otherRoot = path.join(handle.config.repoRoot, "projects", "other");
    await mkdir(otherRoot, { recursive: true });
    const demoSession = await CreateSessionWithRoot(handle, demoRoot);
    const otherSession = await CreateSessionWithRoot(handle, otherRoot);
    const demoWs = await ConnectWebSocket(
      BuildWsUrl(handle, demoSession.repoId, demoSession.workspaceId, demoSession.chatId, { clientId: "demo" }),
    );
    const otherWs = await ConnectWebSocket(
      BuildWsUrl(handle, otherSession.repoId, otherSession.workspaceId, otherSession.chatId, { clientId: "other" }),
    );

    try
    {
      await WriteSessionFile(demoRoot, "docs/readme.md", "# Demo\n");

      const demoEnvelopePromise = WaitForEnvelope(
        demoWs.socket,
        (envelope) => envelope.kind === "file.changed",
      );
      const otherEnvelopePromise = WaitForEnvelope(
        otherWs.socket,
        (envelope) => envelope.kind === "file.changed",
        500,
      ).catch(() => null);

      await RunSessionEdit(handle, demoSession, {
        path: "docs/readme.md",
        edits: [{ oldText: "# Demo", newText: "# Demo Updated" }],
      });

      const demoEnvelope = await demoEnvelopePromise;
      AssertFileChangedPayload(demoEnvelope, "docs/readme.md", handle.config.repoRoot);
      assert.equal(await otherEnvelopePromise, null);
    }
    finally
    {
      demoWs.socket.close();
      otherWs.socket.close();
    }
  });
});
