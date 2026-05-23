import type { ToolCallSet, ToolDefinition } from "./types.js";

const x_echoTool: ToolDefinition = {
  name: "echo",
  description: "Echoes the message field from tool arguments.",
  inputSchema: {
    type: "object",
    properties: {
      message: { type: "string" },
    },
  },
  callback: (args) => ({
    echoed: (args as { message?: string }).message ?? "",
  }),
};

const x_knownToolsByName = new Map<string, ToolDefinition>([
  [x_echoTool.name, x_echoTool],
]);

export function GetKnownToolNames(): string[]
{
  return [...x_knownToolsByName.keys()].sort();
}

export function ResolveToolDefinition(name: string): ToolDefinition | undefined
{
  return x_knownToolsByName.get(name);
}

export function FindUnknownToolNames(toolNames: string[]): string[]
{
  const unknown: string[] = [];

  for (const name of toolNames)
  {
    if (!x_knownToolsByName.has(name))
    {
      unknown.push(name);
    }
  }

  return unknown;
}

export function BuildToolCallSet(toolNames: string[]): ToolCallSet
{
  const tools = toolNames.map((name) =>
  {
    const tool = x_knownToolsByName.get(name);
    if (tool === undefined)
    {
      throw new Error(`Unknown tool: ${name}`);
    }

    return tool;
  });

  return {
    name: tools.length > 0 ? "cli_selected" : "cli_empty",
    tools,
  };
}

export function ParseToolNameArguments(values: string[]): string[]
{
  const names: string[] = [];

  for (const value of values)
  {
    for (const part of value.split(","))
    {
      const trimmed = part.trim();
      if (trimmed.length > 0)
      {
        names.push(trimmed);
      }
    }
  }

  return names;
}
