import type { RealtimeWebSocketLike } from "../../../src/agent/src/types.js";

const x_connectingReadyState = 0;
const x_openReadyState = 1;
const x_closingReadyState = 2;
const x_closedReadyState = 3;

type OpenListener = () => void;
type MessageListener = (data: string) => void;
type ErrorListener = (error: Error) => void;
type CloseListener = (code: number, reason: string) => void;

export interface FakeWebSocketConnectRecord
{
  url: string;
  headers: Record<string, string>;
}

export class FakeWebSocket implements RealtimeWebSocketLike
{
  readonly connectRecord: FakeWebSocketConnectRecord;
  private m_readyState = x_connectingReadyState;
  private m_openListeners = new Set<OpenListener>();
  private m_messageListeners = new Set<MessageListener>();
  private m_errorListeners = new Set<ErrorListener>();
  private m_closeListeners = new Set<CloseListener>();
  readonly sentMessages: string[] = [];

  constructor(url: string, options: { headers: Record<string, string> })
  {
    this.connectRecord = {
      url,
      headers: options.headers,
    };
  }

  get readyState(): number
  {
    return this.m_readyState;
  }

  open(): void
  {
    if (this.m_readyState !== x_connectingReadyState)
    {
      return;
    }

    this.m_readyState = x_openReadyState;
    for (const listener of this.m_openListeners)
    {
      listener();
    }
  }

  receiveMessage(payload: string): void
  {
    for (const listener of this.m_messageListeners)
    {
      listener(payload);
    }
  }

  emitError(error: Error): void
  {
    for (const listener of this.m_errorListeners)
    {
      listener(error);
    }
  }

  send(data: string): void
  {
    this.sentMessages.push(data);
  }

  close(code = 1000, reason = ""): void
  {
    if (this.m_readyState === x_closedReadyState || this.m_readyState === x_closingReadyState)
    {
      return;
    }

    this.m_readyState = x_closedReadyState;
    for (const listener of this.m_closeListeners)
    {
      listener(code, reason);
    }
  }

  on(event: "open", listener: OpenListener): void;
  on(event: "message", listener: MessageListener): void;
  on(event: "error", listener: ErrorListener): void;
  on(event: "close", listener: CloseListener): void;
  on(
    event: "open" | "message" | "error" | "close",
    listener: OpenListener | MessageListener | ErrorListener | CloseListener,
  ): void
  {
    if (event === "open")
    {
      this.m_openListeners.add(listener as OpenListener);
      return;
    }

    if (event === "message")
    {
      this.m_messageListeners.add(listener as MessageListener);
      return;
    }

    if (event === "error")
    {
      this.m_errorListeners.add(listener as ErrorListener);
      return;
    }

    this.m_closeListeners.add(listener as CloseListener);
  }

  off(event: "open", listener: OpenListener): void;
  off(event: "message", listener: MessageListener): void;
  off(event: "error", listener: ErrorListener): void;
  off(event: "close", listener: CloseListener): void;
  off(
    event: "open" | "message" | "error" | "close",
    listener: OpenListener | MessageListener | ErrorListener | CloseListener,
  ): void
  {
    if (event === "open")
    {
      this.m_openListeners.delete(listener as OpenListener);
      return;
    }

    if (event === "message")
    {
      this.m_messageListeners.delete(listener as MessageListener);
      return;
    }

    if (event === "error")
    {
      this.m_errorListeners.delete(listener as ErrorListener);
      return;
    }

    this.m_closeListeners.delete(listener as CloseListener);
  }
}

export function CreateFakeWebSocketFactory(
  sockets: FakeWebSocket[],
): (url: string, options: { headers: Record<string, string> }) => FakeWebSocket
{
  return (url, options) =>
  {
    const socket = new FakeWebSocket(url, options);
    sockets.push(socket);
    return socket;
  };
}
