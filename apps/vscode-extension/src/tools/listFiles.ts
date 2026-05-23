import * as nodePath from "node:path";

import type { ToolDefinition } from "realtime-agent-lib";

import type { ToolServices } from "./toolContext.js";
import type { FileEntry, ListFilesArgs, ListFilesResult, ToolError } from "./types.js";

const x_defaultMaxEntries = 500;
const x_defaultIgnoredDirNames = new Set([".git", "node_modules"]);

const x_inputSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    directory: { type: "string" },
    recursive: { type: "boolean" },
    includeHidden: { type: "boolean" },
    maxEntries: { type: "integer" },
  },
  required: ["directory"],
  additionalProperties: false,
};

function ShouldSkipName(name: string, includeHidden: boolean): boolean
{
  if (!includeHidden && name.startsWith("."))
  {
    return true;
  }

  if (!includeHidden && x_defaultIgnoredDirNames.has(name))
  {
    return true;
  }

  return false;
}

function JoinPosix(dir: string, name: string): string
{
  if (dir === "." || dir.length === 0)
  {
    return name;
  }

  return `${dir}/${name}`;
}

export function CreateListFilesTool(services: ToolServices): ToolDefinition<ListFilesArgs, ListFilesResult | ToolError>
{
  return {
    name: "list_files",
    description: "List files and directories under a workspace-relative directory.",
    inputSchema: x_inputSchema,
    callback: async (rawArgs): Promise<ListFilesResult | ToolError> =>
    {
      const args = rawArgs as ListFilesArgs;
      if (typeof args.directory !== "string")
      {
        return { code: "invalid_range", message: "Argument `directory` must be a string." };
      }

      const resolved = services.editorAccess.ResolveWorkspacePathForTools(args.directory);
      if ("code" in resolved)
      {
        return resolved;
      }

      const stat = await services.editorAccess.Stat(resolved.absPath);
      if (stat === undefined)
      {
        return { code: "file_not_found", message: "Directory not found." };
      }

      if (stat.kind === "file")
      {
        return { code: "invalid_range", message: "Expected a directory path." };
      }

      const recursive = args.recursive === true;
      const includeHidden = args.includeHidden === true;
      const maxEntriesRaw = args.maxEntries ?? x_defaultMaxEntries;
      if (!Number.isInteger(maxEntriesRaw) || maxEntriesRaw < 1)
      {
        return { code: "invalid_range", message: "`maxEntries` must be a positive integer." };
      }

      const maxEntries = maxEntriesRaw;
      const baseDirPosix = resolved.relativePosix === "" ? "." : resolved.relativePosix.split("\\").join("/");

      services.freshness.markFileObserved(baseDirPosix);

      const collected: FileEntry[] = [];
      let truncated = false;

      if (!recursive)
      {
        const entries = await services.editorAccess.ReadDirectory(resolved.absPath);
        for (const entry of entries)
        {
          if (ShouldSkipName(entry.name, includeHidden))
          {
            continue;
          }

          const rel = JoinPosix(baseDirPosix, entry.name);
          collected.push({ path: rel, kind: entry.kind });
        }

        truncated = collected.length > maxEntries;
      }
      else
      {
        const queue: string[] = [resolved.absPath];
        const relQueue: string[] = [baseDirPosix];

        outer: while (queue.length > 0)
        {
          const abs = queue.shift()!;
          const relDir = relQueue.shift()!;
          let dirEntries: Array<{ name: string; kind: "file" | "directory" }>;
          try
          {
            dirEntries = await services.editorAccess.ReadDirectory(abs);
          }
          catch
          {
            continue;
          }

          for (const entry of dirEntries)
          {
            if (ShouldSkipName(entry.name, includeHidden))
            {
              continue;
            }

            const childRel = JoinPosix(relDir, entry.name);
            const childAbs = nodePath.join(abs, entry.name);
            if (collected.length >= maxEntries)
            {
              truncated = true;
              break outer;
            }

            collected.push({ path: childRel, kind: entry.kind });
            if (entry.kind === "directory")
            {
              queue.push(childAbs);
              relQueue.push(childRel);
            }
          }
        }
      }

      const trimmed = collected.slice(0, maxEntries);
      trimmed.sort((a, b) =>
      {
        if (a.kind !== b.kind)
        {
          return a.kind === "directory" ? -1 : 1;
        }

        return a.path.localeCompare(b.path);
      });

      return {
        directory: baseDirPosix,
        recursive,
        truncated,
        entries: trimmed,
      };
    },
  };
}
