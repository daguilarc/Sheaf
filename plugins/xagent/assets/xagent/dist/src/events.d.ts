export declare const harnessNames: readonly ["codex", "pi", "cursor", "claude_code"];
export declare const outputModes: readonly ["subagent", "full"];
export declare const thinkingLevels: readonly ["low", "medium", "high", "xhigh"];
export declare const roles: readonly ["assistant", "user", "system", "tool"];
export declare const statusLevels: readonly ["info", "warning", "error"];
export type HarnessName = (typeof harnessNames)[number];
export type OutputMode = (typeof outputModes)[number];
export type ThinkingLevel = (typeof thinkingLevels)[number];
export type Role = (typeof roles)[number];
export type StatusLevel = (typeof statusLevels)[number];
export type UserInputCommand = {
    type: "control.exit";
    code?: never;
} | {
    type: "user.message";
    text: string;
    metadata?: Record<string, unknown>;
    code?: never;
};
export type InputErrorCode = "invalid_input_json" | "invalid_input_command" | "unsupported_input_command" | "invalid_user_message";
export type InputError = {
    type: "error";
    code: InputErrorCode;
    message: string;
};
export type BaseEvent = {
    schema_version: 1;
    type: OutputEventType;
    run_id: string;
    sequence: number;
    timestamp: string;
};
export type SessionStartedEvent = {
    type: "session.started";
    harness: HarnessName;
    mode: OutputMode;
    model?: string;
    thinking_level?: ThinkingLevel;
    provider_thread_id?: string;
};
export type SessionReadyEvent = {
    type: "session.ready";
    can_accept_input: boolean;
};
export type TurnStartedEvent = {
    type: "turn.started";
    turn_id: string;
    input_sequence: number;
};
export type MessageDeltaEvent = {
    type: "message.delta";
    turn_id: string;
    message_id: string;
    role: Role;
    delta: string;
};
export type MessageCompletedEvent = {
    type: "message.completed";
    turn_id: string;
    message_id: string;
    role: Role;
    text: string;
};
export type ToolStartedEvent = {
    type: "tool.started";
    turn_id: string;
    tool_call_id: string;
    name: string;
    input?: unknown;
};
export type ToolCompletedEvent = {
    type: "tool.completed";
    turn_id: string;
    tool_call_id: string;
    name: string;
    status: "completed" | "failed";
    output?: unknown;
    error?: string;
};
export type StatusEvent = {
    type: "status";
    level: StatusLevel;
    message: string;
    code?: string;
    details?: unknown;
};
export type ErrorEvent = {
    type: "error";
    code: string;
    message: string;
    details?: unknown;
    recoverable?: boolean;
};
export type TurnCompletedEvent = {
    type: "turn.completed";
    turn_id: string;
    final_text: string;
    usage?: unknown;
    provider_thread_id?: string;
};
export type TurnFailedEvent = {
    type: "turn.failed";
    turn_id: string;
    code: string;
    message: string;
    details?: unknown;
    provider_thread_id?: string;
};
export type RawProviderEvent = {
    type: "raw.provider";
    harness: HarnessName;
    payload: unknown;
    provider_sequence?: number;
};
export type SessionEndedEvent = {
    type: "session.ended";
    reason: string;
    exit_code?: number;
};
export type OutputEventBody = SessionStartedEvent | SessionReadyEvent | TurnStartedEvent | MessageDeltaEvent | MessageCompletedEvent | ToolStartedEvent | ToolCompletedEvent | StatusEvent | ErrorEvent | TurnCompletedEvent | TurnFailedEvent | RawProviderEvent | SessionEndedEvent;
export type OutputEventType = OutputEventBody["type"];
export type OutputEvent = BaseEvent & OutputEventBody;
export declare class EventSequencer {
    #private;
    private readonly runId;
    private readonly clock;
    constructor(runId: string, clock?: () => Date);
    stamp<T extends OutputEventBody>(event: T): BaseEvent & T;
}
//# sourceMappingURL=events.d.ts.map