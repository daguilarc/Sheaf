import { spawn as nodeSpawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { truncateUtf8 } from "../sanitize.js";
import { normalizeWatchdogVerdict } from "./watchdog.js";
const DEFAULT_INPUT_LIMIT_BYTES = 64 * 1024;
const DEFAULT_OUTPUT_LIMIT_BYTES = 2 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const HAIKU_INPUT_USD_PER_MILLION_TOKENS = 1;
const HAIKU_OUTPUT_USD_PER_MILLION_TOKENS = 5;
const CLAUDE_CODE_OVERHEAD_RESERVE_USD = 0.02;
const WATCHDOG_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
        verdict: {
            type: "string",
            enum: ["healthy", "derailed", "uncertain"],
        },
        confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
        },
        reason_code: {
            type: "string",
            minLength: 1,
            maxLength: 128,
            pattern: "^[a-z0-9_]+$",
        },
        evidence: {
            type: "array",
            maxItems: 8,
            items: {
                type: "string",
                maxLength: 512,
            },
        },
    },
    required: ["verdict", "confidence", "reason_code", "evidence"],
};
export const WATCHDOG_SCHEMA_JSON = JSON.stringify(WATCHDOG_SCHEMA);
const WATCHDOG_SYSTEM_PROMPT = [
    "Classify only the semantic health of the active worker from the supplied sanitized JSON evidence.",
    "Return healthy, derailed, or uncertain using the required schema.",
    "Evidence entries must be short factual observations already supported by the input.",
    "Do not provide commands, remediation, controller actions, or instructions to the worker.",
    "Use uncertain whenever the bounded evidence cannot establish semantic health.",
].join(" ");
export class ClaudeWatchdogClassifier {
    #spawn;
    #inputLimitBytes;
    #outputLimitBytes;
    #timeoutMs;
    #maxBudgetUsd;
    #confidenceFloor;
    constructor(options = {}) {
        this.#spawn = options.spawn ?? spawnWatchdogProcess;
        this.#inputLimitBytes = boundedPositiveInteger(options.inputLimitBytes ?? DEFAULT_INPUT_LIMIT_BYTES, DEFAULT_INPUT_LIMIT_BYTES, "inputLimitBytes");
        this.#outputLimitBytes = boundedPositiveInteger(options.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES, DEFAULT_OUTPUT_LIMIT_BYTES, "outputLimitBytes");
        this.#timeoutMs = positiveNumber(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs");
        const minimumBudget = minimumWatchdogBudgetUsd(this.#inputLimitBytes, this.#outputLimitBytes);
        this.#maxBudgetUsd = positiveNumber(options.maxBudgetUsd ?? minimumBudget, "maxBudgetUsd");
        if (this.#maxBudgetUsd < minimumBudget) {
            throw new Error(`maxBudgetUsd must be at least ${minimumBudget}.`);
        }
        this.#confidenceFloor = confidence(options.confidenceFloor ?? 0.8);
    }
    async classify(request, signal) {
        const input = JSON.stringify(request);
        if (Buffer.byteLength(input, "utf8") > this.#inputLimitBytes) {
            return uncertain("classifier_input_too_large");
        }
        const cwd = await mkdtemp(path.join(tmpdir(), "xagent-watchdog-"));
        try {
            let result;
            try {
                result = await this.#spawn({
                    command: "claude",
                    args: [
                        "--print",
                        "--model",
                        "haiku",
                        "--safe-mode",
                        "--tools",
                        "",
                        "--strict-mcp-config",
                        "--no-session-persistence",
                        "--output-format",
                        "json",
                        "--json-schema",
                        WATCHDOG_SCHEMA_JSON,
                        "--mcp-config",
                        '{"mcpServers":{}}',
                        "--max-budget-usd",
                        String(this.#maxBudgetUsd),
                        "--system-prompt",
                        WATCHDOG_SYSTEM_PROMPT,
                    ],
                    cwd,
                    input,
                    timeoutMs: this.#timeoutMs,
                    outputLimitBytes: this.#outputLimitBytes,
                    signal,
                });
            }
            catch {
                return uncertain("classifier_invocation_failed");
            }
            const outputBytes = Buffer.byteLength(result.stdout, "utf8");
            if (result.aborted === true) {
                return withOutput(uncertain("classifier_aborted"), outputBytes);
            }
            if (result.timedOut === true) {
                return withOutput(uncertain("classifier_timeout"), outputBytes);
            }
            if (result.outputTooLarge === true
                || outputBytes > this.#outputLimitBytes) {
                return withOutput(uncertain("classifier_output_too_large"), outputBytes);
            }
            if (result.budgetExceeded === true) {
                return withOutput(uncertain("classifier_budget_exceeded"), outputBytes);
            }
            if (result.exitCode !== 0) {
                return withOutput(uncertain("classifier_invocation_failed"), outputBytes);
            }
            let envelope;
            try {
                envelope = JSON.parse(result.stdout);
            }
            catch {
                return withOutput(uncertain("invalid_classifier_output"), outputBytes);
            }
            if (!isRecord(envelope)) {
                return withOutput(uncertain("invalid_classifier_output"), outputBytes);
            }
            if (envelope.subtype === "error_max_budget_usd") {
                return withOutput(uncertain("classifier_budget_exceeded"), outputBytes);
            }
            const candidate = structuredOutput(envelope);
            const verdict = normalizeWatchdogVerdict(candidate, this.#confidenceFloor);
            const usage = watchdogUsage(envelope.usage);
            const estimatedCost = finiteNonNegative(envelope.total_cost_usd);
            return {
                ...verdict,
                output_bytes: outputBytes,
                ...(usage === undefined ? {} : { usage }),
                ...(estimatedCost === undefined
                    ? {}
                    : { estimated_cost_usd: estimatedCost }),
            };
        }
        finally {
            await rm(cwd, { recursive: true, force: true });
        }
    }
}
export function minimumWatchdogBudgetUsd(inputLimitBytes, outputLimitBytes) {
    const inputBytes = nonNegativeSafeInteger(inputLimitBytes, "inputLimitBytes");
    const outputBytes = nonNegativeSafeInteger(outputLimitBytes, "outputLimitBytes");
    // One token per bounded UTF-8 byte is deliberately conservative for the
    // request/response payload. The fixed reserve covers Claude Code's safe-mode
    // system/schema prompt outside that byte envelope.
    const envelopeCost = inputBytes * HAIKU_INPUT_USD_PER_MILLION_TOKENS / 1_000_000
        + outputBytes * HAIKU_OUTPUT_USD_PER_MILLION_TOKENS / 1_000_000;
    return roundUpCents(envelopeCost + CLAUDE_CODE_OVERHEAD_RESERVE_USD);
}
export function maximumWatchdogRunExposureUsd(maxBudgetUsd, maximumCalls) {
    const budget = positiveNumber(maxBudgetUsd, "maxBudgetUsd");
    const calls = nonNegativeSafeInteger(maximumCalls, "maximumCalls");
    return Math.round(budget * calls * 100) / 100;
}
export const spawnWatchdogProcess = async (request) => new Promise((resolve, reject) => {
    const child = nodeSpawn(request.command, [...request.args], {
        cwd: request.cwd,
        stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let outputTooLarge = false;
    let timedOut = false;
    let aborted = false;
    let settled = false;
    const finish = (result) => {
        if (settled) {
            return;
        }
        settled = true;
        clearTimeout(timer);
        request.signal.removeEventListener("abort", onAbort);
        resolve(result);
    };
    const terminate = () => {
        if (!child.killed) {
            child.kill("SIGKILL");
        }
    };
    const timer = setTimeout(() => {
        timedOut = true;
        terminate();
    }, request.timeoutMs);
    const onAbort = () => {
        aborted = true;
        terminate();
    };
    request.signal.addEventListener("abort", onAbort, { once: true });
    if (request.signal.aborted) {
        onAbort();
    }
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
        if (outputTooLarge) {
            return;
        }
        const combined = `${stdout}${chunk}`;
        if (Buffer.byteLength(combined, "utf8") > request.outputLimitBytes) {
            outputTooLarge = true;
            stdout = truncateUtf8(combined, request.outputLimitBytes + 1);
            terminate();
            return;
        }
        stdout = combined;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
        stderr = Buffer.from(`${stderr}${chunk}`, "utf8")
            .subarray(0, request.outputLimitBytes)
            .toString("utf8");
    });
    child.once("error", (error) => {
        if (settled) {
            return;
        }
        settled = true;
        clearTimeout(timer);
        request.signal.removeEventListener("abort", onAbort);
        reject(error);
    });
    child.once("close", (exitCode) => {
        finish({
            exitCode,
            stdout,
            stderr,
            timedOut,
            outputTooLarge,
            aborted,
        });
    });
    child.stdin.end(request.input);
});
function structuredOutput(envelope) {
    if (envelope.structured_output !== undefined) {
        return envelope.structured_output;
    }
    if (typeof envelope.result === "string") {
        try {
            return JSON.parse(envelope.result);
        }
        catch {
            return undefined;
        }
    }
    return envelope;
}
function watchdogUsage(value) {
    if (!isRecord(value)) {
        return undefined;
    }
    const inputTokens = finiteNonNegative(value.input_tokens);
    const outputTokens = finiteNonNegative(value.output_tokens);
    if (inputTokens === undefined && outputTokens === undefined) {
        return undefined;
    }
    return {
        ...(inputTokens === undefined ? {} : { input_tokens: inputTokens }),
        ...(outputTokens === undefined ? {} : { output_tokens: outputTokens }),
    };
}
function finiteNonNegative(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0
        ? value
        : undefined;
}
function withOutput(verdict, outputBytes) {
    return { ...verdict, output_bytes: outputBytes };
}
function uncertain(reasonCode) {
    return {
        verdict: "uncertain",
        confidence: 0,
        reason_code: reasonCode,
        evidence: [],
    };
}
function boundedPositiveInteger(value, maximum, name) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
        throw new Error(`${name} must be a positive integer no greater than ${maximum}.`);
    }
    return value;
}
function positiveNumber(value, name) {
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`${name} must be a positive finite number.`);
    }
    return value;
}
function nonNegativeSafeInteger(value, name) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${name} must be a non-negative safe integer.`);
    }
    return value;
}
function roundUpCents(value) {
    return Math.ceil((value - Number.EPSILON) * 100) / 100;
}
function confidence(value) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error("confidenceFloor must be between 0 and 1.");
    }
    return value;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=claude_watchdog.js.map