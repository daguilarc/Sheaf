#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  DEFAULT_REALTIME_MODEL,
  RealtimeAgentDb,
  RealtimeTransportError,
  startAgentSession,
  type AgentSessionDeps,
  type AgentStartConfig,
  type RealtimeAgentSession,
} from "./index.js";
import {
  CreateFakeMicrophoneCapture,
  CreateMicrophoneCapture,
  FormatInputDeviceList,
  ListInputDevices,
  type MicrophoneCapture,
} from "./audio_input.js";
import { logEventLine } from "./stdout_logger.js";
import {
  BuildToolCallSet,
  FindUnknownToolNames,
  ParseToolNameArguments,
} from "./tool_sets.js";

const x_connectionLostReason = "connection_lost";

export interface ParsedCliRunOptions
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
  env?: NodeJS.ProcessEnv;
  createDatabase?: () => RealtimeAgentDb;
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

  const promptFile = values["prompt-file"];
  if (promptFile === undefined || promptFile.trim().length === 0)
  {
    throw new CliUsageError("--prompt-file is required.");
  }

  const contextFile = values["context-file"];
  if (contextFile === undefined || contextFile.trim().length === 0)
  {
    throw new CliUsageError("--context-file is required.");
  }

  const rawTools = values.tool;
  const toolValues = rawTools === undefined ? [] : Array.isArray(rawTools) ? rawTools : [rawTools];

  return {
    action: "run",
    options: {
      promptFile,
      contextFile,
      model: values.model ?? DEFAULT_REALTIME_MODEL,
      toolNames: ParseToolNameArguments(toolValues),
      inputDevice: values["input-device"],
      safetyIdentifier: values["safety-identifier"],
    },
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
  options: ParsedCliRunOptions,
  deps: CliRunDeps = {},
): Promise<CliRuntime>
{
  const env = deps.env ?? process.env;
  const apiKey = env.OPENAI_API_KEY;
  if (apiKey === undefined || apiKey.trim().length === 0)
  {
    throw new CliUsageError("OPENAI_API_KEY is required to connect to the OpenAI Realtime API.");
  }

  const unknownTools = FindUnknownToolNames(options.toolNames);
  if (unknownTools.length > 0)
  {
    throw new CliUsageError(`Unknown tool(s): ${unknownTools.join(", ")}`);
  }

  const systemPrompt = await readFile(options.promptFile, "utf8");
  const initialContext = await readFile(options.contextFile, "utf8");

  const database = (deps.createDatabase ?? (() => RealtimeAgentDb.open()))();
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
      }
    }

    database.close();
    return code;
  };

  const agentConfig: AgentStartConfig = {
    systemPrompt,
    initialContext,
    toolCallSet: BuildToolCallSet(options.toolNames),
    model: options.model,
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
      if (info.reason === x_connectionLostReason)
      {
        console.error("Realtime connection lost; session ended.");
        void shutdown(info.reason, 1).then((exitCode) =>
        {
          if (deps.registerSignalHandlers !== false)
          {
            process.exit(exitCode);
          }
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

    session = await startSession(agentConfig, sessionDeps);
  }
  catch (error)
  {
    database.close();

    if (error instanceof RealtimeTransportError)
    {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
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
  }
  catch (error)
  {
    await shutdown("audio_setup_error", 1);
    throw error;
  }

  return {
    session,
    audioCapture,
    database,
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
    console.log(FormatInputDeviceList(ListInputDevices()));
    return 0;
  }

  try
  {
    const runtime = await StartCliRuntime(parsed.options, deps);

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
