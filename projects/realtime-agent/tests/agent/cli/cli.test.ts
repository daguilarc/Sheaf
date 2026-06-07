import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DEFAULT_REALTIME_MODEL, type AgentStartConfig } from "../../../src/agent/src/index.js";
import {
  ParseCliArgs,
  RunCli,
  StartCliRuntime,
  type CliRunDeps,
} from "../../../src/agent/src/cli.js";
import { CreateFakeMicrophoneCapture } from "../../../src/agent/src/audio_input.js";
import { buildRealtimeConnectionHeaders } from "../../../src/agent/src/realtime_client.js";
import {
  CreateAgentLoopTestContext,
  OpenConnectedSocket,
} from "../agent_loop/helpers.js";

test("ParseCliArgs requires prompt and context files", () =>
{
  assert.throws(
    () => ParseCliArgs(["node", "realtime-agent"]),
    (error: Error) => error.message.includes("--prompt-file"),
  );

  assert.throws(
    () =>
      ParseCliArgs([
        "node",
        "realtime-agent",
        "--prompt-file",
        "prompt.md",
      ]),
    (error: Error) => error.message.includes("--context-file"),
  );
});

test("ParseCliArgs defaults model to gpt-realtime-2 and parses tool flags", () =>
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

test("ParseCliArgs uses default model when omitted", () =>
{
  const parsed = ParseCliArgs([
    "node",
    "realtime-agent",
    "--prompt-file",
    "prompt.md",
    "--context-file",
    "context.md",
  ]);

  assert.equal(parsed.action, "run");
  if (parsed.action !== "run")
  {
    return;
  }

  assert.equal(parsed.options.model, DEFAULT_REALTIME_MODEL);
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

test("RunCli reports missing OPENAI_API_KEY", async () =>
{
  const dir = await mkdtemp(path.join(os.tmpdir(), "realtime-agent-cli-"));
  const promptFile = path.join(dir, "prompt.md");
  const contextFile = path.join(dir, "context.md");
  await writeFile(promptFile, "system prompt");
  await writeFile(contextFile, "initial context");

  const exitCode = await RunCli(
    [
      "node",
      "realtime-agent",
      "--prompt-file",
      promptFile,
      "--context-file",
      contextFile,
    ],
    { env: {}, registerSignalHandlers: false },
  );

  assert.equal(exitCode, 1);
});

test("RunCli reports unknown tools before connecting", async () =>
{
  const dir = await mkdtemp(path.join(os.tmpdir(), "realtime-agent-cli-"));
  const promptFile = path.join(dir, "prompt.md");
  const contextFile = path.join(dir, "context.md");
  await writeFile(promptFile, "system prompt");
  await writeFile(contextFile, "initial context");

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
    {
      env: { OPENAI_API_KEY: "test-key" },
      registerSignalHandlers: false,
    },
  );

  assert.equal(exitCode, 1);
});

test("StartCliRuntime passes prompt and context file contents to agent config", async () =>
{
  const dir = await mkdtemp(path.join(os.tmpdir(), "realtime-agent-cli-"));
  const promptFile = path.join(dir, "prompt.md");
  const contextFile = path.join(dir, "context.md");
  await writeFile(promptFile, "Prompt body from file.");
  await writeFile(contextFile, "Context body from file.");

  const context = CreateAgentLoopTestContext();
  let capturedConfig: AgentStartConfig | undefined;
  const frames: string[] = [];

  const deps: CliRunDeps = {
    env: { OPENAI_API_KEY: "test-key" },
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
    const runtime = await StartCliRuntime(parsed.options, deps);

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
  }
});

test("StartCliRuntime shutdown stops audio capture and finalizes session", async () =>
{
  const dir = await mkdtemp(path.join(os.tmpdir(), "realtime-agent-cli-"));
  const promptFile = path.join(dir, "prompt.md");
  const contextFile = path.join(dir, "context.md");
  await writeFile(promptFile, "system");
  await writeFile(contextFile, "context");

  const context = CreateAgentLoopTestContext();
  let stopReason: string | undefined;
  let endedReason: string | null | undefined;
  let audioStopped = false;

  const deps: CliRunDeps = {
    env: { OPENAI_API_KEY: "test-key" },
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
    const runtime = await StartCliRuntime(parsed.options, deps);
    await runtime.shutdown("sigint", 0);

    assert.equal(audioStopped, true);
    assert.equal(stopReason, "sigint");
    assert.equal(endedReason, "sigint");
  }
  finally
  {
    rmSync(path.dirname(context.databasePath), { recursive: true, force: true });
  }
});
