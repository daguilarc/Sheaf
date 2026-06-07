#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  ConfigLoadError,
  LoadOpenAiApiKey,
  LoadRealtimeAgentConfig,
  type ResolvedRealtimeAgentConfig,
} from "./config.js";
import {
  startAgentSession,
} from "./agent_loop.js";
import {
  RealtimeAgentDb,
} from "./persistence/db.js";
import {
  RealtimeTransportError,
} from "./realtime_client.js";
import {
  type AgentSessionDeps,
  type AgentStartConfig,
  type RealtimeAgentSession,
  type RealtimeAgentTurnMode,
} from "./types.js";
import {
  CreateFakeMicrophoneCapture,
  CreateMicrophoneCapture,
  FormatInputDeviceList,
  ListInputDevices,
  type MicrophoneCapture,
} from "./audio_input.js";
import {
  CreateRuntimeLogger,
  type RuntimeLogger,
} from "./runtime_log.js";
import { logEventLine } from "./stdout_logger.js";
import {
  BuildToolCallSet,
  FindUnknownToolNames,
  ParseToolNameArguments,
} from "./tool_sets.js";

const x_connectionLostReason = "connection_lost";
const x_defaultTurnMode: RealtimeAgentTurnMode = {
  type: "server_vad",
  silenceDurationMs: 500,
  createResponse: true,
  interruptResponse: true,
};

export interface ParsedCliRunOptions
{
  promptFile?: string;
  contextFile: string;
  model?: string;
  toolNames: string[];
  inputDevice?: string;
  safetyIdentifier?: string;
}

export interface ResolvedCliRunOptions
{
  promptFile: string;
  contextFile: string;
  model: string;
  toolNames: string[];
  inputDevice?: string;
  safetyIdentifier?: string;
}

export type ParseCliResult =
  | { action: "run"; options: ParsedCliRunOptions }
  | { action: "list_input_devices" };

export interface CliRunDeps
{
  repoRoot?: string;
  loadConfig?: typeof LoadRealtimeAgentConfig;
  loadApiKey?: typeof LoadOpenAiApiKey;
  createRuntimeLogger?: typeof CreateRuntimeLogger;
  listInputDevices?: typeof ListInputDevices;
  formatInputDeviceList?: typeof FormatInputDeviceList;
  createDatabase?: (config: ResolvedRealtimeAgentConfig) => RealtimeAgentDb;
  sessionDeps?: Partial<AgentSessionDeps>;
  startSession?: typeof startAgentSession;
  createMicrophoneCapture?: (options: {
    inputDevice?: string;
    onFrame: (pcmBase64: string) => void;
    onError: (error: Error) => void;
  }) => MicrophoneCapture;
  registerSignalHandlers?: boolean;
}

export interface CliRuntime
{
  session: RealtimeAgentSession;
  audioCapture: MicrophoneCapture;
  database: RealtimeAgentDb;
  runtimeLogger: RuntimeLogger;
  shutdown(reason: string, code: number): Promise<number>;
}

export function ParseCliArgs(argv: string[]): ParseCliResult
{
  const { values } = parseArgs({
    args: argv.slice(2),
    options: {
      "prompt-file": { type: "string" },
      "context-file": { type: "string" },
      model: { type: "string" },
      tool: { type: "string", multiple: true },
      "input-device": { type: "string" },
      "list-input-devices": { type: "boolean", default: false },
      "safety-identifier": { type: "string" },
    },
    allowPositionals: false,
  });

  if (values["list-input-devices"] === true)
  {
    return { action: "list_input_devices" };
  }

  const contextFile = values["context-file"];
  if (contextFile === undefined || contextFile.trim().length === 0)
  {
    throw new CliUsageError("--context-file is required.");
  }

  const rawTools = values.tool;
  const toolValues = rawTools === undefined ? [] : Array.isArray(rawTools) ? rawTools : [rawTools];
  const promptFile = values["prompt-file"];
  const trimmedPrompt =
    promptFile !== undefined && promptFile.trim().length > 0 ? promptFile : undefined;

  return {
    action: "run",
    options: {
      promptFile: trimmedPrompt,
      contextFile,
      model: values.model,
      toolNames: ParseToolNameArguments(toolValues),
      inputDevice: values["input-device"],
      safetyIdentifier: values["safety-identifier"],
    },
  };
}

export function ResolveCliRunOptions(
  options: ParsedCliRunOptions,
  config: ResolvedRealtimeAgentConfig,
): ResolvedCliRunOptions
{
  return {
    promptFile: options.promptFile ?? config.defaultPromptPath,
    contextFile: options.contextFile,
    model: options.model ?? config.model,
    toolNames: options.toolNames,
    inputDevice: options.inputDevice,
    safetyIdentifier: options.safetyIdentifier,
  };
}

export class CliUsageError extends Error
{
  constructor(message: string)
  {
    super(message);
    this.name = "CliUsageError";
  }
}

export async function StartCliRuntime(
  options: ResolvedCliRunOptions,
  deps: CliRunDeps & {
    apiKey: string;
    agentConfig: ResolvedRealtimeAgentConfig;
    runtimeLogger: RuntimeLogger;
  },
): Promise<CliRuntime>
{
  const apiKey = deps.apiKey;
  const runtimeLogger = deps.runtimeLogger;
  const agentConfig = deps.agentConfig;

  runtimeLogger.Log("cli_startup", {
    model: options.model,
    turn_mode: x_defaultTurnMode.type,
    prompt_file: options.promptFile,
    context_file: options.contextFile,
  });

  const unknownTools = FindUnknownToolNames(options.toolNames);
  if (unknownTools.length > 0)
  {
    throw new CliUsageError(`Unknown tool(s): ${unknownTools.join(", ")}`);
  }

  let systemPrompt: string;
  let initialContext: string;

  try
  {
    systemPrompt = await readFile(options.promptFile, "utf8");
  }
  catch (error)
  {
    const message = error instanceof Error ? error.message : String(error);
    runtimeLogger.LogError("prompt_load_failed", {
      prompt_file: options.promptFile,
      error: message,
    });
    throw error;
  }

  try
  {
    initialContext = await readFile(options.contextFile, "utf8");
  }
  catch (error)
  {
    const message = error instanceof Error ? error.message : String(error);
    runtimeLogger.LogError("context_load_failed", {
      context_file: options.contextFile,
      error: message,
    });
    throw error;
  }

  let database: RealtimeAgentDb;
  try
  {
    database = (deps.createDatabase ?? ((config) =>
      RealtimeAgentDb.open({ path: config.databasePath })))(agentConfig);
  }
  catch (error)
  {
    const message = error instanceof Error ? error.message : String(error);
    runtimeLogger.LogError("persistence_init_failed", {
      database_path: agentConfig.databasePath,
      error: message,
    });
    throw error;
  }

  const startSession = deps.startSession ?? startAgentSession;
  const createCapture = deps.createMicrophoneCapture ?? CreateMicrophoneCapture;

  let session: RealtimeAgentSession | undefined;
  let audioCapture: MicrophoneCapture | undefined;
  let shuttingDown = false;

  const shutdown = async (reason: string, code: number): Promise<number> =>
  {
    if (shuttingDown)
    {
      return code;
    }

    shuttingDown = true;
    audioCapture?.stop();

    if (session !== undefined)
    {
      try
      {
        await session.stop(reason);
      }
      catch (stopError)
      {
        const message =
          stopError instanceof Error ? stopError.message : String(stopError);
        console.error(`Failed to stop session: ${message}`);
        runtimeLogger.LogError("session_stop_failed", { reason, error: message });
      }
    }

    database.close();
    runtimeLogger.Log("cli_shutdown", { reason, exit_code: code });
    runtimeLogger.Close();
    return code;
  };

  const agentStartConfig: AgentStartConfig = {
    systemPrompt,
    initialContext,
    toolCallSet: BuildToolCallSet(options.toolNames),
    model: options.model,
    turnMode: x_defaultTurnMode,
    onEvent: (event, info) =>
    {
      logEventLine({
        sessionId: info.sessionId,
        direction: info.direction,
        event,
      });
    },
    onSessionEnded: (info) =>
    {
      runtimeLogger.Log("realtime_session_ended", {
        session_id: info.sessionId,
        reason: info.reason,
      });

      if (info.reason === x_connectionLostReason)
      {
        console.error("Realtime connection lost; session ended.");
        runtimeLogger.LogError("realtime_connection_lost", {
          session_id: info.sessionId,
        });
        void shutdown(info.reason, 1).then((exitCode) =>
        {
          if (deps.registerSignalHandlers !== false)
          {
            process.exit(exitCode);
          }
        });
      }
    },
    onToolLifecycle: (notification) =>
    {
      if (notification.phase === "failed")
      {
        runtimeLogger.LogError("tool_dispatch_failed", {
          session_id: notification.sessionId,
          tool_call_id: notification.toolCallId,
          tool_name: notification.toolName,
          error: notification.error,
        });
      }
    },
  };

  try
  {
    const sessionDeps: AgentSessionDeps = {
      apiKey,
      safetyIdentifier: options.safetyIdentifier,
      database,
      ...deps.sessionDeps,
    };

    runtimeLogger.Log("realtime_connecting", { model: options.model });
    session = await startSession(agentStartConfig, sessionDeps);
    runtimeLogger.Log("realtime_connected", { session_id: session.sessionId });
  }
  catch (error)
  {
    database.close();

    if (error instanceof RealtimeTransportError)
    {
      runtimeLogger.LogError("realtime_connection_failed", {
        error: error.message,
      });
      runtimeLogger.Close();
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    runtimeLogger.LogError("realtime_session_start_failed", { error: message });
    runtimeLogger.Close();
    throw new Error(`Failed to start realtime session: ${message}`);
  }

  try
  {
    audioCapture = createCapture({
      inputDevice: options.inputDevice,
      onFrame: (pcmBase64) =>
      {
        session?.sendAudioFrame(pcmBase64);
      },
      onError: (captureError) =>
      {
        console.error(`Microphone capture failed: ${captureError.message}`);
        runtimeLogger.LogError("microphone_capture_failed", {
          error: captureError.message,
        });
        void shutdown("audio_error", 1).then((exitCode) =>
        {
          if (deps.registerSignalHandlers !== false)
          {
            process.exit(exitCode);
          }
        });
      },
    });
    audioCapture.start();
    runtimeLogger.Log("microphone_started", {
      input_device: options.inputDevice,
    });
  }
  catch (error)
  {
    const message = error instanceof Error ? error.message : String(error);
    runtimeLogger.LogError("microphone_setup_failed", { error: message });
    await shutdown("audio_setup_error", 1);
    throw error;
  }

  return {
    session,
    audioCapture,
    database,
    runtimeLogger,
    shutdown,
  };
}

export async function RunCli(argv: string[], deps: CliRunDeps = {}): Promise<number>
{
  let parsed: ParseCliResult;
  try
  {
    parsed = ParseCliArgs(argv);
  }
  catch (error)
  {
    if (error instanceof CliUsageError)
    {
      console.error(error.message);
      return 1;
    }

    throw error;
  }

  if (parsed.action === "list_input_devices")
  {
    const listDevices = deps.listInputDevices ?? ListInputDevices;
    const formatDevices = deps.formatInputDeviceList ?? FormatInputDeviceList;
    console.log(formatDevices(listDevices()));
    return 0;
  }

  const loadConfig = deps.loadConfig ?? LoadRealtimeAgentConfig;
  const loadApiKey = deps.loadApiKey ?? LoadOpenAiApiKey;
  const createRuntimeLogger = deps.createRuntimeLogger ?? CreateRuntimeLogger;

  let agentConfig: ResolvedRealtimeAgentConfig;
  let apiKey: string;
  let runtimeLogger: RuntimeLogger;

  try
  {
    agentConfig = await loadConfig({ repoRoot: deps.repoRoot });
    apiKey = await loadApiKey({ repoRoot: deps.repoRoot });
    runtimeLogger = createRuntimeLogger({
      logPath: agentConfig.runtimeLogPath,
      repoRoot: deps.repoRoot,
    });
  }
  catch (error)
  {
    if (error instanceof ConfigLoadError)
    {
      console.error(error.message);
      return 1;
    }

    throw error;
  }

  const resolvedOptions = ResolveCliRunOptions(parsed.options, agentConfig);

  try
  {
    const runtime = await StartCliRuntime(resolvedOptions, {
      ...deps,
      apiKey,
      agentConfig,
      runtimeLogger,
    });

    if (deps.registerSignalHandlers === false)
    {
      return 0;
    }

    return await new Promise<number>((resolve) =>
    {
      const onSignal = (): void =>
      {
        void runtime.shutdown("signal", 0).then(resolve);
      };

      process.once("SIGINT", onSignal);
      process.once("SIGTERM", onSignal);
    });
  }
  catch (error)
  {
    if (error instanceof CliUsageError)
    {
      console.error(error.message);
      return 1;
    }

    if (error instanceof RealtimeTransportError)
    {
      console.error(error.message);
      return 1;
    }

    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ENOENT") || message.includes("no such file"))
    {
      console.error(`Failed to read prompt or context file: ${message}`);
      return 1;
    }

    console.error(message);
    return 1;
  }
}

async function Main(): Promise<void>
{
  const exitCode = await RunCli(process.argv);
  process.exit(exitCode);
}

const x_invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const x_entryPath = path.resolve(fileURLToPath(import.meta.url));

if (x_invokedPath === x_entryPath)
{
  void Main();
}

export { CreateFakeMicrophoneCapture };
