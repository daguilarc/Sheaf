import type { RealtimeEvent, ToolCallSet } from "./types.js";

const x_pcmSampleRate = 24000;
const x_serverVadSilenceDurationMs = 500;

export function buildSessionUpdateEvent(toolCallSet: ToolCallSet): RealtimeEvent
{
  return {
    type: "session.update",
    session: {
      type: "realtime",
      output_modalities: ["text"],
      audio: {
        input: {
          format: {
            type: "audio/pcm",
            rate: x_pcmSampleRate,
          },
          transcription: {
            model: "gpt-4o-mini-transcribe",
          },
          turn_detection: {
            type: "server_vad",
            silence_duration_ms: x_serverVadSilenceDurationMs,
            create_response: true,
            interrupt_response: true,
          },
        },
      },
      tools: toolCallSet.tools.map((tool) => ({
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      })),
    },
  };
}
