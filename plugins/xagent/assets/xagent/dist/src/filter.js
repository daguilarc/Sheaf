export class OutputFilter {
    #mode;
    #clock;
    #deltaIntervalMs;
    #pendingDelta;
    #lastDeltaEmitMs = Number.NEGATIVE_INFINITY;
    constructor(options) {
        this.#mode = options.mode;
        this.#clock = options.clock ?? { now: () => Date.now() };
        this.#deltaIntervalMs = options.deltaIntervalMs ?? 1500;
    }
    handle(event) {
        if (this.#mode === "full") {
            return [event];
        }
        if (event.type === "raw.provider") {
            return [];
        }
        if (event.type === "message.delta") {
            return this.#handleDelta(event);
        }
        const flushed = event.type === "message.completed" || this.#canEmitDelta()
            ? this.flush()
            : this.#discardPendingDelta();
        if (event.type === "tool.completed" && "output" in event) {
            const { output: _output, ...withoutOutput } = event;
            return [...flushed, withoutOutput];
        }
        return [...flushed, event];
    }
    flush() {
        if (this.#pendingDelta === undefined) {
            return [];
        }
        const event = this.#pendingDelta;
        this.#pendingDelta = undefined;
        this.#lastDeltaEmitMs = this.#clock.now();
        return [event];
    }
    #discardPendingDelta() {
        this.#pendingDelta = undefined;
        return [];
    }
    #handleDelta(event) {
        if (event.type !== "message.delta") {
            return [event];
        }
        if (this.#pendingDelta !== undefined &&
            this.#pendingDelta.type === "message.delta" &&
            isSameDeltaIdentity(this.#pendingDelta, event)) {
            this.#pendingDelta = {
                ...event,
                delta: `${this.#pendingDelta.delta}${event.delta}`,
            };
        }
        else if (this.#pendingDelta !== undefined) {
            const prior = this.#canEmitDelta() ? this.flush() : this.#discardPendingDelta();
            this.#pendingDelta = event;
            return prior;
        }
        else {
            this.#pendingDelta = event;
        }
        if (this.#canEmitDelta()) {
            return this.flush();
        }
        return [];
    }
    #canEmitDelta() {
        return this.#clock.now() - this.#lastDeltaEmitMs >= this.#deltaIntervalMs;
    }
}
export function createOutputFilter(options) {
    return new OutputFilter(options);
}
function isSameDeltaIdentity(left, right) {
    return (left.type === "message.delta" &&
        right.type === "message.delta" &&
        left.turn_id === right.turn_id &&
        left.message_id === right.message_id &&
        left.role === right.role);
}
//# sourceMappingURL=filter.js.map