import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { harnessNames, thinkingLevels, } from "./events.js";
import { FakeHarnessAdapter } from "./adapters/fake.js";
import { createAdapter } from "./adapters/index.js";
import { getDefaultLogRoot, listRuns, readNormalizedLog } from "./logs.js";
import { runSession } from "./runtime.js";
export function parseArgs(argv) {
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
export async function main(argv, stdin, stdout, stderr, cwd, dependencies = {}) {
    const command = parseArgs(argv);
    const adapterFactory = dependencies.createAdapter ?? createCliAdapter;
    const logRoot = await resolveLogRoot(cwd);
    if (command.command === "run") {
        return runSession({
            harness: command.harness,
            mode: command.mode,
            model: command.model,
            thinkingLevel: command.thinkingLevel,
            permissionMode: command.permissionMode,
            repoRoot: cwd,
            logRoot,
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
        const runs = await listRuns(logRoot);
        stdout.write(`${JSON.stringify(runs, null, 2)}\n`);
        return { exitCode: 0 };
    }
    stdout.write(await readNormalizedLog(logRoot, command.runId));
    return { exitCode: 0 };
}
async function resolveLogRoot(cwd) {
    const configured = process.env.XAGENT_LOG_ROOT?.trim();
    if (configured !== undefined && configured.length > 0) {
        return path.resolve(configured);
    }
    return getDefaultLogRoot(await findRepoRoot(cwd));
}
async function findRepoRoot(cwd) {
    let current = path.resolve(cwd);
    while (true) {
        if (await pathExists(path.join(current, ".git"))) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return path.resolve(cwd);
        }
        current = parent;
    }
}
async function pathExists(candidate) {
    try {
        await stat(candidate);
        return true;
    }
    catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}
function createCliAdapter(harness) {
    if (process.env.XAGENT_TEST_ADAPTER === "fake") {
        return new FakeHarnessAdapter({
            includeToolEvents: true,
            includeRawProvider: true,
            includeDeltas: true,
        });
    }
    return createAdapter(harness);
}
export async function runCli(argv, stdin, stdout, stderr, cwd, dependencies = {}) {
    try {
        return await main(argv, stdin, stdout, stderr, cwd, dependencies);
    }
    catch (error) {
        stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        return { exitCode: 1 };
    }
}
function parseRunArgs(argv) {
    let harness;
    let model;
    let thinkingLevel;
    let permissionMode;
    let mode;
    const initialMessageParts = [];
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
        if (flag === "--permission-mode") {
            if (permissionMode !== undefined) {
                throw new Error("xagent run accepts --permission-mode at most once.");
            }
            permissionMode = readFlagValue(argv, index, flag);
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
            const nextMode = flag === "--subagent" ? "subagent" : "full";
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
        ...(permissionMode === undefined ? {} : { permissionMode }),
        initialMessage: initialMessageParts.length > 0 ? initialMessageParts.join(" ") : undefined,
    };
}
function readFlagValue(argv, index, flag) {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
        throw new Error(`Expected a value after ${flag}.`);
    }
    return value;
}
function assertHarness(value) {
    if (!harnessNames.includes(value)) {
        throw new Error(`Unsupported harness: ${value}.`);
    }
}
function assertThinkingLevel(value) {
    if (!thinkingLevels.includes(value)) {
        throw new Error(`Unsupported thinking level: ${value}.`);
    }
}
function withInitialMessage(initialMessage, stdin) {
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
function usage(topic) {
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
//# sourceMappingURL=cli.js.map