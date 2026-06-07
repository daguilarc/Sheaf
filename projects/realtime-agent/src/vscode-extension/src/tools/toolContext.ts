import type { EditorAccess } from "./editorAccessTypes.js";
import type { FreshnessHooks } from "./types.js";

export interface ToolServices
{
  editorAccess: EditorAccess;
  freshness: FreshnessHooks;
}
