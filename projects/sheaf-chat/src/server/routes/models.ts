import type { ServerResponse } from "node:http";

import { SendJson } from "../http.js";
import type { RouteContext } from "./context.js";

export function HandleListModels(context: RouteContext, response: ServerResponse): void
{
  const models = context.agentManager.listModels();
  SendJson(response, 200, { models });
}
