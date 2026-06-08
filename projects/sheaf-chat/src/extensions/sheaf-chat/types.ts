import type { AuditLogger, ScopedActivityEvent } from "./audit.js";
import type { RootPolicy } from "./pathPolicy.js";

export interface ScopedToolContext
{
  rootDirectory: string;
  policy: RootPolicy;
  audit: AuditLogger;
  emitActivity: (event: ScopedActivityEvent) => void;
}

export interface ToolAgentResult
{
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
  isError?: boolean;
}

export interface ScopedToolDefinition
{
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<ToolAgentResult>;
}
