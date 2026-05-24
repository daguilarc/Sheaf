import type { ToolCallSet, ToolDefinition } from "realtime-agent-lib";

import { CreateCodeReadTool } from "./codeRead.js";
import { CreateListFilesTool } from "./listFiles.js";
import { CreateModifyFileTool } from "./modifyFile.js";
import { CreateMoveVisibleRangeTool } from "./moveVisibleRange.js";
import { CreateReadVisibleRangeTool } from "./readVisibleRange.js";
import { CreateRgrepTool } from "./rgrep.js";
import { CreateSetCursorPositionTool } from "./setCursorPosition.js";
import type { EditorAccess } from "./editorAccessTypes.js";
import type { FreshnessHooks } from "./types.js";
import { NoOpFreshnessHooks } from "./types.js";
import type { ToolServices } from "./toolContext.js";

export interface BuildVscodeToolCallSetDeps
{
  editorAccess: EditorAccess;
  freshness?: FreshnessHooks;
}

export function BuildVscodeToolCallSet(deps: BuildVscodeToolCallSetDeps): ToolCallSet
{
  const freshness = deps.freshness ?? NoOpFreshnessHooks;
  const services: ToolServices = {
    editorAccess: deps.editorAccess,
    freshness,
  };

  return {
    name: "sheaf VS Code",
    tools: [
      CreateCodeReadTool(services),
      CreateListFilesTool(services),
      CreateRgrepTool(services),
      CreateReadVisibleRangeTool(services),
      CreateSetCursorPositionTool(services),
      CreateMoveVisibleRangeTool(services),
      CreateModifyFileTool(services),
    ] as ToolDefinition[],
  };
}
