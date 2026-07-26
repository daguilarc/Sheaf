import type {
  WatchdogClassifier,
  WatchdogPolicy,
  WatchdogRequest,
  WatchdogUsage,
  WatchdogVerdict,
} from "./types.js";

const DEFAULT_CADENCE_MS = [10 * 60_000, 20 * 60_000, 40 * 60_000] as const;
const DEFAULT_MINIMUM_INTERVAL_MS = 5 * 60_000;
const DEFAULT_MAXIMUM_CALLS = 8;
const DEFAULT_CONFIDENCE_FLOOR = 0.8;
const MAX_INPUT_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024;
const MAX_REASON_CODE_LENGTH = 128;
const MAX_EVIDENCE_ITEMS = 8;
const MAX_EVIDENCE_ITEM_LENGTH = 512;

export type WatchdogSchedulerOptions = {
  readonly classifier: WatchdogClassifier;
  readonly policy?: WatchdogPolicy;
  readonly clock?: () => Date;
  readonly onVerdict?: (
    request: WatchdogRequest,
    verdict: WatchdogVerdict,
    callCount: number,
    currentTurn: boolean,
  ) => Promise<void> | void;
};

export class WatchdogScheduler {
  readonly #classifier: WatchdogClassifier;
  readonly #clock: () => Date;
  readonly #cadenceMs: readonly number[];
  readonly #minimumIntervalMs: number;
  readonly #maximumCalls: number;
  readonly #confidenceFloor: number;
  readonly #outputLimitBytes: number;
  readonly #onVerdict: NonNullable<WatchdogSchedulerOptions["onVerdict"]>;
  #turnStartedAt = 0;
  #nextPeriodicAt = 0;
  #cadenceIndex = 0;
  #lastInvocationAt?: number;
  #callsUsed = 0;
  #inFlight?: Promise<void>;
  #turnGeneration = 0;

  constructor(options: WatchdogSchedulerOptions) {
    this.#classifier = options.classifier;
    this.#clock = options.clock ?? (() => new Date());
    validateInvocationBounds(options.policy);
    this.#cadenceMs = validatedCadence(options.policy?.cadenceMs);
    this.#minimumIntervalMs = validatedPositiveInteger(
      options.policy?.minimumIntervalMs ?? DEFAULT_MINIMUM_INTERVAL_MS,
      "minimumIntervalMs",
    );
    if (this.#minimumIntervalMs < DEFAULT_MINIMUM_INTERVAL_MS) {
      throw new Error(
        `minimumIntervalMs must be at least ${DEFAULT_MINIMUM_INTERVAL_MS} milliseconds.`,
      );
    }
    this.#maximumCalls = validatedPositiveInteger(
      options.policy?.maximumCalls ?? DEFAULT_MAXIMUM_CALLS,
      "maximumCalls",
    );
    if (this.#maximumCalls > DEFAULT_MAXIMUM_CALLS) {
      throw new Error(`maximumCalls cannot exceed ${DEFAULT_MAXIMUM_CALLS}.`);
    }
    this.#confidenceFloor = validatedConfidence(
      options.policy?.confidenceFloor ?? DEFAULT_CONFIDENCE_FLOOR,
    );
    this.#outputLimitBytes = options.policy?.outputLimitBytes ?? MAX_OUTPUT_BYTES;
    this.#onVerdict = options.onVerdict ?? (() => {});
    this.resetTurn();
  }

  get callsUsed(): number {
    return this.#callsUsed;
  }

  get coverageExhausted(): boolean {
    return this.#callsUsed >= this.#maximumCalls;
  }

  resetTurn(): void {
    this.#turnGeneration += 1;
    this.#turnStartedAt = this.#clock().getTime();
    this.#cadenceIndex = 0;
    this.#nextPeriodicAt = this.#turnStartedAt + this.#cadenceMs[0]!;
  }

  onActiveEvidence(request: WatchdogRequest): Promise<void> {
    if (this.coverageExhausted || this.#inFlight !== undefined) {
      return this.#inFlight ?? Promise.resolve();
    }
    const now = this.#clock().getTime();
    const lastRelevantCheck = this.#lastInvocationAt ?? this.#turnStartedAt;
    const minimumElapsed = now - lastRelevantCheck >= this.#minimumIntervalMs;
    const suspicionEligible = request.suspicion_signals.length > 0 && minimumElapsed;
    const periodicEligible = now >= this.#nextPeriodicAt && minimumElapsed;
    if (!suspicionEligible && !periodicEligible) {
      return Promise.resolve();
    }

    this.#callsUsed += 1;
    const callCount = this.#callsUsed;
    this.#lastInvocationAt = now;
    const trigger = periodicEligible ? "periodic" : "suspicion";
    const turnGeneration = this.#turnGeneration;
    if (trigger === "periodic") {
      this.#nextPeriodicAt = now + this.#cadenceMs[this.#cadenceIndex]!;
    }
    const controller = new AbortController();
    const pending = (async () => {
      let verdict: WatchdogVerdict;
      try {
        const raw = await this.#classifier.classify(request, controller.signal);
        verdict = withClassifierTelemetry(
          normalizeWatchdogVerdict(raw, this.#confidenceFloor),
          raw,
          this.#outputLimitBytes,
        );
      } catch {
        verdict = uncertain("classifier_invocation_failed");
      }
      const currentTurn = turnGeneration === this.#turnGeneration;
      if (trigger === "periodic" && currentTurn) {
        this.#cadenceIndex = verdict.verdict === "healthy"
          ? Math.min(this.#cadenceIndex + 1, this.#cadenceMs.length - 1)
          : 0;
        this.#nextPeriodicAt = now + this.#cadenceMs[this.#cadenceIndex]!;
      }
      await this.#onVerdict(request, verdict, callCount, currentTurn);
    })();
    this.#inFlight = pending.finally(() => {
      this.#inFlight = undefined;
    });
    return this.#inFlight;
  }
}

export function normalizeWatchdogVerdict(
  value: unknown,
  confidenceFloor = DEFAULT_CONFIDENCE_FLOOR,
): WatchdogVerdict {
  if (!isRecord(value) || Object.keys(value).some((key) => ![
    "verdict",
    "confidence",
    "reason_code",
    "evidence",
    "usage",
    "estimated_cost_usd",
    "output_bytes",
  ].includes(key))) {
    return uncertain("invalid_classifier_output");
  }
  if (
    value.verdict !== "healthy"
    && value.verdict !== "derailed"
    && value.verdict !== "uncertain"
  ) {
    return uncertain("invalid_classifier_output");
  }
  if (
    typeof value.confidence !== "number"
    || !Number.isFinite(value.confidence)
    || value.confidence < 0
    || value.confidence > 1
    || typeof value.reason_code !== "string"
    || value.reason_code.length === 0
    || value.reason_code.length > MAX_REASON_CODE_LENGTH
    || !/^[a-z0-9_]+$/.test(value.reason_code)
    || !Array.isArray(value.evidence)
    || value.evidence.length > MAX_EVIDENCE_ITEMS
    || value.evidence.some((item) =>
      typeof item !== "string" || item.length > MAX_EVIDENCE_ITEM_LENGTH)
  ) {
    return uncertain("invalid_classifier_output");
  }
  const normalized: WatchdogVerdict = {
    verdict: value.verdict,
    confidence: value.confidence,
    reason_code: value.reason_code,
    evidence: value.evidence as string[],
  };
  if (normalized.verdict === "healthy" && normalized.confidence < confidenceFloor) {
    return {
      ...normalized,
      verdict: "uncertain",
      reason_code: "healthy_below_confidence_floor",
    };
  }
  return normalized;
}

function withClassifierTelemetry(
  normalized: WatchdogVerdict,
  raw: WatchdogVerdict,
  outputLimitBytes: number,
): WatchdogVerdict {
  const usage = normalizedUsage(raw.usage);
  const estimatedCost = finiteNonNegative(raw.estimated_cost_usd);
  const outputBytes = boundedNonNegativeInteger(raw.output_bytes, outputLimitBytes);
  return {
    ...normalized,
    ...(usage === undefined ? {} : { usage }),
    ...(estimatedCost === undefined ? {} : { estimated_cost_usd: estimatedCost }),
    ...(outputBytes === undefined ? {} : { output_bytes: outputBytes }),
  };
}

function normalizedUsage(value: unknown): WatchdogUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const inputTokens = nonNegativeSafeInteger(value.input_tokens);
  const outputTokens = nonNegativeSafeInteger(value.output_tokens);
  if (inputTokens === undefined && outputTokens === undefined) {
    return undefined;
  }
  return {
    ...(inputTokens === undefined ? {} : { input_tokens: inputTokens }),
    ...(outputTokens === undefined ? {} : { output_tokens: outputTokens }),
  };
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function nonNegativeSafeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function boundedNonNegativeInteger(
  value: unknown,
  maximum: number,
): number | undefined {
  const normalized = nonNegativeSafeInteger(value);
  return normalized === undefined ? undefined : Math.min(normalized, maximum + 1);
}

function validatedCadence(value: readonly number[] | undefined): readonly number[] {
  const cadence = value ?? DEFAULT_CADENCE_MS;
  if (cadence.length === 0) {
    throw new Error("cadenceMs must contain at least one interval.");
  }
  return cadence.map((interval) => validatedPositiveInteger(interval, "cadenceMs"));
}

function validatedPositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return value;
}

function validatedConfidence(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("confidenceFloor must be between 0 and 1.");
  }
  return value;
}

function validateInvocationBounds(policy: WatchdogPolicy | undefined): void {
  if (
    policy?.inputLimitBytes !== undefined
    && (
      !Number.isSafeInteger(policy.inputLimitBytes)
      || policy.inputLimitBytes <= 0
      || policy.inputLimitBytes > MAX_INPUT_BYTES
    )
  ) {
    throw new Error(`inputLimitBytes cannot exceed ${MAX_INPUT_BYTES}.`);
  }
  if (
    policy?.outputLimitBytes !== undefined
    && (
      !Number.isSafeInteger(policy.outputLimitBytes)
      || policy.outputLimitBytes <= 0
      || policy.outputLimitBytes > MAX_OUTPUT_BYTES
    )
  ) {
    throw new Error(`outputLimitBytes cannot exceed ${MAX_OUTPUT_BYTES}.`);
  }
  if (
    policy?.timeoutMs !== undefined
    && (!Number.isFinite(policy.timeoutMs) || policy.timeoutMs <= 0)
  ) {
    throw new Error("timeoutMs must be a positive finite number.");
  }
  if (
    policy?.maxBudgetUsd !== undefined
    && (!Number.isFinite(policy.maxBudgetUsd) || policy.maxBudgetUsd <= 0)
  ) {
    throw new Error("maxBudgetUsd must be a positive finite number.");
  }
}

function uncertain(reasonCode: string): WatchdogVerdict {
  return {
    verdict: "uncertain",
    confidence: 0,
    reason_code: reasonCode,
    evidence: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
