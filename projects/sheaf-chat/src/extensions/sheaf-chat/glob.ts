function EscapeRegex(value: string): string
{
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function GlobSegmentToRegex(segment: string): string
{
  let regex = "";
  let index = 0;

  while (index < segment.length)
  {
    if (segment[index] === "*")
    {
      if (segment[index + 1] === "*")
      {
        regex += ".*";
        index += 2;
        continue;
      }

      regex += "[^/]*";
      index += 1;
      continue;
    }

    if (segment[index] === "?")
    {
      regex += "[^/]";
      index += 1;
      continue;
    }

    regex += EscapeRegex(segment[index]);
    index += 1;
  }

  return regex;
}

export function GlobToRegExp(pattern: string): RegExp
{
  const normalized = pattern.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const regexParts: string[] = [];

  for (let index = 0; index < segments.length; index++)
  {
    const segment = segments[index];

    if (segment === "**")
    {
      if (index === segments.length - 1)
      {
        regexParts.push("(?:.*)");
      }
      else
      {
        regexParts.push("(?:.*/)?");
      }
      continue;
    }

    regexParts.push(GlobSegmentToRegex(segment));
  }

  return new RegExp(`^${regexParts.join("/")}$`);
}

export function MatchesGlob(relativePath: string, pattern: string): boolean
{
  const normalized = relativePath.replace(/\\/g, "/");
  return GlobToRegExp(pattern).test(normalized);
}

export function MatchesAnyGlob(relativePath: string, patterns: string[]): boolean
{
  for (const pattern of patterns)
  {
    if (MatchesGlob(relativePath, pattern))
    {
      return true;
    }
  }

  return false;
}
