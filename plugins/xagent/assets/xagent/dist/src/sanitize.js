import path from "node:path";
const SECRET_PATTERNS = [
    [/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [REDACTED]"],
    [/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]"],
    [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]"],
];
const SECRET_ASSIGNMENT_PATTERN = /(["']?)([A-Za-z0-9_-]*(?:api[_-]?key|apikey|token|secret|password)[A-Za-z0-9_-]*)\1(\s*[:=]\s*)(["']?)([^"',\s}]+)\4/gi;
export function sanitizeValue(value, repoRoot) {
    return sanitizeValueInternal(value, repoRoot);
}
function sanitizeValueInternal(value, repoRoot, key) {
    if (key !== undefined && isSensitiveKey(key)) {
        return "[REDACTED]";
    }
    if (typeof value === "string") {
        return sanitizeString(value, repoRoot);
    }
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeValueInternal(item, repoRoot));
    }
    if (isRecord(value)) {
        const sanitized = {};
        for (const [key, item] of Object.entries(value)) {
            sanitized[key] = sanitizeValueInternal(item, repoRoot, key);
        }
        return sanitized;
    }
    return value;
}
export function sanitizeString(value, repoRoot) {
    let sanitized = relativizeRepoPath(value, repoRoot);
    for (const [pattern, replacement] of SECRET_PATTERNS) {
        sanitized = sanitized.replace(pattern, replacement);
    }
    sanitized = sanitized.replace(SECRET_ASSIGNMENT_PATTERN, (match, keyQuote, key, separator, valueQuote) => {
        if (!isSensitiveKey(key)) {
            return match;
        }
        return `${keyQuote}${key}${keyQuote}${separator}${valueQuote}[REDACTED]${valueQuote}`;
    });
    return sanitized;
}
export function canonicalJson(value) {
    return JSON.stringify(canonicalValue(value));
}
export function truncateUtf8(value, maxBytes) {
    const byteLimit = Math.max(0, Math.floor(maxBytes));
    if (Buffer.byteLength(value, "utf8") <= byteLimit) {
        return value;
    }
    let bytes = 0;
    let result = "";
    for (const character of value) {
        const characterBytes = Buffer.byteLength(character, "utf8");
        if (bytes + characterBytes > byteLimit) {
            break;
        }
        result += character;
        bytes += characterBytes;
    }
    return result;
}
function relativizeRepoPath(value, repoRoot) {
    const normalizedRoot = path.resolve(repoRoot);
    return value.replaceAll(normalizedRoot, (match, offset, full) => {
        const before = offset === 0 ? "" : full[offset - 1];
        const after = full[offset + match.length] ?? "";
        if ((before === "" || isPathBoundaryBefore(before))
            && (after === "" || after === path.sep || isPathBoundaryAfter(after))) {
            return ".";
        }
        return match;
    });
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isSensitiveKey(key) {
    const normalized = key.toLowerCase();
    if (normalized === "total_tokens" || normalized === "completion_tokens" || normalized === "token_count") {
        return false;
    }
    return /(^|[_-])(api[_-]?key|apikey|token|secret|password)([_-]|$)/i.test(normalized);
}
function isPathBoundaryBefore(value) {
    return /\s|["'([{:=]/.test(value);
}
function isPathBoundaryAfter(value) {
    return /\s|["'\])},;:]/.test(value);
}
function canonicalValue(value) {
    if (Array.isArray(value)) {
        return value.map((item) => canonicalValue(item));
    }
    if (isRecord(value)) {
        const result = {};
        for (const key of Object.keys(value).sort()) {
            const item = value[key];
            if (item !== undefined && typeof item !== "function" && typeof item !== "symbol") {
                result[key] = canonicalValue(item);
            }
        }
        return result;
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
        return null;
    }
    return value;
}
//# sourceMappingURL=sanitize.js.map