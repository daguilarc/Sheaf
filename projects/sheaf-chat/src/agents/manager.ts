import { stat } from "node:fs/promises";

import type { FileChangedNotification } from "../extensions/sheaf-chat/types.js";
import type { SheafChatConfig } from "../server/config.js";
import {
  AgentLifecycleState,
  type ModelMetadata,
  type ModelReference,
} from "../shared/types.js";
import {
  AllocateChatShell,
  CreateStoragePaths,
  type StoragePaths,
} from "../storage/index.js";
import { ResolveRootDirectory, ResolveWorkspaceDirectory } from "../storage/paths.js";
import { ResolveWorkspace } from "../storage/repositories.js";
import { StorageError } from "../storage/errors.js";

import { CreateSheafAuthStorage } from "./auth.js";
import {
  FormatChatKey,
  KeyChatId,
  KeyRepoId,
  KeyWorkspaceId,
  LifecycleEmitter,
  type AgentStatusSnapshot,
  type ModelApplyTo,
  type ChatKey,
  type UserMessageSubmission,
} from "./lifecycle.js";
import {
  CreateSheafModelRegistry,
  ListModels,
  ModelValidationError,
  ValidateModelSelection,
  type SheafModelRegistryBundle,
} from "./models.js";
import {
  CreateSheafPiSession,
  type CreateSheafPiSessionInput,
  type PiSessionHandle,
} from "./piAdapter.js";
import {
  CreateRuntimeRecordFromColdResume,
  ResolveWorkspaceRuntimeDirectory,
  ResolveSessionBootstrap,
  SessionRuntime,
  type SessionRuntimeContext,
} from "./sessionRuntime.js";
import { CreateSessionSummarizer, type SessionSummaryGenerator } from "./summarizer.js";

export class AgentManagerError extends Error
{
  readonly code: string;

  constructor(code: string, message: string)
  {
    super(message);
    this.name = "AgentManagerError";
    this.code = code;
  }
}

export type CreatePiSessionFn = (
  input: CreateSheafPiSessionInput,
) => Promise<PiSessionHandle>;

export interface AgentManagerOptions
{
  config: SheafChatConfig;
  storagePaths?: StoragePaths;
  modelBundle?: SheafModelRegistryBundle;
  lifecycle?: LifecycleEmitter;
  summarizer?: SessionSummaryGenerator;
  createPiSession?: CreatePiSessionFn;
  notifyFileChanged?: (event: FileChangedNotification) => void | Promise<void>;
  idleOffloadSeconds?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

export interface CreateBlankChatResult
{
  key: ChatKey;
  shell: import("../shared/types.js").AllocatedChatShell;
}

export class AgentManager
{
  private readonly m_config: SheafChatConfig;
  private readonly m_storagePaths: StoragePaths;
  private readonly m_modelBundle: SheafModelRegistryBundle;
  private readonly m_lifecycle: LifecycleEmitter;
  private readonly m_createPiSession: CreatePiSessionFn;
  private readonly m_runtimeContext: SessionRuntimeContext;
  private readonly m_runtimes = new Map<string, SessionRuntime>();
  private readonly m_startupLocks = new Map<string, Promise<void>>();
  private m_notifyFileChanged?: (event: FileChangedNotification) => void | Promise<void>;

  private constructor(
    config: SheafChatConfig,
    storagePaths: StoragePaths,
    modelBundle: SheafModelRegistryBundle,
    lifecycle: LifecycleEmitter,
    summarizer: SessionSummaryGenerator,
    createPiSession: CreatePiSessionFn,
    runtimeContext: SessionRuntimeContext,
    notifyFileChanged?: (event: FileChangedNotification) => void | Promise<void>,
  )
  {
    this.m_config = config;
    this.m_storagePaths = storagePaths;
    this.m_modelBundle = modelBundle;
    this.m_lifecycle = lifecycle;
    this.m_createPiSession = createPiSession;
    this.m_runtimeContext = runtimeContext;
    this.m_notifyFileChanged = notifyFileChanged;
  }

  static async Create(options: AgentManagerOptions): Promise<AgentManager>
  {
    const storagePaths = options.storagePaths ?? CreateStoragePaths(options.config.repoRoot);
    const authStorage = CreateSheafAuthStorage(options.config);
    const modelBundle =
      options.modelBundle ??
      await CreateSheafModelRegistry(options.config, authStorage);
    const lifecycle = options.lifecycle ?? new LifecycleEmitter();
    const summarizer = options.summarizer ?? CreateSessionSummarizer();
    const createPiSession = options.createPiSession ?? CreateSheafPiSession;
    const runtimeContext: SessionRuntimeContext = {
      config: options.config,
      storagePaths,
      lifecycle,
      summarizer,
      idleOffloadSeconds: options.idleOffloadSeconds ?? options.config.agentIdleOffloadSeconds,
      setTimeoutFn: options.setTimeoutFn ?? setTimeout,
      clearTimeoutFn: options.clearTimeoutFn ?? clearTimeout,
    };

    return new AgentManager(
      options.config,
      storagePaths,
      modelBundle,
      lifecycle,
      summarizer,
      createPiSession,
      runtimeContext,
      options.notifyFileChanged,
    );
  }

  SetNotifyFileChanged(
    notifyFileChanged: (event: FileChangedNotification) => void | Promise<void>,
  ): void
  {
    this.m_notifyFileChanged = notifyFileChanged;
  }

  get lifecycle(): LifecycleEmitter
  {
    return this.m_lifecycle;
  }

  get storagePaths(): StoragePaths
  {
    return this.m_storagePaths;
  }

  // Resolve a workspace's worktree root from cached workspace metadata, without
  // needing a chat. Used by workspace-scoped features such as Agent Review.
  async resolveWorkspaceRootDirectory(
    repoId: string,
    workspaceId: string,
  ): Promise<string>
  {
    const workspace = await ResolveWorkspace(this.m_storagePaths, repoId, workspaceId);
    return ResolveRootDirectory(this.m_storagePaths.repoRoot, workspace.path);
  }

  async resolveSessionRootDirectory(
    repoId: string,
    workspaceId: string,
    chatId: string,
  ): Promise<string>
  {
    try
    {
      const bootstrap = await ResolveSessionBootstrap(
        this.m_storagePaths,
        repoId,
        workspaceId,
        chatId,
      );

      return ResolveRootDirectory(this.m_storagePaths.repoRoot, bootstrap.rootDirectory);
    }
    catch
    {
      throw new AgentManagerError("chat_not_found", `chat not found: ${chatId}`);
    }
  }

  listModels(): ModelMetadata[]
  {
    return ListModels(
      this.m_config,
      this.m_modelBundle.modelRegistry,
      this.m_modelBundle.localProviderState,
    );
  }

  async createBlankChat(
    repoId: string,
    workspaceId: string,
    model: ModelReference,
  ): Promise<CreateBlankChatResult>
  {
    ValidateModelSelection(
      this.m_config,
      this.m_modelBundle.modelRegistry,
      this.m_modelBundle.localProviderState,
      model,
    );

    const shell = await AllocateChatShell(
      this.m_storagePaths,
      repoId,
      workspaceId,
      model,
    );
    await this.ValidateRootDirectory(shell.provisionalChat.rootDirectory);

    return {
      key: {
        repoId: shell.repoId,
        workspaceId: shell.workspaceId,
        chatId: shell.chatId,
      },
      shell,
    };
  }

  async attachSession(
    repoId: string,
    workspaceId: string,
    chatId: string,
    clientId?: string,
  ): Promise<AgentStatusSnapshot>
  {
    const key: ChatKey = {
      repoId,
      workspaceId,
      chatId,
    };
    const encodedKey = FormatChatKey(key);
    const existing = this.m_runtimes.get(encodedKey);

    if (existing !== undefined && existing.Record.piSession !== undefined)
    {
      existing.AttachClient(clientId);
      return this.BuildStatus(existing);
    }

    await this.RunWithStartupLock(encodedKey, async () =>
    {
      let runtime = this.m_runtimes.get(encodedKey);

      if (runtime !== undefined && runtime.Record.piSession !== undefined)
      {
        runtime.AttachClient(clientId);
        return;
      }

      runtime = await this.StartSessionRuntime(key);
      this.m_runtimes.set(encodedKey, runtime);
      runtime.AttachClient(clientId);
    });

    const runtime = this.m_runtimes.get(encodedKey);

    if (runtime === undefined)
    {
      throw new AgentManagerError("session_start_failed", "session runtime missing after startup");
    }

    return this.BuildStatus(runtime);
  }

  async submitUserMessage(key: ChatKey, message: UserMessageSubmission): Promise<void>
  {
    const runtime = await this.RequireActiveRuntime(key);
    await runtime.AcceptUserMessage(message);
  }

  async selectModel(
    key: ChatKey,
    model: ModelReference,
    applyTo: ModelApplyTo = "next_turn",
  ): Promise<void>
  {
    ValidateModelSelection(
      this.m_config,
      this.m_modelBundle.modelRegistry,
      this.m_modelBundle.localProviderState,
      model,
    );

    const runtime = await this.RequireActiveRuntime(key);
    await runtime.SelectModel(model, applyTo);
  }

  async cancelTurn(key: ChatKey): Promise<void>
  {
    const runtime = this.m_runtimes.get(FormatChatKey(key));

    if (runtime === undefined)
    {
      return;
    }

    await runtime.CancelTurn();
  }

  markClientDetached(key: ChatKey, clientId?: string): void
  {
    const runtime = this.m_runtimes.get(FormatChatKey(key));

    if (runtime === undefined)
    {
      return;
    }

    runtime.DetachClient(clientId);
  }

  getStatus(key: ChatKey): AgentStatusSnapshot | null
  {
    const runtime = this.m_runtimes.get(FormatChatKey(key));

    if (runtime === undefined)
    {
      return null;
    }

    return this.BuildStatus(runtime);
  }

  async dispose(): Promise<void>
  {
    for (const runtime of this.m_runtimes.values())
    {
      runtime.Dispose();
    }

    this.m_runtimes.clear();
    this.m_startupLocks.clear();
  }

  private async RequireActiveRuntime(key: ChatKey): Promise<SessionRuntime>
  {
    const encodedKey = FormatChatKey(key);
    let runtime = this.m_runtimes.get(encodedKey);

    if (runtime === undefined || runtime.Record.piSession === undefined)
    {
      await this.attachSession(KeyRepoId(key), KeyWorkspaceId(key), KeyChatId(key));
      runtime = this.m_runtimes.get(encodedKey);
    }

    if (runtime === undefined || runtime.Record.piSession === undefined)
    {
      throw new AgentManagerError("session_not_active", "session is not active");
    }

    return runtime;
  }

  private async StartSessionRuntime(key: ChatKey): Promise<SessionRuntime>
  {
    const bootstrap = await ResolveSessionBootstrap(
      this.m_storagePaths,
      KeyRepoId(key),
      KeyWorkspaceId(key),
      KeyChatId(key),
    );
    const record = CreateRuntimeRecordFromColdResume(key, bootstrap);
    const runtime = new SessionRuntime(this.m_runtimeContext, record);

    this.m_runtimes.set(FormatChatKey(key), runtime);
    runtime.TransitionState(AgentLifecycleState.Starting);

    try
    {
      const piSession = await this.m_createPiSession({
        config: this.m_config,
        modelBundle: this.m_modelBundle,
        rootDirectory: bootstrap.rootDirectory,
        sessionFilePath: bootstrap.sessionFilePath,
        workspaceDirectory: ResolveWorkspaceRuntimeDirectory(
          this.m_storagePaths,
          KeyRepoId(key),
          KeyWorkspaceId(key),
        ),
        model: bootstrap.model,
        coldResume: bootstrap.manifest !== undefined,
        notifyFileChanged: this.m_notifyFileChanged,
      });

      runtime.BindPiSession(piSession);
      runtime.TransitionState(AgentLifecycleState.Active);
      return runtime;
    }
    catch (error)
    {
      const message = error instanceof Error ? error.message : String(error);
      runtime.TransitionState(AgentLifecycleState.Failed);
      runtime.ReportError({
        code: "session_start_failed",
        message,
        fatal: true,
      });
      throw new AgentManagerError("session_start_failed", message);
    }
  }

  private async ValidateRootDirectory(rootDirectory: string): Promise<void>
  {
    const absoluteRoot = ResolveRootDirectory(this.m_storagePaths.repoRoot, rootDirectory);

    try
    {
      const rootStat = await stat(absoluteRoot);

      if (!rootStat.isDirectory())
      {
        throw new AgentManagerError(
          "invalid_root_directory",
          `root directory is not a directory: ${rootDirectory}`,
        );
      }
    }
    catch (error)
    {
      if (error instanceof AgentManagerError)
      {
        throw error;
      }

      throw new AgentManagerError(
        "invalid_root_directory",
        `root directory does not exist: ${rootDirectory}`,
      );
    }
  }

  private BuildStatus(runtime: SessionRuntime): AgentStatusSnapshot
  {
    const record = runtime.Record;
    const piSession = record.piSession;

    return {
      key: record.key,
      state: record.state,
      model: record.model,
      rootDirectory: record.rootDirectory,
      connectedClientCount: runtime.ConnectedClientCount,
      manifestPresent: record.manifestWritten || record.manifest !== undefined,
      isStreaming: piSession?.isStreaming ?? false,
      activeRunCount: record.activeRunCount,
      activeToolCount: record.activeToolCount,
      manifest: record.manifest,
      provisionalRootDirectory: record.provisional?.rootDirectory,
      error: record.lastError,
    };
  }

  private RunWithStartupLock(encodedKey: string, operation: () => Promise<void>): Promise<void>
  {
    const previous = this.m_startupLocks.get(encodedKey) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) =>
    {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.m_startupLocks.set(encodedKey, tail);

    return previous
      .then(() => operation())
      .finally(() =>
      {
        release();
        if (this.m_startupLocks.get(encodedKey) === tail)
        {
          this.m_startupLocks.delete(encodedKey);
        }
      });
  }
}

export {
  AgentLifecycleState,
  ModelValidationError,
  StorageError,
};
