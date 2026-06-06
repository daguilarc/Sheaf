import type { FetchFn } from "./health_poller.js";
import { resolvePollHost } from "./health_poller.js";
import type { HeartbeatState } from "./health_poller.js";
import {
  createProcessRunner,
  type ProcessRunner,
  type SpawnedProcess,
  type SpawnFailure,
} from "./process_runner.js";
import {
  presentServiceHealth,
  type PresentedServiceHealth,
} from "./service_presenter.js";
import type { ServiceDefinition } from "./service_definition.js";

export type ProcessInfo =
{
  pid: number;
  command: string;
  argv: string[];
};

export type StartServiceResult =
{
  name: string;
  action: "start";
  started: boolean;
  process?: ProcessInfo;
  heartbeat: PresentedServiceHealth;
  error?: string;
};

export type StopServiceResult =
{
  name: string;
  action: "stop";
  stop_requested: boolean;
  heartbeat: PresentedServiceHealth;
  error?: string;
};

export type RestartServiceResult =
{
  name: string;
  action: "restart";
  restart_requested: boolean;
  stop_requested: boolean;
  started: boolean;
  process?: ProcessInfo;
  heartbeat: PresentedServiceHealth;
  error?: string;
};

export type CommandValidationError =
{
  error: string;
  name: string;
};

export type ExitRequestResult =
{
  ok: boolean;
  status?: number;
  error?: string;
};

export type ExitRequester =
{
  requestExit: (service: ServiceDefinition) => Promise<ExitRequestResult>;
};

export type LifecycleManagerOptions =
{
  repoRoot: string;
  processRunner?: ProcessRunner;
  exitRequester?: ExitRequester;
  getHeartbeat: (serviceName: string) => HeartbeatState | undefined;
  fetchFn?: FetchFn;
  exitRequestTimeoutMs?: number;
  killProcess?: (pid: number) => void;
};

export function buildExitUrl(service: ServiceDefinition): string
{
  const host = resolvePollHost(service.host);
  return `http://${host}:${service.port}/exit`;
}

export function createExitRequester(options?: {
  fetchFn?: FetchFn;
  requestTimeoutMs?: number;
}): ExitRequester
{
  const fetchFn = options?.fetchFn ?? fetch;
  const requestTimeoutMs = options?.requestTimeoutMs ?? 5_000;

  return {
    async requestExit(service: ServiceDefinition): Promise<ExitRequestResult>
    {
      const exitUrl = buildExitUrl(service);
      const controller = new AbortController();
      const timeout = setTimeout(() =>
      {
        controller.abort();
      }, requestTimeoutMs);

      try
      {
        const response = await fetchFn(exitUrl, {
          method: "POST",
          signal: controller.signal,
        });

        if (!response.ok)
        {
          return {
            ok: false,
            status: response.status,
            error: `HTTP ${response.status}`,
          };
        }

        return {
          ok: true,
          status: response.status,
        };
      }
      catch (error: unknown)
      {
        const message = error instanceof Error ? error.message : "network error";
        return {
          ok: false,
          error: message,
        };
      }
      finally
      {
        clearTimeout(timeout);
      }
    },
  };
}

export function validateServiceCommand(service: ServiceDefinition): CommandValidationError | null
{
  if (typeof service.command !== "string" || service.command.trim().length === 0)
  {
    return {
      error: "service command is missing or empty",
      name: service.name,
    };
  }

  return null;
}

function toProcessInfo(process: SpawnedProcess): ProcessInfo
{
  return {
    pid: process.pid,
    command: process.command,
    argv: process.argv,
  };
}

function toPresentedHeartbeat(
  serviceName: string,
  heartbeat: HeartbeatState | undefined,
): PresentedServiceHealth
{
  if (!heartbeat)
  {
    return {
      name: serviceName,
      healthy: false,
      last_checked_at: null,
      last_error: "not checked yet",
    };
  }

  return presentServiceHealth(serviceName, heartbeat);
}

export class LifecycleManager
{
  private m_repoRoot: string;
  private m_processRunner: ProcessRunner;
  private m_exitRequester: ExitRequester;
  private m_getHeartbeat: (serviceName: string) => HeartbeatState | undefined;
  private m_killProcess: (pid: number) => void;
  private m_startedProcesses = new Map<string, SpawnedProcess>();

  constructor(options: LifecycleManagerOptions)
  {
    this.m_repoRoot = options.repoRoot;
    this.m_processRunner = options.processRunner ?? createProcessRunner();
    this.m_exitRequester = options.exitRequester ?? createExitRequester({
      fetchFn: options.fetchFn,
      requestTimeoutMs: options.exitRequestTimeoutMs,
    });
    this.m_getHeartbeat = options.getHeartbeat;
    this.m_killProcess = options.killProcess ?? ((pid) =>
    {
      try
      {
        process.kill(pid);
      }
      catch
      {
        //
      }
    });
  }

  StartService(service: ServiceDefinition): StartServiceResult
  {
    const validationError = validateServiceCommand(service);
    const heartbeat = toPresentedHeartbeat(service.name, this.m_getHeartbeat(service.name));

    if (validationError)
    {
      return {
        name: service.name,
        action: "start",
        started: false,
        heartbeat,
        error: validationError.error,
      };
    }

    try
    {
      const process = this.m_processRunner.spawn(service.command, this.m_repoRoot);
      this.m_startedProcesses.set(service.name, process);

      return {
        name: service.name,
        action: "start",
        started: true,
        process: toProcessInfo(process),
        heartbeat,
      };
    }
    catch (error: unknown)
    {
      const failure = error as SpawnFailure;
      const message = failure.message ?? (error instanceof Error ? error.message : "spawn failed");

      return {
        name: service.name,
        action: "start",
        started: false,
        heartbeat,
        error: message,
        process: failure.argv
          ? {
            pid: -1,
            command: failure.command ?? service.command,
            argv: failure.argv,
          }
          : undefined,
      };
    }
  }

  async StopService(service: ServiceDefinition): Promise<StopServiceResult>
  {
    const heartbeat = toPresentedHeartbeat(service.name, this.m_getHeartbeat(service.name));
    const exitResult = await this.m_exitRequester.requestExit(service);

    if (exitResult.ok)
    {
      this.m_startedProcesses.delete(service.name);

      return {
        name: service.name,
        action: "stop",
        stop_requested: true,
        heartbeat,
      };
    }

    const ownedProcess = this.m_startedProcesses.get(service.name);

    if (ownedProcess)
    {
      this.m_killProcess(ownedProcess.pid);
      this.m_startedProcesses.delete(service.name);

      return {
        name: service.name,
        action: "stop",
        stop_requested: true,
        heartbeat,
      };
    }

    return {
      name: service.name,
      action: "stop",
      stop_requested: false,
      heartbeat,
      error: exitResult.error ?? `HTTP ${exitResult.status ?? "unknown"}`,
    };
  }

  async RestartService(service: ServiceDefinition): Promise<RestartServiceResult>
  {
    const heartbeat = toPresentedHeartbeat(service.name, this.m_getHeartbeat(service.name));
    const stopResult = await this.StopService(service);
    const startResult = this.StartService(service);

    const restartRequested = startResult.started;
    const error = startResult.error ?? (startResult.started ? undefined : stopResult.error);

    return {
      name: service.name,
      action: "restart",
      restart_requested: restartRequested,
      stop_requested: stopResult.stop_requested,
      started: startResult.started,
      process: startResult.process,
      heartbeat,
      error,
    };
  }
}
