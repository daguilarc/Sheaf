export class SequencedEventQueue {
    runId;
    sink;
    clock;
    scheduler;
    #deliverableEvents = [];
    #waiters = new Set();
    #sequence = 0;
    #nextSequence = 0;
    #publishTail = Promise.resolve();
    constructor(runId, sink = async () => { }, clock = () => new Date(), scheduler = systemScheduler) {
        this.runId = runId;
        this.sink = sink;
        this.clock = clock;
        this.scheduler = scheduler;
    }
    get sequence() {
        return this.#sequence;
    }
    publish(body, deliverable = true, commit = async () => { }) {
        this.#nextSequence += 1;
        const event = {
            ...body,
            schema_version: 1,
            run_id: this.runId,
            sequence: this.#nextSequence,
            timestamp: this.clock().toISOString(),
        };
        const persisted = this.#publishTail.then(async () => {
            try {
                await this.sink(event);
                await commit(event);
                this.#sequence = event.sequence;
                if (!deliverable) {
                    return;
                }
                this.#deliverableEvents.push(event);
                for (const waiter of [...this.#waiters]) {
                    if (waiter.afterSequence < event.sequence) {
                        this.#settle(waiter, event);
                    }
                }
            }
            catch (error) {
                const persistenceError = asError(error);
                for (const waiter of [...this.#waiters]) {
                    this.#reject(waiter, persistenceError);
                }
                throw error;
            }
        });
        this.#publishTail = persisted;
        return persisted.then(() => event);
    }
    async awaitEvent(afterSequence, deadlineMs, signal) {
        await this.#publishTail;
        const available = this.#deliverableEvents.find((event) => event.sequence > afterSequence);
        if (available !== undefined) {
            return available;
        }
        if (signal?.aborted === true) {
            throw abortError();
        }
        return new Promise((resolve, reject) => {
            const waiter = {
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
    #settle(waiter, event) {
        if (!this.#waiters.delete(waiter)) {
            return;
        }
        this.scheduler.clearTimeout(waiter.timer);
        if (waiter.onAbort !== undefined) {
            waiter.signal?.removeEventListener("abort", waiter.onAbort);
        }
        waiter.resolve(event);
    }
    #reject(waiter, error) {
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
function abortError() {
    return new DOMException("The operation was aborted.", "AbortError");
}
function asError(error) {
    return error instanceof Error ? error : new Error(String(error));
}
const systemScheduler = {
    setTimeout(callback, delayMs) {
        return setTimeout(callback, delayMs);
    },
    clearTimeout(handle) {
        clearTimeout(handle);
    },
};
//# sourceMappingURL=event_queue.js.map