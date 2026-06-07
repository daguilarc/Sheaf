export {
  DuplicateToolNameError,
  startAgentSession,
} from "./agent_loop.js";

export {
  CreateMicrophoneCapture,
  CreateSoxMicrophoneCapture,
  REALTIME_PCM_SAMPLE_RATE,
  type MicrophoneCapture,
  type MicrophoneCaptureOptions,
} from "./audio_input.js";

export {
  DEFAULT_REALTIME_MODEL,
  type AgentEventCallback,
  type AgentSessionDeps,
  type AgentStartConfig,
  type ClassifiedIncomingEvent,
  type ClassifiedOutgoingEvent,
  type ConversationEventCallback,
  type ConversationEventInfo,
  type CreateResponseOptions,
  type CreateSessionInput,
  type DatabaseConfig,
  type EventDirection,
  type EventRouterCallbacks,
  type EventRouterOptions,
  type EventRow,
  type IncomingEventClass,
  type OutgoingEventClass,
  type PersistEventInput,
  type QueuedEventResult,
  type QueueRequestOptions,
  type RealtimeAgentSession,
  type RealtimeAgentTurnMode,
  type RealtimeClientOptions,
  type RealtimeCloseHandler,
  type RealtimeErrorHandler,
  type RealtimeEvent,
  type RealtimeEventHandler,
  type RealtimeWebSocketLike,
  type ResponseQueuePolicy,
  type SendMessageOptions,
  type SessionEndedCallback,
  type SessionRow,
  type StructuredContextMessage,
  type ToolCallSet,
  type ToolDefinition,
  type ToolLifecycleCallback,
  type ToolLifecycleNotification,
  type ToolLifecyclePhase,
  type ToolRuntimeContext,
  type WebSocketConnectOptions,
  type WebSocketFactory,
} from "./types.js";

export {
  ConfigLoadError,
  LoadOpenAiApiKey,
  LoadRealtimeAgentConfig,
  type LoadOpenAiApiKeyOptions,
  type LoadRealtimeAgentConfigOptions,
  type RealtimeAgentConfig,
  type ResolvedRealtimeAgentConfig,
} from "./config.js";

export {
  FindRepositoryRoot,
  GetDefaultRealtimeAgentPaths,
  ResolveRepositoryPath,
  type RealtimeAgentPaths,
} from "./repo_paths.js";

export {
  CreateRuntimeLogger,
  type RuntimeLogEntry,
  type RuntimeLogger,
  type RuntimeLoggerOptions,
} from "./runtime_log.js";

export {
  DEFAULT_DATABASE_PATH,
  RealtimeAgentDb,
  resolveDatabasePath,
  runMigrations,
} from "./persistence/db.js";

export { SessionsRepo } from "./persistence/sessions_repo.js";

export {
  EventsRepo,
  shouldPersistOutgoingEvent,
} from "./persistence/events_repo.js";

export { buildSessionUpdateEvent } from "./session_config.js";

export {
  classifyIncomingEvent,
  classifyOutgoingEvent,
  EventRouter,
} from "./event_router.js";

export {
  buildRealtimeConnectionHeaders,
  buildRealtimeConnectionUrl,
  DEFAULT_REALTIME_BASE_URL,
  RealtimeClient,
  RealtimeTransportError,
} from "./realtime_client.js";

export {
  buildFunctionCallOutputEvent,
  buildToolErrorPayload,
  ToolDispatcher,
  ToolRegistry,
  type ExtractedToolCall,
  type ToolDispatcherOptions,
  type ToolDispatcherSendContext,
  type ToolErrorCode,
  type ToolErrorPayload,
} from "./tooling.js";
