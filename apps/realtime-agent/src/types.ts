export type EventDirection = "incoming" | "outgoing";

export const DEFAULT_REALTIME_MODEL = "gpt-realtime-2";

export interface RealtimeEvent
{
  type: string;
  [key: string]: unknown;
}

export interface ToolRuntimeContext
{
  sessionId: string;
  toolCallId: string;
  metadata?: Record<string, unknown>;
  log?: (message: string, fields?: Record<string, unknown>) => void;
}

export interface ToolDefinition<TArgs = unknown, TResult = unknown>
{
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  callback: (args: TArgs, ctx: ToolRuntimeContext) => Promise<TResult> | TResult;
}

export interface ToolCallSet
{
  name?: string;
  tools: ToolDefinition[];
}

export interface ConversationEventInfo
{
  sessionId: string;
  direction: EventDirection;
}

export type ConversationEventCallback = (
  event: RealtimeEvent,
  info: ConversationEventInfo,
) => void;

export type AgentEventCallback = (
  event: RealtimeEvent,
  info: ConversationEventInfo,
) => void;

export type ToolLifecyclePhase = "queued" | "started" | "succeeded" | "failed";

export interface ToolLifecycleNotification
{
  sessionId: string;
  toolCallId: string;
  toolName: string;
  phase: ToolLifecyclePhase;
  error?: string;
}

export type ToolLifecycleCallback = (notification: ToolLifecycleNotification) => void;

export type SessionEndedCallback = (info: {
  sessionId: string;
  reason: string;
  session: SessionRow;
}) => void;

export interface AgentStartConfig
{
  systemPrompt: string;
  initialContext: string;
  toolCallSet: ToolCallSet;
  model?: string;
  onConversationEvent?: ConversationEventCallback;
  onEvent?: AgentEventCallback;
  onToolLifecycle?: ToolLifecycleCallback;
  onSessionEnded?: SessionEndedCallback;
}

export interface AgentSessionDeps
{
  apiKey: string;
  safetyIdentifier?: string;
  baseUrl?: string;
  database?: import("./persistence/db.js").RealtimeAgentDb;
  webSocketFactory?: WebSocketFactory;
}

export interface RealtimeAgentSession
{
  readonly sessionId: string;
  sendAudioFrame(pcmBase64OrBuffer: string | Buffer): void;
  stop(reason: string): Promise<SessionRow>;
}

export interface DatabaseConfig
{
  path?: string;
  ensureDirectory?: boolean;
}

export interface CreateSessionInput
{
  systemPrompt: string;
  initialContext: string;
  toolCallSetName?: string | null;
  toolNames: string[];
  model: string;
  sessionConfig: Record<string, unknown>;
}

export interface SessionRow
{
  id: string;
  createdAt: string;
  endedAt: string | null;
  endedReason: string | null;
  systemPrompt: string;
  initialContext: string;
  toolCallSetName: string | null;
  toolNamesJson: string;
  model: string;
  sessionConfigJson: string;
}

export interface EventRow
{
  id: number;
  sessionId: string;
  createdAt: string;
  direction: EventDirection;
  eventType: string;
  eventJson: string;
  isAudioBufferAppend: boolean;
}

export interface PersistEventInput
{
  sessionId: string;
  direction: EventDirection;
  event: RealtimeEvent;
}

export type IncomingEventClass =
  | "session_lifecycle"
  | "input_audio_turn"
  | "transcription"
  | "text_output"
  | "tool_call"
  | "error"
  | "unknown";

export type OutgoingEventClass =
  | "session_config"
  | "conversation_input"
  | "tool_output"
  | "response_trigger"
  | "audio_buffer_append"
  | "unknown";

export interface RealtimeWebSocketLike
{
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "open", listener: () => void): void;
  on(event: "message", listener: (data: string) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "close", listener: (code: number, reason: string) => void): void;
  off(event: "open", listener: () => void): void;
  off(event: "message", listener: (data: string) => void): void;
  off(event: "error", listener: (error: Error) => void): void;
  off(event: "close", listener: (code: number, reason: string) => void): void;
}

export interface WebSocketConnectOptions
{
  headers: Record<string, string>;
}

export type WebSocketFactory = (
  url: string,
  options: WebSocketConnectOptions,
) => RealtimeWebSocketLike;

export interface RealtimeClientOptions
{
  apiKey: string;
  model: string;
  safetyIdentifier?: string;
  baseUrl?: string;
  webSocketFactory?: WebSocketFactory;
}

export type RealtimeEventHandler = (event: RealtimeEvent) => void;
export type RealtimeErrorHandler = (error: Error) => void;
export type RealtimeCloseHandler = (code: number, reason: string) => void;

export interface ClassifiedIncomingEvent
{
  event: RealtimeEvent;
  eventClass: IncomingEventClass;
}

export interface ClassifiedOutgoingEvent
{
  event: RealtimeEvent;
  eventClass: OutgoingEventClass;
}

export interface EventRouterCallbacks
{
  onConversationEvent?: ConversationEventCallback;
  onEvent?: AgentEventCallback;
  onSessionLifecycle?: RealtimeEventHandler;
  onInputAudioTurn?: RealtimeEventHandler;
  onTranscription?: RealtimeEventHandler;
  onTextOutput?: RealtimeEventHandler;
  onToolCall?: RealtimeEventHandler;
  onErrorEvent?: RealtimeEventHandler;
  onUnknownIncoming?: RealtimeEventHandler;
  onSessionConfig?: RealtimeEventHandler;
  onConversationInput?: RealtimeEventHandler;
  onToolOutput?: RealtimeEventHandler;
  onResponseTrigger?: RealtimeEventHandler;
  onAudioBufferAppend?: RealtimeEventHandler;
  onUnknownOutgoing?: RealtimeEventHandler;
}

export interface EventRouterOptions extends EventRouterCallbacks
{
  sessionId: string;
  eventsRepo: import("./persistence/events_repo.js").EventsRepo;
}
