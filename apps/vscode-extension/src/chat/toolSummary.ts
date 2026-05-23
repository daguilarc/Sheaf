function ReadOptionalString(record: Record<string, unknown>, key: string): string | undefined
{
  const v = record[key];
  return typeof v === "string" ? v : undefined;
}

function ReadOptionalNumber(record: Record<string, unknown>, key: string): number | undefined
{
  const v = record[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function ParseArgsRecord(argsJson: string | undefined): Record<string, unknown>
{
  if (argsJson === undefined || argsJson.length === 0)
  {
    return {};
  }

  try
  {
    const parsed: unknown = JSON.parse(argsJson);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed))
    {
      return parsed as Record<string, unknown>;
    }
  }
  catch
  {
    // ignore malformed JSON
    //
  }

  return {};
}

function SummarizeCodeRead(args: Record<string, unknown>): string
{
  const file = ReadOptionalString(args, "file") ?? "(file)";
  const start = ReadOptionalNumber(args, "startLine");
  const end = ReadOptionalNumber(args, "endLine");

  if (start !== undefined && end !== undefined)
  {
    return `Reading ${file} lines ${start}-${end}`;
  }

  return `Reading ${file}`;
}

function SummarizeListFiles(args: Record<string, unknown>): string
{
  const dir = ReadOptionalString(args, "directory");
  if (dir !== undefined && dir.length > 0)
  {
    return `Listing files in ${dir}`;
  }

  return "Listing workspace files";
}

function SummarizeRgrep(args: Record<string, unknown>): string
{
  const pattern = ReadOptionalString(args, "pattern") ?? "(pattern)";
  const path = ReadOptionalString(args, "path");
  if (path !== undefined && path.length > 0)
  {
    return `Searching ${pattern} in ${path}`;
  }

  return `Searching ${pattern}`;
}

function SummarizeReadVisibleRange(args: Record<string, unknown>): string
{
  const file = ReadOptionalString(args, "file") ?? "(file)";
  return `Visible range for ${file}`;
}

function SummarizeSetCursorPosition(args: Record<string, unknown>): string
{
  const file = ReadOptionalString(args, "file") ?? "(file)";
  const line = ReadOptionalNumber(args, "line");
  if (line !== undefined)
  {
    return `Cursor to ${file}:${line}`;
  }

  return `Cursor move in ${file}`;
}

function SummarizeMoveVisibleRange(args: Record<string, unknown>): string
{
  const file = ReadOptionalString(args, "file") ?? "(file)";
  const direction = ReadOptionalString(args, "direction");
  if (direction !== undefined)
  {
    return `Viewport ${direction} in ${file}`;
  }

  return `Viewport move in ${file}`;
}

export function FormatToolCallSummary(toolName: string, argsJson: string | undefined): string
{
  const args = ParseArgsRecord(argsJson);

  switch (toolName)
  {
    case "code_read":
      return SummarizeCodeRead(args);
    case "list_files":
      return SummarizeListFiles(args);
    case "rgrep":
      return SummarizeRgrep(args);
    case "read_visible_range":
      return SummarizeReadVisibleRange(args);
    case "set_cursor_position":
      return SummarizeSetCursorPosition(args);
    case "move_visible_range":
      return SummarizeMoveVisibleRange(args);
    default:
      return toolName;
  }
}
