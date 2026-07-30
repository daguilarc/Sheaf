import type { HarnessName } from "../events.js";
import { truncateUtf8 } from "../sanitize.js";

export type ProviderJsonEvidenceInput = {
  readonly original_prompt: string;
  readonly harness: HarnessName;
  readonly recent_provider_json: readonly unknown[];
  readonly elapsed_ms: number;
  readonly truncated: boolean;
};

export type ProviderJsonEvidenceSnapshot = ProviderJsonEvidenceInput & {
  readonly input_bytes: number;
};

export type ProviderJsonEvidenceWindowOptions = {
  readonly harness: HarnessName;
  readonly originalPrompt: string;
  readonly clock?: () => Date;
  readonly maxInputBytes?: number;
  readonly maxStringBytes?: number;
};

type RetainedRecord = {
  readonly value: unknown;
  readonly bytes: number;
};

const DEFAULT_MAX_INPUT_BYTES = 64 * 1024;
const DEFAULT_MAX_STRING_BYTES = 16 * 1024;
const MIN_INPUT_BYTES = 512;
const TRUNCATION_MARKER = "[xagent: truncated]";

export class ProviderJsonEvidenceWindow {
  readonly #harness: HarnessName;
  readonly #clock: () => Date;
  readonly #createdAt: number;
  readonly #maxInputBytes: number;
  readonly #maxStringBytes: number;
  readonly #originalPrompt: string;
  readonly #records: RetainedRecord[] = [];
  #retainedRecordBytes = 0;
  #wasTruncated = false;

  constructor(options: ProviderJsonEvidenceWindowOptions) {
    validateProviderJsonEvidencePolicy({
      maxInputBytes: options.maxInputBytes,
      maxStringBytes: options.maxStringBytes,
    });
    this.#harness = options.harness;
    this.#clock = options.clock ?? (() => new Date());
    this.#createdAt = this.#clock().getTime();
    this.#maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
    this.#maxStringBytes = options.maxStringBytes ?? DEFAULT_MAX_STRING_BYTES;
    const prompt = boundProviderValue(options.originalPrompt, this.#maxStringBytes);
    this.#originalPrompt = typeof prompt.value === "string" ? prompt.value : "";
    this.#wasTruncated = prompt.truncated;
  }

  record(payload: unknown): void {
    const bounded = boundProviderValue(payload, this.#maxStringBytes);
    const encoded = JSON.stringify(bounded.value);
    if (encoded === undefined) {
      this.#wasTruncated = true;
      return;
    }
    const bytes = Buffer.byteLength(encoded, "utf8");
    this.#wasTruncated ||= bounded.truncated;
    if (bytes > this.#maxInputBytes) {
      this.#wasTruncated = true;
      return;
    }

    this.#records.push({ value: bounded.value, bytes });
    this.#retainedRecordBytes += bytes;
    while (this.#retainedRecordBytes > this.#maxInputBytes) {
      const removed = this.#records.shift();
      if (removed === undefined) {
        this.#retainedRecordBytes = 0;
        break;
      }
      this.#retainedRecordBytes -= removed.bytes;
      this.#wasTruncated = true;
    }
  }

  snapshot(): ProviderJsonEvidenceSnapshot {
    const now = this.#clock().getTime();
    let originalPrompt = this.#originalPrompt;
    let truncated = this.#wasTruncated;

    let emptyInput = this.#createInput(originalPrompt, [], truncated, now);
    if (byteLength(emptyInput) > this.#maxInputBytes) {
      truncated = true;
      originalPrompt = fitPrompt(
        originalPrompt,
        this.#maxInputBytes,
        (candidate) => this.#createInput(candidate, [], truncated, now),
      );
      emptyInput = this.#createInput(originalPrompt, [], truncated, now);
    }

    let recentProviderJson = newestRecordsWithinBudget(
      this.#records,
      this.#maxInputBytes,
      emptyInput,
    );
    if (recentProviderJson.length < this.#records.length && !truncated) {
      truncated = true;
      emptyInput = this.#createInput(originalPrompt, [], truncated, now);
      recentProviderJson = newestRecordsWithinBudget(
        this.#records,
        this.#maxInputBytes,
        emptyInput,
      );
    }

    const input = this.#createInput(originalPrompt, recentProviderJson, truncated, now);
    return {
      ...input,
      input_bytes: byteLength(input),
    };
  }

  #createInput(
    originalPrompt: string,
    recentProviderJson: readonly unknown[],
    truncated: boolean,
    now: number,
  ): ProviderJsonEvidenceInput {
    return {
      original_prompt: originalPrompt,
      harness: this.#harness,
      recent_provider_json: recentProviderJson,
      elapsed_ms: Math.max(0, now - this.#createdAt),
      truncated,
    };
  }
}

export function validateProviderJsonEvidencePolicy(options: {
  readonly maxInputBytes?: number;
  readonly maxStringBytes?: number;
}): void {
  const maxInputBytes = positiveInteger(
    options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES,
    "inputLimitBytes",
  );
  if (maxInputBytes < MIN_INPUT_BYTES) {
    throw new Error(`inputLimitBytes must be at least ${MIN_INPUT_BYTES} bytes.`);
  }
  const maxStringBytes = positiveInteger(
    options.maxStringBytes ?? DEFAULT_MAX_STRING_BYTES,
    "maxStringBytes",
  );
  const markerBytes = Buffer.byteLength(TRUNCATION_MARKER, "utf8");
  if (maxStringBytes < markerBytes) {
    throw new Error(`maxStringBytes must be at least ${markerBytes} bytes.`);
  }
}

export function boundProviderValue(value: unknown, maxStringBytes: number): {
  readonly value: unknown;
  readonly truncated: boolean;
} {
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") <= maxStringBytes) {
      return { value, truncated: false };
    }
    const prefixBudget = maxStringBytes - Buffer.byteLength(TRUNCATION_MARKER, "utf8");
    return {
      value: `${truncateUtf8(value, prefixBudget)}${TRUNCATION_MARKER}`,
      truncated: true,
    };
  }
  if (Array.isArray(value)) {
    const bounded = value.map((item) => boundProviderValue(item, maxStringBytes));
    return {
      value: bounded.map((item) => item.value),
      truncated: bounded.some((item) => item.truncated),
    };
  }
  if (isRecord(value)) {
    let truncated = false;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const bounded = boundProviderValue(item, maxStringBytes);
      result[key] = bounded.value;
      truncated ||= bounded.truncated;
    }
    return { value: result, truncated };
  }
  return { value, truncated: false };
}

function fitPrompt(
  prompt: string,
  maxBytes: number,
  buildInput: (candidate: string) => ProviderJsonEvidenceInput,
): string {
  const source = prompt.endsWith(TRUNCATION_MARKER)
    ? prompt.slice(0, -TRUNCATION_MARKER.length)
    : prompt;
  if (byteLength(buildInput(TRUNCATION_MARKER)) > maxBytes) {
    return "";
  }
  const characters = [...source];
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = `${characters.slice(0, middle).join("")}${TRUNCATION_MARKER}`;
    if (byteLength(buildInput(candidate)) <= maxBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return `${characters.slice(0, low).join("")}${TRUNCATION_MARKER}`;
}

function byteLength(value: ProviderJsonEvidenceInput): number {
  return snapshotByteLengthFromInputBytes(
    Buffer.byteLength(JSON.stringify(value), "utf8"),
  );
}

function newestRecordsWithinBudget(
  records: readonly RetainedRecord[],
  maxBytes: number,
  emptyInput: ProviderJsonEvidenceInput,
): unknown[] {
  const emptyInputBytes = Buffer.byteLength(JSON.stringify(emptyInput), "utf8");
  const selectedNewestFirst: unknown[] = [];
  let recordListBytes = 0;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record === undefined) {
      continue;
    }
    const separatorBytes = selectedNewestFirst.length === 0 ? 0 : 1;
    const candidateInputBytes = emptyInputBytes
      + recordListBytes
      + separatorBytes
      + record.bytes;
    if (snapshotByteLengthFromInputBytes(candidateInputBytes) > maxBytes) {
      break;
    }
    selectedNewestFirst.push(record.value);
    recordListBytes += separatorBytes + record.bytes;
  }
  return selectedNewestFirst.reverse();
}

function snapshotByteLengthFromInputBytes(inputBytes: number): number {
  const propertyBytes = Buffer.byteLength(',"input_bytes":', "utf8");
  let totalBytes = inputBytes + propertyBytes + 1;
  while (true) {
    const next = inputBytes + propertyBytes + String(totalBytes).length;
    if (next === totalBytes) {
      return totalBytes;
    }
    totalBytes = next;
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
