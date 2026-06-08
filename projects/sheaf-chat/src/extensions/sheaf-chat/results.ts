import type { RootPolicy } from "./pathPolicy.js";

export function RelativizeDisplayPath(policy: RootPolicy, absolutePath: string): string
{
  return policy.ToRootRelativePath(absolutePath);
}

export function SanitizeToolText(policy: RootPolicy, text: string): string
{
  let sanitized = text;

  if (policy.canonicalRoot.length > 0)
  {
    sanitized = sanitized.split(policy.canonicalRoot).join(".");
  }

  if (policy.rootDirectory !== policy.canonicalRoot)
  {
    sanitized = sanitized.split(policy.rootDirectory).join(".");
  }

  return sanitized;
}

export function AssertNoParentLeak(text: string, policy: RootPolicy): void
{
  const parentMarker = "../";
  const index = text.indexOf(parentMarker);

  if (index !== -1)
  {
    throw new Error(`Tool result leaked parent path segment near: ${text.slice(Math.max(0, index - 20), index + 20)}`);
  }

  if (text.includes(policy.canonicalRoot))
  {
    throw new Error("Tool result leaked absolute session root path");
  }

  if (policy.rootDirectory !== policy.canonicalRoot && text.includes(policy.rootDirectory))
  {
    throw new Error("Tool result leaked absolute session root path");
  }
}
