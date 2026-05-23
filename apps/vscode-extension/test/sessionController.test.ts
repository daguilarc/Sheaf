import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  AgentSessionDeps,
  AgentStartConfig,
  RealtimeAgentSession,
  SessionRow,
} from "realtime-agent-lib";

import { SessionController } from "../src/sessionController.js";
import { BuildVscodeToolCallSet } from "../src/tools/callSetBuilder.js";
import { NoOpFreshnessHooks } from "../src/tools/types.js";
import type { LogSink } from "../src/log.js";
import type { SessionControllerHost, SessionPreferences, SessionSecrets, SessionUi } from "../src/sessionTypes.js";
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
      { startSession, createMicrophoneCapture, buildVscodeToolCallSet: () => CreateHarnessToolCallSet(tmp) },
      () => {},
    );

    await controller.ToggleSession();

    assert.equal(controller.GetState(), "active");
    assert.ok(capturedConfig !== undefined);
    assert.equal(capturedConfig.turnMode?.type, "manual");
    assert.equal(capturedConfig.responseAfterToolOutput, true);
    assert.equal(capturedConfig.toolCallSet.tools.length, 6);
    assert.deepEqual(
      capturedConfig.toolCallSet.tools.map((t) => t.name),
      ["code_read", "list_files", "rgrep", "read_visible_range", "set_cursor_position", "move_visible_range"],
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
