import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import {
  XAGENT_DEFAULT_BIND_HOST,
  XAGENT_DEFAULT_BIND_PORT,
} from "./config.js";
import type {
  AwaitRunResult,
  CloseRunResult,
  InspectRunResult,
  InterruptRunResult,
  MessageRunResult,
  StartRunResult,
} from "./run_manager.js";
import { x_ServiceRequestTimeoutMs } from "./server.js";
import type {
  StructuredToolError,
  XagentAwaitInput,
  XagentCloseInput,
  XagentInspectInput,
  XagentInterruptInput,
  XagentMessageInput,
  XagentStartInput,
} from "./tool_schemas.js";
import {
  x_DefaultAwaitDeadlineSeconds,
  x_MaxAwaitDeadlineSeconds,
} from "./tool_schemas.js";

export const XAGENT_DEFAULT_SERVICE_BASE_URL =
  `http://${XAGENT_DEFAULT_BIND_HOST}:${XAGENT_DEFAULT_BIND_PORT}`;

export type XagentServiceClientOptions = {
  readonly baseUrl?: string;
};

export type XagentServiceClient = {
  start(input: XagentStartInput): Promise<StartRunResult>;
  await(input: XagentAwaitInput, signal?: AbortSignal): Promise<AwaitRunResult>;
  inspect(input: XagentInspectInput): Promise<InspectRunResult>;
  message(input: XagentMessageInput): Promise<MessageRunResult>;
  interrupt(input: XagentInterruptInput): Promise<InterruptRunResult>;
  closeRun(input: XagentCloseInput): Promise<CloseRunResult>;
  close(): Promise<void>;
};

export class XagentServiceUnavailableError extends Error {
  readonly structured: StructuredToolError;

  constructor(message: string, details?: unknown) {
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
  readonly structured: StructuredToolError;

  constructor(structured: StructuredToolError) {
    super(structured.message);
    this.name = "XagentServiceToolError";
    this.structured = structured;
  }
}

export function resolveXagentServiceBaseUrl(
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = explicit?.trim() || env.XAGENT_SERVICE_URL?.trim();
  if (configured !== undefined && configured.length > 0) {
    return configured.replace(/\/$/, "");
  }
  return XAGENT_DEFAULT_SERVICE_BASE_URL;
}

export function createXagentServiceClient(
  options: XagentServiceClientOptions = {},
): XagentServiceClient {
  const baseUrl = resolveXagentServiceBaseUrl(options.baseUrl);
  const mcpUrl = new URL("/mcp", `${baseUrl}/`);
  let client: Client | undefined;
  let transport: StreamableHTTPClientTransport | undefined;
  let connectPromise: Promise<Client> | undefined;
  let closed = false;

  async function ensureConnected(): Promise<Client> {
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
      } catch (error) {
        await nextTransport.close().catch(() => {});
        await nextClient.close().catch(() => {});
        connectPromise = undefined;
        throw toUnavailableError(error, baseUrl);
      }
      client = nextClient;
      transport = nextTransport;
      return nextClient;
    })();
    return connectPromise;
  }

  async function callTool<T>(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    let connected: Client;
    try {
      connected = await ensureConnected();
    } catch (error) {
      throw toUnavailableError(error, baseUrl);
    }

    let result: unknown;
    try {
      result = await connected.callTool(
        { name, arguments: args },
        undefined,
        mcpToolRequestOptions(name, args, signal),
      );
    } catch (error) {
      throw toUnavailableError(error, baseUrl);
    }

    return unpackToolResult<T>(result);
  }

  return {
    start(input) {
      return callTool<StartRunResult>("xagent_start", { ...input });
    },
    await(input, signal) {
      return callTool<AwaitRunResult>("xagent_await", { ...input }, signal);
    },
    inspect(input) {
      return callTool<InspectRunResult>("xagent_inspect", { ...input });
    },
    message(input) {
      return callTool<MessageRunResult>("xagent_message", { ...input });
    },
    interrupt(input) {
      return callTool<InterruptRunResult>("xagent_interrupt", { ...input });
    },
    closeRun(input) {
      return callTool<CloseRunResult>("xagent_close", { ...input });
    },
    async close(): Promise<void> {
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

function unpackToolResult<T>(result: unknown): T {
  const toolResult = result as {
    readonly isError?: boolean;
    readonly structuredContent?: unknown;
    readonly content?: unknown;
  };
  const body = structuredBody(toolResult);
  if (toolResult.isError === true) {
    throw new XagentServiceToolError({
      error: typeof body.error === "string" ? body.error : "tool_failed",
      message: typeof body.message === "string" ? body.message : "xagent tool failed",
      ...(body.details === undefined ? {} : { details: body.details }),
    });
  }
  return body as T;
}

function structuredBody(result: {
  readonly structuredContent?: unknown;
  readonly content?: unknown;
}): Record<string, unknown> {
  if (
    result.structuredContent !== undefined
    && result.structuredContent !== null
    && typeof result.structuredContent === "object"
    && !Array.isArray(result.structuredContent)
  ) {
    return result.structuredContent as Record<string, unknown>;
  }
  if (Array.isArray(result.content)) {
    const textPart = (result.content as Array<{ type?: string; text?: string }>).find(
      (part) => part.type === "text" && typeof part.text === "string",
    );
    if (textPart?.text !== undefined) {
      return JSON.parse(textPart.text) as Record<string, unknown>;
    }
  }
  throw new XagentServiceToolError({
    error: "tool_failed",
    message: "xagent tool returned no structured content",
  });
}

function toUnavailableError(error: unknown, baseUrl: string): XagentServiceUnavailableError {
  if (error instanceof XagentServiceUnavailableError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new XagentServiceUnavailableError(
    `xagent service unavailable at ${baseUrl}: ${message}`,
    { cause: message },
  );
}

// MCP SDK defaults callTool requests to 60s. xagent_await must survive the full
// application deadline (up to 7000s) within the service's 7200s HTTP lifetime.
//
export const x_McpAwaitTimeoutSlackSeconds = 30;

export type McpToolRequestOptions = {
  readonly timeout?: number;
  readonly maxTotalTimeout?: number;
  readonly signal?: AbortSignal;
};

export function mcpToolRequestOptions(
  toolName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): McpToolRequestOptions {
  if (toolName !== "xagent_await") {
    return signal === undefined ? {} : { signal };
  }
  const deadlineSeconds = awaitDeadlineSeconds(args.deadline_seconds);
  const timeoutMs = Math.min(
    x_ServiceRequestTimeoutMs,
    (deadlineSeconds + x_McpAwaitTimeoutSlackSeconds) * 1000,
  );
  return {
    timeout: timeoutMs,
    maxTotalTimeout: timeoutMs,
    ...(signal === undefined ? {} : { signal }),
  };
}

function awaitDeadlineSeconds(value: unknown): number {
  if (
    typeof value === "number"
    && Number.isFinite(value)
    && value > 0
    && value <= x_MaxAwaitDeadlineSeconds
  ) {
    return Math.floor(value);
  }
  return x_DefaultAwaitDeadlineSeconds;
}
