import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { XAGENT_DEFAULT_BIND_HOST, XAGENT_DEFAULT_BIND_PORT, } from "./config.js";
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
    const mcpUrl = new URL("/mcp", `${baseUrl}/`);
    let client;
    let transport;
    let connectPromise;
    let closed = false;
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
    async function callTool(name, args, signal) {
        let connected;
        try {
            connected = await ensureConnected();
        }
        catch (error) {
            throw toUnavailableError(error, baseUrl);
        }
        let result;
        try {
            result = await connected.callTool({ name, arguments: args }, undefined, signal === undefined ? undefined : { signal });
        }
        catch (error) {
            throw toUnavailableError(error, baseUrl);
        }
        return unpackToolResult(result);
    }
    return {
        start(input) {
            return callTool("xagent_start", { ...input });
        },
        await(input, signal) {
            return callTool("xagent_await", { ...input }, signal);
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
            const activeClient = client;
            const activeTransport = transport;
            client = undefined;
            transport = undefined;
            connectPromise = undefined;
            await Promise.allSettled([
                activeClient?.close() ?? Promise.resolve(),
                activeTransport?.close() ?? Promise.resolve(),
            ]);
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
//# sourceMappingURL=client.js.map