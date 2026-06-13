import type { Hunk, PaneState } from "./types.js";

export interface PlannedRange
{
  hunkId: string;
  current: boolean;
  startLine: number;
  endLineExclusive: number;
}

export interface PlannedDeletedBlock
{
  hunkId: string;
  current: boolean;
  anchorLine: number;
  attachment: "before" | "after";
  text: string;
}

export interface InlineHunkDecorationPlan
{
  addedRanges: PlannedRange[];
  deletedBlocks: PlannedDeletedBlock[];
  currentBoundaries: PlannedRange[];
  revealLine: number | null;
}

export function PlanInlineHunkDecorations(state: PaneState): InlineHunkDecorationPlan
{
  const plan: InlineHunkDecorationPlan = {
    addedRanges: [],
    deletedBlocks: [],
    currentBoundaries: [],
    revealLine: null,
  };

  for (const hunk of state.hunks)
  {
    const current = hunk.id === state.currentHunkId;
    AddRanges(plan, hunk, current);
    AddDeletedBlocks(plan, hunk, current);
    if (current)
    {
      AddCurrentBoundary(plan, hunk);
      plan.revealLine = RevealLine(hunk);
    }
  }

  return plan;
}

function AddRanges(plan: InlineHunkDecorationPlan, hunk: Hunk, current: boolean): void
{
  const newLines = hunk.displayLines
    .filter((line) => line.kind === "added" && line.newLine !== null)
    .map((line) => line.newLine ?? 1)
    .sort((a, b) => a - b);

  let blockStart: number | null = null;
  let previous: number | null = null;
  for (const line of newLines)
  {
    if (blockStart === null)
    {
      blockStart = line;
      previous = line;
      continue;
    }
    if (previous !== null && line === previous + 1)
    {
      previous = line;
      continue;
    }
    plan.addedRanges.push(ToRange(hunk.id, current, blockStart, previous ?? blockStart));
    blockStart = line;
    previous = line;
  }

  if (blockStart !== null)
  {
    plan.addedRanges.push(ToRange(hunk.id, current, blockStart, previous ?? blockStart));
  }
}

function AddDeletedBlocks(plan: InlineHunkDecorationPlan, hunk: Hunk, current: boolean): void
{
  for (const block of hunk.displayBlocks.filter((block) => block.kind === "deleted"))
  {
    plan.deletedBlocks.push({
      hunkId: hunk.id,
      current,
      anchorLine: OneBasedToZeroBased(block.anchorNewLine),
      attachment: block.attachment,
      text: block.lines.map((line) => `- ${line.text}`).join("\n"),
    });
  }
}

function AddCurrentBoundary(plan: InlineHunkDecorationPlan, hunk: Hunk): void
{
  const revealLine = RevealLine(hunk);
  if (revealLine === null)
  {
    return;
  }
  plan.currentBoundaries.push({
    hunkId: hunk.id,
    current: true,
    startLine: revealLine,
    endLineExclusive: revealLine + 1,
  });
}

function RevealLine(hunk: Hunk): number | null
{
  const added = hunk.displayLines.find((line) => line.kind === "added" && line.newLine !== null);
  if (added?.newLine !== undefined && added.newLine !== null)
  {
    return OneBasedToZeroBased(added.newLine);
  }
  const deleted = hunk.displayBlocks.find((block) => block.kind === "deleted")?.anchorNewLine;
  if (deleted !== undefined)
  {
    return OneBasedToZeroBased(deleted);
  }
  const context = hunk.displayLines.find((line) => line.newLine !== null);
  if (context?.newLine !== undefined && context.newLine !== null)
  {
    return OneBasedToZeroBased(context.newLine);
  }
  return null;
}

function ToRange(hunkId: string, current: boolean, start: number, end: number): PlannedRange
{
  return {
    hunkId,
    current,
    startLine: OneBasedToZeroBased(start),
    endLineExclusive: OneBasedToZeroBased(end) + 1,
  };
}

function OneBasedToZeroBased(line: number): number
{
  return Math.max(0, line - 1);
}
