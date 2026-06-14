import type { ServerResponse } from "node:http";

import { SendJson } from "../http.js";
import type { RouteContext } from "./context.js";

export async function HandleGetAgentReviewAvailability(
  context: RouteContext,
  pile: string,
  sessionId: string,
  response: ServerResponse,
): Promise<void>
{
  if (context.agentReviewService === undefined)
  {
    SendJson(response, 503, {
      error: {
        code: "agent_review_unavailable",
        message: "Agent Review service is not available",
      },
    });
    return;
  }

  const state = await context.agentReviewService.Availability(pile, sessionId);
  SendJson(response, 200, state);
}
