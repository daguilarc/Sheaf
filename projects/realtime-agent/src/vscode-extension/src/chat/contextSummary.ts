import type { StructuredContextMessage } from "realtime-agent-lib";

export function FormatContextPushSummary(message: StructuredContextMessage): string
{
  if (message.summary !== undefined && message.summary.length > 0)
  {
    return message.summary;
  }

  return `Context: ${message.kind}`;
}
