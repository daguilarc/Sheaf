export { createRepoPaths, createRepoPathsForRoot, type RepoPaths } from "./paths.js";
export { type ServiceDefinition } from "./service_definition.js";
export {
  findServiceByName,
  loadServiceRegistry,
  type LoadServiceRegistryOptions,
} from "./service_registry.js";
export {
  HealthPoller,
  buildHealthUrl,
  parseHealthResponseBody,
  resolvePollHost,
  type FetchFn,
  type HealthPollerOptions,
  type HeartbeatState,
} from "./health_poller.js";
export {
  decodePathSegment,
  parseRequestPath,
  sendJson,
  sendJsonAfterFlush,
} from "./http_json.js";
export {
  presentAllServices,
  presentService,
  presentServiceHealth,
  type PresentedService,
  type PresentedServiceHealth,
} from "./service_presenter.js";
export {
  createShutdownController,
  type ShutdownController,
  type ShutdownControllerDeps,
} from "./shutdown.js";
export {
  createConductorServer,
  findConductorService,
  type ConductorServer,
  type ConductorServerOptions,
} from "./server.js";
export {
  LifecycleManager,
  buildExitUrl,
  createExitRequester,
  validateServiceCommand,
  type CommandValidationError,
  type ExitRequester,
  type ExitRequestResult,
  type LifecycleManagerOptions,
  type ProcessInfo,
  type RestartServiceResult,
  type StartServiceResult,
  type StopServiceResult,
} from "./lifecycle.js";
export {
  createProcessRunner,
  needsShellExecution,
  parseCommand,
  spawnCommand,
  type ProcessRunner,
  type SpawnedProcess,
  type SpawnFailure,
} from "./process_runner.js";
export {
  isPathInsideRoot,
  listServiceLogs,
  normalizeRelativeLogPath,
  resolveLogFilePath,
  validateLogFileForReading,
  type LogFileEntry,
  type LogFileValidationResult,
  type LogListResult,
} from "./logs.js";
export {
  DEFAULT_MAX_READ_BYTES,
  LogStreamSession,
  TRUNCATION_ERROR_MESSAGE,
  computeReadBeforeRange,
  computeTailRange,
  getFileSize,
  readByteRange,
  type AppendMessage,
  type ChunkMessage,
  type ErrorMessage,
  type LogStreamSessionOptions,
  type ServerMessage,
} from "./log_stream.js";
export {
  attachLogStreamConnection,
  createLogStreamWebSocketServer,
  matchLogStreamUpgradePath,
  rejectUpgradeWithHttpStatus,
  resolveLogStreamUpgrade,
  type LogStreamWebSocketOptions,
  type LogStreamWebSocketUpgrade,
} from "./websocket.js";
export {
  readStaticFile,
  resolveStaticFile,
  sendHtml,
  sendStaticResult,
  type StaticAssetRoot,
  type StaticFileResult,
} from "./static.js";
export {
  renderLogsPageHtml,
  renderMainPageHtml,
  sendLogsPage,
  sendMainPage,
} from "./ui.js";
export {
  buildConductorStaticRoots,
  matchLogsPagePath,
  resolveBrowserHomeUrl,
  x_LogsJsAssetPath,
  x_MainJsAssetPath,
  x_SharedCssAssetPath,
} from "./ui_helpers.js";
