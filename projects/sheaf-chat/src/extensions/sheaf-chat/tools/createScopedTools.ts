import { CreateAuditLogger } from "../audit.js";
import { CreateRootPolicy } from "../pathPolicy.js";
import type { ScopedToolBindings } from "../audit.js";
import type { FileChangedNotification, ScopedToolContext, ScopedToolDefinition } from "../types.js";
import { CreateEditTool } from "./edit.js";
import { CreateFileInfoTool } from "./fileInfo.js";
import { CreateFindFilesTool } from "./findFiles.js";
import { CreateListTool } from "./list.js";
import { CreateReadTool } from "./read.js";
import { CreateSearchTextTool } from "./searchText.js";
import { CreateTreeTool } from "./tree.js";
import { CreateWriteTool } from "./write.js";

export const x_scopedToolNames = [
  "read",
  "write",
  "edit",
  "list",
  "tree",
  "find_files",
  "search_text",
  "file_info",
] as const;

export interface CreateScopedToolsInput
{
  rootDirectory: string;
  audit: ScopedToolBindings["audit"];
  emitActivity: ScopedToolBindings["emitActivity"];
  notifyFileChanged?: (event: FileChangedNotification) => void | Promise<void>;
}

export async function CreateScopedToolContext(
  input: CreateScopedToolsInput,
): Promise<ScopedToolContext>
{
  const policy = await CreateRootPolicy(input.rootDirectory);

  return {
    rootDirectory: input.rootDirectory,
    policy,
    audit: input.audit,
    emitActivity: input.emitActivity,
    notifyFileChanged: input.notifyFileChanged,
  };
}

export function CreateScopedTools(context: ScopedToolContext): ScopedToolDefinition[]
{
  return [
    CreateReadTool(context),
    CreateWriteTool(context),
    CreateEditTool(context),
    CreateListTool(context),
    CreateTreeTool(context),
    CreateFindFilesTool(context),
    CreateSearchTextTool(context),
    CreateFileInfoTool(context),
  ];
}

export async function BuildScopedTools(
  input: CreateScopedToolsInput,
): Promise<{ context: ScopedToolContext; tools: ScopedToolDefinition[] }>
{
  const context = await CreateScopedToolContext(input);
  return {
    context,
    tools: CreateScopedTools(context),
  };
}

export function CreateDefaultBindings(
  emitActivity: ScopedToolBindings["emitActivity"] = () => {},
): ScopedToolBindings
{
  return {
    audit: CreateAuditLogger({ emitActivity }),
    emitActivity,
  };
}
