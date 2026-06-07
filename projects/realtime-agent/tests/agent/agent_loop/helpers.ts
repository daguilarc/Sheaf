import type { AgentStartConfig, AgentSessionDeps } from "../../../src/agent/src/index.js";

import { CreatePersistenceTestContext, type PersistenceTestContext } from "../persistence/helpers.js";
import { CreateFakeWebSocketFactory, FakeWebSocket } from "../realtime/helpers.js";

export interface AgentLoopTestContext extends PersistenceTestContext
{
  sockets: FakeWebSocket[];
  deps: AgentSessionDeps;
}

export function CreateAgentLoopTestContext(): AgentLoopTestContext
{
  const persistence = CreatePersistenceTestContext();
  const sockets: FakeWebSocket[] = [];

  return {
    ...persistence,
    sockets,
    deps: {
      apiKey: "test-key",
      database: persistence.database,
      webSocketFactory: CreateFakeWebSocketFactory(sockets),
    },
  };
}

export function BuildTestAgentConfig(
  overrides: Partial<AgentStartConfig> = {},
): AgentStartConfig
{
  return {
    systemPrompt: "You are a helpful assistant.",
    initialContext: "Initial operator context.",
    toolCallSet: {
      name: "test_tools",
      tools: [
        {
          name: "echo",
          inputSchema: { type: "object" },
          callback: (args) => args,
        },
      ],
    },
    ...overrides,
  };
}

export function ParseSentEvents(socket: FakeWebSocket): Array<{ type: string; [key: string]: unknown }>
{
  return socket.sentMessages.map((message) => JSON.parse(message) as { type: string; [key: string]: unknown });
}

export async function OpenConnectedSocket(sockets: FakeWebSocket[]): Promise<FakeWebSocket>
{
  const socket = sockets[0];
  if (socket === undefined)
  {
    throw new Error("Expected fake socket to be created");
  }

  socket.open();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return socket;
}

export function SimulateResponseCreatedAndDone(
  socket: FakeWebSocket,
  responseId = "resp_test_fixture",
): void
{
  socket.receiveMessage(
    JSON.stringify({
      type: "response.created",
      response: { id: responseId },
    }),
  );
  socket.receiveMessage(
    JSON.stringify({
      type: "response.done",
      response: { id: responseId },
    }),
  );
}
