import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";

import {
  BuildScopedTools,
  CreateDefaultBindings,
  CreateScopedTools,
  CreateScopedToolContext,
  x_scopedToolNames,
  type CreateScopedToolsInput,
} from "./tools/createScopedTools.js";

export {
  CreateAuditLogger,
  CreateNoopBindings,
  type AuditLogger,
  type PathEscapeAuditEvent,
  type ScopedActivityEvent,
  type ScopedToolBindings,
} from "./audit.js";
export { PathEscapeError, x_rootEscapeDeniedCode } from "./errors.js";
export {
  CreateRootPolicy,
  IsPathWithinRoot,
  ToRootRelativePathFromCanonical,
  type ResolveInputPathOptions,
  type RootPolicy,
} from "./pathPolicy.js";
export {
  AssertNoParentLeak,
  RelativizeDisplayPath,
  SanitizeToolText,
} from "./results.js";
export {
  BuildScopedTools,
  CreateDefaultBindings,
  CreateScopedToolContext,
  CreateScopedTools,
  x_scopedToolNames,
  type CreateScopedToolsInput,
} from "./tools/createScopedTools.js";
export type {
  FileChangedNotification,
  ScopedToolContext,
  ScopedToolDefinition,
  ToolAgentResult,
} from "./types.js";

export async function RegisterScopedTools(
  pi: ExtensionAPI,
  input: CreateScopedToolsInput,
): Promise<void>
{
  const { tools } = await BuildScopedTools(input);

  for (const tool of tools)
  {
    pi.registerTool({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters as TSchema,
      async execute(toolCallId, params, signal)
      {
        const result = await tool.execute(toolCallId, params as Record<string, unknown>, signal);
        return {
          content: result.content,
          details: result.details,
        };
      },
    });
  }
}

export default async function SheafChatExtension(pi: ExtensionAPI): Promise<void>
{
  const rootDirectory = process.env.SHEAF_CHAT_ROOT ?? process.cwd();
  const bindings = CreateDefaultBindings();
  await RegisterScopedTools(pi, {
    rootDirectory,
    audit: bindings.audit,
    emitActivity: bindings.emitActivity,
  });
}
