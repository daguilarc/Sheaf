import * as fs from "node:fs";
import * as nodePath from "node:path";

import type {
  ActiveEditorHandle,
  CursorRevealKind,
  EditorAccess,
  OpenedTextDocument,
} from "../../src/tools/editorAccessTypes.js";
import { ResolveWorkspacePath, type ResolveWorkspacePathResult } from "../../src/tools/pathPolicy.js";
import type { ToolError } from "../../src/tools/types.js";

function ToAbs(root: string, relPosix: string): string
{
  return nodePath.normalize(nodePath.join(root, ...relPosix.split("/")));
}

function OpenedFromLines(absPath: string, relativePosix: string, lines: string[]): OpenedTextDocument
{
  return {
    absPath,
    relativePosix,
    languageId: "plaintext",
    lineCount: lines.length,
    lineTextAt0(lineIndex0: number): string
    {
      return lines[lineIndex0] ?? "";
    },
    getText(): string
    {
      return lines.join("\n");
    },
  };
}

export class MemoryEditorAccess implements EditorAccess
{
  private readonly m_root: string;
  private readonly m_files = new Map<string, string[]>();
  private readonly m_dirs = new Set<string>();
  private m_activeAbs: string | undefined;
  private m_cursorLine0 = 0;
  private m_cursorChar0 = 0;
  private m_viewFirst0 = 0;
  private m_viewLast0 = 0;

  constructor(rootAbs: string)
  {
    this.m_root = nodePath.normalize(rootAbs);
    this.m_dirs.add(this.m_root);
  }

  GetWorkspaceRoots(): string[]
  {
    return [this.m_root];
  }

  ResolveWorkspacePathForTools(input: string): ResolveWorkspacePathResult
  {
    return ResolveWorkspacePath(input, this.GetWorkspaceRoots());
  }

  SeedFile(relativePosix: string, lines: string[]): void
  {
    const abs = ToAbs(this.m_root, relativePosix);
    this.m_files.set(abs, lines);
    fs.mkdirSync(nodePath.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, lines.join("\n"), "utf8");
    let cur = nodePath.dirname(abs);
    while (cur.length >= this.m_root.length && cur.startsWith(this.m_root))
    {
      this.m_dirs.add(cur);
      const next = nodePath.dirname(cur);
      if (next === cur)
      {
        break;
      }

      cur = next;
    }
  }

  SeedDirectory(relativePosix: string): void
  {
    const abs = ToAbs(this.m_root, relativePosix);
    this.m_dirs.add(abs);
    fs.mkdirSync(abs, { recursive: true });
    let cur = nodePath.dirname(abs);
    while (cur.length >= this.m_root.length && cur.startsWith(this.m_root))
    {
      this.m_dirs.add(cur);
      const next = nodePath.dirname(cur);
      if (next === cur)
      {
        break;
      }

      cur = next;
    }
  }

  SetActiveFile(relativePosix: string | undefined, cursorLine0 = 0, cursorChar0 = 0): void
  {
    if (relativePosix === undefined)
    {
      this.m_activeAbs = undefined;
      return;
    }

    this.m_activeAbs = ToAbs(this.m_root, relativePosix);
    this.m_cursorLine0 = cursorLine0;
    this.m_cursorChar0 = cursorChar0;
    const lines = this.m_files.get(this.m_activeAbs) ?? [];
    this.m_viewFirst0 = 0;
    this.m_viewLast0 = Math.max(0, lines.length - 1);
  }

  async Stat(absPath: string): Promise<{ kind: "file" | "directory"; size: number } | undefined>
  {
    if (this.m_files.has(absPath))
    {
      const text = this.m_files.get(absPath)!.join("\n");
      return { kind: "file", size: Buffer.byteLength(text, "utf8") };
    }

    if (this.m_dirs.has(nodePath.normalize(absPath)))
    {
      return { kind: "directory", size: 0 };
    }

    return undefined;
  }

  async OpenTextDocument(absPath: string, relativePosix: string): Promise<OpenedTextDocument | ToolError>
  {
    const lines = this.m_files.get(absPath);
    if (lines === undefined)
    {
      return { code: "file_not_found", message: "missing" };
    }

    return OpenedFromLines(absPath, relativePosix, lines);
  }

  async ReadDirectory(absPath: string): Promise<Array<{ name: string; kind: "file" | "directory" }>>
  {
    const norm = nodePath.normalize(absPath);
    const out = new Map<string, "file" | "directory">();

    for (const fileAbs of this.m_files.keys())
    {
      if (nodePath.dirname(fileAbs) === norm)
      {
        out.set(nodePath.basename(fileAbs), "file");
      }
    }

    for (const dirAbs of this.m_dirs)
    {
      if (dirAbs === norm)
      {
        continue;
      }

      if (nodePath.dirname(dirAbs) === norm)
      {
        out.set(nodePath.basename(dirAbs), "directory");
      }
    }

    return [...out.entries()].map(([name, kind]) => ({ name, kind }));
  }

  async FindWorkspaceFiles(
    scope:
      | { type: "all_workspace"; includePattern: string }
      | { type: "under_root"; rootFsPath: string; includePatternRelativeToRoot: string },
    maxResults: number,
  ): Promise<string[]>
  {
    const relOf = (abs: string): string =>
      nodePath.relative(this.m_root, abs).split(nodePath.sep).join("/");

    const all = [...this.m_files.keys()].sort((a, b) => a.localeCompare(b));
    const out: string[] = [];

    let dirPrefix = "";
    let glob = "**/*";
    if (scope.type === "under_root")
    {
      const combined = scope.includePatternRelativeToRoot.replace(/\\/g, "/");
      const slash = combined.lastIndexOf("/");
      if (slash >= 0)
      {
        dirPrefix = combined.slice(0, slash);
        glob = combined.slice(slash + 1);
      }
      else
      {
        glob = combined;
      }
    }
    else
    {
      glob = scope.includePattern;
    }

    for (const abs of all)
    {
      const rel = relOf(abs);
      if (scope.type === "under_root")
      {
        if (dirPrefix.length > 0 && dirPrefix !== "." && !rel.startsWith(`${dirPrefix}/`) && rel !== dirPrefix)
        {
          continue;
        }
      }

      if (!GlobMatches(rel, glob))
      {
        continue;
      }

      out.push(abs);
      if (out.length >= maxResults)
      {
        break;
      }
    }

    return out;
  }

  GetActiveEditor(): ActiveEditorHandle | undefined
  {
    if (this.m_activeAbs === undefined)
    {
      return undefined;
    }

    return this.BuildHandleForAbs(this.m_activeAbs);
  }

  async OpenEditorAndFocus(
    absPath: string,
    relativePosix: string,
    preserveFocus: boolean,
  ): Promise<ActiveEditorHandle | ToolError>
  {
    void preserveFocus;
    const lines = this.m_files.get(absPath);
    if (lines === undefined)
    {
      return { code: "file_not_found", message: "missing" };
    }

    this.m_activeAbs = absPath;
    return this.BuildHandleForAbsWithDoc(absPath, relativePosix, lines);
  }

  private BuildHandleForAbs(abs: string): ActiveEditorHandle | undefined
  {
    const lines = this.m_files.get(abs);
    if (lines === undefined)
    {
      return undefined;
    }

    const rel = nodePath.relative(this.m_root, abs).split(nodePath.sep).join("/") || ".";
    return this.BuildHandleForAbsWithDoc(abs, rel, lines);
  }

  private BuildHandleForAbsWithDoc(abs: string, relativePosix: string, lines: string[]): ActiveEditorHandle
  {
    const doc = OpenedFromLines(abs, relativePosix, lines);
    const self = this;

    return {
      document: doc,
      getActivePosition0(): { line: number; character: number }
      {
        return { line: self.m_cursorLine0, character: self.m_cursorChar0 };
      },
      setActivePosition0(line: number, character: number): void
      {
        self.m_cursorLine0 = line;
        self.m_cursorChar0 = character;
      },
      getViewportInclusive0(): { firstLine0: number; lastLine0: number }
      {
        return { firstLine0: self.m_viewFirst0, lastLine0: self.m_viewLast0 };
      },
      revealLinePreservingSelection(line0: number, reveal: CursorRevealKind): void
      {
        void reveal;
        self.m_viewFirst0 = Math.max(0, line0);
        self.m_viewLast0 = Math.min(Math.max(0, doc.lineCount - 1), line0 + 10);
      },
      revealCursorAfterMove(line0: number, char0: number, reveal: CursorRevealKind): void
      {
        void reveal;
        self.m_cursorLine0 = line0;
        self.m_cursorChar0 = char0;
        self.m_viewFirst0 = Math.max(0, line0 - 2);
        self.m_viewLast0 = Math.min(Math.max(0, doc.lineCount - 1), line0 + 8);
      },
    };
  }
}

function GlobMatches(relPosix: string, glob: string): boolean
{
  if (glob === "**/*" || glob === "**")
  {
    return true;
  }

  if (glob.startsWith("**/"))
  {
    const tail = glob.slice(3);
    return relPosix.endsWith(tail) || relPosix.includes(`/${tail}`);
  }

  if (glob.startsWith("*."))
  {
    const ext = glob.slice(1);
    return relPosix.endsWith(ext);
  }

  return relPosix.endsWith(glob);
}
