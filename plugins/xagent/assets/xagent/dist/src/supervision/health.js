export class DeterministicHealthMonitor {
    #silenceTimeoutMs;
    #hardDeadlineMs;
    #clock;
    #scheduler;
    #onClassification;
    #active = false;
    #activeStartedAt;
    #lastTransportActivityMs;
    #lastSemanticActivityMs;
    #silenceHandle;
    #hardDeadlineHandle;
    #silenceReported = false;
    #hardDeadlineReported = false;
    #reportedExposedWaits = new Set();
    constructor(options) {
        if (!Number.isFinite(options.silenceTimeoutMs) || options.silenceTimeoutMs <= 0) {
            throw new Error("silenceTimeoutMs must be a positive finite number.");
        }
        if (options.hardDeadlineMs !== undefined
            && (!Number.isFinite(options.hardDeadlineMs) || options.hardDeadlineMs <= 0)) {
            throw new Error("hardDeadlineMs must be a positive finite number when provided.");
        }
        this.#silenceTimeoutMs = options.silenceTimeoutMs;
        this.#hardDeadlineMs = options.hardDeadlineMs;
        this.#clock = options.clock ?? (() => new Date());
        this.#scheduler = options.scheduler ?? systemScheduler;
        this.#onClassification = options.onClassification;
        const now = this.#clock().getTime();
        this.#lastTransportActivityMs = now;
        this.#lastSemanticActivityMs = now;
    }
    get lastTransportActivityAt() {
        return new Date(this.#lastTransportActivityMs).toISOString();
    }
    get lastSemanticActivityAt() {
        return new Date(this.#lastSemanticActivityMs).toISOString();
    }
    recordProviderActivity(kind) {
        const now = this.#clock().getTime();
        this.#lastTransportActivityMs = now;
        if (kind === "semantic") {
            this.#lastSemanticActivityMs = now;
            this.#reportedExposedWaits.clear();
        }
        if (!this.#active) {
            return;
        }
        this.#silenceReported = false;
        this.#scheduleSilence();
    }
    recordMechanicalEvent(event) {
        switch (event.type) {
            case "process.spawned":
            case "provider.started":
                this.#activate();
                return undefined;
            case "process.exited":
                this.#deactivate();
                return {
                    kind: "failure",
                    reason: "process_exit",
                    payload: { exit_code: event.exitCode, signal: event.signal },
                };
            case "provider.completed":
                this.#deactivate();
                return { kind: "completion", reason: "provider_completed" };
            case "provider.failed":
                this.#deactivate();
                return {
                    kind: "failure",
                    reason: event.code,
                    payload: { message: event.message },
                };
            case "transport.lost":
                this.#deactivate();
                return {
                    kind: "failure",
                    reason: "transport_loss",
                    payload: { message: event.message },
                };
            case "input.required":
                return this.#exposedWaitAttention("input_required", event.prompt === undefined ? undefined : { prompt: event.prompt });
            case "permission.required":
                return this.#exposedWaitAttention("permission_required", event.permission === undefined ? undefined : { permission: event.permission });
            case "cancelled":
                this.#deactivate();
                return { kind: "cancellation", reason: "cancelled" };
        }
    }
    nextDeadline() {
        if (!this.#active) {
            return undefined;
        }
        const deadlines = [];
        if (!this.#silenceReported) {
            deadlines.push({
                reason: "silence_timeout",
                atMs: this.#lastTransportActivityMs + this.#silenceTimeoutMs,
            });
        }
        if (!this.#hardDeadlineReported
            && this.#hardDeadlineMs !== undefined
            && this.#activeStartedAt !== undefined) {
            deadlines.push({
                reason: "hard_deadline",
                atMs: this.#activeStartedAt + this.#hardDeadlineMs,
            });
        }
        const next = deadlines.sort((left, right) => left.atMs - right.atMs)[0];
        return next === undefined
            ? undefined
            : { reason: next.reason, at: new Date(next.atMs).toISOString() };
    }
    #activate() {
        const now = this.#clock().getTime();
        this.#active = true;
        this.#activeStartedAt = now;
        this.#lastTransportActivityMs = now;
        this.#lastSemanticActivityMs = now;
        this.#silenceReported = false;
        this.#hardDeadlineReported = false;
        this.#reportedExposedWaits.clear();
        this.#cancelTimers();
        this.#scheduleSilence();
        if (this.#hardDeadlineMs !== undefined) {
            this.#hardDeadlineHandle = this.#scheduler.setTimeout(() => {
                if (!this.#active || this.#hardDeadlineReported) {
                    return;
                }
                this.#hardDeadlineReported = true;
                this.#onClassification({ kind: "attention", reason: "hard_deadline" });
            }, this.#hardDeadlineMs);
        }
    }
    #deactivate() {
        this.#active = false;
        this.#reportedExposedWaits.clear();
        this.#cancelTimers();
    }
    #exposedWaitAttention(reason, payload) {
        if (this.#reportedExposedWaits.has(reason)) {
            return undefined;
        }
        this.#reportedExposedWaits.add(reason);
        return {
            kind: "attention",
            reason,
            ...(payload === undefined ? {} : { payload }),
        };
    }
    #scheduleSilence() {
        if (this.#silenceHandle !== undefined) {
            this.#scheduler.clearTimeout(this.#silenceHandle);
        }
        this.#silenceHandle = this.#scheduler.setTimeout(() => {
            if (!this.#active || this.#silenceReported) {
                return;
            }
            const remaining = this.#lastTransportActivityMs + this.#silenceTimeoutMs
                - this.#clock().getTime();
            if (remaining > 0) {
                this.#scheduleSilence();
                return;
            }
            this.#silenceReported = true;
            this.#onClassification({ kind: "attention", reason: "silence_timeout" });
        }, this.#silenceTimeoutMs);
    }
    #cancelTimers() {
        if (this.#silenceHandle !== undefined) {
            this.#scheduler.clearTimeout(this.#silenceHandle);
            this.#silenceHandle = undefined;
        }
        if (this.#hardDeadlineHandle !== undefined) {
            this.#scheduler.clearTimeout(this.#hardDeadlineHandle);
            this.#hardDeadlineHandle = undefined;
        }
    }
}
const systemScheduler = {
    setTimeout(callback, delayMs) {
        return setTimeout(callback, delayMs);
    },
    clearTimeout(handle) {
        clearTimeout(handle);
    },
};
//# sourceMappingURL=health.js.map