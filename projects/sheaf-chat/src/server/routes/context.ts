import type { AgentManager } from "../../agents/manager.js";
import type { SheafChatConfig } from "../config.js";

export interface RouteContext
{
  config: SheafChatConfig;
  agentManager: AgentManager;
}
