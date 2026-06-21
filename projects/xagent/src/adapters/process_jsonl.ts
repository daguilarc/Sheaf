import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";

import type { HarnessName } from "../events.js";
import type { AdapterEvent, AdapterTurnContext, HarnessSession } from "./types.js";

export type ProcessHarnessState = {
  providerThreadId?: string;
  providerSequence: number;
};

export type ProviderEventParser = (
  raw: unknown,
  context: AdapterTurnContext,
  state: ProcessHarnessState,
) => AdapterEvent[];

export type ProcessCommand = {
  command: string;
  args: string[];
  input?: string;
};

export type ProcessCommandBuilder = (
  context: AdapterTurnContext,
  state: ProcessHarnessState,
) => ProcessCommand;

export type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: { cwd: string },
) => ChildProcessWithoutNullStreams;

export type ProcessJsonlSessionOptions = {
  readonly harness: HarnessName;
  readonly cwd: string;
  readonly buildCommand: ProcessCommandBuilder;
  readonly parseEvent: ProviderEventParser;
  readonly spawnProcess?: SpawnProcess;
};

export class ProcessJsonlSession implements HarnessSession {
  readonly #state: ProcessHarnessState = { providerSequence: 0 };
  readonly #spawnProcess: SpawnProcess;

  constructor(private readonly options: ProcessJsonlSessionOptions) {
    this.#spawnProcess = options.spawnProcess ?? ((command, args, childOptions) => spawn(command, args, childOptions));
  }

  get providerThreadId(): string | undefined {
    return this.#state.providerThreadId;
  }

  async *submit(context: AdapterTurnContext): AsyncIterable<AdapterEvent> {
    const command = this.options.buildCommand(context, this.#state);
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.#spawnProcess(command.command, command.args, { cwd: this.options.cwd });
    } catch (error) {
      throw harnessUnavailable(this.options.harness, error);
    }
    const exitPromise = waitForExit(child);

    const stderrChunks: string[] = [];
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderrChunks.push(chunk);
    });

    if (command.input !== undefined) {
      child.stdin.end(command.input);
    } else {
      child.stdin.end();
    }

    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    for await (const line of lines) {
      if (line.trim() === "") {
        continue;
      }
      const raw = parseProviderLine(line);
      this.#state.providerSequence += 1;
      yield {
        type: "raw.provider",
        harness: this.options.harness,
        payload: raw,
        provider_sequence: this.#state.providerSequence,
      };
      if (isProviderText(raw)) {
        yield {
          type: "status",
          level: "info",
          message: raw.text,
          rawProvider: raw,
        };
      }
      for (const event of this.options.parseEvent(raw, context, this.#state)) {
        yield event;
      }
    }

    const exit = await exitPromise;
    if (exit.error !== undefined) {
      throw harnessUnavailable(this.options.harness, exit.error);
    }
    if (exit.code !== 0) {
      const message = stderrChunks.join("").trim() || `${this.options.harness} process exited ${exit.code ?? "without a code"}.`;
      const error = new Error(message);
      Object.assign(error, { code: exit.code === undefined ? "harness_failed" : "harness_process_failed" });
      throw error;
    }
  }

  async close(): Promise<void> {}
}

export async function assertCommandAvailable(command: string, harness: HarnessName): Promise<void> {
  if (command.includes(path.sep)) {
    await assertExecutable(command, harness);
    return;
  }

  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (directory === "") {
      continue;
    }
    const candidate = path.join(directory, command);
    try {
      await access(candidate, fsConstants.X_OK);
      return;
    } catch {
      // Keep looking through PATH.
    }
  }

  throw unavailableError(harness, `${command} was not found on PATH.`);
}

function parseProviderLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return { type: "text", text: line };
  }
}

function isProviderText(value: unknown): value is { type: "text"; text: string } {
  return isRecord(value) && value.type === "text" && typeof value.text === "string";
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<{ code?: number | null; signal?: NodeJS.Signals | null; error?: Error }> {
  return new Promise((resolve) => {
    let childError: Error | undefined;
    child.once("error", (error) => {
      childError = error;
    });
    child.once("close", (code, signal) => {
      resolve({ code, signal, error: childError });
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function harnessUnavailable(harness: HarnessName, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return unavailableError(harness, detail);
}

async function assertExecutable(command: string, harness: HarnessName): Promise<void> {
  try {
    await access(command, fsConstants.X_OK);
  } catch {
    throw unavailableError(harness, `${command} is not executable.`);
  }
}

function unavailableError(harness: HarnessName, detail: string): Error {
  const unavailable = new Error(`${harness} harness is unavailable: ${detail}`);
  Object.assign(unavailable, { code: "harness_unavailable" });
  return unavailable;
}
