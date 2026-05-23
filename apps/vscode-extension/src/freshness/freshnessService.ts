import * as vscode from "vscode";
import type { RealtimeAgentSession, StructuredContextMessage } from "realtime-agent-lib";

import type { ChatModel } from "../chat/chatModel.js";
import type { LogSink } from "../log.js";
import { buildCursorChangedMessage, buildFileChangedMessage, buildViewportChangedMessage } from "./contextBuilders.js";
import type { AgentMutationGuard, CursorFreshnessState, FileFreshnessState, ViewportFreshnessState } from "./types.js";
import type { VscodeFreshnessHost } from "./vscodeFreshnessHost.js";

export class FreshnessService
{
  private readonly m_session: RealtimeAgentSession;
  private readonly m_chatModel: ChatModel;
  private readonly m_log: LogSink;
  private readonly m_host: VscodeFreshnessHost;
  private readonly m_files = new Map<string, FileFreshnessState>();
  private m_viewport: ViewportFreshnessState = FreshnessService.EmptyViewport();
  private m_cursor: CursorFreshnessState = FreshnessService.EmptyCursor();
  private m_agentMutationDepth = 0;
  private m_disposables: vscode.Disposable[] = [];

  constructor(
    session: RealtimeAgentSession,
    chatModel: ChatModel,
    log: LogSink,
    host: VscodeFreshnessHost,
  )
  {
    this.m_session = session;
    this.m_chatModel = chatModel;
    this.m_log = log;
    this.m_host = host;
  }

  private static EmptyViewport(): ViewportFreshnessState
  {
    return {
      currentFile: null,
      everObserved: false,
      changedSinceLastCheck: false,
      notificationSent: false,
    };
  }

  private static EmptyCursor(): CursorFreshnessState
  {
    return {
      currentFile: null,
      everObserved: false,
      changedSinceLastCheck: false,
      notificationSent: false,
    };
  }

  attachListeners(): void
  {
    this.dispose();

    this.m_disposables.push(
      this.m_host.onDidChangeTextDocument((e) =>
      {
        this.OnDidChangeTextDocument(e);
      }),
      this.m_host.onDidChangeActiveTextEditor((e) =>
      {
        this.OnDidChangeActiveTextEditor(e);
      }),
      this.m_host.onDidChangeTextEditorVisibleRanges((e) =>
      {
        this.OnDidChangeTextEditorVisibleRanges(e);
      }),
      this.m_host.onDidChangeTextEditorSelection((e) =>
      {
        this.OnDidChangeTextEditorSelection(e);
      }),
    );
  }

  dispose(): void
  {
    for (const d of this.m_disposables)
    {
      d.dispose();
    }

    this.m_disposables = [];
    this.m_files.clear();
    this.m_viewport = FreshnessService.EmptyViewport();
    this.m_cursor = FreshnessService.EmptyCursor();
    this.m_agentMutationDepth = 0;
  }

  markFileObserved(file: string): void
  {
    const normalized = file.split("\\").join("/");
    let st = this.m_files.get(normalized);
    if (st === undefined)
    {
      st = { file: normalized, changedSinceLastRead: false, notificationSent: false };
      this.m_files.set(normalized, st);
    }
    else
    {
      st.changedSinceLastRead = false;
      st.notificationSent = false;
    }

    this.MaybeNotifyFile(st);
  }

  markViewportObserved(file: string): void
  {
    const normalized = file.split("\\").join("/");
    this.m_viewport.everObserved = true;
    this.m_viewport.changedSinceLastCheck = false;
    this.m_viewport.notificationSent = false;
    this.m_viewport.currentFile = normalized;
    this.MaybeNotifyViewport(normalized);
  }

  markCursorObserved(file: string): void
  {
    const normalized = file.split("\\").join("/");
    this.m_cursor.everObserved = true;
    this.m_cursor.changedSinceLastCheck = false;
    this.m_cursor.notificationSent = false;
    this.m_cursor.currentFile = normalized;
    this.MaybeNotifyCursor(normalized);
  }

  beginAgentMutation(): AgentMutationGuard
  {
    this.m_agentMutationDepth++;
    let ended = false;
    return {
      end: () =>
      {
        if (ended)
        {
          return;
        }

        ended = true;
        this.m_agentMutationDepth = Math.max(0, this.m_agentMutationDepth - 1);
      },
    };
  }

  private WorkspaceFileRelative(doc: vscode.TextDocument): string | undefined
  {
    if (doc.uri.scheme !== "file")
    {
      return undefined;
    }

    if (doc.languageId === "git" || doc.languageId === "vscode-scm")
    {
      return undefined;
    }

    const rel = this.m_host.asRelativePath(doc.uri);
    if (rel.length === 0)
    {
      return undefined;
    }

    const posix = rel.split("\\").join("/");
    if (posix.split("/").includes(".."))
    {
      return undefined;
    }

    return posix;
  }

  private OnDidChangeTextDocument(e: vscode.TextDocumentChangeEvent): void
  {
    if (this.m_agentMutationDepth > 0)
    {
      return;
    }

    const rel = this.WorkspaceFileRelative(e.document);
    if (rel === undefined)
    {
      return;
    }

    const st = this.m_files.get(rel);
    if (st === undefined)
    {
      return;
    }

    st.changedSinceLastRead = true;
    this.MaybeNotifyFile(st);
  }

  private OnDidChangeActiveTextEditor(editor: vscode.TextEditor | undefined): void
  {
    const newFile = editor === undefined ? null : this.WorkspaceFileRelative(editor.document) ?? null;

    if (this.m_agentMutationDepth > 0)
    {
      this.m_viewport.currentFile = newFile;
      this.m_cursor.currentFile = newFile;
      return;
    }

    const prevViewportFile = this.m_viewport.currentFile;
    const prevCursorFile = this.m_cursor.currentFile;

    this.m_viewport.currentFile = newFile;
    this.m_cursor.currentFile = newFile;

    const viewportPayload =
      newFile !== null && newFile.length > 0 ? newFile : prevViewportFile !== null ? prevViewportFile : null;
    const cursorPayload =
      newFile !== null && newFile.length > 0 ? newFile : prevCursorFile !== null ? prevCursorFile : null;

    if (this.m_viewport.everObserved && viewportPayload !== null)
    {
      this.m_viewport.changedSinceLastCheck = true;
      this.MaybeNotifyViewport(viewportPayload);
    }

    if (this.m_cursor.everObserved && cursorPayload !== null)
    {
      this.m_cursor.changedSinceLastCheck = true;
      this.MaybeNotifyCursor(cursorPayload);
    }
  }

  private OnDidChangeTextEditorVisibleRanges(e: vscode.TextEditorVisibleRangesChangeEvent): void
  {
    if (this.m_agentMutationDepth > 0)
    {
      return;
    }

    if (this.m_host.getActiveTextEditor() !== e.textEditor)
    {
      return;
    }

    const rel = this.WorkspaceFileRelative(e.textEditor.document);
    if (rel === undefined)
    {
      return;
    }

    if (!this.m_viewport.everObserved)
    {
      return;
    }

    this.m_viewport.changedSinceLastCheck = true;
    this.MaybeNotifyViewport(rel);
  }

  private OnDidChangeTextEditorSelection(e: vscode.TextEditorSelectionChangeEvent): void
  {
    if (this.m_agentMutationDepth > 0)
    {
      return;
    }

    if (this.m_host.getActiveTextEditor() !== e.textEditor)
    {
      return;
    }

    const rel = this.WorkspaceFileRelative(e.textEditor.document);
    if (rel === undefined)
    {
      return;
    }

    if (!this.m_cursor.everObserved)
    {
      return;
    }

    this.m_cursor.changedSinceLastCheck = true;
    this.MaybeNotifyCursor(rel);
  }

  private MaybeNotifyFile(st: FileFreshnessState): void
  {
    if (!st.changedSinceLastRead || st.notificationSent)
    {
      return;
    }

    const message = buildFileChangedMessage(st.file);
    st.notificationSent = true;
    void this.SendContext(message);
  }

  private MaybeNotifyViewport(payloadFile: string): void
  {
    if (!this.m_viewport.everObserved || !this.m_viewport.changedSinceLastCheck || this.m_viewport.notificationSent)
    {
      return;
    }

    const message = buildViewportChangedMessage(payloadFile);
    this.m_viewport.notificationSent = true;
    void this.SendContext(message);
  }

  private MaybeNotifyCursor(payloadFile: string): void
  {
    if (!this.m_cursor.everObserved || !this.m_cursor.changedSinceLastCheck || this.m_cursor.notificationSent)
    {
      return;
    }

    const message = buildCursorChangedMessage(payloadFile);
    this.m_cursor.notificationSent = true;
    void this.SendContext(message);
  }

  private async SendContext(message: StructuredContextMessage): Promise<void>
  {
    try
    {
      await this.m_session.sendStructuredContext(message);
      this.m_chatModel.recordContextPush(message);
    }
    catch (error)
    {
      this.m_log.Error("sendStructuredContext failed", error);
    }
  }
}
