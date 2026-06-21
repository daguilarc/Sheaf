import { Readable, type Writable } from "node:stream";

import {
  harnessNames,
  thinkingLevels,
  type HarnessName,
  type OutputMode,
  type ThinkingLevel,
} from "./events.js";
import { FakeHarnessAdapter } from "./adapters/fake.js";
import { createAdapter } from "./adapters/index.js";
import type { HarnessAdapter } from "./adapters/types.js";
import { listRuns, readNormalizedLog } from "./logs.js";
import { runSession } from "./runtime.js";

export type CliCommand =
  | {
      command: "run";
      harness: HarnessName;
      mode: OutputMode;
      model?: string;
      thinkingLevel?: ThinkingLevel;
      initialMessage?: string;
    }
  | { command: "list" }
  | { command: "logs"; runId: string }
  | { command: "help"; topic?: "run" };

export type CliResult = {
  readonly exitCode: number;
};

export type CliDependencies = {
  readonly createAdapter?: (harness: HarnessName) => HarnessAdapter;
};

export function parseArgs(argv: string[]): CliCommand {
  const [command, ...rest] = argv;

  if (command === undefined || command === "--help" || command === "-h") {
    return { command: "help" };
  }

  if (command === "run") {
    if (rest.length === 1 && (rest[0] === "--help" || rest[0] === "-h")) {
      return { command: "help", topic: "run" };
    }
    return parseRunArgs(rest);
  }

  if (command === "list") {
    if (rest.length !== 0) {
      throw new Error("Usage: xagent list");
    }
    return { command: "list" };
  }

  if (command === "logs") {
    if (rest.length !== 1 || rest[0] === undefined || rest[0].startsWith("--")) {
      throw new Error("Usage: xagent logs <run_id>");
    }
    return { command: "logs", runId: rest[0] };
  }

  throw new Error(usage());
}

export async function main(
  argv: string[],
  stdin: Readable,
  stdout: Writable,
  stderr: Writable,
  cwd: string,
  dependencies: CliDependencies = {},
): Promise<CliResult> {
  const command = parseArgs(argv);
  const adapterFactory = dependencies.createAdapter ?? createCliAdapter;

  if (command.command === "run") {
    return runSession({
      harness: command.harness,
      mode: command.mode,
      model: command.model,
      thinkingLevel: command.thinkingLevel,
      repoRoot: cwd,
      cwd,
      stdin: withInitialMessage(command.initialMessage, stdin),
      stdout,
      adapter: adapterFactory(command.harness),
    });
  }

  if (command.command === "help") {
    stdout.write(`${usage(command.topic)}\n`);
    return { exitCode: 0 };
  }

  if (command.command === "list") {
    const runs = await listRuns(cwd);
    stdout.write(`${JSON.stringify(runs, null, 2)}\n`);
    return { exitCode: 0 };
  }

  stdout.write(await readNormalizedLog(cwd, command.runId));
  return { exitCode: 0 };
}

function createCliAdapter(harness: HarnessName): HarnessAdapter {
  if (process.env.XAGENT_TEST_ADAPTER === "fake") {
    return new FakeHarnessAdapter({
      includeToolEvents: true,
      includeRawProvider: true,
      includeDeltas: true,
    });
  }
  return createAdapter(harness);
}

export async function runCli(
  argv: string[],
  stdin: Readable,
  stdout: Writable,
  stderr: Writable,
  cwd: string,
  dependencies: CliDependencies = {},
): Promise<CliResult> {
  try {
    return await main(argv, stdin, stdout, stderr, cwd, dependencies);
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return { exitCode: 1 };
  }
}

function parseRunArgs(argv: string[]): CliCommand {
  let harness: HarnessName | undefined;
  let model: string | undefined;
  let thinkingLevel: ThinkingLevel | undefined;
  let mode: OutputMode | undefined;
  const initialMessageParts: string[] = [];
  let positionalOnly = false;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === undefined) {
      continue;
    }

    if (positionalOnly) {
      initialMessageParts.push(flag);
      continue;
    }

    if (flag === "--") {
      positionalOnly = true;
      continue;
    }

    if (!flag.startsWith("--")) {
      initialMessageParts.push(flag);
      continue;
    }

    if (flag === "--harness") {
      if (harness !== undefined) {
        throw new Error("xagent run requires exactly one --harness value.");
      }
      const value = readFlagValue(argv, index, flag);
      assertHarness(value);
      harness = value;
      index += 1;
      continue;
    }

    if (flag === "--model") {
      if (model !== undefined) {
        throw new Error("xagent run accepts --model at most once.");
      }
      model = readFlagValue(argv, index, flag);
      index += 1;
      continue;
    }

    if (flag === "--thinking-level") {
      if (thinkingLevel !== undefined) {
        throw new Error("xagent run accepts --thinking-level at most once.");
      }
      const value = readFlagValue(argv, index, flag);
      assertThinkingLevel(value);
      thinkingLevel = value;
      index += 1;
      continue;
    }

    if (flag === "--subagent" || flag === "--full") {
      const nextMode: OutputMode = flag === "--subagent" ? "subagent" : "full";
      if (mode !== undefined) {
        throw new Error("xagent run requires exactly one verbosity mode: --subagent or --full.");
      }
      mode = nextMode;
      continue;
    }

    throw new Error(`Unsupported flag for xagent run: ${flag}.`);
  }

  if (harness === undefined) {
    throw new Error("xagent run requires --harness <codex|pi|cursor|claude_code>.");
  }

  if (mode === undefined) {
    throw new Error("xagent run requires exactly one verbosity mode: --subagent or --full.");
  }

  return {
    command: "run",
    harness,
    mode,
    model,
    thinkingLevel,
    initialMessage: initialMessageParts.length > 0 ? initialMessageParts.join(" ") : undefined,
  };
}

function readFlagValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Expected a value after ${flag}.`);
  }
  return value;
}

function assertHarness(value: string): asserts value is HarnessName {
  if (!harnessNames.includes(value as HarnessName)) {
    throw new Error(`Unsupported harness: ${value}.`);
  }
}

function assertThinkingLevel(value: string): asserts value is ThinkingLevel {
  if (!thinkingLevels.includes(value as ThinkingLevel)) {
    throw new Error(`Unsupported thinking level: ${value}.`);
  }
}

function withInitialMessage(initialMessage: string | undefined, stdin: Readable): Readable {
  if (initialMessage === undefined) {
    return stdin;
  }

  return Readable.from((async function* () {
    yield `${JSON.stringify({ type: "user.message", text: initialMessage })}\n`;
    for await (const chunk of stdin) {
      yield chunk;
    }
  })());
}

function usage(topic?: "run"): string {
  if (topic === "run") {
    return [
      "Usage:",
      "  xagent run --harness <codex|pi|cursor|claude_code> [--model <model>] [--thinking-level <low|medium|high|xhigh>] (--subagent|--full) [initial message]",
      "",
      "Reads follow-up commands from stdin as JSON Lines:",
      '  {"type":"user.message","text":"follow up"}',
      '  {"type":"control.exit"}',
      "",
      "Examples:",
      "  xagent run --harness codex --subagent \"hello\"",
      "  printf '%s\\n' '{\"type\":\"user.message\",\"text\":\"hello\"}' '{\"type\":\"control.exit\"}' | xagent run --harness codex --subagent",
      "",
      "Modes:",
      "  --subagent  Parent-agent friendly output: final text, turn lifecycle, errors, and debounced deltas.",
      "  --full      Normalized events plus sanitized raw provider events and tool details.",
    ].join("\n");
  }

  return [
    "Usage:",
    "  xagent run --harness <codex|pi|cursor|claude_code> [--model <model>] [--thinking-level <low|medium|high|xhigh>] (--subagent|--full) [initial message]",
    "  xagent list",
    "  xagent logs <run_id>",
    "",
    "Run protocol:",
    "  xagent run stays alive. Pass an optional initial message as CLI text, then send follow-ups on stdin as JSON Lines.",
    '  Supported stdin commands: {"type":"user.message","text":"..."} and {"type":"control.exit"}.',
    "",
    "Examples:",
    "  xagent run --harness codex --subagent \"hello\"",
    "  xagent run --harness claude_code --model haiku --subagent \"hello\"",
    "  xagent list",
    "  xagent logs <run_id>",
    "",
    "Use `xagent run --help` for run protocol details.",
  ].join("\n");
}
