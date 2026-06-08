import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";

import type { PiSessionHandle } from "../../../src/agents/piAdapter.js";
import type { SheafModelRegistryBundle } from "../../../src/agents/models.js";
import type { SheafChatConfig } from "../../../src/server/config.js";
import { CreateStoragePaths } from "../../../src/storage/paths.js";
import type { ModelReference } from "../../../src/shared/types.js";
import {
  BuildTestConfig,
  CreateInMemoryAuthStorage,
  WithFakeRepoAsync,
} from "../modelRegistry/helpers.js";

export { BuildTestConfig, WithFakeRepoAsync };

export class FakePiSession extends EventEmitter implements PiSessionHandle
{
  readonly sessionId: string;
  readonly sessionFile: string | undefined;
  messages: AgentSession["messages"] = [];
  model: ModelReference | undefined;
  private m_isStreaming = false;
  private m_disposed = false;
  promptCalls: Array<{ text: string; options?: { streamingBehavior?: string } }> = [];
  steerCalls: string[] = [];
  followUpCalls: string[] = [];
  abortCalls = 0;

  constructor(sessionId: string, sessionFile?: string, model?: ModelReference)
  {
    super();
    this.sessionId = sessionId;
    this.sessionFile = sessionFile;
    this.model = model;
  }

  get isStreaming(): boolean
  {
    return this.m_isStreaming;
  }

  setStreaming(value: boolean): void
  {
    this.m_isStreaming = value;
  }

  async prompt(text: string, options?: { streamingBehavior?: string }): Promise<void>
  {
    this.promptCalls.push({ text, options });
  }

  async steer(text: string): Promise<void>
  {
    this.steerCalls.push(text);
  }

  async followUp(text: string): Promise<void>
  {
    this.followUpCalls.push(text);
  }

  async setModel(model: ModelReference): Promise<void>
  {
    this.model = model;
  }

  async abort(): Promise<void>
  {
    this.abortCalls += 1;
    this.m_isStreaming = false;
  }

  dispose(): void
  {
    this.m_disposed = true;
    this.removeAllListeners();
  }

  get disposed(): boolean
  {
    return this.m_disposed;
  }

  subscribe(listener: (event: AgentSessionEvent) => void): () => void
  {
    const handler = (event: AgentSessionEvent) => listener(event);
    this.on("event", handler);
    return () => this.off("event", handler);
  }

  Emit(event: AgentSessionEvent): void
  {
    this.emit("event", event);
  }

  async EmitAssistantTurn(text = "assistant reply"): Promise<void>
  {
    this.Emit({ type: "agent_start" });
    this.Emit({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text }],
      } as AgentSession["messages"][number],
    });
    this.Emit({
      type: "agent_end",
      messages: [],
      willRetry: false,
    });
  }
}

export function CreateTestModelBundle(
  authStorage: AuthStorage = CreateInMemoryAuthStorage(),
): SheafModelRegistryBundle
{
  authStorage.setRuntimeApiKey("openai", "test-key");
  const modelRegistry = ModelRegistry.create(authStorage);

  return {
    authStorage,
    modelRegistry,
    localProviderState: {
      models: [],
      fetchError: null,
      unavailableReason: "local inference not configured",
    },
  };
}

export function CreateTestConfigWithRoot(repoRoot: string): SheafChatConfig
{
  const config = BuildTestConfig(repoRoot, {
    openAiApiKey: "test-key",
    agentIdleOffloadSeconds: 2,
  });
  mkdirSync(path.join(repoRoot, "projects", "demo"), { recursive: true });
  return config;
}

export function CreateStorage(repoRoot: string)
{
  return CreateStoragePaths(repoRoot);
}

export interface FakeTimerController
{
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  RunDueTimers(): void;
}

export function WaitForManifestUpdated(
  manager: { lifecycle: { On: (event: "manifestUpdated", listener: () => void) => () => void } },
): Promise<void>
{
  return new Promise((resolve) =>
  {
    const unsubscribe = manager.lifecycle.On("manifestUpdated", () =>
    {
      unsubscribe();
      resolve();
    });
  });
}

export function CreateFakeTimers(): FakeTimerController & { Advance(ms: number): void }
{
  const pending = new Map<NodeJS.Timeout, { callback: () => void; dueAt: number }>();
  let now = 0;
  let nextId = 1;

  const setTimeoutFn = ((callback: () => void, delay?: number) =>
  {
    const id = nextId++ as unknown as NodeJS.Timeout;
    pending.set(id, {
      callback,
      dueAt: now + (delay ?? 0),
    });
    return id;
  }) as typeof setTimeout;

  const clearTimeoutFn = ((id: NodeJS.Timeout) =>
  {
    pending.delete(id);
  }) as typeof clearTimeout;

  const controller = {
    setTimeout: setTimeoutFn,
    clearTimeout: clearTimeoutFn,
    RunDueTimers()
    {
      const due = [...pending.entries()].filter(([, entry]) => entry.dueAt <= now);
      for (const [id, entry] of due)
      {
        pending.delete(id);
        entry.callback();
      }
    },
    Advance(ms: number)
    {
      now += ms;
      controller.RunDueTimers();
    },
  };

  return controller;
}

export function WriteColdResumeFixture(
  repoRoot: string,
  pile: string,
  sessionId: string,
  rootDirectory: string,
  model: ModelReference,
): { sessionFilePath: string; manifestPath: string }
{
  const storagePaths = CreateStoragePaths(repoRoot);
  const pileDir = path.join(storagePaths.pilesDir, pile);
  mkdirSync(pileDir, { recursive: true });

  const sessionFilePath = path.join(pileDir, `${sessionId}.jsonl`);
  const header = {
    type: "session",
    version: 3,
    id: sessionId,
    timestamp: "2026-06-08T00:00:00.000Z",
    cwd: rootDirectory,
  };
  const userEntry = {
    type: "message",
    id: "entry-user-1",
    parentId: null,
    timestamp: "2026-06-08T00:00:01.000Z",
    message: {
      role: "user",
      content: [{ type: "text", text: "prior user message" }],
    },
  };
  const assistantEntry = {
    type: "message",
    id: "entry-assistant-1",
    parentId: "entry-user-1",
    timestamp: "2026-06-08T00:00:02.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "prior assistant message" }],
    },
  };

  writeFileSync(
    sessionFilePath,
    `${JSON.stringify(header)}\n${JSON.stringify(userEntry)}\n${JSON.stringify(assistantEntry)}\n`,
    "utf8",
  );

  const manifest = {
    schemaVersion: 1,
    pile,
    sessionId,
    chatName: "Cold resume chat",
    description: "Existing session",
    rootDirectory,
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z",
    lastOpenedAt: "2026-06-08T00:00:00.000Z",
    model,
    pi: {
      sessionFile: `data/sheaf-chat/sessions/piles/${pile}/${sessionId}.jsonl`,
      extensionVersion: "0.1.0",
    },
    history: {
      messageCount: 2,
      lastSequence: 0,
    },
  };
  const manifestPath = path.join(pileDir, `${sessionId}.manifest.json`);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return { sessionFilePath, manifestPath };
}
