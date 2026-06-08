export interface SessionSummary
{
  chatName: string;
  description: string;
}

export const x_defaultSummaryMaxLength = 80;

export type SessionSummaryGenerator = (firstUserMessage: string) => Promise<SessionSummary>;

function NormalizeLine(text: string): string
{
  const firstLine = text.split(/\r?\n/u)[0]?.trim() ?? "";
  return firstLine.replace(/\s+/gu, " ");
}

export function BuildDeterministicSummary(
  firstUserMessage: string,
  maxLength = x_defaultSummaryMaxLength,
): SessionSummary
{
  const normalized = NormalizeLine(firstUserMessage);

  if (normalized.length === 0)
  {
    return {
      chatName: "New chat",
      description: "New chat",
    };
  }

  const truncated =
    normalized.length > maxLength
      ? `${normalized.slice(0, maxLength - 1).trimEnd()}…`
      : normalized;

  return {
    chatName: truncated,
    description: truncated,
  };
}

export interface CreateSessionSummarizerOptions
{
  generate?: SessionSummaryGenerator;
}

export function CreateSessionSummarizer(
  options: CreateSessionSummarizerOptions = {},
): SessionSummaryGenerator
{
  const generate = options.generate;

  if (generate === undefined)
  {
    return async (firstUserMessage: string) => BuildDeterministicSummary(firstUserMessage);
  }

  return async (firstUserMessage: string) =>
  {
    try
    {
      return await generate(firstUserMessage);
    }
    catch
    {
      return BuildDeterministicSummary(firstUserMessage);
    }
  };
}
