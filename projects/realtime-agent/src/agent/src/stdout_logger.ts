import type { ConversationEventInfo, RealtimeEvent } from "./types.js";

const x_skipEventType = "input_audio_buffer.append";

export interface LogEventLineInput
{
  sessionId: string;
  direction: ConversationEventInfo["direction"];
  event: RealtimeEvent;
}

export function ShouldLogEvent(event: RealtimeEvent): boolean
{
  return event.type !== x_skipEventType;
}

export function logEventLine(input: LogEventLineInput): void
{
  if (!ShouldLogEvent(input.event))
  {
    return;
  }

  const line = {
    session_id: input.sessionId,
    direction: input.direction,
    event_type: input.event.type,
    event: input.event,
  };

  process.stdout.write(`${JSON.stringify(line)}\n`);
}
