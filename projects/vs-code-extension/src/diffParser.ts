import { createHash } from "node:crypto";

import type { Hunk } from "./types.js";

interface FilePatch
{
  file: string;
  headerLines: string[];
  hunkLines: string[][];
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

export function ParseUnifiedDiff(diffText: string): Map<string, Hunk[]>
{
  const patches = SplitFilePatches(diffText);
  const result = new Map<string, Hunk[]>();

  for (const patch of patches)
  {
    const hunks: Hunk[] = [];
    for (const hunkLines of patch.hunkLines)
    {
      const header = hunkLines[0] ?? "";
      const match = HUNK_HEADER_RE.exec(header);
      if (match === null)
      {
        continue;
      }

      const oldStart = Number(match[1]);
      const oldLines = Number(match[2] ?? "1");
      const newStart = Number(match[3]);
      const newLines = Number(match[4] ?? "1");
      const patchText = [...patch.headerLines, ...hunkLines].join("\n") + "\n";
      const patchHash = Hash(patchText);

      hunks.push({
        id: `${patch.file}:${header}:${patchHash}`,
        file: patch.file,
        index: 0,
        count: 0,
        header,
        oldRange: { start: oldStart, lines: oldLines },
        newRange: { start: newStart, lines: newLines },
        patch: patchText,
        patchHash,
      });
    }

    const count = hunks.length;
    result.set(patch.file, hunks.map((hunk, index) => ({ ...hunk, index, count })));
  }

  return result;
}

export function ParseNameOnlyList(output: string): string[]
{
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function SplitFilePatches(diffText: string): FilePatch[]
{
  const lines = diffText.split(/\r?\n/);
  const patches: FilePatch[] = [];
  let current: FilePatch | undefined;
  let currentHunk: string[] | undefined;

  function FinishHunk(): void
  {
    if (current !== undefined && currentHunk !== undefined && currentHunk.length > 0)
    {
      current.hunkLines.push(currentHunk);
    }
    currentHunk = undefined;
  }

  for (const line of lines)
  {
    if (line.startsWith("diff --git "))
    {
      FinishHunk();
      const file = ParseDiffGitFile(line);
      current = { file, headerLines: [line], hunkLines: [] };
      patches.push(current);
      continue;
    }

    if (current === undefined)
    {
      continue;
    }

    if (line.startsWith("@@ "))
    {
      FinishHunk();
      currentHunk = [line];
      continue;
    }

    if (currentHunk !== undefined)
    {
      currentHunk.push(line);
    }
    else
    {
      current.headerLines.push(line);
      if (line.startsWith("+++ b/"))
      {
        current.file = line.slice("+++ b/".length);
      }
    }
  }

  FinishHunk();
  return patches.filter((patch) => patch.hunkLines.length > 0);
}

function ParseDiffGitFile(line: string): string
{
  const parts = line.split(" ");
  const b = parts[3] ?? "";
  return b.startsWith("b/") ? b.slice(2) : b;
}

function Hash(value: string): string
{
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
