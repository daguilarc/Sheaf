import path from "node:path";

export const x_redactedSecret = "[REDACTED]";

export const x_outsideRootPath = "<outside-root>";

const x_secretPatterns: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bsk-[A-Za-z0-9]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /(?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^\s"']{8,}/gi,
];

export interface SanitizeOptions
{
  canonicalRoot?: string;
}

function IsRecord(value: unknown): value is Record<string, unknown>
{
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function RedactSecrets(text: string): string
{
  let output = text;

  for (const pattern of x_secretPatterns)
  {
    output = output.replace(pattern, x_redactedSecret);
  }

  return output;
}

export function RelativizeAbsolutePath(
  absolutePath: string,
  canonicalRoot: string,
): string
{
  const normalizedRoot = path.resolve(canonicalRoot);
  const normalizedPath = path.resolve(absolutePath);
  const relative = path.relative(normalizedRoot, normalizedPath);

  if (relative === "" || relative === ".")
  {
    return ".";
  }

  if (relative.startsWith("..") || path.isAbsolute(relative))
  {
    return x_outsideRootPath;
  }

  return relative.split(path.sep).join("/");
}

export function RelativizePathsInText(text: string, canonicalRoot: string): string
{
  const normalizedRoot = path.resolve(canonicalRoot);
  const pattern = /(?:\/[\w.@+-]+)+/g;

  return text.replace(pattern, (match) =>
  {
    if (!path.isAbsolute(match))
    {
      return match;
    }

    return RelativizeAbsolutePath(match, normalizedRoot);
  });
}

export function SanitizeString(value: string, options: SanitizeOptions = {}): string
{
  let output = RedactSecrets(value);

  if (options.canonicalRoot !== undefined && options.canonicalRoot.length > 0)
  {
    output = RelativizePathsInText(output, options.canonicalRoot);
  }

  return output;
}

export function SanitizeValue(value: unknown, options: SanitizeOptions = {}): unknown
{
  if (typeof value === "string")
  {
    return SanitizeString(value, options);
  }

  if (Array.isArray(value))
  {
    return value.map((entry) => SanitizeValue(entry, options));
  }

  if (IsRecord(value))
  {
    const output: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(value))
    {
      output[key] = SanitizeValue(entry, options);
    }

    return output;
  }

  return value;
}
