import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { createInterface, type Interface } from "node:readline/promises";

import type { HarnessName } from "../events.js";
import { captureOwnedProcessIdentity } from "../supervision/process_identity.js";
import type {
  AdapterEvent,
  AdapterTurnContext,
  HarnessSession,
  OwnedProcessIdentity,
} from "./types.js";

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
  options: { cwd: string; detached: boolean },
) => ChildProcessWithoutNullStreams;

export type ProcessJsonlSessionOptions = {
  readonly harness: HarnessName;
  readonly cwd: string;
  readonly buildCommand: ProcessCommandBuilder;
  readonly parseEvent: ProviderEventParser;
  readonly spawnProcess?: SpawnProcess;
  readonly captureProcessIdentity?: (
    pid: number,
  ) => OwnedProcessIdentity | undefined;
};

export class ProcessJsonlSession implements HarnessSession {
  readonly #state: ProcessHarnessState = { providerSequence: 0 };
  readonly #spawnProcess: SpawnProcess;
  readonly #captureProcessIdentity: NonNullable<
    ProcessJsonlSessionOptions["captureProcessIdentity"]
  >;
  #activeTurn?: ActiveProcessTurn;
  #closed = false;
  #closePromise?: Promise<void>;

  constructor(private readonly options: ProcessJsonlSessionOptions) {
    this.#spawnProcess = options.spawnProcess ?? ((command, args, childOptions) => spawn(command, args, childOptions));
    this.#captureProcessIdentity = options.captureProcessIdentity
      ?? captureOwnedProcessIdentity;
  }

  get providerThreadId(): string | undefined {
    return this.#state.providerThreadId;
  }

  get processIdentity(): OwnedProcessIdentity | undefined {
    return this.#activeTurn?.identity;
  }

  submit(context: AdapterTurnContext): AsyncIterable<AdapterEvent> {
    if (this.#closed) {
      throw new Error("Harness session is closed.");
    }
    if (this.#activeTurn !== undefined) {
      throw new Error("Harness session already has an active turn.");
    }
    const command = this.options.buildCommand(context, this.#state);
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.#spawnProcess(command.command, command.args, {
        cwd: this.options.cwd,
        detached: process.platform !== "win32",
      });
    } catch (error) {
      throw harnessUnavailable(this.options.harness, error);
    }
    const exitPromise = waitForExit(child);
    const stderrChunks: string[] = [];
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderrChunks.push(chunk);
    });
    const lines = createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });
    if (command.input !== undefined) {
      child.stdin.end(command.input);
    } else {
      child.stdin.end();
    }
    let identity: OwnedProcessIdentity | undefined;
    try {
      identity = child.pid === undefined
        ? undefined
        : this.#captureProcessIdentity(child.pid);
    } catch (error) {
      lines.close();
      terminateUnownedSpawn(child);
      throw error;
    }
    if (
      child.pid === undefined
      || identity === undefined
      || (
        process.platform !== "win32"
        && identity.process_group_id !== child.pid
      )
    ) {
      lines.close();
      terminateUnownedSpawn(child);
      throw harnessUnavailable(
        this.options.harness,
        new Error("Could not establish owned process-group identity."),
      );
    }
    const activeTurn: ActiveProcessTurn = {
      child,
      exitPromise,
      identity,
      lines,
      stderrChunks,
      interrupted: false,
    };
    this.#activeTurn = activeTurn;
    const iterator = this.#runTurn(context, activeTurn)[Symbol.asyncIterator]();
    const firstResult = iterator.next();
    void firstResult.catch(() => {});
    return consumePrimedIterator(iterator, firstResult);
  }

  async *#runTurn(
    context: AdapterTurnContext,
    activeTurn: ActiveProcessTurn,
  ): AsyncIterable<AdapterEvent> {
    let processExitObserved = false;
    try {
      for await (const line of activeTurn.lines) {
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

      const exit = await activeTurn.exitPromise;
      processExitObserved = true;
      if (activeTurn.interrupted) {
        throw interruptedError();
      }
      if (exit.error !== undefined) {
        throw harnessUnavailable(this.options.harness, exit.error);
      }
      if (exit.code !== 0) {
        const message = activeTurn.stderrChunks.join("").trim() || `${this.options.harness} process exited ${exit.code ?? "without a code"}.`;
        const error = new Error(message);
        Object.assign(error, { code: exit.code === undefined ? "harness_failed" : "harness_process_failed" });
        throw error;
      }
    } finally {
      try {
        if (!processExitObserved) {
          await interruptActiveTurn(activeTurn);
        }
      } finally {
        if (this.#activeTurn === activeTurn) {
          this.#activeTurn = undefined;
        }
      }
    }
  }

  interrupt(): Promise<void> {
    const activeTurn = this.#activeTurn;
    if (activeTurn === undefined) {
      return Promise.resolve();
    }
    return interruptActiveTurn(activeTurn);
  }

  close(): Promise<void> {
    if (this.#closePromise === undefined) {
      this.#closed = true;
      const activeTurn = this.#activeTurn;
      this.#closePromise = activeTurn === undefined
        ? Promise.resolve()
        : interruptActiveTurn(activeTurn);
    }
    return this.#closePromise;
  }
}

type ActiveProcessTurn = {
  readonly child: ChildProcessWithoutNullStreams;
  readonly exitPromise: Promise<{
    code?: number | null;
    signal?: NodeJS.Signals | null;
    error?: Error;
  }>;
  readonly identity?: OwnedProcessIdentity;
  readonly lines: Interface;
  readonly stderrChunks: string[];
  interrupted: boolean;
};

function consumePrimedIterator<T>(
  iterator: AsyncIterator<T>,
  firstResult: Promise<IteratorResult<T>>,
): AsyncIterableIterator<T> {
  let initialResult: Promise<IteratorResult<T>> | undefined = firstResult;
  let closed = false;
  return {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next(): Promise<IteratorResult<T>> {
      if (closed) {
        return { done: true, value: undefined };
      }
      const result = initialResult === undefined
        ? await iterator.next()
        : await initialResult;
      initialResult = undefined;
      if (result.done) {
        closed = true;
      }
      return result;
    },
    async return(): Promise<IteratorResult<T>> {
      if (!closed) {
        closed = true;
        await iterator.return?.();
      }
      return { done: true, value: undefined };
    },
  };
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

async function interruptActiveTurn(activeTurn: ActiveProcessTurn): Promise<void> {
  if (!activeTurn.interrupted) {
    if (process.platform === "win32") {
      activeTurn.interrupted = true;
      activeTurn.child.kill("SIGTERM");
    } else {
      const processGroupId = activeTurn.identity?.process_group_id;
      if (processGroupId === undefined || processGroupId !== activeTurn.child.pid) {
        throw new Error("Cannot safely interrupt provider process without owned process-group identity.");
      }
      activeTurn.interrupted = true;
      try {
        process.kill(-processGroupId, "SIGTERM");
      } catch (error) {
        if (!isNodeError(error) || error.code !== "ESRCH") {
          throw error;
        }
      }
    }
  }
  await activeTurn.exitPromise;
}

function terminateUnownedSpawn(child: ChildProcessWithoutNullStreams): void {
  if (child.pid === undefined) {
    return;
  }
  try {
    if (process.platform === "win32") {
      child.kill("SIGTERM");
    } else {
      process.kill(-child.pid, "SIGTERM");
    }
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ESRCH") {
      throw error;
    }
  }
}

function interruptedError(): Error {
  const error = new Error("Harness process was interrupted.");
  Object.assign(error, { code: "harness_process_interrupted" });
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
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
