import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  AgentSessionDeps,
  AgentStartConfig,
  RealtimeAgentDb,
  RealtimeAgentSession,
  SessionRow,
} from "realtime-agent-lib";

import { ChatModel } from "../../src/vscode-extension/src/chat/chatModel.js";
import { SessionController } from "../../src/vscode-extension/src/sessionController.js";
import { BuildVscodeToolCallSet } from "../../src/vscode-extension/src/tools/callSetBuilder.js";
import { NoOpFreshnessHooks } from "../../src/vscode-extension/src/tools/types.js";
import { x_missingOpenAiApiKeyMessage } from "../../src/vscode-extension/src/configCore.js";
import type { LogSink } from "../../src/vscode-extension/src/log.js";
import type { SessionControllerHost, SessionPreferences, SessionSecrets, SessionUi } from "../../src/vscode-extension/src/sessionTypes.js";
import { MemoryEditorAccess } from "./helpers/memoryEditorAccess.js";

function CreateHarnessToolCallSet(workspaceRootAbs: string)
{
  return BuildVscodeToolCallSet({
    editorAccess: new MemoryEditorAccess(workspaceRootAbs),
    freshness: NoOpFreshnessHooks,
  });
}

function CreateTestLog(): LogSink
{
  return {
    Line: () => {},
    Error: () => {},
    LogEvent: () => {},
    LogEventError: () => {},
  };
}

function CreateTestUi(): SessionUi & { errors: string[]; statusMessages: string[] }
{
  const errors: string[] = [];
  const statusMessages: string[] = [];
  return {
    errors,
    statusMessages,
    showErrorMessage: (message) =>
    {
      errors.push(message);
    },
    setStatusBarMessage: (message) =>
    {
      statusMessages.push(message);
    },
  };
}

function CreateFakeSession(
  onStop: (reason: string) => void,
): RealtimeAgentSession
{
  return {
    sessionId: "test-session",
    sendAudioFrame: () => {},
    commitAudio: async () => ({ status: "sent" as const }),
    createResponse: async () => ({ status: "sent" as const }),
    commitAudioAndCreateResponse: async () => ({ status: "sent" as const }),
    sendTextMessage: async () => ({ status: "sent" as const }),
    sendStructuredContext: async () => ({ status: "sent" as const }),
    sendRealtimeEvent: async () => ({ status: "sent" as const }),
    clearAudioBuffer: async () => ({ status: "sent" as const }),
    stop: async (reason) =>
    {
      onStop(reason);
      return {} as SessionRow;
    },
  };
}

function CreateFakeDatabase(): RealtimeAgentDb
{
  return {
    close: () => {},
  } as unknown as RealtimeAgentDb;
}

test("SessionController stores session database under global storage path", async () =>
{
  const globalStoragePath = mkdtempSync(join(tmpdir(), "sheaf-vsc-global-"));
  const repoRoot = mkdtempSync(join(tmpdir(), "sheaf-vsc-repo-"));
  let capturedDbPath: string | undefined;

  try
  {
    const startSession = async (): Promise<RealtimeAgentSession> => CreateFakeSession(() => {});

    const host: SessionControllerHost = { globalStoragePath };
    const secrets: SessionSecrets = { getOpenAiApiKey: async () => "sk-test-key" };
    const prefs: SessionPreferences = {
      getModel: () => "gpt-realtime-2",
      getSystemPrompt: () => "system",
      getInputDevice: () => undefined,
      getSafetyIdentifier: () => undefined,
    };
    const ui = CreateTestUi();

    const controller = new SessionController(host, CreateTestLog(), secrets, prefs, ui, {
      startSession,
      createDatabase: (databasePath: string) =>
      {
        capturedDbPath = databasePath;
        return CreateFakeDatabase();
      },
      createMicrophoneCapture: () => ({ start: () => {}, stop: () => {} }),
      buildVscodeToolCallSet: () => CreateHarnessToolCallSet(repoRoot),
    });

    await controller.ToggleSession();

    assert.equal(capturedDbPath, join(globalStoragePath, "realtime-agent.sqlite3"));
    await controller.ToggleSession();
  }
  finally
  {
    rmSync(globalStoragePath, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("SessionController commit uses commitAudioAndCreateResponse", async () =>
{
  const tmp = mkdtempSync(join(tmpdir(), "sheaf-vsc-test-"));
  let commitCalled = false;

  try
  {
    const fakeSession: RealtimeAgentSession = {
      ...CreateFakeSession(() => {}),
      commitAudioAndCreateResponse: async () =>
      {
        commitCalled = true;
        return { status: "sent" as const };
      },
    };

    const startSession = async (): Promise<RealtimeAgentSession> => fakeSession;
    const host: SessionControllerHost = { globalStoragePath: tmp };
    const secrets: SessionSecrets = { getOpenAiApiKey: async () => "sk" };
    const prefs: SessionPreferences = {
      getModel: () => "m",
      getSystemPrompt: () => "s",
      getInputDevice: () => undefined,
      getSafetyIdentifier: () => undefined,
    };
    const ui = CreateTestUi();

    const controller = new SessionController(host, CreateTestLog(), secrets, prefs, ui, {
      startSession,
      createDatabase: CreateFakeDatabase,
      createMicrophoneCapture: () => ({ start: () => {}, stop: () => {} }),
      buildVscodeToolCallSet: () => CreateHarnessToolCallSet(tmp),
    });

    await controller.ToggleSession();
    await controller.CommitAndRespond();
    assert.equal(commitCalled, true);
    await controller.ToggleSession();
  }
  finally
  {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("SessionController missing API key reports configured sources", async () =>
{
  const tmp = mkdtempSync(join(tmpdir(), "sheaf-vsc-test-"));
  const host: SessionControllerHost = { globalStoragePath: tmp };
  const secrets: SessionSecrets = { getOpenAiApiKey: async () => undefined };
  const prefs: SessionPreferences = {
    getModel: () => "m",
    getSystemPrompt: () => "s",
    getInputDevice: () => undefined,
    getSafetyIdentifier: () => undefined,
  };
  const ui = CreateTestUi();

  const controller = new SessionController(host, CreateTestLog(), secrets, prefs, ui, {});
  await controller.ToggleSession();

  assert.equal(controller.GetState(), "idle");
  assert.ok(ui.errors.includes(x_missingOpenAiApiKeyMessage));
});

test("SessionController start passes manual turnMode and navigation tools", async () =>
{
  const tmp = mkdtempSync(join(tmpdir(), "sheaf-vsc-test-"));
  mkdirSync(tmp, { recursive: true });

  try
  {
    let capturedConfig: AgentStartConfig | undefined;
    let capturedDeps: AgentSessionDeps | undefined;

    const order: string[] = [];
    const fakeSession = CreateFakeSession((reason) =>
    {
      order.push(`session-stop:${reason}`);
    });

    const startSession = async (
      config: AgentStartConfig,
      deps: AgentSessionDeps,
    ): Promise<RealtimeAgentSession> =>
    {
      capturedConfig = config;
      capturedDeps = deps;
      return fakeSession;
    };

    const createMicrophoneCapture = (): { start: () => void; stop: () => void } => ({
      start: () =>
      {
        order.push("mic-start");
      },
      stop: () =>
      {
        order.push("mic-stop");
      },
    });

    const host: SessionControllerHost = { globalStoragePath: tmp };
    const secrets: SessionSecrets = {
      getOpenAiApiKey: async () => "sk-test-key",
    };
    const prefs: SessionPreferences = {
      getModel: () => "gpt-realtime-2",
      getSystemPrompt: () => "system",
      getInputDevice: () => undefined,
      getSafetyIdentifier: () => undefined,
    };
    const ui = CreateTestUi();

    const controller = new SessionController(
      host,
      CreateTestLog(),
      secrets,
      prefs,
      ui,
      {
        startSession,
        createDatabase: CreateFakeDatabase,
        createMicrophoneCapture,
        buildVscodeToolCallSet: () => CreateHarnessToolCallSet(tmp),
      },
      () => {},
    );

    await controller.ToggleSession();

    assert.equal(controller.GetState(), "active");
    assert.ok(capturedConfig !== undefined);
    assert.equal(capturedConfig.turnMode?.type, "manual");
    assert.equal(capturedConfig.responseAfterToolOutput, true);
    assert.equal(capturedConfig.toolCallSet.name, "sheaf VS Code");
    assert.equal(capturedConfig.toolCallSet.tools.length, 7);
    assert.deepEqual(
      capturedConfig.toolCallSet.tools.map((t) => t.name),
      [
        "code_read",
        "list_files",
        "rgrep",
        "read_visible_range",
        "set_cursor_position",
        "move_visible_range",
        "modifyFile",
      ],
    );
    assert.equal(capturedConfig.initialContext, "");
    assert.ok(capturedDeps?.database !== undefined);
    assert.ok(order.includes("mic-start"));

    await controller.ToggleSession();
    assert.equal(controller.GetState(), "idle");
    const micStopIndex = order.indexOf("mic-stop");
    const sessionStopIndex = order.findIndex((entry) => entry.startsWith("session-stop:"));
    assert.ok(micStopIndex >= 0 && sessionStopIndex >= 0);
    assert.ok(micStopIndex < sessionStopIndex);
  }
  finally
  {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("SessionController maps start failure back to idle and records error", async () =>
{
  const tmp = mkdtempSync(join(tmpdir(), "sheaf-vsc-test-"));
  mkdirSync(tmp, { recursive: true });

  try
  {
    const startSession = async (
      _config: AgentStartConfig,
      _deps: AgentSessionDeps,
    ): Promise<RealtimeAgentSession> =>
    {
      throw new Error("ws failed");
    };

    const host: SessionControllerHost = { globalStoragePath: tmp };
    const secrets: SessionSecrets = {
      getOpenAiApiKey: async () => "sk-test",
    };
    const prefs: SessionPreferences = {
      getModel: () => "gpt-realtime-2",
      getSystemPrompt: () => "s",
      getInputDevice: () => undefined,
      getSafetyIdentifier: () => undefined,
    };
    const ui = CreateTestUi();

    const controller = new SessionController(host, CreateTestLog(), secrets, prefs, ui, {
      startSession,
      createDatabase: CreateFakeDatabase,
      createMicrophoneCapture: () => ({
        start: () => {},
        stop: () => {},
      }),
      buildVscodeToolCallSet: () => CreateHarnessToolCallSet(tmp),
    });

    await controller.ToggleSession();
    assert.equal(controller.GetState(), "idle");
    assert.ok(ui.errors.some((message) => message.includes("ws failed")));
  }
  finally
  {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("SessionController ignores duplicate toggle while starting", async () =>
{
  const tmp = mkdtempSync(join(tmpdir(), "sheaf-vsc-test-"));
  mkdirSync(tmp, { recursive: true });

  try
  {
    let resolveBlock: (() => void) | undefined;
    const block = new Promise<void>((resolve) =>
    {
      resolveBlock = resolve;
    });

    const startSession = async (
      _config: AgentStartConfig,
      _deps: AgentSessionDeps,
    ): Promise<RealtimeAgentSession> =>
    {
      await block;
      return CreateFakeSession(() => {});
    };

    const host: SessionControllerHost = { globalStoragePath: tmp };
    const secrets: SessionSecrets = { getOpenAiApiKey: async () => "sk" };
    const prefs: SessionPreferences = {
      getModel: () => "m",
      getSystemPrompt: () => "s",
      getInputDevice: () => undefined,
      getSafetyIdentifier: () => undefined,
    };
    const ui = CreateTestUi();

    const controller = new SessionController(host, CreateTestLog(), secrets, prefs, ui, {
      startSession,
      createDatabase: CreateFakeDatabase,
      createMicrophoneCapture: () => ({
        start: () => {},
        stop: () => {},
      }),
      buildVscodeToolCallSet: () => CreateHarnessToolCallSet(tmp),
    });

    const first = controller.ToggleSession();
    await new Promise((r) => setImmediate(r));
    assert.equal(controller.GetState(), "starting");
    await controller.ToggleSession();
    resolveBlock?.();
    await first;
    assert.equal(controller.GetState(), "active");
    await controller.ToggleSession();
    assert.equal(controller.GetState(), "idle");
  }
  finally
  {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("SessionController commit when idle surfaces status message only", async () =>
{
  const tmp = mkdtempSync(join(tmpdir(), "sheaf-vsc-test-"));
  const host: SessionControllerHost = { globalStoragePath: tmp };
  const secrets: SessionSecrets = { getOpenAiApiKey: async () => "sk" };
  const prefs: SessionPreferences = {
    getModel: () => "m",
    getSystemPrompt: () => "s",
    getInputDevice: () => undefined,
    getSafetyIdentifier: () => undefined,
  };
  const ui = CreateTestUi();

  const controller = new SessionController(host, CreateTestLog(), secrets, prefs, ui, {});
  await controller.CommitAndRespond();
  assert.ok(ui.statusMessages.length > 0);
});

test("SessionController start failure records error bubble in chat model", async () =>
{
  const tmp = mkdtempSync(join(tmpdir(), "sheaf-vsc-test-"));
  mkdirSync(tmp, { recursive: true });

  try
  {
    const startSession = async (): Promise<RealtimeAgentSession> =>
    {
      throw new Error("ws boom");
    };

    const host: SessionControllerHost = { globalStoragePath: tmp };
    const secrets: SessionSecrets = { getOpenAiApiKey: async () => "sk" };
    const prefs: SessionPreferences = {
      getModel: () => "m",
      getSystemPrompt: () => "s",
      getInputDevice: () => undefined,
      getSafetyIdentifier: () => undefined,
    };
    const ui = CreateTestUi();
    const chatModel = new ChatModel();

    const controller = new SessionController(host, CreateTestLog(), secrets, prefs, ui, {
      startSession,
      createDatabase: CreateFakeDatabase,
      createMicrophoneCapture: () => ({ start: () => {}, stop: () => {} }),
      buildVscodeToolCallSet: () => CreateHarnessToolCallSet(tmp),
      chatModel,
    });

    await controller.ToggleSession();

    const bubbles = chatModel.getSnapshot();
    const errorBubbles = bubbles.filter((b) => b.kind === "error");
    assert.equal(errorBubbles.length, 1);
    if (errorBubbles[0]?.kind === "error")
    {
      assert.ok(errorBubbles[0].message.includes("ws boom"));
    }
  }
  finally
  {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("SessionController commit failure records error bubble in chat model", async () =>
{
  const tmp = mkdtempSync(join(tmpdir(), "sheaf-vsc-test-"));
  mkdirSync(tmp, { recursive: true });

  try
  {
    const fakeSession: RealtimeAgentSession = {
      ...CreateFakeSession(() => {}),
      commitAudioAndCreateResponse: async () =>
      {
        throw new Error("commit boom");
      },
    };

    const startSession = async (): Promise<RealtimeAgentSession> => fakeSession;

    const host: SessionControllerHost = { globalStoragePath: tmp };
    const secrets: SessionSecrets = { getOpenAiApiKey: async () => "sk" };
    const prefs: SessionPreferences = {
      getModel: () => "m",
      getSystemPrompt: () => "s",
      getInputDevice: () => undefined,
      getSafetyIdentifier: () => undefined,
    };
    const ui = CreateTestUi();
    const chatModel = new ChatModel();

    const controller = new SessionController(host, CreateTestLog(), secrets, prefs, ui, {
      startSession,
      createDatabase: CreateFakeDatabase,
      createMicrophoneCapture: () => ({ start: () => {}, stop: () => {} }),
      buildVscodeToolCallSet: () => CreateHarnessToolCallSet(tmp),
      chatModel,
    });

    await controller.ToggleSession();
    assert.equal(controller.GetState(), "active");

    await controller.CommitAndRespond();

    const errorBubbles = chatModel.getSnapshot().filter((b) => b.kind === "error");
    assert.equal(errorBubbles.length, 1);
    if (errorBubbles[0]?.kind === "error")
    {
      assert.ok(errorBubbles[0].message.toLowerCase().includes("commit"));
      assert.ok(errorBubbles[0].message.includes("commit boom"));
    }
  }
  finally
  {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("SessionController microphone capture failure records error bubble in chat model", async () =>
{
  const tmp = mkdtempSync(join(tmpdir(), "sheaf-vsc-test-"));
  mkdirSync(tmp, { recursive: true });

  try
  {
    let capturedConfig: AgentStartConfig | undefined;

    const fakeSession: RealtimeAgentSession = {
      sessionId: "test-session",
      sendAudioFrame: () => {},
      commitAudio: async () => ({ status: "sent" as const }),
      createResponse: async () => ({ status: "sent" as const }),
      commitAudioAndCreateResponse: async () => ({ status: "sent" as const }),
      sendTextMessage: async () => ({ status: "sent" as const }),
      sendStructuredContext: async () => ({ status: "sent" as const }),
      sendRealtimeEvent: async () => ({ status: "sent" as const }),
      clearAudioBuffer: async () => ({ status: "sent" as const }),
      stop: async (reason) =>
      {
        capturedConfig?.onSessionEnded?.({
          sessionId: "test-session",
          reason,
          session: {} as SessionRow,
        });
        return {} as SessionRow;
      },
    };

    const startSession = async (config: AgentStartConfig): Promise<RealtimeAgentSession> =>
    {
      capturedConfig = config;
      return fakeSession;
    };

    let triggerCaptureError: ((err: Error) => void) | undefined;

    const createMicrophoneCapture = (config: { onError: (err: Error) => void }) =>
    {
      triggerCaptureError = config.onError;
      return {
        start: () => {},
        stop: () => {},
      };
    };

    const host: SessionControllerHost = { globalStoragePath: tmp };
    const secrets: SessionSecrets = { getOpenAiApiKey: async () => "sk" };
    const prefs: SessionPreferences = {
      getModel: () => "m",
      getSystemPrompt: () => "s",
      getInputDevice: () => undefined,
      getSafetyIdentifier: () => undefined,
    };
    const ui = CreateTestUi();
    const chatModel = new ChatModel();

    const controller = new SessionController(host, CreateTestLog(), secrets, prefs, ui, {
      startSession,
      createDatabase: CreateFakeDatabase,
      createMicrophoneCapture: createMicrophoneCapture as never,
      buildVscodeToolCallSet: () => CreateHarnessToolCallSet(tmp),
      chatModel,
    });

    await controller.ToggleSession();
    assert.equal(controller.GetState(), "active");
    assert.ok(triggerCaptureError !== undefined);

    triggerCaptureError?.(new Error("mic dead"));

    const deadline = Date.now() + 1000;
    while (controller.GetState() !== "idle" && Date.now() < deadline)
    {
      await new Promise((r) => setImmediate(r));
    }

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const finalBubbles = chatModel.getSnapshot();
    const errorBubbles = finalBubbles.filter((b) => b.kind === "error");
    const contextBubbles = finalBubbles.filter((b) => b.kind === "context_push");

    assert.equal(errorBubbles.length, 1);
    assert.ok(contextBubbles.length >= 1);
    if (errorBubbles[0]?.kind === "error")
    {
      assert.ok(errorBubbles[0].message.toLowerCase().includes("microphone"));
      assert.ok(errorBubbles[0].message.includes("mic dead"));
    }

    const ctxHasAudioError = contextBubbles.some(
      (b) => b.kind === "context_push" && b.summary.includes("audio_error"),
    );
    assert.ok(ctxHasAudioError);
  }
  finally
  {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("SessionController connection lost records error bubble alongside session ended context", async () =>
{
  const tmp = mkdtempSync(join(tmpdir(), "sheaf-vsc-test-"));
  mkdirSync(tmp, { recursive: true });

  try
  {
    let capturedConfig: AgentStartConfig | undefined;
    const fakeSession = CreateFakeSession(() => {});
    const startSession = async (config: AgentStartConfig): Promise<RealtimeAgentSession> =>
    {
      capturedConfig = config;
      return fakeSession;
    };

    const host: SessionControllerHost = { globalStoragePath: tmp };
    const secrets: SessionSecrets = { getOpenAiApiKey: async () => "sk" };
    const prefs: SessionPreferences = {
      getModel: () => "m",
      getSystemPrompt: () => "s",
      getInputDevice: () => undefined,
      getSafetyIdentifier: () => undefined,
    };
    const ui = CreateTestUi();
    const chatModel = new ChatModel();

    const controller = new SessionController(host, CreateTestLog(), secrets, prefs, ui, {
      startSession,
      createDatabase: CreateFakeDatabase,
      createMicrophoneCapture: () => ({ start: () => {}, stop: () => {} }),
      buildVscodeToolCallSet: () => CreateHarnessToolCallSet(tmp),
      chatModel,
    });

    await controller.ToggleSession();
    assert.equal(controller.GetState(), "active");
    assert.ok(capturedConfig !== undefined);

    capturedConfig?.onSessionEnded?.({ reason: "connection_lost" } as never);

    await new Promise((r) => setImmediate(r));

    const bubbles = chatModel.getSnapshot();
    const errorBubbles = bubbles.filter((b) => b.kind === "error");
    const contextBubbles = bubbles.filter((b) => b.kind === "context_push");

    assert.equal(errorBubbles.length, 1);
    assert.ok(contextBubbles.length >= 1);
    if (errorBubbles[0]?.kind === "error")
    {
      assert.ok(errorBubbles[0].message.toLowerCase().includes("connection"));
    }
  }
  finally
  {
    rmSync(tmp, { recursive: true, force: true });
  }
});
