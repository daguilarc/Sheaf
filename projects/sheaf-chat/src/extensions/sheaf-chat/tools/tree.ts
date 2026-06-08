import { constants } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { Type } from "typebox";

import { RelativizeDisplayPath } from "../results.js";
import type { ScopedToolContext, ScopedToolDefinition } from "../types.js";
import {
  HandlePathEscape,
  ResolveScopedPath,
  ToolError,
  ToolSuccess,
  x_treeDefaultIgnores,
} from "../toolHelpers.js";

const x_treeSchema = Type.Object({
  path: Type.Optional(Type.String({ description: "Directory to tree (default: session root)" })),
  maxDepth: Type.Optional(Type.Number({ description: "Maximum directory depth (default: 4)" })),
  maxEntries: Type.Optional(Type.Number({ description: "Maximum total entries (default: 200)" })),
});

const x_defaultMaxDepth = 4;
const x_defaultMaxEntries = 200;

interface TreeWalkState
{
  lines: string[];
  entryCount: number;
  truncated: boolean;
}

function ShouldIgnoreDirectory(name: string): boolean
{
  return x_treeDefaultIgnores.includes(name);
}

async function WalkTree(
  policy: ScopedToolContext["policy"],
  absoluteDirectory: string,
  prefix: string,
  depth: number,
  maxDepth: number,
  maxEntries: number,
  state: TreeWalkState,
): Promise<void>
{
  if (state.entryCount >= maxEntries)
  {
    state.truncated = true;
    return;
  }

  if (depth > maxDepth)
  {
    return;
  }

  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries)
  {
    if (state.entryCount >= maxEntries)
    {
      state.truncated = true;
      return;
    }

    const entryAbsolute = path.join(absoluteDirectory, entry.name);
    policy.AssertWithinRoot(entryAbsolute);
    const entryRelative = RelativizeDisplayPath(policy, entryAbsolute);
    const entryStat = await stat(entryAbsolute);

    if (entryStat.isDirectory() && ShouldIgnoreDirectory(entry.name))
    {
      continue;
    }

    const marker = entryStat.isDirectory() ? "/" : "";
    state.lines.push(`${prefix}${entryRelative}${marker}`);
    state.entryCount += 1;

    if (entryStat.isDirectory())
    {
      await WalkTree(
        policy,
        entryAbsolute,
        `${prefix}  `,
        depth + 1,
        maxDepth,
        maxEntries,
        state,
      );
    }
  }
}

export function CreateTreeTool(context: ScopedToolContext): ScopedToolDefinition
{
  return {
    name: "tree",
    label: "tree",
    description:
      "Return a bounded directory tree under the session root with default ignores for VCS, dependency, build, cache, and generated directories.",
    parameters: x_treeSchema,
    async execute(_toolCallId, params, signal)
    {
      if (signal?.aborted)
      {
        return ToolError("Operation aborted");
      }

      const pathArg = typeof params.path === "string" ? params.path : ".";
      const maxDepth = typeof params.maxDepth === "number" ? params.maxDepth : x_defaultMaxDepth;
      const maxEntries = typeof params.maxEntries === "number" ? params.maxEntries : x_defaultMaxEntries;

      let absolutePath: string;

      try
      {
        absolutePath = await ResolveScopedPath(context.policy, pathArg);
      }
      catch (error)
      {
        const escapeResult = HandlePathEscape(context, "tree", error);

        if (escapeResult)
        {
          return escapeResult;
        }

        throw error;
      }

      const displayPath = RelativizeDisplayPath(context.policy, absolutePath);

      try
      {
        await access(absolutePath, constants.R_OK);
      }
      catch
      {
        return ToolError(`Path not found: ${displayPath}`);
      }

      const directoryStat = await stat(absolutePath);

      if (!directoryStat.isDirectory())
      {
        return ToolError(`Not a directory: ${displayPath}`);
      }

      const state: TreeWalkState = {
        lines: [displayPath],
        entryCount: 1,
        truncated: false,
      };

      await WalkTree(
        context.policy,
        absolutePath,
        "",
        1,
        maxDepth,
        maxEntries,
        state,
      );

      let output = state.lines.join("\n");

      if (state.truncated)
      {
        output += `\n\n[Truncated: reached maxEntries=${maxEntries}.]`;
      }

      return ToolSuccess(output, {
        path: displayPath,
        entryCount: state.entryCount,
        truncated: state.truncated,
      });
    },
  };
}
