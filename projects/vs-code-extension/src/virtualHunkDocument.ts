import type { Hunk, HunkDisplayLine } from "./types.js";

export const VIRTUAL_HUNK_SCHEME = "sheaf-hunks";

export type VirtualHunkRowKind = "context" | "added" | "deleted";
export type VirtualHunkRowSource = "real" | "synthetic";

export interface VirtualLineRange
{
  start: number;
  endExclusive: number;
}

export interface VirtualHunkRow
{
  virtualLine: number;
  kind: VirtualHunkRowKind;
  text: string;
  realLine: number | null;
  oldLine: number | null;
  hunkId: string | null;
  source: VirtualHunkRowSource;
}

export interface VirtualHunkSpan
{
  hunkId: string;
  hunkIndex: number;
  virtualStartLine: number;
  virtualEndLineExclusive: number;
  addedVirtualRange: VirtualLineRange | null;
  deletedVirtualRange: VirtualLineRange | null;
  realNewRange: { start: number; lines: number };
}

export interface VirtualHunkDocument
{
  uri: string;
  repoRoot: string;
  file: string;
  text: string;
  rows: VirtualHunkRow[];
  hunks: VirtualHunkSpan[];
}

export interface VirtualHunkIdentity
{
  repoRoot: string;
  file: string;
}

export function BuildVirtualHunkDocument(repoRoot: string, file: string, realText: string, hunks: Hunk[]): VirtualHunkDocument
{
  const realLines = SplitLines(realText);
  const rows: VirtualHunkRow[] = [];
  const spans: VirtualHunkSpan[] = [];
  let nextRealLine = 1;

  for (const hunk of [...hunks].sort((a, b) => a.newRange.start - b.newRange.start))
  {
    const hunkStart = Math.max(1, hunk.newRange.start);
    while (nextRealLine < hunkStart)
    {
      AddRealRow(rows, realLines, nextRealLine, null, "context");
      nextRealLine += 1;
    }

    const spanStart = rows.length;
    let maxRealLine = nextRealLine - 1;

    const plannedRows = PlanHunkRows(hunk.displayLines);
    const leadingContext = plannedRows.leadingContext;
    const addedLines = plannedRows.added;
    const deletedLines = plannedRows.deleted;
    const trailingContext = plannedRows.trailingContext;

    for (const line of leadingContext)
    {
      AddDisplayRow(rows, line, hunk.id);
      if (line.newLine !== null)
      {
        maxRealLine = Math.max(maxRealLine, line.newLine);
      }
    }

    const addedStart = rows.length;
    for (const line of addedLines)
    {
      AddDisplayRow(rows, line, hunk.id);
      if (line.newLine !== null)
      {
        maxRealLine = Math.max(maxRealLine, line.newLine);
      }
    }
    const addedEnd = rows.length;

    const deletedStart = rows.length;
    for (const line of deletedLines)
    {
      AddDisplayRow(rows, line, hunk.id);
    }
    const deletedEnd = rows.length;

    for (const line of trailingContext)
    {
      AddDisplayRow(rows, line, hunk.id);
      if (line.newLine !== null)
      {
        maxRealLine = Math.max(maxRealLine, line.newLine);
      }
    }

    spans.push({
      hunkId: hunk.id,
      hunkIndex: hunk.index,
      virtualStartLine: spanStart,
      virtualEndLineExclusive: rows.length,
      addedVirtualRange: addedEnd > addedStart ? { start: addedStart, endExclusive: addedEnd } : null,
      deletedVirtualRange: deletedEnd > deletedStart ? { start: deletedStart, endExclusive: deletedEnd } : null,
      realNewRange: hunk.newRange,
    });

    nextRealLine = Math.max(nextRealLine, maxRealLine + 1);
  }

  while (nextRealLine <= realLines.length)
  {
    AddRealRow(rows, realLines, nextRealLine, null, "context");
    nextRealLine += 1;
  }

  return {
    uri: VirtualUriFor(repoRoot, file),
    repoRoot,
    file,
    text: rows.map((row) => row.text).join("\n"),
    rows,
    hunks: spans,
  };
}

export function VirtualLineToContext(document: VirtualHunkDocument, virtualLine: number): VirtualHunkRow | null
{
  return document.rows[virtualLine] ?? null;
}

export function HunkIdToVirtualSpan(document: VirtualHunkDocument, hunkId: string): VirtualHunkSpan | null
{
  return document.hunks.find((hunk) => hunk.hunkId === hunkId) ?? null;
}

export function RealLineToVirtualLine(document: VirtualHunkDocument, realLine: number): number | null
{
  return document.rows.find((row) => row.realLine === realLine)?.virtualLine ?? null;
}

export function VirtualUriFor(repoRoot: string, file: string): string
{
  return `${VIRTUAL_HUNK_SCHEME}://review/${EncodeIdentitySegment(repoRoot)}/${EncodeIdentitySegment(file)}`;
}

export function ParseVirtualUri(uri: string): VirtualHunkIdentity | null
{
  try
  {
    const parsed = new URL(uri);
    if (parsed.protocol !== `${VIRTUAL_HUNK_SCHEME}:` || parsed.hostname !== "review")
    {
      return null;
    }

    const pathParts = parsed.pathname.split("/").filter((part) => part.length > 0);
    if (pathParts.length === 2)
    {
      return {
        repoRoot: DecodeIdentitySegment(pathParts[0] ?? ""),
        file: DecodeIdentitySegment(pathParts[1] ?? ""),
      };
    }

    const legacy = ParseLegacyVirtualUri(parsed);
    if (legacy !== null)
    {
      return legacy;
    }

    return null;
  }
  catch
  {
    return null;
  }
}

function ParseLegacyVirtualUri(parsed: URL): VirtualHunkIdentity | null
{
  const repoRoot = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const file = LegacyFileQueryValue(parsed);
  if (repoRoot.length === 0 || file === null || file.length === 0)
  {
    return null;
  }
  return { repoRoot, file };
}

function LegacyFileQueryValue(parsed: URL): string | null
{
  const normalValue = parsed.searchParams.get("file");
  if (normalValue !== null)
  {
    return decodeURIComponent(normalValue);
  }

  const decodedSearch = decodeURIComponent(parsed.search.replace(/^\?/, ""));
  if (decodedSearch.startsWith("file="))
  {
    const value = decodedSearch.slice("file=".length);
    if (value.length > 0)
    {
      return value;
    }
  }

  return null;
}

function EncodeIdentitySegment(value: string): string
{
  return Buffer.from(value, "utf8").toString("base64url");
}

function DecodeIdentitySegment(value: string): string
{
  return Buffer.from(value, "base64url").toString("utf8");
}

function AddRealRow(rows: VirtualHunkRow[], realLines: string[], realLine: number, hunkId: string | null, kind: VirtualHunkRowKind): void
{
  rows.push({
    virtualLine: rows.length,
    kind,
    text: realLines[realLine - 1] ?? "",
    realLine,
    oldLine: null,
    hunkId,
    source: "real",
  });
}

function AddDisplayRow(rows: VirtualHunkRow[], line: HunkDisplayLine, hunkId: string): void
{
  rows.push({
    virtualLine: rows.length,
    kind: line.kind,
    text: line.text,
    realLine: line.newLine,
    oldLine: line.oldLine,
    hunkId,
    source: line.kind === "deleted" ? "synthetic" : "real",
  });
}

function PlanHunkRows(lines: HunkDisplayLine[]): {
  leadingContext: HunkDisplayLine[];
  added: HunkDisplayLine[];
  deleted: HunkDisplayLine[];
  trailingContext: HunkDisplayLine[];
}
{
  const firstChange = lines.findIndex((line) => line.kind !== "context");
  if (firstChange < 0)
  {
    return { leadingContext: lines, added: [], deleted: [], trailingContext: [] };
  }

  const leadingContext = lines.slice(0, firstChange);
  const rest = lines.slice(firstChange);
  return {
    leadingContext,
    added: rest.filter((line) => line.kind === "added"),
    deleted: rest.filter((line) => line.kind === "deleted"),
    trailingContext: rest.filter((line) => line.kind === "context"),
  };
}

function SplitLines(text: string): string[]
{
  const lines = text.split(/\r?\n/);
  if (lines.length > 1 && lines.at(-1) === "")
  {
    return lines.slice(0, -1);
  }
  return lines;
}
