import WebSocket from "ws";

import type {
  RealtimeClientOptions,
  RealtimeCloseHandler,
  RealtimeErrorHandler,
  RealtimeEvent,
  RealtimeEventHandler,
  RealtimeWebSocketLike,
  WebSocketConnectOptions,
  WebSocketFactory,
} from "./types.js";

export const DEFAULT_REALTIME_BASE_URL = "wss://api.openai.com/v1/realtime";

const x_openReadyState = 1;

export class RealtimeTransportError extends Error
{
  constructor(message: string, options?: { cause?: unknown })
  {
    super(message, options);
    this.name = "RealtimeTransportError";
  }
}

function WrapNodeWebSocket(socket: WebSocket): RealtimeWebSocketLike
{
  return {
    get readyState()
    {
      return socket.readyState;
    },
    send(data: string): void
    {
      socket.send(data);
    },
    close(code?: number, reason?: string): void
    {
      socket.close(code, reason);
    },
    on(
      event: "open" | "message" | "error" | "close",
      listener: (() => void) | ((data: string) => void) | ((error: Error) => void) | ((code: number, reason: string) => void),
    ): void
    {
      if (event === "open")
      {
        socket.on("open", listener as () => void);
        return;
      }

      if (event === "message")
      {
        socket.on("message", (data) =>
        {
          const text = typeof data === "string" ? data : data.toString("utf8");
          (listener as (payload: string) => void)(text);
        });
        return;
      }

      if (event === "error")
      {
        socket.on("error", listener as (error: Error) => void);
        return;
      }

      socket.on("close", (code, reasonBuffer) =>
      {
        const reason = typeof reasonBuffer === "string" ? reasonBuffer : reasonBuffer.toString("utf8");
        (listener as (closeCode: number, closeReason: string) => void)(code, reason);
      });
    },
    off(
      event: "open" | "message" | "error" | "close",
      listener: (() => void) | ((data: string) => void) | ((error: Error) => void) | ((code: number, reason: string) => void),
    ): void
    {
      if (event === "open" || event === "error")
      {
        socket.off(event, listener as never);
        return;
      }

      if (event === "message" || event === "close")
      {
        return;
      }
    },
  };
}

function DefaultWebSocketFactory(
  url: string,
  options: WebSocketConnectOptions,
): RealtimeWebSocketLike
{
  return WrapNodeWebSocket(
    new WebSocket(url, {
      headers: options.headers,
    }),
  );
}

export function buildRealtimeConnectionUrl(model: string, baseUrl?: string): string
{
  const resolvedBaseUrl = baseUrl ?? DEFAULT_REALTIME_BASE_URL;
  const separator = resolvedBaseUrl.includes("?") ? "&" : "?";
  return `${resolvedBaseUrl}${separator}model=${encodeURIComponent(model)}`;
}

export function buildRealtimeConnectionHeaders(
  apiKey: string,
  safetyIdentifier?: string,
): Record<string, string>
{
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };

  if (safetyIdentifier !== undefined && safetyIdentifier.length > 0)
  {
    headers["OpenAI-Safety-Identifier"] = safetyIdentifier;
  }

  return headers;
}

export class RealtimeClient
{
  private m_apiKey: string;
  private m_model: string;
  private m_safetyIdentifier?: string;
  private m_baseUrl?: string;
  private m_webSocketFactory: WebSocketFactory;
  private m_socket: RealtimeWebSocketLike | null = null;
  private m_eventHandlers = new Set<RealtimeEventHandler>();
  private m_errorHandlers = new Set<RealtimeErrorHandler>();
  private m_closeHandlers = new Set<RealtimeCloseHandler>();

  constructor(options: RealtimeClientOptions)
  {
    this.m_apiKey = options.apiKey;
    this.m_model = options.model;
    this.m_safetyIdentifier = options.safetyIdentifier;
    this.m_baseUrl = options.baseUrl;
    this.m_webSocketFactory = options.webSocketFactory ?? DefaultWebSocketFactory;
  }

  getConnectionUrl(): string
  {
    return buildRealtimeConnectionUrl(this.m_model, this.m_baseUrl);
  }

  getConnectionHeaders(): Record<string, string>
  {
    return buildRealtimeConnectionHeaders(this.m_apiKey, this.m_safetyIdentifier);
  }

  connect(): Promise<void>
  {
    if (this.m_socket !== null)
    {
      return Promise.reject(
        new RealtimeTransportError("RealtimeClient is already connected or connecting"),
      );
    }

    const url = this.getConnectionUrl();
    const headers = this.getConnectionHeaders();
    const socket = this.m_webSocketFactory(url, { headers });
    this.m_socket = socket;

    return new Promise((resolve, reject) =>
    {
      let settled = false;

      const finishResolve = (): void =>
      {
        if (settled)
        {
          return;
        }

        settled = true;
        this.AttachSocketHandlers(socket);
        resolve();
      };

      const finishReject = (error: Error): void =>
      {
        if (settled)
        {
          return;
        }

        settled = true;
        this.m_socket = null;
        reject(error);
      };

      socket.on("open", finishResolve);
      socket.on("error", (error) =>
      {
        finishReject(error);
      });
      socket.on("close", (code, reason) =>
      {
        if (!settled)
        {
          finishReject(
            new RealtimeTransportError(
              `WebSocket closed before connection opened (${code}: ${reason})`,
            ),
          );
        }
      });
    });
  }

  send(event: RealtimeEvent): void
  {
    const socket = this.m_socket;
    if (socket === null || socket.readyState !== x_openReadyState)
    {
      this.ReportError(new RealtimeTransportError("Cannot send event before connect() succeeds"));
      return;
    }

    try
    {
      socket.send(JSON.stringify(event));
    }
    catch (error)
    {
      this.ReportError(
        new RealtimeTransportError("Failed to serialize or send realtime event", {
          cause: error,
        }),
      );
    }
  }

  onEvent(handler: RealtimeEventHandler): () => void
  {
    this.m_eventHandlers.add(handler);
    return () =>
    {
      this.m_eventHandlers.delete(handler);
    };
  }

  onError(handler: RealtimeErrorHandler): () => void
  {
    this.m_errorHandlers.add(handler);
    return () =>
    {
      this.m_errorHandlers.delete(handler);
    };
  }

  onClose(handler: RealtimeCloseHandler): () => void
  {
    this.m_closeHandlers.add(handler);
    return () =>
    {
      this.m_closeHandlers.delete(handler);
    };
  }

  close(): void
  {
    const socket = this.m_socket;
    if (socket === null)
    {
      return;
    }

    this.m_socket = null;
    socket.close();
  }

  private AttachSocketHandlers(socket: RealtimeWebSocketLike): void
  {
    socket.on("message", (payload) =>
    {
      this.HandleMessage(payload);
    });

    socket.on("error", (error) =>
    {
      this.ReportError(error);
    });

    socket.on("close", (code, reason) =>
    {
      if (this.m_socket === socket)
      {
        this.m_socket = null;
      }

      for (const handler of this.m_closeHandlers)
      {
        handler(code, reason);
      }
    });
  }

  private HandleMessage(payload: string): void
  {
    let event: RealtimeEvent;

    try
    {
      const parsed: unknown = JSON.parse(payload);
      if (typeof parsed !== "object" || parsed === null)
      {
        throw new RealtimeTransportError("Realtime message must be a JSON object");
      }

      const candidate = parsed as { type?: unknown };
      if (typeof candidate.type !== "string" || candidate.type.length === 0)
      {
        throw new RealtimeTransportError("Realtime message is missing event type");
      }

      event = parsed as RealtimeEvent;
    }
    catch (error)
    {
      const transportError =
        error instanceof RealtimeTransportError
          ? error
          : new RealtimeTransportError("Failed to parse realtime message JSON", {
              cause: error,
            });
      this.ReportError(transportError);
      return;
    }

    for (const handler of this.m_eventHandlers)
    {
      handler(event);
    }
  }

  private ReportError(error: Error): void
  {
    for (const handler of this.m_errorHandlers)
    {
      handler(error);
    }
  }
}
