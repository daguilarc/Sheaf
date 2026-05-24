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

function EffectiveLines(lines: string[]): string[]
{
  // Mirror VS Code's real `TextDocument` shape: an empty file is reported as
  // `lineCount: 1` with a single empty line and `getText() === ""`, not as zero
  // lines. Production tools must handle this case from on-disk empty files.
  //
  return lines.length === 0 ? [""] : lines;
}

function BufferTextFromLines(lines: string[]): string
{
  return EffectiveLines(lines).join("\n");
}

function PositionIsValid0(effectiveLines: string[], line0: number, character0: number): boolean
{
  if (line0 < 0 || line0 >= effectiveLines.length)
  {
    return false;
  }

  if (character0 < 0)
  {
    return false;
  }

  const lineEnd = effectiveLines[line0]?.length ?? 0;
  return character0 <= lineEnd;
}

function OffsetAt0(effectiveLines: string[], line0: number, character0: number): number
{
  let offset = 0;
  for (let i = 0; i < line0; i++)
  {
    offset += effectiveLines[i]!.length + 1;
  }

  return offset + character0;
}

function LineEndCharacter0(effectiveLines: string[], line0: number): number
{
  return effectiveLines[line0]?.length ?? 0;
}

function GetTextRange0(
  effectiveLines: string[],
  startLine0: number,
  startCharacter0: number,
  endLine0: number,
  endCharacter0: number,
): string
{
  if (startLine0 === endLine0)
  {
    return effectiveLines[startLine0]!.slice(startCharacter0, endCharacter0);
  }

  const parts: string[] = [];
  parts.push(effectiveLines[startLine0]!.slice(startCharacter0));
  for (let line = startLine0 + 1; line < endLine0; line++)
  {
    parts.push(effectiveLines[line]!);
  }

  parts.push(effectiveLines[endLine0]!.slice(0, endCharacter0));
  return parts.join("\n");
}

function LinesFromBufferText(text: string): string[]
{
  if (text.length === 0)
  {
    return [""];
  }

  return text.split("\n");
}

function OpenedFromLines(absPath: string, relativePosix: string, lines: string[]): OpenedTextDocument
{
  const effectiveLines = EffectiveLines(lines);
  const fullText = BufferTextFromLines(lines);

  return {
    absPath,
    relativePosix,
    languageId: "plaintext",
    lineCount: effectiveLines.length,
    lineTextAt0(lineIndex0: number): string
    {
      return effectiveLines[lineIndex0] ?? "";
    },
    getText(): string
    {
      return fullText;
    },
    positionIsValid0(line0: number, character0: number): boolean
    {
      return PositionIsValid0(effectiveLines, line0, character0);
    },
    offsetAt0(line0: number, character0: number): number
    {
      return OffsetAt0(effectiveLines, line0, character0);
    },
    lineEndCharacter0(line0: number): number
    {
      return LineEndCharacter0(effectiveLines, line0);
    },
    getTextRange0(
      startLine0: number,
      startCharacter0: number,
      endLine0: number,
      endCharacter0: number,
    ): string
    {
      return GetTextRange0(effectiveLines, startLine0, startCharacter0, endLine0, endCharacter0);
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

  async ReplaceTextRange(
    absPath: string,
    relativePosix: string,
    range: {
      startLine0: number;
      startCharacter0: number;
      endLine0: number;
      endCharacter0: number;
    },
    replacementText: string,
  ): Promise<{ accepted: true } | ToolError>
  {
    const lines = this.m_files.get(absPath);
    if (lines === undefined)
    {
      return { code: "file_not_found", message: "missing" };
    }

    const opened = OpenedFromLines(absPath, relativePosix, lines);

    if (
      !opened.positionIsValid0(range.startLine0, range.startCharacter0)
      || !opened.positionIsValid0(range.endLine0, range.endCharacter0)
    )
    {
      return {
        code: "invalid_position",
        message: "Start or end position is outside the document buffer.",
        details: {
          file: relativePosix,
          startLine0: range.startLine0,
          startCharacter0: range.startCharacter0,
          endLine0: range.endLine0,
          endCharacter0: range.endCharacter0,
        },
      };
    }

    const startOffset = opened.offsetAt0(range.startLine0, range.startCharacter0);
    const endOffset = opened.offsetAt0(range.endLine0, range.endCharacter0);
    if (startOffset > endOffset)
    {
      return {
        code: "invalid_position",
        message: "Start position must be before or equal to the end position.",
        details: {
          file: relativePosix,
          startLine0: range.startLine0,
          startCharacter0: range.startCharacter0,
          endLine0: range.endLine0,
          endCharacter0: range.endCharacter0,
        },
      };
    }

    const before = BufferTextFromLines(lines).slice(0, startOffset);
    const after = BufferTextFromLines(lines).slice(endOffset);
    const newText = before + replacementText + after;
    const newLines = LinesFromBufferText(newText);
    this.m_files.set(absPath, newLines);

    return { accepted: true };
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
