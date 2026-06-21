import path from "node:path";

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [REDACTED]"],
  [/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]"],
];

const SECRET_ASSIGNMENT_PATTERN =
  /(["']?)([A-Za-z0-9_-]*(?:api[_-]?key|apikey|token|secret|password)[A-Za-z0-9_-]*)\1(\s*[:=]\s*)(["']?)([^"',\s}]+)\4/gi;

export function sanitizeValue<T>(value: T, repoRoot: string): T {
  return sanitizeValueInternal(value, repoRoot) as T;
}

function sanitizeValueInternal(value: unknown, repoRoot: string, key?: string): unknown {
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
    const sanitized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      sanitized[key] = sanitizeValueInternal(item, repoRoot, key);
    }
    return sanitized;
  }

  return value;
}

export function sanitizeString(value: string, repoRoot: string): string {
  let sanitized = relativizeRepoPath(value, repoRoot);
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  sanitized = sanitized.replace(
    SECRET_ASSIGNMENT_PATTERN,
    (match: string, keyQuote: string, key: string, separator: string, valueQuote: string) => {
      if (!isSensitiveKey(key)) {
        return match;
      }
      return `${keyQuote}${key}${keyQuote}${separator}${valueQuote}[REDACTED]${valueQuote}`;
    },
  );
  return sanitized;
}

function relativizeRepoPath(value: string, repoRoot: string): string {
  const normalizedRoot = path.resolve(repoRoot);
  return value.replaceAll(normalizedRoot, (match, offset: number, full: string) => {
    const before = offset === 0 ? "" : full[offset - 1];
    const after = full[offset + match.length] ?? "";
    if ((before === "" || isPathBoundaryBefore(before)) && (after === "" || after === path.sep)) {
      return ".";
    }
    return match;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (normalized === "total_tokens" || normalized === "completion_tokens" || normalized === "token_count") {
    return false;
  }
  return /(^|[_-])(api[_-]?key|apikey|token|secret|password)([_-]|$)/i.test(normalized);
}

function isPathBoundaryBefore(value: string): boolean {
  return /\s|["'([{:=]/.test(value);
}
