import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { captureOwnedProcessIdentity } from "../supervision/process_identity.js";
const DEFAULT_TERMINATION_GRACE_MS = 5_000;
export class ProcessJsonlSession {
    options;
    #state;
    #spawnProcess;
    #captureProcessIdentity;
    #terminationGraceMs;
    #activeTurn;
    #closed = false;
    #closePromise;
    constructor(options) {
        this.options = options;
        this.#state = {
            providerSequence: 0,
            ...(options.initialProviderThreadId === undefined
                ? {}
                : { providerThreadId: options.initialProviderThreadId }),
        };
        this.#spawnProcess = options.spawnProcess ?? ((command, args, childOptions) => spawn(command, args, childOptions));
        this.#captureProcessIdentity = options.captureProcessIdentity
            ?? captureOwnedProcessIdentity;
        this.#terminationGraceMs = validateTerminationGrace(options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS);
    }
    get providerThreadId() {
        return this.#state.providerThreadId;
    }
    get processIdentity() {
        return this.#activeTurn?.identity;
    }
    submit(context) {
        if (this.#closed) {
            throw new Error("Harness session is closed.");
        }
        if (this.#activeTurn !== undefined) {
            throw new Error("Harness session already has an active turn.");
        }
        const command = this.options.buildCommand(context, this.#state);
        let child;
        try {
            child = this.#spawnProcess(command.command, command.args, {
                cwd: this.options.cwd,
                detached: process.platform !== "win32",
            });
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
        const lines = createInterface({
            input: child.stdout,
            crlfDelay: Infinity,
        });
        if (command.input !== undefined) {
            attachStdinErrorHandler(child.stdin);
            child.stdin.end(command.input);
        }
        else {
            attachStdinErrorHandler(child.stdin);
            child.stdin.end();
        }
        let identity;
        try {
            identity = child.pid === undefined
                ? undefined
                : this.#captureProcessIdentity(child.pid);
        }
        catch (error) {
            lines.close();
            terminateUnownedSpawn(child);
            throw error;
        }
        if (child.pid === undefined
            || identity === undefined
            || (process.platform !== "win32"
                && identity.process_group_id !== child.pid)) {
            lines.close();
            terminateUnownedSpawn(child);
            throw harnessUnavailable(this.options.harness, new Error("Could not establish owned process-group identity."));
        }
        const activeTurn = {
            child,
            exitPromise,
            identity,
            lines,
            stderrChunks,
            terminationGraceMs: this.#terminationGraceMs,
            interrupted: false,
        };
        this.#activeTurn = activeTurn;
        const iterator = this.#runTurn(context, activeTurn)[Symbol.asyncIterator]();
        const firstResult = iterator.next();
        void firstResult.catch(() => { });
        return consumePrimedIterator(iterator, firstResult, () => interruptActiveTurn(activeTurn), activeTurn.terminationGraceMs);
    }
    async *#runTurn(context, activeTurn) {
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
                const exitCode = exit.code ?? null;
                const signal = exit.signal ?? null;
                const message = activeTurn.stderrChunks.join("").trim()
                    || processExitMessage(this.options.harness, exitCode, signal);
                yield {
                    type: "error",
                    code: "process_exit",
                    message,
                    details: { exit_code: exitCode, signal },
                    recoverable: false,
                };
                return;
            }
        }
        finally {
            try {
                if (!processExitObserved) {
                    await interruptActiveTurn(activeTurn);
                }
            }
            finally {
                if (this.#activeTurn === activeTurn) {
                    this.#activeTurn = undefined;
                }
            }
        }
    }
    interrupt() {
        const activeTurn = this.#activeTurn;
        if (activeTurn === undefined) {
            return Promise.resolve();
        }
        return interruptActiveTurn(activeTurn);
    }
    close() {
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
function consumePrimedIterator(iterator, firstResult, interrupt, cleanupWaitMs) {
    let initialResult = firstResult;
    let closed = false;
    return {
        [Symbol.asyncIterator]() {
            return this;
        },
        async next() {
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
        async return() {
            if (!closed) {
                closed = true;
                const iteratorReturn = iterator.return?.();
                void iteratorReturn?.catch(() => { });
                await interrupt();
                if (iteratorReturn !== undefined) {
                    await promiseWithin(iteratorReturn, cleanupWaitMs, "Provider iterator did not settle after process cleanup.");
                }
            }
            return { done: true, value: undefined };
        },
    };
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
function interruptActiveTurn(activeTurn) {
    if (activeTurn.cleanupPromise === undefined) {
        activeTurn.cleanupPromise = terminateActiveTurn(activeTurn);
    }
    return activeTurn.cleanupPromise;
}
async function terminateActiveTurn(activeTurn) {
    activeTurn.interrupted = true;
    signalActiveTurn(activeTurn, "SIGTERM");
    if (await exitWithin(activeTurn.exitPromise, activeTurn.terminationGraceMs)) {
        return;
    }
    signalActiveTurn(activeTurn, "SIGKILL");
    if (await exitWithin(activeTurn.exitPromise, activeTurn.terminationGraceMs)) {
        return;
    }
    const error = new Error("Provider process did not exit after SIGTERM and SIGKILL.");
    Object.assign(error, { code: "harness_process_cleanup_timeout" });
    throw error;
}
function signalActiveTurn(activeTurn, signal) {
    if (process.platform === "win32") {
        activeTurn.child.kill(signal);
        return;
    }
    const processGroupId = activeTurn.identity?.process_group_id;
    if (processGroupId === undefined || processGroupId !== activeTurn.child.pid) {
        throw new Error("Cannot safely interrupt provider process without owned process-group identity.");
    }
    try {
        process.kill(-processGroupId, signal);
    }
    catch (error) {
        if (!isNodeError(error) || error.code !== "ESRCH") {
            throw error;
        }
    }
}
function exitWithin(exitPromise, timeoutMs) {
    return new Promise((resolve) => {
        let settled = false;
        const timeout = setTimeout(() => {
            if (!settled) {
                settled = true;
                resolve(false);
            }
        }, timeoutMs);
        timeout.unref();
        void exitPromise.then(() => {
            if (!settled) {
                settled = true;
                clearTimeout(timeout);
                resolve(true);
            }
        });
    });
}
async function promiseWithin(promise, timeoutMs, message) {
    let timeout;
    const deadline = new Promise((_resolve, reject) => {
        timeout = setTimeout(() => {
            const error = new Error(message);
            Object.assign(error, { code: "harness_process_cleanup_timeout" });
            reject(error);
        }, timeoutMs);
        timeout.unref();
    });
    try {
        return await Promise.race([promise, deadline]);
    }
    finally {
        if (timeout !== undefined) {
            clearTimeout(timeout);
        }
    }
}
function validateTerminationGrace(value) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error("Process termination grace must be a positive integer.");
    }
    return value;
}
function terminateUnownedSpawn(child) {
    if (child.pid === undefined) {
        return;
    }
    try {
        if (process.platform === "win32") {
            child.kill("SIGTERM");
        }
        else {
            process.kill(-child.pid, "SIGTERM");
        }
    }
    catch (error) {
        if (!isNodeError(error) || error.code !== "ESRCH") {
            throw error;
        }
    }
}
// The provider can be interrupted (SIGTERM/SIGKILL) while a stdin write is
// still buffered. When that happens Node emits `error` on the Socket — not
// on the ChildProcess — and an unhandled stream error would crash the
// entire xagent service. Swallow stdin errors here; the active turn's
// interrupt path already records the failure outcome.
//
function attachStdinErrorHandler(stdin) {
    stdin.on("error", () => {
        // Intentionally empty: see comment above.
        //
    });
}
function interruptedError() {
    const error = new Error("Harness process was interrupted.");
    Object.assign(error, { code: "harness_process_interrupted" });
    return error;
}
function processExitMessage(harness, exitCode, signal) {
    if (exitCode !== null) {
        return `${harness} process exited with code ${exitCode}.`;
    }
    if (signal !== null) {
        return `${harness} process exited from signal ${signal}.`;
    }
    return `${harness} process exited without a code.`;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isNodeError(error) {
    return error instanceof Error;
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