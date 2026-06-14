import type { AgentManager } from "../../agents/manager.js";
import type { AgentReviewService } from "../agentReview/service.js";
import type { SheafChatConfig } from "../config.js";

export interface RouteContext
{
  config: SheafChatConfig;
  agentManager: AgentManager;
  agentReviewService?: AgentReviewService;
}
