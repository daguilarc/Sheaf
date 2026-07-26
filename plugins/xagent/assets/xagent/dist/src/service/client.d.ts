import type { AwaitRunResult, CloseRunResult, InspectRunResult, InterruptRunResult, MessageRunResult, StartRunResult } from "./run_manager.js";
import type { StructuredToolError, XagentAwaitInput, XagentCloseInput, XagentInspectInput, XagentInterruptInput, XagentMessageInput, XagentStartInput } from "./tool_schemas.js";
export declare const XAGENT_DEFAULT_SERVICE_BASE_URL = "http://127.0.0.1:9005";
export type XagentServiceClientOptions = {
    readonly baseUrl?: string;
    readonly awaitHttpChunkSeconds?: number;
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
export declare class XagentServiceUnavailableError extends Error {
    readonly structured: StructuredToolError;
    constructor(message: string, details?: unknown);
}
export declare class XagentServiceToolError extends Error {
    readonly structured: StructuredToolError;
    constructor(structured: StructuredToolError);
}
export declare function resolveXagentServiceBaseUrl(explicit?: string, env?: NodeJS.ProcessEnv): string;
export declare function createXagentServiceClient(options?: XagentServiceClientOptions): XagentServiceClient;
export declare const x_McpAwaitTimeoutSlackSeconds = 30;
export declare const x_McpAwaitHttpChunkSeconds = 240;
export declare const x_McpAwaitReconnectAttempts = 3;
export declare const x_McpAwaitReconnectBackoffMs = 250;
export type McpToolRequestOptions = {
    readonly timeout?: number;
    readonly maxTotalTimeout?: number;
    readonly signal?: AbortSignal;
};
export declare function mcpToolRequestOptions(toolName: string, args: Record<string, unknown>, signal?: AbortSignal): McpToolRequestOptions;
//# sourceMappingURL=client.d.ts.map