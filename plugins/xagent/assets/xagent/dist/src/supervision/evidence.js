import { truncateUtf8 } from "../sanitize.js";
const DEFAULT_MAX_INPUT_BYTES = 64 * 1024;
const DEFAULT_MAX_STRING_BYTES = 16 * 1024;
const MIN_INPUT_BYTES = 512;
const TRUNCATION_MARKER = "[xagent: truncated]";
export class ProviderJsonEvidenceWindow {
    #harness;
    #clock;
    #createdAt;
    #maxInputBytes;
    #maxStringBytes;
    #originalPrompt;
    #records = [];
    #retainedRecordBytes = 0;
    #wasTruncated = false;
    constructor(options) {
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
    record(payload) {
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
    snapshot() {
        const now = this.#clock().getTime();
        let originalPrompt = this.#originalPrompt;
        let truncated = this.#wasTruncated;
        let emptyInput = this.#createInput(originalPrompt, [], truncated, now);
        if (byteLength(emptyInput) > this.#maxInputBytes) {
            truncated = true;
            originalPrompt = fitPrompt(originalPrompt, this.#maxInputBytes, (candidate) => this.#createInput(candidate, [], truncated, now));
            emptyInput = this.#createInput(originalPrompt, [], truncated, now);
        }
        let recentProviderJson = newestRecordsWithinBudget(this.#records, this.#maxInputBytes, emptyInput);
        if (recentProviderJson.length < this.#records.length && !truncated) {
            truncated = true;
            emptyInput = this.#createInput(originalPrompt, [], truncated, now);
            recentProviderJson = newestRecordsWithinBudget(this.#records, this.#maxInputBytes, emptyInput);
        }
        const input = this.#createInput(originalPrompt, recentProviderJson, truncated, now);
        return {
            ...input,
            input_bytes: byteLength(input),
        };
    }
    #createInput(originalPrompt, recentProviderJson, truncated, now) {
        return {
            original_prompt: originalPrompt,
            harness: this.#harness,
            recent_provider_json: recentProviderJson,
            elapsed_ms: Math.max(0, now - this.#createdAt),
            truncated,
        };
    }
}
export function validateProviderJsonEvidencePolicy(options) {
    const maxInputBytes = positiveInteger(options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES, "inputLimitBytes");
    if (maxInputBytes < MIN_INPUT_BYTES) {
        throw new Error(`inputLimitBytes must be at least ${MIN_INPUT_BYTES} bytes.`);
    }
    const maxStringBytes = positiveInteger(options.maxStringBytes ?? DEFAULT_MAX_STRING_BYTES, "maxStringBytes");
    const markerBytes = Buffer.byteLength(TRUNCATION_MARKER, "utf8");
    if (maxStringBytes < markerBytes) {
        throw new Error(`maxStringBytes must be at least ${markerBytes} bytes.`);
    }
}
export function boundProviderValue(value, maxStringBytes) {
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
        const result = {};
        for (const [key, item] of Object.entries(value)) {
            const bounded = boundProviderValue(item, maxStringBytes);
            result[key] = bounded.value;
            truncated ||= bounded.truncated;
        }
        return { value: result, truncated };
    }
    return { value, truncated: false };
}
function fitPrompt(prompt, maxBytes, buildInput) {
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
        }
        else {
            high = middle - 1;
        }
    }
    return `${characters.slice(0, low).join("")}${TRUNCATION_MARKER}`;
}
function byteLength(value) {
    return snapshotByteLengthFromInputBytes(Buffer.byteLength(JSON.stringify(value), "utf8"));
}
function newestRecordsWithinBudget(records, maxBytes, emptyInput) {
    const emptyInputBytes = Buffer.byteLength(JSON.stringify(emptyInput), "utf8");
    const selectedNewestFirst = [];
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
            continue;
        }
        selectedNewestFirst.push(record.value);
        recordListBytes += separatorBytes + record.bytes;
    }
    return selectedNewestFirst.reverse();
}
function snapshotByteLengthFromInputBytes(inputBytes) {
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
function positiveInteger(value, name) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive safe integer.`);
    }
    return value;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=evidence.js.map