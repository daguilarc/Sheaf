import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DEFAULT_REALTIME_MODEL, type AgentStartConfig } from "../../../src/agent/src/index.js";
import {
  LoadRealtimeAgentConfig,
} from "../../../src/agent/src/config.js";
import {
  ParseCliArgs,
  ResolveCliRunOptions,
  RunCli,
  StartCliRuntime,
  type CliRunDeps,
} from "../../../src/agent/src/cli.js";
import { CreateFakeMicrophoneCapture } from "../../../src/agent/src/audio_input.js";
import { CreateRuntimeLogger } from "../../../src/agent/src/runtime_log.js";
import { buildRealtimeConnectionHeaders } from "../../../src/agent/src/realtime_client.js";
import {
  CreateAgentLoopTestContext,
  OpenConnectedSocket,
} from "../agent_loop/helpers.js";

function CreateFakeRepoRoot(): string
{
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "realtime-agent-repo-"));
  mkdirSync(path.join(repoRoot, "config"), { recursive: true });
  mkdirSync(path.join(repoRoot, "structure"), { recursive: true });
  mkdirSync(
    path.join(
      repoRoot,
      "projects/realtime-agent/prompts/system-prompts",
    ),
    { recursive: true },
  );
  writeFileSync(path.join(repoRoot, "config", "services.json"), "{}");
  return repoRoot;
}

async function WriteApiKey(repoRoot: string, apiKey: string): Promise<void>
{
  await writeFile(
    path.join(repoRoot, "config", "api_keys.json"),
    JSON.stringify({ openai_api_key: apiKey }),
  );
}

test("ParseCliArgs requires context file", () =>
{
  assert.throws(
    () => ParseCliArgs(["node", "realtime-agent"]),
    (error: Error) => error.message.includes("--context-file"),
  );
});

test("ParseCliArgs accepts optional prompt file", () =>
{
  const parsed = ParseCliArgs([
    "node",
    "realtime-agent",
    "--context-file",
    "context.md",
  ]);

  assert.equal(parsed.action, "run");
  if (parsed.action !== "run")
  {
    return;
  }

  assert.equal(parsed.options.promptFile, undefined);
});

test("ParseCliArgs parses tool flags and explicit model", () =>
{
  const parsed = ParseCliArgs([
    "node",
    "realtime-agent",
    "--prompt-file",
    "prompt.md",
    "--context-file",
    "context.md",
    "--tool",
    "echo",
    "--tool",
    "echo,echo",
    "--model",
    "custom-model",
    "--safety-identifier",
    "operator-42",
    "--input-device",
    "15",
  ]);

  assert.equal(parsed.action, "run");
  if (parsed.action !== "run")
  {
    return;
  }

  assert.equal(parsed.options.model, "custom-model");
  assert.deepEqual(parsed.options.toolNames, ["echo", "echo", "echo"]);
  assert.equal(parsed.options.safetyIdentifier, "operator-42");
  assert.equal(parsed.options.inputDevice, "15");
});

test("ResolveCliRunOptions uses configured default prompt and model", async () =>
{
  const repoRoot = CreateFakeRepoRoot();
  const promptPath = path.join(
    repoRoot,
    "projects/realtime-agent/prompts/system-prompts/basic_realtime_conversation_v1.md",
  );

  try
  {
    await writeFile(promptPath, "default prompt");
    const config = await LoadRealtimeAgentConfig({ repoRoot });
    const parsed = ParseCliArgs([
      "node",
      "realtime-agent",
      "--context-file",
      "context.md",
    ]);

    assert.equal(parsed.action, "run");
    if (parsed.action !== "run")
    {
      return;
    }

    const resolved = ResolveCliRunOptions(parsed.options, config);
    assert.equal(resolved.promptFile, promptPath);
    assert.equal(resolved.model, DEFAULT_REALTIME_MODEL);
  }
  finally
  {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("ParseCliArgs supports list-input-devices action", () =>
{
  const parsed = ParseCliArgs([
    "node",
    "realtime-agent",
    "--list-input-devices",
  ]);

  assert.equal(parsed.action, "list_input_devices");
});

test("RunCli list-input-devices does not require config or API key", async () =>
{
  let configLoaded = false;
  let apiKeyLoaded = false;

  const exitCode = await RunCli(
    ["node", "realtime-agent", "--list-input-devices"],
    {
      loadConfig: async () =>
      {
        configLoaded = true;
        throw new Error("config should not load");
      },
      loadApiKey: async () =>
      {
        apiKeyLoaded = true;
        throw new Error("api key should not load");
      },
      listInputDevices: () => [],
      formatInputDeviceList: () => "no input devices",
    },
  );

  assert.equal(exitCode, 0);
  assert.equal(configLoaded, false);
  assert.equal(apiKeyLoaded, false);
});

test("RunCli loads API key from config/api_keys.json without OPENAI_API_KEY", async () =>
{
  const repoRoot = CreateFakeRepoRoot();
  const dir = await mkdtemp(path.join(os.tmpdir(), "realtime-agent-cli-"));
  const promptFile = path.join(dir, "prompt.md");
  const contextFile = path.join(dir, "context.md");
  await writeFile(promptFile, "system prompt");
  await writeFile(contextFile, "initial context");
  await WriteApiKey(repoRoot, "repo-config-key");

  const context = CreateAgentLoopTestContext();

  try
  {
    const exitCode = await RunCli(
      [
        "node",
        "realtime-agent",
        "--prompt-file",
        promptFile,
        "--context-file",
        contextFile,
      ],
      {
        repoRoot,
        registerSignalHandlers: false,
        createDatabase: () => context.database,
        sessionDeps: {
          webSocketFactory: context.deps.webSocketFactory,
        },
        createMicrophoneCapture: (options) =>
          CreateFakeMicrophoneCapture({
            frames: [],
            onFrame: options.onFrame,
            onError: options.onError,
          }),
        startSession: async (config, sessionDeps) =>
        {
          const { startAgentSession } = await import("../../../src/agent/src/agent_loop.js");
          const startPromise = startAgentSession(config, sessionDeps);
          await OpenConnectedSocket(context.sockets);
          const session = await startPromise;
          await session.stop("test");
          return session;
        },
      },
    );

    assert.equal(exitCode, 0);
  }
  finally
  {
    rmSync(path.dirname(context.databasePath), { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("RunCli reports missing API key from config/api_keys.json", async () =>
{
  const repoRoot = CreateFakeRepoRoot();
  const dir = await mkdtemp(path.join(os.tmpdir(), "realtime-agent-cli-"));
  const contextFile = path.join(dir, "context.md");
  await writeFile(contextFile, "initial context");

  try
  {
    const exitCode = await RunCli(
      [
        "node",
        "realtime-agent",
        "--prompt-file",
        path.join(dir, "prompt.md"),
        "--context-file",
        contextFile,
      ],
      { repoRoot, registerSignalHandlers: false },
    );

    assert.equal(exitCode, 1);
  }
  finally
  {
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("RunCli reports unknown tools before connecting", async () =>
{
  const repoRoot = CreateFakeRepoRoot();
  const dir = await mkdtemp(path.join(os.tmpdir(), "realtime-agent-cli-"));
  const promptFile = path.join(dir, "prompt.md");
  const contextFile = path.join(dir, "context.md");
  await writeFile(promptFile, "system prompt");
  await writeFile(contextFile, "initial context");
  await WriteApiKey(repoRoot, "test-key");

  try
  {
    const exitCode = await RunCli(
      [
        "node",
        "realtime-agent",
        "--prompt-file",
        promptFile,
        "--context-file",
        contextFile,
        "--tool",
        "missing_tool",
      ],
      { repoRoot, registerSignalHandlers: false },
    );

    assert.equal(exitCode, 1);
  }
  finally
  {
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("StartCliRuntime passes prompt and context file contents to agent config", async () =>
{
  const repoRoot = CreateFakeRepoRoot();
  const dir = await mkdtemp(path.join(os.tmpdir(), "realtime-agent-cli-"));
  const promptFile = path.join(dir, "prompt.md");
  const contextFile = path.join(dir, "context.md");
  await writeFile(promptFile, "Prompt body from file.");
  await writeFile(contextFile, "Context body from file.");

  const context = CreateAgentLoopTestContext();
  let capturedConfig: AgentStartConfig | undefined;

  const agentConfig = await LoadRealtimeAgentConfig({ repoRoot });
  const runtimeLogger = CreateRuntimeLogger({
    logPath: path.join(dir, "runtime.jsonl"),
    repoRoot,
  });

  const deps: CliRunDeps & {
    apiKey: string;
    agentConfig: Awaited<ReturnType<typeof LoadRealtimeAgentConfig>>;
    runtimeLogger: ReturnType<typeof CreateRuntimeLogger>;
  } = {
    apiKey: "test-key",
    agentConfig,
    runtimeLogger,
    createDatabase: () => context.database,
    sessionDeps: {
      webSocketFactory: context.deps.webSocketFactory,
    },
    registerSignalHandlers: false,
    createMicrophoneCapture: (options) =>
      CreateFakeMicrophoneCapture({
        frames: ["Zm9v"],
        onFrame: options.onFrame,
        onError: options.onError,
      }),
    startSession: async (config, sessionDeps) =>
    {
      capturedConfig = config;
      const { startAgentSession } = await import("../../../src/agent/src/agent_loop.js");
      const startPromise = startAgentSession(config, sessionDeps);
      await OpenConnectedSocket(context.sockets);
      return startPromise;
    },
  };

  const parsed = ParseCliArgs([
    "node",
    "realtime-agent",
    "--prompt-file",
    promptFile,
    "--context-file",
    contextFile,
    "--safety-identifier",
    "operator-99",
  ]);

  assert.equal(parsed.action, "run");
  if (parsed.action !== "run")
  {
    return;
  }

  try
  {
    const resolved = ResolveCliRunOptions(parsed.options, agentConfig);
    const runtime = await StartCliRuntime(resolved, deps);

    assert.equal(capturedConfig?.systemPrompt, "Prompt body from file.");
    assert.equal(capturedConfig?.initialContext, "Context body from file.");

    const headers = buildRealtimeConnectionHeaders("test-key", "operator-99");
    assert.equal(headers["OpenAI-Safety-Identifier"], "operator-99");

    runtime.session.sendAudioFrame("ignored-for-test");
    await runtime.shutdown("test", 0);
  }
  finally
  {
    rmSync(path.dirname(context.databasePath), { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("StartCliRuntime shutdown stops audio capture and finalizes session", async () =>
{
  const repoRoot = CreateFakeRepoRoot();
  const dir = await mkdtemp(path.join(os.tmpdir(), "realtime-agent-cli-"));
  const promptFile = path.join(dir, "prompt.md");
  const contextFile = path.join(dir, "context.md");
  await writeFile(promptFile, "system");
  await writeFile(contextFile, "context");

  const context = CreateAgentLoopTestContext();
  let stopReason: string | undefined;
  let endedReason: string | null | undefined;
  let audioStopped = false;

  const agentConfig = await LoadRealtimeAgentConfig({ repoRoot });
  const runtimeLogger = CreateRuntimeLogger({
    logPath: path.join(dir, "runtime.jsonl"),
    repoRoot,
  });

  const deps: CliRunDeps & {
    apiKey: string;
    agentConfig: Awaited<ReturnType<typeof LoadRealtimeAgentConfig>>;
    runtimeLogger: ReturnType<typeof CreateRuntimeLogger>;
  } = {
    apiKey: "test-key",
    agentConfig,
    runtimeLogger,
    createDatabase: () => context.database,
    sessionDeps: {
      webSocketFactory: context.deps.webSocketFactory,
    },
    registerSignalHandlers: false,
    createMicrophoneCapture: (options) =>
    {
      const capture = CreateFakeMicrophoneCapture({
        frames: [],
        onFrame: options.onFrame,
        onError: options.onError,
      });

      const originalStop = capture.stop.bind(capture);
      return {
        start: capture.start.bind(capture),
        stop: () =>
        {
          audioStopped = true;
          originalStop();
        },
      };
    },
    startSession: async (config, sessionDeps) =>
    {
      const { startAgentSession } = await import("../../../src/agent/src/agent_loop.js");
      const startPromise = startAgentSession(config, sessionDeps);
      await OpenConnectedSocket(context.sockets);
      const session = await startPromise;

      return {
        ...session,
        stop: async (reason: string) =>
        {
          stopReason = reason;
          const ended = await session.stop(reason);
          endedReason = ended.endedReason;
          return ended;
        },
      };
    },
  };

  const parsed = ParseCliArgs([
    "node",
    "realtime-agent",
    "--prompt-file",
    promptFile,
    "--context-file",
    contextFile,
  ]);

  assert.equal(parsed.action, "run");
  if (parsed.action !== "run")
  {
    return;
  }

  try
  {
    const resolved = ResolveCliRunOptions(parsed.options, agentConfig);
    const runtime = await StartCliRuntime(resolved, deps);
    await runtime.shutdown("sigint", 0);

    assert.equal(audioStopped, true);
    assert.equal(stopReason, "sigint");
    assert.equal(endedReason, "sigint");
  }
  finally
  {
    rmSync(path.dirname(context.databasePath), { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});
