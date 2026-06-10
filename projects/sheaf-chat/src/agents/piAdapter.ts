import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
  type PromptOptions,
} from "@earendil-works/pi-coding-agent";

import type { SheafChatConfig } from "../server/config.js";
import {
  CreateDefaultBindings,
  RegisterScopedTools,
  x_scopedToolNames,
} from "../extensions/sheaf-chat/index.js";
import type { FileChangedNotification } from "../extensions/sheaf-chat/types.js";
import type { ModelReference } from "../shared/types.js";
import { ResolveSheafAgentDir } from "./auth.js";
import { CreateSheafProviderExtension } from "./providerExtension.js";
import type { SheafModelRegistryBundle } from "./models.js";

export interface PiSessionPromptOptions
{
  streamingBehavior?: PromptOptions["streamingBehavior"];
}

export interface PiSessionHandle
{
  prompt(text: string, options?: PiSessionPromptOptions): Promise<void>;
  steer(text: string): Promise<void>;
  followUp(text: string): Promise<void>;
  setModel(model: ModelReference): Promise<void>;
  abort(): Promise<void>;
  dispose(): void;
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  readonly isStreaming: boolean;
  readonly sessionFile: string | undefined;
  readonly sessionId: string;
  readonly messages: AgentSession["messages"];
  readonly model: ModelReference | undefined;
}

export interface CreateSheafPiSessionInput
{
  config: SheafChatConfig;
  modelBundle: SheafModelRegistryBundle;
  rootDirectory: string;
  sessionFilePath: string;
  pileDirectory: string;
  model: ModelReference;
  coldResume?: boolean;
  notifyFileChanged?: (event: FileChangedNotification) => void | Promise<void>;
}

export interface CreateSheafPiSessionOptions
{
  createAgentSessionFn?: typeof createAgentSession;
}

class AgentSessionHandle implements PiSessionHandle
{
  private readonly m_session: AgentSession;
  private readonly m_modelRegistry: SheafModelRegistryBundle["modelRegistry"];

  constructor(session: AgentSession, modelRegistry: SheafModelRegistryBundle["modelRegistry"])
  {
    this.m_session = session;
    this.m_modelRegistry = modelRegistry;
  }

  get isStreaming(): boolean
  {
    return this.m_session.isStreaming;
  }

  get sessionFile(): string | undefined
  {
    return this.m_session.sessionFile;
  }

  get sessionId(): string
  {
    return this.m_session.sessionId;
  }

  get messages(): AgentSession["messages"]
  {
    return this.m_session.messages;
  }

  get model(): ModelReference | undefined
  {
    const current = this.m_session.model;

    if (current === undefined)
    {
      return undefined;
    }

    return {
      provider: current.provider,
      id: current.id,
    };
  }

  async prompt(text: string, options?: PiSessionPromptOptions): Promise<void>
  {
    await this.m_session.prompt(text, options);
  }

  async steer(text: string): Promise<void>
  {
    await this.m_session.steer(text);
  }

  async followUp(text: string): Promise<void>
  {
    await this.m_session.followUp(text);
  }

  async setModel(model: ModelReference): Promise<void>
  {
    const resolved = this.m_modelRegistry.find(model.provider, model.id);

    if (resolved === undefined)
    {
      throw new Error(`model not found: ${model.provider}/${model.id}`);
    }

    await this.m_session.setModel(resolved);
  }

  abort(): Promise<void>
  {
    return this.m_session.abort();
  }

  dispose(): void
  {
    this.m_session.dispose();
  }

  subscribe(listener: (event: AgentSessionEvent) => void): () => void
  {
    return this.m_session.subscribe(listener);
  }
}

function CreateScopedToolsExtension(
  rootDirectory: string,
  notifyFileChanged?: (event: FileChangedNotification) => void | Promise<void>,
)
{
  const bindings = CreateDefaultBindings();

  return async (pi: Parameters<typeof RegisterScopedTools>[0]): Promise<void> =>
  {
    await RegisterScopedTools(pi, {
      rootDirectory,
      audit: bindings.audit,
      emitActivity: bindings.emitActivity,
      notifyFileChanged,
    });
  };
}

export async function CreateSheafPiSession(
  input: CreateSheafPiSessionInput,
  options: CreateSheafPiSessionOptions = {},
): Promise<PiSessionHandle>
{
  const createAgentSessionFn = options.createAgentSessionFn ?? createAgentSession;
  const agentDir = ResolveSheafAgentDir(input.config);
  const settingsManager = SettingsManager.create(input.rootDirectory, agentDir);
  const sessionManager = SessionManager.open(
    input.sessionFilePath,
    input.pileDirectory,
    input.rootDirectory,
  );
  const piModel = input.modelBundle.modelRegistry.find(
    input.model.provider,
    input.model.id,
  );

  if (piModel === undefined)
  {
    throw new Error(`model not found: ${input.model.provider}/${input.model.id}`);
  }

  const resourceLoader = new DefaultResourceLoader({
    cwd: input.rootDirectory,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [
      CreateSheafProviderExtension(input.config, input.modelBundle.localProviderState),
      CreateScopedToolsExtension(input.rootDirectory, input.notifyFileChanged),
    ],
  });

  await resourceLoader.reload();

  const { session } = await createAgentSessionFn({
    cwd: input.rootDirectory,
    agentDir,
    authStorage: input.modelBundle.authStorage,
    modelRegistry: input.modelBundle.modelRegistry,
    model: piModel,
    settingsManager,
    sessionManager,
    resourceLoader,
    noTools: "builtin",
    tools: [...x_scopedToolNames],
  });

  return new AgentSessionHandle(session, input.modelBundle.modelRegistry);
}
