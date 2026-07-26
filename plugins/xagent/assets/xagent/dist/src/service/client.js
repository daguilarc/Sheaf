import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { XAGENT_DEFAULT_BIND_HOST, XAGENT_DEFAULT_BIND_PORT, x_ServiceRequestTimeoutMs, } from "./config.js";
import { x_DefaultAwaitDeadlineSeconds, x_MaxAwaitDeadlineSeconds, } from "./tool_schemas.js";
export const XAGENT_DEFAULT_SERVICE_BASE_URL = `http://${XAGENT_DEFAULT_BIND_HOST}:${XAGENT_DEFAULT_BIND_PORT}`;
export class XagentServiceUnavailableError extends Error {
    structured;
    constructor(message, details) {
        super(message);
        this.name = "XagentServiceUnavailableError";
        this.structured = {
            error: "xagent_service_unavailable",
            message,
            ...(details === undefined ? {} : { details }),
        };
    }
}
export class XagentServiceToolError extends Error {
    structured;
    constructor(structured) {
        super(structured.message);
        this.name = "XagentServiceToolError";
        this.structured = structured;
    }
}
export function resolveXagentServiceBaseUrl(explicit, env = process.env) {
    const configured = explicit?.trim() || env.XAGENT_SERVICE_URL?.trim();
    if (configured !== undefined && configured.length > 0) {
        return configured.replace(/\/$/, "");
    }
    return XAGENT_DEFAULT_SERVICE_BASE_URL;
}
export function createXagentServiceClient(options = {}) {
    const baseUrl = resolveXagentServiceBaseUrl(options.baseUrl);
    const awaitHttpChunkSeconds = positiveChunkSeconds(options.awaitHttpChunkSeconds ?? x_McpAwaitHttpChunkSeconds);
    const mcpUrl = new URL("/mcp", `${baseUrl}/`);
    let client;
    let transport;
    let connectPromise;
    let closed = false;
    let lastAwaitChunksIssued = 0;
    async function ensureConnected() {
        if (closed) {
            throw new XagentServiceUnavailableError("xagent service client is closed");
        }
        if (client !== undefined) {
            return client;
        }
        if (connectPromise !== undefined) {
            return connectPromise;
        }
        connectPromise = (async () => {
            const nextClient = new Client({ name: "xagent-cli", version: "0.1.0" });
            const nextTransport = new StreamableHTTPClientTransport(mcpUrl);
            try {
                await nextClient.connect(nextTransport);
            }
            catch (error) {
                await nextTransport.close().catch(() => { });
                await nextClient.close().catch(() => { });
                connectPromise = undefined;
                throw toUnavailableError(error, baseUrl);
            }
            client = nextClient;
            transport = nextTransport;
            return nextClient;
        })();
        return connectPromise;
    }
    async function resetConnection() {
        const activeClient = client;
        const activeTransport = transport;
        client = undefined;
        transport = undefined;
        connectPromise = undefined;
        await Promise.allSettled([
            activeClient?.close() ?? Promise.resolve(),
            activeTransport?.close() ?? Promise.resolve(),
        ]);
    }
    async function callToolOnce(name, args, signal) {
        let connected;
        try {
            connected = await ensureConnected();
        }
        catch (error) {
            throw toUnavailableError(error, baseUrl);
        }
        let result;
        try {
            result = await connected.callTool({ name, arguments: args }, undefined, mcpToolRequestOptions(name, args, signal));
        }
        catch (error) {
            throw toUnavailableError(error, baseUrl);
        }
        return unpackToolResult(result);
    }
    async function callTool(name, args, signal) {
        try {
            return await callToolOnce(name, args, signal);
        }
        catch (error) {
            if (!(error instanceof XagentServiceUnavailableError) || closed) {
                throw error;
            }
            // One reconnect covers transient stream drops mid-request.
            //
            await resetConnection();
            return callToolOnce(name, args, signal);
        }
    }
    async function awaitRun(input, signal) {
        const applicationDeadlineSeconds = resolveApplicationDeadlineSeconds(input.deadline_seconds);
        const startedAtMs = Date.now();
        const applicationDeadlineMs = startedAtMs + applicationDeadlineSeconds * 1000;
        let lastDeadline;
        let consecutiveTransportFailures = 0;
        let completedChunk = false;
        let chunksIssued = 0;
        for (;;) {
            if (signal?.aborted) {
                throw abortedError();
            }
            const remainingSeconds = Math.max(0, Math.ceil((applicationDeadlineMs - Date.now()) / 1000));
            if (remainingSeconds <= 0) {
                lastAwaitChunksIssued = chunksIssued;
                return lastDeadline ?? {
                    schema_version: 1,
                    event: "supervision.deadline",
                    run_id: input.run_id,
                    sequence: input.after_sequence,
                    phase: "running",
                    elapsed_ms: applicationDeadlineSeconds * 1000,
                    reason: "await_deadline",
                };
            }
            // Keep each HTTP MCP POST under the typical fetch/undici body idle
            // timeout (~300s). The server returns a clean await_deadline for the
            // chunk; the client continues until the application deadline.
            //
            const chunkSeconds = Math.min(remainingSeconds, awaitHttpChunkSeconds);
            const chunkStartMs = Date.now();
            let result;
            try {
                result = await callToolOnce("xagent_await", {
                    run_id: input.run_id,
                    after_sequence: input.after_sequence,
                    deadline_seconds: chunkSeconds,
                }, signal);
                consecutiveTransportFailures = 0;
                completedChunk = true;
                chunksIssued += 1;
            }
            catch (error) {
                if (signal?.aborted) {
                    throw abortedError();
                }
                if (!(error instanceof XagentServiceUnavailableError) || closed) {
                    throw error;
                }
                // Fail fast when the service was never reached. Only retry after a
                // successful chunk (stream drop mid-wait), and bound those retries.
                //
                if (!completedChunk || consecutiveTransportFailures >= x_McpAwaitReconnectAttempts) {
                    throw error;
                }
                consecutiveTransportFailures += 1;
                await resetConnection();
                await delay(x_McpAwaitReconnectBackoffMs * consecutiveTransportFailures);
                if (Date.now() >= applicationDeadlineMs) {
                    throw error;
                }
                continue;
            }
            // A terminal persisted run with no wake after the cursor returns
            // `run_terminal` to signal the deadline was never reached. Return it
            // promptly — looping would busy-spin the MCP transport until the
            // application deadline (review I1).
            //
            if (result.event === "supervision.deadline"
                && result.reason === "run_terminal") {
                lastAwaitChunksIssued = chunksIssued;
                return {
                    ...result,
                    elapsed_ms: Math.max(0, Date.now() - startedAtMs),
                };
            }
            if (result.event === "supervision.deadline"
                && result.reason === "await_deadline"
                && Date.now() < applicationDeadlineMs) {
                lastDeadline = {
                    ...result,
                    elapsed_ms: Math.max(0, Date.now() - startedAtMs),
                };
                // The loop assumes each chunk consumed wall-clock server-side. That
                // holds for a live run, but a synthetic await_deadline (or any future
                // path that returns faster than requested) would otherwise busy-loop.
                // Floor the interval between chunks at the requested chunk duration
                // so the MCP transport is not hammered faster than the chunk budget
                // (review I1).
                //
                const chunkElapsedMs = Math.max(0, Date.now() - chunkStartMs);
                const targetChunkMs = chunkSeconds * 1000;
                const sleepMs = Math.max(0, targetChunkMs - chunkElapsedMs);
                const remainingApplicationMs = Math.max(0, applicationDeadlineMs - Date.now());
                const cappedSleepMs = Math.min(sleepMs, remainingApplicationMs);
                if (cappedSleepMs > 0) {
                    await delay(cappedSleepMs);
                }
                continue;
            }
            lastAwaitChunksIssued = chunksIssued;
            return result;
        }
    }
    return {
        start(input) {
            return callTool("xagent_start", { ...input });
        },
        await(input, signal) {
            return awaitRun(input, signal);
        },
        inspect(input) {
            return callTool("xagent_inspect", { ...input });
        },
        message(input) {
            return callTool("xagent_message", { ...input });
        },
        interrupt(input) {
            return callTool("xagent_interrupt", { ...input });
        },
        closeRun(input) {
            return callTool("xagent_close", { ...input });
        },
        async close() {
            closed = true;
            await resetConnection();
        },
        get awaitChunksIssued() {
            return lastAwaitChunksIssued;
        },
    };
}
function unpackToolResult(result) {
    const toolResult = result;
    const body = structuredBody(toolResult);
    if (toolResult.isError === true) {
        throw new XagentServiceToolError({
            error: typeof body.error === "string" ? body.error : "tool_failed",
            message: typeof body.message === "string" ? body.message : "xagent tool failed",
            ...(body.details === undefined ? {} : { details: body.details }),
        });
    }
    return body;
}
function structuredBody(result) {
    if (result.structuredContent !== undefined
        && result.structuredContent !== null
        && typeof result.structuredContent === "object"
        && !Array.isArray(result.structuredContent)) {
        return result.structuredContent;
    }
    if (Array.isArray(result.content)) {
        const textPart = result.content.find((part) => part.type === "text" && typeof part.text === "string");
        if (textPart?.text !== undefined) {
            return JSON.parse(textPart.text);
        }
    }
    throw new XagentServiceToolError({
        error: "tool_failed",
        message: "xagent tool returned no structured content",
    });
}
function toUnavailableError(error, baseUrl) {
    if (error instanceof XagentServiceUnavailableError) {
        return error;
    }
    const message = error instanceof Error ? error.message : String(error);
    return new XagentServiceUnavailableError(`xagent service unavailable at ${baseUrl}: ${message}`, { cause: message });
}
// MCP SDK defaults callTool requests to 60s. Node's fetch/undici stack also
// idles out bodies around 300s, which aborts a single long xagent_await POST
// with "fetch failed" while the service-owned worker keeps running. Chunk each
// MCP await under that ceiling and continue until the application deadline.
//
export const x_McpAwaitTimeoutSlackSeconds = 30;
export const x_McpAwaitHttpChunkSeconds = 240;
export const x_McpAwaitReconnectAttempts = 3;
export const x_McpAwaitReconnectBackoffMs = 250;
export function mcpToolRequestOptions(toolName, args, signal) {
    if (toolName !== "xagent_await") {
        return signal === undefined ? {} : { signal };
    }
    const deadlineSeconds = awaitDeadlineSeconds(args.deadline_seconds);
    const timeoutMs = Math.min(x_ServiceRequestTimeoutMs, (deadlineSeconds + x_McpAwaitTimeoutSlackSeconds) * 1000);
    return {
        timeout: timeoutMs,
        maxTotalTimeout: timeoutMs,
        ...(signal === undefined ? {} : { signal }),
    };
}
function awaitDeadlineSeconds(value) {
    if (typeof value === "number"
        && Number.isFinite(value)
        && value > 0
        && value <= x_MaxAwaitDeadlineSeconds) {
        return Math.floor(value);
    }
    return x_DefaultAwaitDeadlineSeconds;
}
function resolveApplicationDeadlineSeconds(value) {
    if (value === undefined) {
        return x_DefaultAwaitDeadlineSeconds;
    }
    if (typeof value !== "number"
        || !Number.isFinite(value)
        || !Number.isInteger(value)
        || value <= 0) {
        throw new XagentServiceToolError({
            error: "invalid_deadline",
            message: `deadline_seconds must be a positive integer <= ${x_MaxAwaitDeadlineSeconds}`,
            details: { deadline_seconds: value },
        });
    }
    if (value > x_MaxAwaitDeadlineSeconds) {
        throw new XagentServiceToolError({
            error: "invalid_deadline",
            message: `deadline_seconds cannot exceed ${x_MaxAwaitDeadlineSeconds}`,
            details: { deadline_seconds: value },
        });
    }
    return value;
}
function positiveChunkSeconds(value) {
    if (!Number.isFinite(value) || value <= 0) {
        return x_McpAwaitHttpChunkSeconds;
    }
    return Math.min(x_MaxAwaitDeadlineSeconds, Math.floor(value));
}
function abortedError() {
    const error = new Error("xagent await aborted");
    error.name = "AbortError";
    return error;
}
function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
//# sourceMappingURL=client.js.map