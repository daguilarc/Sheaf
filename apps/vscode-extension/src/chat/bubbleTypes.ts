import type { ToolLifecyclePhase } from "realtime-agent-lib";

export type ChatBubble =
  | {
      kind: "user_transcript";
      id: string;
      itemId: string;
      text: string;
      complete: boolean;
      createdAt: string;
    }
  | {
      kind: "assistant_text";
      id: string;
      responseId: string;
      text: string;
      complete: boolean;
      createdAt: string;
    }
  | {
      kind: "tool_call";
      id: string;
      toolCallId: string;
      toolName: string;
      summary: string;
      phase: ToolLifecyclePhase;
      createdAt: string;
    }
  | {
      kind: "context_push";
      id: string;
      summary: string;
      createdAt: string;
    }
  | {
      kind: "error";
      id: string;
      message: string;
      createdAt: string;
    };
