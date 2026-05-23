import type { ToolDefinition } from "realtime-agent-lib";

import type { ToolServices } from "./toolContext.js";
import type { CodeLine, RgrepArgs, RgrepMatch, RgrepResult, ToolError } from "./types.js";
import { IsToolError } from "./types.js";

const x_defaultMaxMatches = 200;
const x_maxFindFiles = 5001;

const x_inputSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    pattern: { type: "string" },
    directory: { type: "string" },
    fileGlob: { type: "string" },
    caseSensitive: { type: "boolean" },
    maxMatches: { type: "integer" },
    contextLinesBefore: { type: "integer" },
    contextLinesAfter: { type: "integer" },
  },
  required: ["pattern"],
  additionalProperties: false,
};

function HasNulByte(text: string): boolean
{
  for (let i = 0; i < text.length; i++)
  {
    if (text.charCodeAt(i) === 0)
    {
      return true;
    }
  }

  return false;
}

function PosixRelativeFromRoots(absPath: string, roots: string[]): string | undefined
{
  const normalized = absPath.replace(/\\/g, "/");
  for (const root of roots)
  {
    const rootNorm = root.replace(/\\/g, "/");
    const prefix = rootNorm.endsWith("/") ? rootNorm : `${rootNorm}/`;
    if (normalized === rootNorm || normalized === rootNorm.replace(/\/$/, ""))
    {
      return ".";
    }

    if (normalized.startsWith(prefix))
    {
      return normalized.slice(prefix.length);
    }
  }

  return undefined;
}

// Freshness: rgrep scans text but does not count as a full-file read for
// invalidation; only read tools establish per-file observation (slice 0006).
//
export function CreateRgrepTool(services: ToolServices): ToolDefinition<RgrepArgs, RgrepResult | ToolError>
{
  return {
    name: "rgrep",
    description: "Search workspace text files using a regular expression (VS Code workspace file discovery).",
    inputSchema: x_inputSchema,
    callback: async (rawArgs): Promise<RgrepResult | ToolError> =>
    {
      const args = rawArgs as RgrepArgs;
      if (typeof args.pattern !== "string")
      {
        return { code: "invalid_pattern", message: "Argument `pattern` must be a string." };
      }

      let regex: RegExp;
      try
      {
        regex = new RegExp(args.pattern, args.caseSensitive === false ? "gi" : "g");
      }
      catch (error)
      {
        return {
          code: "invalid_pattern",
          message: error instanceof Error ? error.message : "Invalid regular expression.",
        };
      }

      const maxMatchesRaw = args.maxMatches ?? x_defaultMaxMatches;
      if (!Number.isInteger(maxMatchesRaw) || maxMatchesRaw < 1)
      {
        return { code: "invalid_range", message: "`maxMatches` must be a positive integer." };
      }

      const ctxBeforeRaw = args.contextLinesBefore ?? 0;
      const ctxAfterRaw = args.contextLinesAfter ?? 0;
      if (!Number.isInteger(ctxBeforeRaw) || ctxBeforeRaw < 0 || !Number.isInteger(ctxAfterRaw) || ctxAfterRaw < 0)
      {
        return { code: "invalid_range", message: "Context line counts must be non-negative integers." };
      }

      const maxMatches = maxMatchesRaw;
      const ctxBefore = ctxBeforeRaw;
      const ctxAfter = ctxAfterRaw;

      let dirRel: string | undefined;
      let dirRoot: string | undefined;
      if (args.directory !== undefined && args.directory.trim().length > 0)
      {
        const resolved = services.editorAccess.ResolveWorkspacePathForTools(args.directory);
        if ("code" in resolved)
        {
          return resolved;
        }

        const stat = await services.editorAccess.Stat(resolved.absPath);
        if (stat === undefined)
        {
          return { code: "file_not_found", message: "Search directory not found." };
        }

        if (stat.kind === "file")
        {
          return { code: "invalid_range", message: "Expected `directory` to be a directory." };
        }

        dirRel = resolved.relativePosix === "" ? "." : resolved.relativePosix.split("\\").join("/");
        dirRoot = resolved.rootFsPath;
      }

      const globPart = args.fileGlob === undefined || args.fileGlob.length === 0 ? "**/*" : args.fileGlob;
      const paths =
        args.directory === undefined || args.directory.trim().length === 0
          ? await services.editorAccess.FindWorkspaceFiles({ type: "all_workspace", includePattern: globPart }, x_maxFindFiles)
          : await services.editorAccess.FindWorkspaceFiles(
              {
                type: "under_root",
                rootFsPath: dirRoot ?? "",
                includePatternRelativeToRoot:
                  dirRel === undefined || dirRel === "." ? globPart : `${dirRel}/${globPart}`,
              },
              x_maxFindFiles,
            );

      paths.sort((a, b) => a.localeCompare(b));

      const matches: RgrepMatch[] = [];
      let truncated = false;
      const roots = services.editorAccess.GetWorkspaceRoots();

      outer: for (const absPath of paths)
      {
        const stat = await services.editorAccess.Stat(absPath);
        if (stat === undefined || stat.kind !== "file" || stat.size > 2 * 1024 * 1024)
        {
          continue;
        }

        const relativePosix = PosixRelativeFromRoots(absPath, roots);
        if (relativePosix === undefined)
        {
          continue;
        }

        const doc = await services.editorAccess.OpenTextDocument(absPath, relativePosix);
        if (IsToolError(doc))
        {
          continue;
        }

        if (doc.languageId === "binary")
        {
          continue;
        }

        const head = doc.getText().slice(0, 8192);
        if (HasNulByte(head))
        {
          continue;
        }

        for (let line0 = 0; line0 < doc.lineCount; line0++)
        {
          const lineText = doc.lineTextAt0(line0);
          regex.lastIndex = 0;
          let matchExec: RegExpExecArray | null;
          while ((matchExec = regex.exec(lineText)) !== null)
          {
            const matchText = matchExec[0];
            const char0 = matchExec.index;
            const before: CodeLine[] = [];
            const after: CodeLine[] = [];
            for (let b = line0 - ctxBefore; b < line0; b++)
            {
              if (b >= 0)
              {
                before.push({ line: b + 1, text: doc.lineTextAt0(b) });
              }
            }

            for (let a = line0 + 1; a <= line0 + ctxAfter; a++)
            {
              if (a < doc.lineCount)
              {
                after.push({ line: a + 1, text: doc.lineTextAt0(a) });
              }
            }

            // `truncated` must signal that at least one additional match was
            // omitted, not merely that the bound was reached. Detect the
            // overflow case before pushing so an exact-bound result still
            // reports `truncated: false`.
            //
            if (matches.length >= maxMatches)
            {
              truncated = true;
              break outer;
            }

            const entry: RgrepMatch = {
              file: doc.relativePosix,
              line: line0 + 1,
              character: char0,
              text: lineText,
              matchText,
            };
            if (before.length > 0)
            {
              entry.contextBefore = before;
            }

            if (after.length > 0)
            {
              entry.contextAfter = after;
            }

            matches.push(entry);

            if (matchText.length === 0)
            {
              regex.lastIndex++;
            }
          }
        }
      }

      matches.sort((a, b) =>
      {
        if (a.file !== b.file)
        {
          return a.file.localeCompare(b.file);
        }

        if (a.line !== b.line)
        {
          return a.line - b.line;
        }

        return a.character - b.character;
      });

      const result: RgrepResult = {
        pattern: args.pattern,
        truncated,
        matches,
      };

      if (args.directory !== undefined && args.directory.trim().length > 0)
      {
        result.directory = dirRel;
      }

      if (args.fileGlob !== undefined)
      {
        result.fileGlob = args.fileGlob;
      }

      return result;
    },
  };
}
