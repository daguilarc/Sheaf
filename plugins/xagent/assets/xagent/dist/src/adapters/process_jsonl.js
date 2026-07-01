import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
export class ProcessJsonlSession {
    options;
    #state = { providerSequence: 0 };
    #spawnProcess;
    constructor(options) {
        this.options = options;
        this.#spawnProcess = options.spawnProcess ?? ((command, args, childOptions) => spawn(command, args, childOptions));
    }
    get providerThreadId() {
        return this.#state.providerThreadId;
    }
    async *submit(context) {
        const command = this.options.buildCommand(context, this.#state);
        let child;
        try {
            child = this.#spawnProcess(command.command, command.args, { cwd: this.options.cwd });
        }
        catch (error) {
            throw harnessUnavailable(this.options.harness, error);
        }
        const exitPromise = waitForExit(child);
        const stderrChunks = [];
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk) => {
            stderrChunks.push(chunk);
        });
        if (command.input !== undefined) {
            child.stdin.end(command.input);
        }
        else {
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
    async close() { }
}
export async function assertCommandAvailable(command, harness) {
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
        }
        catch {
            // Keep looking through PATH.
        }
    }
    throw unavailableError(harness, `${command} was not found on PATH.`);
}
function parseProviderLine(line) {
    try {
        return JSON.parse(line);
    }
    catch {
        return { type: "text", text: line };
    }
}
function isProviderText(value) {
    return isRecord(value) && value.type === "text" && typeof value.text === "string";
}
function waitForExit(child) {
    return new Promise((resolve) => {
        let childError;
        child.once("error", (error) => {
            childError = error;
        });
        child.once("close", (code, signal) => {
            resolve({ code, signal, error: childError });
        });
    });
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function harnessUnavailable(harness, error) {
    const detail = error instanceof Error ? error.message : String(error);
    return unavailableError(harness, detail);
}
async function assertExecutable(command, harness) {
    try {
        await access(command, fsConstants.X_OK);
    }
    catch {
        throw unavailableError(harness, `${command} is not executable.`);
    }
}
function unavailableError(harness, detail) {
    const unavailable = new Error(`${harness} harness is unavailable: ${detail}`);
    Object.assign(unavailable, { code: "harness_unavailable" });
    return unavailable;
}
//# sourceMappingURL=process_jsonl.js.map