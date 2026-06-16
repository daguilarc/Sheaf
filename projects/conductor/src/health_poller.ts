import type { ServiceDefinition } from "./service_definition.js";

export type HeartbeatState =
{
  healthy: boolean;
  last_checked_at: string | null;
  last_error: string | null;
  uptime?: number;
  warning?: string;
};

export type FetchFn = typeof fetch;

export type ForegroundLeaseRenewal =
{
  foreground_polling: true;
  poll_interval_ms: number;
  expires_at: string;
};

export type ForegroundLeaseRelease =
{
  foreground_polling: boolean;
  poll_interval_ms: number;
};

export type HealthPollerOptions =
{
  services: ServiceDefinition[];
  fetchFn?: FetchFn;
  pollIntervalMs?: number;
  foregroundPollIntervalMs?: number;
  foregroundLeaseTtlMs?: number;
  requestTimeoutMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  nowFn?: () => number;
};

function createInitialHeartbeatState(): HeartbeatState
{
  return {
    healthy: false,
    last_checked_at: null,
    last_error: "not checked yet",
  };
}

export function resolvePollHost(host: string): string
{
  if (host === "0.0.0.0")
  {
    return "127.0.0.1";
  }

  return host;
}

export function buildHealthUrl(service: ServiceDefinition): string
{
  const pollHost = resolvePollHost(service.host);
  return `http://${pollHost}:${service.port}/health`;
}

type ParsedHealthResponse =
{
  healthy: boolean;
  uptime?: number;
  warning?: string;
  error: string | null;
};

export function parseHealthResponseBody(body: unknown): ParsedHealthResponse
{
  if (typeof body !== "object" || body === null || Array.isArray(body))
  {
    return {
      healthy: false,
      error: "invalid JSON",
    };
  }

  const record = body as Record<string, unknown>;

  if (record.healthy !== true)
  {
    if (record.healthy === false)
    {
      return {
        healthy: false,
        error: "healthy: false",
      };
    }

    return {
      healthy: false,
      error: "missing healthy",
    };
  }

  if (typeof record.uptime !== "number")
  {
    return {
      healthy: false,
      error: "missing uptime",
    };
  }

  const parsed: ParsedHealthResponse =
  {
    healthy: true,
    uptime: record.uptime,
    error: null,
  };

  if (typeof record.warning === "string")
  {
    parsed.warning = record.warning;
  }

  return parsed;
}

export class HealthPoller
{
  private m_services: ServiceDefinition[];
  private m_fetchFn: FetchFn;
  private m_pollIntervalMs: number;
  private m_foregroundPollIntervalMs: number;
  private m_foregroundLeaseTtlMs: number;
  private m_requestTimeoutMs: number;
  private m_setTimeoutFn: typeof setTimeout;
  private m_clearTimeoutFn: typeof clearTimeout;
  private m_nowFn: () => number;
  private m_states = new Map<string, HeartbeatState>();
  private m_foregroundLeases = new Map<string, number>();
  private m_timer: ReturnType<typeof setTimeout> | null = null;
  private m_started = false;
  private m_pollInProgress = false;

  constructor(options: HealthPollerOptions)
  {
    this.m_services = options.services;
    this.m_fetchFn = options.fetchFn ?? fetch;
    this.m_pollIntervalMs = options.pollIntervalMs ?? 30_000;
    this.m_foregroundPollIntervalMs = options.foregroundPollIntervalMs ?? 1_000;
    this.m_foregroundLeaseTtlMs = options.foregroundLeaseTtlMs ?? 3_000;
    this.m_requestTimeoutMs = options.requestTimeoutMs ?? 5_000;
    this.m_setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.m_clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
    this.m_nowFn = options.nowFn ?? Date.now;

    for (const service of this.m_services)
    {
      this.m_states.set(service.name, createInitialHeartbeatState());
    }
  }

  getHeartbeat(serviceName: string): HeartbeatState | undefined
  {
    return this.m_states.get(serviceName);
  }

  getForegroundPollIntervalMs(): number
  {
    return this.m_foregroundPollIntervalMs;
  }

  hasActiveForegroundLeases(): boolean
  {
    this.pruneExpiredForegroundLeases();
    return this.m_foregroundLeases.size > 0;
  }

  renewForegroundLease(clientId: string): ForegroundLeaseRenewal
  {
    const hadActiveLease = this.hasActiveForegroundLeases();
    const expiresAtMs = this.m_nowFn() + this.m_foregroundLeaseTtlMs;

    this.m_foregroundLeases.set(clientId, expiresAtMs);

    if (this.m_started && !hadActiveLease)
    {
      this.scheduleNextPoll(0);
    }

    return {
      foreground_polling: true,
      poll_interval_ms: this.m_foregroundPollIntervalMs,
      expires_at: new Date(expiresAtMs).toISOString(),
    };
  }

  releaseForegroundLease(clientId: string): ForegroundLeaseRelease
  {
    this.m_foregroundLeases.delete(clientId);
    const foregroundPolling = this.hasActiveForegroundLeases();

    if (this.m_started && !foregroundPolling)
    {
      this.scheduleNextPoll(this.m_pollIntervalMs);
    }

    return {
      foreground_polling: foregroundPolling,
      poll_interval_ms: this.m_foregroundPollIntervalMs,
    };
  }

  start(): void
  {
    if (this.m_started)
    {
      return;
    }

    this.m_started = true;
    void this.runScheduledPollCycle();
  }

  stop(): void
  {
    if (!this.m_started)
    {
      return;
    }

    this.m_started = false;
    this.clearScheduledPoll();
  }

  async runPollCycle(): Promise<void>
  {
    await Promise.all(this.m_services.map((service) => this.pollService(service)));
  }

  private async runScheduledPollCycle(): Promise<void>
  {
    if (this.m_pollInProgress)
    {
      if (this.m_started)
      {
        this.scheduleNextPoll(this.getActivePollIntervalMs());
      }
      return;
    }

    this.m_pollInProgress = true;

    try
    {
      await this.runPollCycle();
    }
    finally
    {
      this.m_pollInProgress = false;

      if (this.m_started)
      {
        this.scheduleNextPoll(this.getActivePollIntervalMs());
      }
    }
  }

  private scheduleNextPoll(delayMs: number): void
  {
    this.clearScheduledPoll();
    this.m_timer = this.m_setTimeoutFn(() =>
    {
      this.m_timer = null;
      void this.runScheduledPollCycle();
    }, delayMs);
  }

  private clearScheduledPoll(): void
  {
    if (this.m_timer !== null)
    {
      this.m_clearTimeoutFn(this.m_timer);
      this.m_timer = null;
    }
  }

  private getActivePollIntervalMs(): number
  {
    return this.hasActiveForegroundLeases()
      ? this.m_foregroundPollIntervalMs
      : this.m_pollIntervalMs;
  }

  private pruneExpiredForegroundLeases(): void
  {
    const now = this.m_nowFn();

    for (const [clientId, expiresAtMs] of this.m_foregroundLeases)
    {
      if (expiresAtMs <= now)
      {
        this.m_foregroundLeases.delete(clientId);
      }
    }
  }

  private async pollService(service: ServiceDefinition): Promise<void>
  {
    const checkedAt = new Date().toISOString();
    const healthUrl = buildHealthUrl(service);
    const controller = new AbortController();
    const timeout = this.m_setTimeoutFn(() =>
    {
      controller.abort();
    }, this.m_requestTimeoutMs);

    try
    {
      const response = await this.m_fetchFn(healthUrl, {
        signal: controller.signal,
      });

      if (!response.ok)
      {
        this.updateUnhealthyState(service.name, checkedAt, `HTTP ${response.status}`);
        return;
      }

      let body: unknown;

      try
      {
        body = await response.json() as unknown;
      }
      catch
      {
        this.updateUnhealthyState(service.name, checkedAt, "invalid JSON");
        return;
      }

      const parsed = parseHealthResponseBody(body);

      if (!parsed.healthy)
      {
        this.updateUnhealthyState(service.name, checkedAt, parsed.error ?? "unhealthy response");
        return;
      }

      const nextState: HeartbeatState =
      {
        healthy: true,
        last_checked_at: checkedAt,
        last_error: null,
        uptime: parsed.uptime,
      };

      if (parsed.warning !== undefined)
      {
        nextState.warning = parsed.warning;
      }

      this.m_states.set(service.name, nextState);
    }
    catch (error: unknown)
    {
      const message = error instanceof Error ? error.message : "network error";
      this.updateUnhealthyState(service.name, checkedAt, message);
    }
    finally
    {
      this.m_clearTimeoutFn(timeout);
    }
  }

  private updateUnhealthyState(serviceName: string, checkedAt: string, error: string): void
  {
    const previous = this.m_states.get(serviceName) ?? createInitialHeartbeatState();

    this.m_states.set(serviceName, {
      healthy: false,
      last_checked_at: checkedAt,
      last_error: error,
      uptime: previous.uptime,
      warning: previous.warning,
    });
  }
}
