import type { ServerResponse } from "node:http";

import { eventsToSnapshots } from "../../agui/snapshots.js";
import type { AguiEvent } from "../../agui/types.js";
import type { HistoryPageRequest } from "../../shared/types.js";
import { ReadHistoryPage } from "../../storage/history.js";
import { StorageError } from "../../storage/errors.js";
import { ParseOptionalInteger, SendJson } from "../http.js";
import type { RouteContext } from "./context.js";

function ParseHistoryQuery(searchParams: URLSearchParams): HistoryPageRequest
{
  const request: HistoryPageRequest = {};
  const before = ParseOptionalInteger(searchParams.get("before"), "before");
  const after = ParseOptionalInteger(searchParams.get("after"), "after");
  const limit = ParseOptionalInteger(searchParams.get("limit"), "limit");
  const prefer = searchParams.get("prefer");

  if (before !== undefined)
  {
    request.before = before;
  }

  if (after !== undefined)
  {
    request.after = after;
  }

  if (limit !== undefined)
  {
    request.limit = limit;
  }

  if (prefer === "events" || prefer === "snapshots")
  {
    request.prefer = prefer;
  }
  else if (prefer !== null && prefer.length > 0)
  {
    throw new StorageError(
      "invalid_history_request",
      "prefer must be events or snapshots",
    );
  }

  return request;
}

function ExtractAguiEvents(page: Awaited<ReturnType<typeof ReadHistoryPage>>): AguiEvent[]
{
  const events: AguiEvent[] = [];

  for (const envelope of page.envelopes)
  {
    if (envelope.kind !== "agui.event" || envelope.payload === undefined)
    {
      continue;
    }

    if (typeof envelope.payload === "object" && envelope.payload !== null)
    {
      events.push(envelope.payload as AguiEvent);
    }
  }

  return events;
}

export async function HandleSessionHistory(
  context: RouteContext,
  pile: string,
  sessionId: string,
  searchParams: URLSearchParams,
  response: ServerResponse,
): Promise<void>
{
  const request = ParseHistoryQuery(searchParams);
  const page = await ReadHistoryPage(
    context.agentManager.storagePaths,
    pile,
    sessionId,
    request,
  );
  const prefer = request.prefer ?? "events";
  const events = ExtractAguiEvents(page);

  if (prefer === "snapshots")
  {
    SendJson(response, 200, {
      direction: page.direction,
      messages: eventsToSnapshots(events),
      oldestSequence: page.oldestSequence,
      newestSequence: page.newestSequence,
      hasMoreBefore: page.hasMoreBefore,
      hasMoreAfter: page.hasMoreAfter,
    });
    return;
  }

  SendJson(response, 200, {
    direction: page.direction,
    events,
    envelopes: page.envelopes,
    oldestSequence: page.oldestSequence,
    newestSequence: page.newestSequence,
    hasMoreBefore: page.hasMoreBefore,
    hasMoreAfter: page.hasMoreAfter,
  });
}
