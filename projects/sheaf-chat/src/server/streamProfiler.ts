import { monitorEventLoopDelay, performance } from "node:perf_hooks";

import type { AguiEvent, PiMappableEvent } from "../agui/types.js";
import type { ChatEnvelope } from "../shared/envelope.js";

const x_profileEnabled = process.env.SHEAF_CHAT_PROFILE_STREAM === "1";
const x_startedAt = performance.now();
const x_eventLoopDelay = x_profileEnabled
  ? monitorEventLoopDelay({ resolution: 10 })
  : undefined;

if (x_eventLoopDelay !== undefined)
{
  x_eventLoopDelay.enable();
}

export function IsStreamProfilerEnabled(): boolean
{
  return x_profileEnabled;
}

function NowMs(): number
{
  return performance.now() - x_startedAt;
}

function ToFixedMs(value: number): number
{
  return Math.round(value * 1000) / 1000;
}

function ReadPiMessageEvent(event: PiMappableEvent): Record<string, unknown>
{
  if (typeof event !== "object" || event === null)
  {
    return {};
  }

  const messageEvent = (event as { assistantMessageEvent?: unknown }).assistantMessageEvent;

  if (typeof messageEvent !== "object" || messageEvent === null)
  {
    return {};
  }

  const typed = messageEvent as { type?: unknown; delta?: unknown; content?: unknown };
  const detail: Record<string, unknown> = {};

  if (typeof typed.type === "string")
  {
    detail.piMessageEventType = typed.type;
  }

  if (typeof typed.delta === "string")
  {
    detail.deltaChars = typed.delta.length;
  }

  if (typeof typed.content === "string")
  {
    detail.contentChars = typed.content.length;
  }

  return detail;
}

function ReadAguiDetail(event: AguiEvent | undefined): Record<string, unknown>
{
  if (event === undefined)
  {
    return {};
  }

  const detail: Record<string, unknown> = {
    aguiType: event.type,
  };
  const delta = (event as { delta?: unknown }).delta;

  if (typeof delta === "string")
  {
    detail.deltaChars = delta.length;
  }

  return detail;
}

function ReadEnvelopeDetail(envelope: ChatEnvelope | undefined): Record<string, unknown>
{
  if (envelope === undefined)
  {
    return {};
  }

  const detail: Record<string, unknown> = {
    kind: envelope.kind,
    sequence: envelope.sequence,
  };
  const payload = envelope.payload;

  if (typeof payload === "object" && payload !== null)
  {
    Object.assign(detail, ReadAguiDetail(payload as AguiEvent));
  }

  return detail;
}

export function ProfileStreamPoint(
  point: string,
  detail: Record<string, unknown> = {},
): void
{
  if (!x_profileEnabled)
  {
    return;
  }

  const payload = {
    profile: "sheaf-stream",
    tMs: ToFixedMs(NowMs()),
    point,
    ...detail,
  };

  console.error(JSON.stringify(payload));
}

export function ProfilePiEvent(point: string, event: PiMappableEvent): void
{
  if (!x_profileEnabled)
  {
    return;
  }

  ProfileStreamPoint(point, {
    piEventType: typeof event === "object" && event !== null
      ? (event as { type?: unknown }).type
      : typeof event,
    ...ReadPiMessageEvent(event),
  });
}

export function ProfileAguiEvent(point: string, event: AguiEvent): void
{
  if (!x_profileEnabled)
  {
    return;
  }

  ProfileStreamPoint(point, ReadAguiDetail(event));
}

export function ProfileEnvelope(point: string, envelope: ChatEnvelope): void
{
  if (!x_profileEnabled)
  {
    return;
  }

  ProfileStreamPoint(point, ReadEnvelopeDetail(envelope));
}

export function ProfileEventLoopDelay(point: string): void
{
  if (x_eventLoopDelay === undefined)
  {
    return;
  }

  ProfileStreamPoint(point, {
    eventLoopMeanMs: ToFixedMs(x_eventLoopDelay.mean / 1_000_000),
    eventLoopMaxMs: ToFixedMs(x_eventLoopDelay.max / 1_000_000),
    eventLoopP99Ms: ToFixedMs(x_eventLoopDelay.percentile(99) / 1_000_000),
  });
  x_eventLoopDelay.reset();
}
