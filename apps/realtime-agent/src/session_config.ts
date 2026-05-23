import type { RealtimeAgentTurnMode, RealtimeEvent, ToolCallSet } from "./types.js";

const x_pcmSampleRate = 24000;
const x_serverVadSilenceDurationMs = 500;

export function BuildAudioTurnDetectionConfig(
  turnMode: RealtimeAgentTurnMode,
): Record<string, unknown> | null
{
  if (turnMode.type === "manual")
  {
    return null;
  }

  const detection: Record<string, unknown> = {
    type: "server_vad",
    silence_duration_ms: turnMode.silenceDurationMs ?? x_serverVadSilenceDurationMs,
    create_response: turnMode.createResponse ?? true,
    interrupt_response: turnMode.interruptResponse ?? true,
  };

  if (turnMode.threshold !== undefined)
  {
    detection.threshold = turnMode.threshold;
  }

  if (turnMode.prefixPaddingMs !== undefined)
  {
    detection.prefix_padding_ms = turnMode.prefixPaddingMs;
  }

  return detection;
}

function DefaultServerVadTurnMode(): RealtimeAgentTurnMode
{
  return {
    type: "server_vad",
    silenceDurationMs: x_serverVadSilenceDurationMs,
    createResponse: true,
    interruptResponse: true,
  };
}

export function buildSessionUpdateEvent(
  toolCallSet: ToolCallSet,
  turnMode: RealtimeAgentTurnMode = DefaultServerVadTurnMode(),
): RealtimeEvent
{
  const turnDetection = BuildAudioTurnDetectionConfig(turnMode);

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
          turn_detection: turnDetection,
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
