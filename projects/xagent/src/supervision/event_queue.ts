import type {
  SupervisionEvent,
  SupervisionEventSink,
  SupervisionScheduler,
} from "./types.js";

export type PublishableSupervisionEvent = Omit<
  SupervisionEvent,
  "schema_version" | "run_id" | "sequence" | "timestamp"
>;

type Waiter = {
  readonly afterSequence: number;
  readonly resolve: (event: SupervisionEvent | undefined) => void;
  readonly reject: (error: Error) => void;
  readonly timer: unknown;
  readonly signal?: AbortSignal;
  readonly onAbort?: () => void;
};

export class SequencedEventQueue {
  readonly #deliverableEvents: SupervisionEvent[] = [];
  readonly #waiters = new Set<Waiter>();
  #sequence = 0;
  #publishTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly runId: string,
    private readonly sink: SupervisionEventSink = async () => {},
    private readonly clock: () => Date = () => new Date(),
    private readonly scheduler: SupervisionScheduler = systemScheduler,
  ) {}

  get sequence(): number {
    return this.#sequence;
  }

  publish(body: PublishableSupervisionEvent, deliverable = true): Promise<SupervisionEvent> {
    this.#sequence += 1;
    const event: SupervisionEvent = {
      ...body,
      schema_version: 1,
      run_id: this.runId,
      sequence: this.#sequence,
      timestamp: this.clock().toISOString(),
    };
    const persisted = this.#publishTail.then(async () => {
      await this.sink(event);
      if (!deliverable) {
        return;
      }
      this.#deliverableEvents.push(event);
      for (const waiter of [...this.#waiters]) {
        if (waiter.afterSequence < event.sequence) {
          this.#settle(waiter, event);
        }
      }
    });
    this.#publishTail = persisted;
    return persisted.then(() => event);
  }

  async awaitEvent(
    afterSequence: number,
    deadlineMs: number,
    signal?: AbortSignal,
  ): Promise<SupervisionEvent | undefined> {
    await this.#publishTail;
    const available = this.#deliverableEvents.find((event) => event.sequence > afterSequence);
    if (available !== undefined) {
      return available;
    }
    if (signal?.aborted === true) {
      throw abortError();
    }

    return new Promise<SupervisionEvent | undefined>((resolve, reject) => {
      const waiter: Waiter = {
        afterSequence,
        resolve,
        reject,
        timer: this.scheduler.setTimeout(() => {
          this.#settle(waiter, undefined);
        }, Math.max(0, deadlineMs)),
        signal,
        onAbort: signal === undefined
          ? undefined
          : () => {
              this.#reject(waiter, abortError());
            },
      };
      this.#waiters.add(waiter);
      if (waiter.onAbort !== undefined) {
        signal?.addEventListener("abort", waiter.onAbort, { once: true });
      }
    });
  }

  #settle(waiter: Waiter, event: SupervisionEvent | undefined): void {
    if (!this.#waiters.delete(waiter)) {
      return;
    }
    this.scheduler.clearTimeout(waiter.timer);
    if (waiter.onAbort !== undefined) {
      waiter.signal?.removeEventListener("abort", waiter.onAbort);
    }
    waiter.resolve(event);
  }

  #reject(waiter: Waiter, error: Error): void {
    if (!this.#waiters.delete(waiter)) {
      return;
    }
    this.scheduler.clearTimeout(waiter.timer);
    if (waiter.onAbort !== undefined) {
      waiter.signal?.removeEventListener("abort", waiter.onAbort);
    }
    waiter.reject(error);
  }
}

function abortError(): Error {
  return new DOMException("The operation was aborted.", "AbortError");
}

const systemScheduler: SupervisionScheduler = {
  setTimeout(callback, delayMs) {
    return setTimeout(callback, delayMs);
  },
  clearTimeout(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};
