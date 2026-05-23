import type { QueueRequestOptions, QueuedEventResult, RealtimeEvent } from "./types.js";

interface QueuedResponseUnit
{
  run: () => void;
}

function ReadNestedString(value: unknown, key: string): string | undefined
{
  if (typeof value !== "object" || value === null)
  {
    return undefined;
  }

  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
}

function ReadResponseIdFromEnvelope(event: RealtimeEvent): string | undefined
{
  const top = ReadNestedString(event, "response_id");
  if (top !== undefined)
  {
    return top;
  }

  const response = event.response;
  if (typeof response === "object" && response !== null)
  {
    const id = ReadNestedString(response, "id");
    if (id !== undefined)
    {
      return id;
    }
  }

  return undefined;
}

function ReadErrorAssociatedResponseId(event: RealtimeEvent): string | undefined
{
  const err = event.error;
  if (typeof err === "object" && err !== null)
  {
    const fromError = ReadNestedString(err, "response_id");
    if (fromError !== undefined)
    {
      return fromError;
    }
  }

  return ReadNestedString(event, "response_id");
}

export interface ResponseQueueOptions
{
  transmit: (event: RealtimeEvent) => void;
}

export class ResponseQueue
{
  private m_transmit: (event: RealtimeEvent) => void;
  private m_serverResponseActive = false;
  private m_outboundCreatePending = false;
  private m_activeResponseId: string | undefined;
  private m_fifo: QueuedResponseUnit[] = [];
  private m_draining = false;
  private m_pendingToolOutputCallIds = new Set<string>();

  constructor(options: ResponseQueueOptions)
  {
    this.m_transmit = options.transmit;
  }

  IsBusy(): boolean
  {
    return (
      this.m_serverResponseActive ||
      this.m_outboundCreatePending ||
      this.m_pendingToolOutputCallIds.size > 0
    );
  }

  // Reserve a slot for an in-flight tool output whose `function_call_output`
  // has not yet been transmitted. While at least one such reservation exists,
  // the queue treats itself as busy so that externally queued response-affecting
  // units cannot drain ahead of the tool result the model is waiting for.
  //
  RegisterPendingToolOutput(callId: string): void
  {
    this.m_pendingToolOutputCallIds.add(callId);
  }

  NotifyOutgoingTransmitted(event: RealtimeEvent): void
  {
    if (event.type === "response.create")
    {
      this.m_outboundCreatePending = true;
      return;
    }

    if (event.type === "conversation.item.create")
    {
      const item = event.item;
      if (typeof item === "object" && item !== null)
      {
        const record = item as { type?: unknown; call_id?: unknown };
        if (record.type === "function_call_output" && typeof record.call_id === "string")
        {
          if (this.m_pendingToolOutputCallIds.delete(record.call_id))
          {
            this.TryDrain();
          }
        }
      }
    }
  }

  OnIncomingEvent(event: RealtimeEvent): void
  {
    if (event.type === "response.created")
    {
      const id = ReadResponseIdFromEnvelope(event);
      this.m_serverResponseActive = true;
      this.m_activeResponseId = id;
      this.m_outboundCreatePending = false;
      return;
    }

    if (event.type === "response.done" || event.type === "response.cancelled")
    {
      this.ClearActiveResponseState();
      this.TryDrain();
      return;
    }

    if (event.type === "error")
    {
      this.HandleIncomingError(event);
      return;
    }
  }

  async SubmitResponseAffectingUnit(
    run: () => void,
    options?: QueueRequestOptions,
  ): Promise<QueuedEventResult>
  {
    const policy = options?.queuePolicy ?? "enqueue";

    if (!this.IsBusy())
    {
      run();
      return { status: "sent" };
    }

    if (policy === "reject")
    {
      return { status: "rejected", reason: "response_active" };
    }

    if (policy === "cancel_current")
    {
      this.EmitResponseCancelForActive();
      this.m_fifo.push({ run });
      return { status: "queued", reason: "cancelling_active" };
    }

    this.m_fifo.push({ run });
    return { status: "queued" };
  }

  async EnqueueToolFollowUpResponseCreate(run: () => void): Promise<QueuedEventResult>
  {
    return this.SubmitResponseAffectingUnit(run, { queuePolicy: "enqueue" });
  }

  private EmitResponseCancelForActive(): void
  {
    if (this.m_activeResponseId !== undefined)
    {
      this.m_transmit({
        type: "response.cancel",
        response_id: this.m_activeResponseId,
      });
      return;
    }

    this.m_transmit({
      type: "response.cancel",
    });
  }

  private ClearActiveResponseState(): void
  {
    this.m_serverResponseActive = false;
    this.m_activeResponseId = undefined;
    this.m_outboundCreatePending = false;
  }

  private HandleIncomingError(event: RealtimeEvent): void
  {
    const associatedId = ReadErrorAssociatedResponseId(event);

    if (
      this.m_serverResponseActive &&
      associatedId !== undefined &&
      this.m_activeResponseId !== undefined &&
      associatedId === this.m_activeResponseId
    )
    {
      this.ClearActiveResponseState();
      this.TryDrain();
    }
  }

  private TryDrain(): void
  {
    if (this.m_draining)
    {
      return;
    }

    this.m_draining = true;

    try
    {
      while (this.m_fifo.length > 0 && !this.IsBusy())
      {
        const unit = this.m_fifo.shift();
        if (unit === undefined)
        {
          continue;
        }

        unit.run();
      }
    }
    finally
    {
      this.m_draining = false;
    }
  }
}
