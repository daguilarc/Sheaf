import { createHash } from "node:crypto";

import type { AdapterEvent } from "../adapters/types.js";
import {
  canonicalJson,
  sanitizeValue,
  truncateUtf8,
} from "../sanitize.js";

export type PriorWatchdogVerdict = {
  readonly verdict: "healthy" | "derailed" | "uncertain";
  readonly confidence: number;
  readonly reason_code: string;
};

export type EvidenceSuspicionSignal =
  | "repeated_tool_fingerprint"
  | "repeated_failure_fingerprint";

export type EvidenceFingerprint = {
  readonly fingerprint: string;
  readonly count: number;
};

export type SemanticEvidenceInput = {
  readonly original_prompt: string;
  readonly recent_events: readonly Record<string, unknown>[];
  readonly tool_fingerprints: readonly EvidenceFingerprint[];
  readonly failure_fingerprints: readonly EvidenceFingerprint[];
  readonly elapsed_ms: number;
  readonly previous_verdict?: PriorWatchdogVerdict;
  readonly suspicion_signals: readonly EvidenceSuspicionSignal[];
  readonly truncated: boolean;
};

export type SemanticEvidenceSnapshot = SemanticEvidenceInput & {
  readonly input: SemanticEvidenceInput;
  readonly input_bytes: number;
};

export type SemanticEvidenceWindowOptions = {
  readonly repoRoot: string;
  readonly originalPrompt: string;
  readonly clock?: () => Date;
  readonly previousVerdict?: PriorWatchdogVerdict;
  readonly maxInputBytes?: number;
  readonly suspicionWindowMs?: number;
  readonly repeatedToolThreshold?: number;
  readonly repeatedFailureThreshold?: number;
};

type TimedEvent = {
  readonly recordedAt: number;
  readonly event: Record<string, unknown>;
};

type TimedFingerprint = {
  readonly recordedAt: number;
  readonly fingerprint: string;
};

const DEFAULT_MAX_INPUT_BYTES = 64 * 1024;
const DEFAULT_SUSPICION_WINDOW_MS = 10 * 60_000;
const MAX_RETAINED_EVENTS = 256;
const MAX_RETAINED_FINGERPRINTS = 512;
const MAX_SNAPSHOT_FINGERPRINTS_PER_KIND = 32;
const MAX_SINGLE_EVENT_BYTES = 16 * 1024;

export class SemanticEvidenceWindow {
  readonly #repoRoot: string;
  readonly #clock: () => Date;
  readonly #createdAt: number;
  readonly #previousVerdict?: PriorWatchdogVerdict;
  readonly #maxInputBytes: number;
  readonly #suspicionWindowMs: number;
  readonly #repeatedToolThreshold: number;
  readonly #repeatedFailureThreshold: number;
  readonly #originalPrompt: string;
  readonly #events: TimedEvent[] = [];
  readonly #toolFingerprints: TimedFingerprint[] = [];
  readonly #failureFingerprints: TimedFingerprint[] = [];
  #wasTruncated = false;

  constructor(options: SemanticEvidenceWindowOptions) {
    this.#repoRoot = options.repoRoot;
    this.#clock = options.clock ?? (() => new Date());
    this.#createdAt = this.#clock().getTime();
    this.#previousVerdict = options.previousVerdict;
    this.#maxInputBytes = positiveInteger(
      options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES,
      "maxInputBytes",
    );
    this.#suspicionWindowMs = positiveInteger(
      options.suspicionWindowMs ?? DEFAULT_SUSPICION_WINDOW_MS,
      "suspicionWindowMs",
    );
    this.#repeatedToolThreshold = positiveInteger(
      options.repeatedToolThreshold ?? 3,
      "repeatedToolThreshold",
    );
    this.#repeatedFailureThreshold = positiveInteger(
      options.repeatedFailureThreshold ?? 2,
      "repeatedFailureThreshold",
    );
    const sanitizedPrompt = sanitizeValue(options.originalPrompt, this.#repoRoot);
    this.#originalPrompt = truncateUtf8(sanitizedPrompt, this.#maxInputBytes);
    this.#wasTruncated = this.#originalPrompt !== sanitizedPrompt;
  }

  record(event: AdapterEvent): void {
    const now = this.#clock().getTime();
    this.#pruneFingerprints(now);
    const normalized = normalizeSemanticEvent(event, this.#repoRoot);
    if (normalized === undefined) {
      return;
    }

    const bounded = boundEvent(normalized);
    this.#wasTruncated ||= bounded.truncated;
    this.#events.push({ recordedAt: now, event: bounded.event });
    if (this.#events.length > MAX_RETAINED_EVENTS) {
      this.#events.shift();
      this.#wasTruncated = true;
    }

    if (event.type === "tool.started") {
      this.#toolFingerprints.push({
        recordedAt: now,
        fingerprint: fingerprint({
          name: event.name,
          input: sanitizeValue(event.input, this.#repoRoot),
        }),
      });
      trimStart(this.#toolFingerprints, MAX_RETAINED_FINGERPRINTS);
    }

    const failure = normalizeFailureFingerprint(event, this.#repoRoot);
    if (failure !== undefined) {
      this.#failureFingerprints.push({ recordedAt: now, fingerprint: fingerprint(failure) });
      trimStart(this.#failureFingerprints, MAX_RETAINED_FINGERPRINTS);
    }
  }

  snapshot(): SemanticEvidenceSnapshot {
    const now = this.#clock().getTime();
    this.#pruneFingerprints(now);
    const toolFingerprintCount = distinctFingerprintCount(this.#toolFingerprints);
    const failureFingerprintCount = distinctFingerprintCount(this.#failureFingerprints);
    const toolFingerprints = aggregateFingerprints(
      this.#toolFingerprints,
      MAX_SNAPSHOT_FINGERPRINTS_PER_KIND,
    );
    const failureFingerprints = aggregateFingerprints(
      this.#failureFingerprints,
      MAX_SNAPSHOT_FINGERPRINTS_PER_KIND,
    );
    const suspicionSignals: EvidenceSuspicionSignal[] = [];
    if (toolFingerprints.some(({ count }) => count >= this.#repeatedToolThreshold)) {
      suspicionSignals.push("repeated_tool_fingerprint");
    }
    if (failureFingerprints.some(({ count }) => count >= this.#repeatedFailureThreshold)) {
      suspicionSignals.push("repeated_failure_fingerprint");
    }

    let originalPrompt = this.#originalPrompt;
    let recentEvents = this.#events.map(({ event }) => event);
    let truncated = this.#wasTruncated
      || toolFingerprintCount > toolFingerprints.length
      || failureFingerprintCount > failureFingerprints.length;
    let input = this.#createInput(
      originalPrompt,
      recentEvents,
      toolFingerprints,
      failureFingerprints,
      suspicionSignals,
      truncated,
      now,
    );

    while (byteLength(input) > this.#maxInputBytes && recentEvents.length > 0) {
      recentEvents = recentEvents.slice(1);
      truncated = true;
      input = this.#createInput(
        originalPrompt,
        recentEvents,
        toolFingerprints,
        failureFingerprints,
        suspicionSignals,
        truncated,
        now,
      );
    }

    if (byteLength(input) > this.#maxInputBytes) {
      truncated = true;
      originalPrompt = fitPrompt(
        originalPrompt,
        this.#maxInputBytes,
        (candidate) => this.#createInput(
          candidate,
          recentEvents,
          toolFingerprints,
          failureFingerprints,
          suspicionSignals,
          truncated,
          now,
        ),
      );
      input = this.#createInput(
        originalPrompt,
        recentEvents,
        toolFingerprints,
        failureFingerprints,
        suspicionSignals,
        truncated,
        now,
      );
    }

    const inputBytes = byteLength(input);
    return {
      ...input,
      input,
      input_bytes: inputBytes,
    };
  }

  #createInput(
    originalPrompt: string,
    recentEvents: readonly Record<string, unknown>[],
    toolFingerprints: readonly EvidenceFingerprint[],
    failureFingerprints: readonly EvidenceFingerprint[],
    suspicionSignals: readonly EvidenceSuspicionSignal[],
    truncated: boolean,
    now: number,
  ): SemanticEvidenceInput {
    return {
      original_prompt: originalPrompt,
      recent_events: recentEvents,
      tool_fingerprints: toolFingerprints,
      failure_fingerprints: failureFingerprints,
      elapsed_ms: Math.max(0, now - this.#createdAt),
      ...(this.#previousVerdict === undefined
        ? {}
        : { previous_verdict: this.#previousVerdict }),
      suspicion_signals: suspicionSignals,
      truncated,
    };
  }

  #pruneFingerprints(now: number): void {
    const earliest = now - this.#suspicionWindowMs;
    while (
      this.#toolFingerprints[0] !== undefined
      && this.#toolFingerprints[0].recordedAt < earliest
    ) {
      this.#toolFingerprints.shift();
    }
    while (
      this.#failureFingerprints[0] !== undefined
      && this.#failureFingerprints[0].recordedAt < earliest
    ) {
      this.#failureFingerprints.shift();
    }
  }
}

function normalizeSemanticEvent(
  event: AdapterEvent,
  repoRoot: string,
): Record<string, unknown> | undefined {
  switch (event.type) {
    case "message.delta":
      return sanitizeValue({
        type: event.type,
        role: event.role,
        delta: event.delta,
      }, repoRoot);
    case "message.completed":
      return sanitizeValue({
        type: event.type,
        role: event.role,
        text: event.text,
      }, repoRoot);
    case "tool.started":
      return sanitizeValue({
        type: event.type,
        name: event.name,
        ...(event.input === undefined ? {} : { input: event.input }),
      }, repoRoot);
    case "tool.completed":
      return sanitizeValue({
        type: event.type,
        name: event.name,
        status: event.status,
        ...(event.output === undefined ? {} : { output: event.output }),
        ...(event.error === undefined ? {} : { error: event.error }),
      }, repoRoot);
    case "turn.failed":
      return sanitizeValue({
        type: event.type,
        code: event.code,
        message: event.message,
        ...(event.details === undefined ? {} : { details: event.details }),
      }, repoRoot);
    case "error":
      return sanitizeValue({
        type: event.type,
        code: event.code,
        message: event.message,
        ...(event.details === undefined ? {} : { details: event.details }),
      }, repoRoot);
    case "raw.provider":
    case "status":
    case "turn.completed":
      return undefined;
  }
}

function normalizeFailureFingerprint(
  event: AdapterEvent,
  repoRoot: string,
): Record<string, unknown> | undefined {
  if (event.type === "tool.completed" && event.status === "failed") {
    return sanitizeValue({
      name: event.name,
      ...(event.error === undefined ? {} : { error: event.error }),
      ...(event.output === undefined ? {} : { output: event.output }),
    }, repoRoot);
  }
  if (event.type === "turn.failed" || event.type === "error") {
    return sanitizeValue({
      code: event.code,
      message: event.message,
    }, repoRoot);
  }
  return undefined;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function aggregateFingerprints(
  entries: readonly TimedFingerprint[],
  maximum: number,
): EvidenceFingerprint[] {
  const counts = new Map<string, number>();
  for (const { fingerprint: value } of entries) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts]
    .map(([value, count]) => ({ fingerprint: value, count }))
    .sort((left, right) =>
      right.count - left.count || left.fingerprint.localeCompare(right.fingerprint))
    .slice(0, maximum)
    .sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
}

function distinctFingerprintCount(entries: readonly TimedFingerprint[]): number {
  return new Set(entries.map(({ fingerprint: value }) => value)).size;
}

function boundEvent(event: Record<string, unknown>): {
  readonly event: Record<string, unknown>;
  readonly truncated: boolean;
} {
  const encoded = JSON.stringify(event);
  if (Buffer.byteLength(encoded, "utf8") <= MAX_SINGLE_EVENT_BYTES) {
    return { event, truncated: false };
  }
  return {
    event: {
      type: event.type,
      summary: truncateUtf8(encoded, MAX_SINGLE_EVENT_BYTES),
      truncated: true,
    },
    truncated: true,
  };
}

function fitPrompt(
  prompt: string,
  maxBytes: number,
  buildInput: (candidate: string) => SemanticEvidenceInput,
): string {
  const characters = [...prompt];
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = characters.slice(0, middle).join("");
    if (byteLength(buildInput(candidate)) <= maxBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return characters.slice(0, low).join("");
}

function byteLength(value: SemanticEvidenceInput): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function trimStart<T>(items: T[], maximum: number): void {
  if (items.length > maximum) {
    items.splice(0, items.length - maximum);
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return value;
}
