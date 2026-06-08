import type { ServerResponse } from "node:http";

import { x_serviceName, x_serviceVersion } from "../constants.js";
import { SendJson } from "../http.js";
import type { RouteContext } from "./context.js";

export function HandleHealth(_context: RouteContext, response: ServerResponse): void
{
  SendJson(response, 200, {
    service: x_serviceName,
    version: x_serviceVersion,
    status: "ok",
    dependencies: {
      localInference: {
        configured:
          _context.config.localInferenceUrl !== null &&
          _context.config.localInferenceApiKey !== null,
        available: _context.config.localInferenceAvailable,
      },
      openAi: {
        configured: _context.config.openAiApiKey !== null,
      },
    },
  });
}
