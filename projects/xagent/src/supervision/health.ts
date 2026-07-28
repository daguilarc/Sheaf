import type { SupervisionScheduler } from "./types.js";

export type ProviderActivityKind = "transport" | "semantic";

export type MechanicalHealthEvent =
  | { readonly type: "process.spawned" }
  | {
      readonly type: "process.exited";
      readonly exitCode: number | null;
      readonly signal: string | null;
      // The adapter already builds a human-readable cause from the child's
      // stderr (process_jsonl.ts). Carrying it here is what lets a controller
      // see "usage limit reached" instead of a bare exit_code: 1.
      //
      readonly message?: string;
    }
  | { readonly type: "provider.started" }
  | { readonly type: "provider.completed" }
  | { readonly type: "provider.failed"; readonly code: string; readonly message: string }
  | { readonly type: "transport.lost"; readonly message: string }
  | { readonly type: "input.required"; readonly prompt?: string }
  | { readonly type: "permission.required"; readonly permission?: string }
  | { readonly type: "cancelled" };

export type DeterministicHealthClassification =
  | {
      readonly kind: "completion" | "failure" | "attention" | "cancellation";
      readonly reason: string;
      readonly payload?: unknown;
    };

export type DeterministicDeadline = {
  readonly reason: "silence_timeout" | "hard_deadline";
  readonly at: string;
};

export type DeterministicHealthMonitorOptions = {
  readonly silenceTimeoutMs: number;
  readonly hardDeadlineMs?: number;
  readonly clock?: () => Date;
  readonly scheduler?: SupervisionScheduler;
  readonly onClassification: (classification: DeterministicHealthClassification) => void;
};

export class DeterministicHealthMonitor {
  readonly #silenceTimeoutMs: number;
  readonly #hardDeadlineMs?: number;
  readonly #clock: () => Date;
  readonly #scheduler: SupervisionScheduler;
  readonly #onClassification: (classification: DeterministicHealthClassification) => void;
  #active = false;
  #activeStartedAt?: number;
  #lastTransportActivityMs: number;
  #lastSemanticActivityMs: number;
  #silenceHandle?: unknown;
  #hardDeadlineHandle?: unknown;
  #silenceReported = false;
  #hardDeadlineReported = false;
  readonly #reportedExposedWaits = new Set<"input_required" | "permission_required">();

  constructor(options: DeterministicHealthMonitorOptions) {
    if (!Number.isFinite(options.silenceTimeoutMs) || options.silenceTimeoutMs <= 0) {
      throw new Error("silenceTimeoutMs must be a positive finite number.");
    }
    if (
      options.hardDeadlineMs !== undefined
      && (!Number.isFinite(options.hardDeadlineMs) || options.hardDeadlineMs <= 0)
    ) {
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

  get lastTransportActivityAt(): string {
    return new Date(this.#lastTransportActivityMs).toISOString();
  }

  get lastSemanticActivityAt(): string {
    return new Date(this.#lastSemanticActivityMs).toISOString();
  }

  recordProviderActivity(kind: ProviderActivityKind): void {
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

  recordMechanicalEvent(
    event: MechanicalHealthEvent,
  ): DeterministicHealthClassification | undefined {
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
          payload: {
            exit_code: event.exitCode,
            signal: event.signal,
            ...(event.message === undefined || event.message.trim() === ""
              ? {}
              : { message: event.message }),
          },
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
        return this.#exposedWaitAttention(
          "input_required",
          event.prompt === undefined ? undefined : { prompt: event.prompt },
        );
      case "permission.required":
        return this.#exposedWaitAttention(
          "permission_required",
          event.permission === undefined ? undefined : { permission: event.permission },
        );
      case "cancelled":
        this.#deactivate();
        return { kind: "cancellation", reason: "cancelled" };
    }
  }

  nextDeadline(): DeterministicDeadline | undefined {
    if (!this.#active) {
      return undefined;
    }
    const deadlines: Array<{ reason: DeterministicDeadline["reason"]; atMs: number }> = [];
    if (!this.#silenceReported) {
      deadlines.push({
        reason: "silence_timeout",
        atMs: this.#lastTransportActivityMs + this.#silenceTimeoutMs,
      });
    }
    if (
      !this.#hardDeadlineReported
      && this.#hardDeadlineMs !== undefined
      && this.#activeStartedAt !== undefined
    ) {
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

  #activate(): void {
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

  #deactivate(): void {
    this.#active = false;
    this.#reportedExposedWaits.clear();
    this.#cancelTimers();
  }

  #exposedWaitAttention(
    reason: "input_required" | "permission_required",
    payload: unknown,
  ): DeterministicHealthClassification | undefined {
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

  #scheduleSilence(): void {
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

  #cancelTimers(): void {
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

const systemScheduler: SupervisionScheduler = {
  setTimeout(callback, delayMs) {
    return setTimeout(callback, delayMs);
  },
  clearTimeout(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};
