import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import type { AgentLifecycleState, ModelReference } from "../shared/types.js";
import type { UserMessageSubmission } from "../agents/lifecycle.js";

export type AguiEvent = Record<string, unknown> & { type: string };

export type AguiSnapshotMessage = Record<string, unknown> & {
  id: string;
  role: string;
};

export interface PiMapperContext
{
  threadId: string;
  step?: number | string;
  sequence?: number | string;
  timestampMs?: number;
  rootDirectory?: string;
  canonicalRoot?: string;
}

export type SheafActivity =
  | {
    kind: "path_escape_denied";
    inputPath: string;
    reason: string;
    tool?: string;
  }
  | {
    kind: "model_changed";
    model: ModelReference;
    applyTo?: string;
  }
  | {
    kind: "lifecycle_status";
    state: AgentLifecycleState;
    previousState?: AgentLifecycleState;
  }
  | {
    kind: "cancellation";
    message?: string;
    runId?: string;
  }
  | {
    kind: "error";
    code: string;
    message: string;
    fatal?: boolean;
    runId?: string;
  };

export type PiMappableEvent = AgentSessionEvent | Record<string, unknown>;

export interface UserMessageAguiInput extends Pick<UserMessageSubmission, "messageId" | "text">
{
}
