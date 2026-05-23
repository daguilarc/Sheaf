import * as path from "node:path";

import {
  CreateMicrophoneCapture,
  RealtimeAgentDb,
  RealtimeTransportError,
  startAgentSession,
  type AgentStartConfig,
  type AgentSessionDeps,
  type MicrophoneCapture,
  type RealtimeAgentSession,
  type ToolCallSet,
} from "realtime-agent-lib";

import type { LogSink } from "./log.js";
import type {
  SessionControllerHost,
  SessionPreferences,
  SessionSecrets,
  SessionUi,
} from "./sessionTypes.js";
import { BuildVscodeToolCallSet } from "./tools/callSetBuilder.js";

export type SessionControllerState = "idle" | "starting" | "active" | "stopping";

const x_connectionLostReason = "connection_lost";

export interface SessionControllerDeps
{
  startSession?: typeof startAgentSession;
  createMicrophoneCapture?: typeof CreateMicrophoneCapture;
  buildVscodeToolCallSet?: () => ToolCallSet | Promise<ToolCallSet>;
}

export class SessionController
{
  private m_state: SessionControllerState = "idle";
  private m_session: RealtimeAgentSession | undefined;
  private m_audioCapture: MicrophoneCapture | undefined;
  private m_database: RealtimeAgentDb | undefined;
  private m_onStateChange: (state: SessionControllerState) => void;

  constructor(
    private readonly m_host: SessionControllerHost,
    private readonly m_log: LogSink,
    private readonly m_secrets: SessionSecrets,
    private readonly m_prefs: SessionPreferences,
    private readonly m_ui: SessionUi,
    private readonly m_deps: SessionControllerDeps = {},
    onStateChange: (state: SessionControllerState) => void = () => {},
  )
  {
    this.m_onStateChange = onStateChange;
  }

  GetState(): SessionControllerState
  {
    return this.m_state;
  }

  private SetState(next: SessionControllerState): void
  {
    this.m_state = next;
    this.m_onStateChange(next);
  }

  async ToggleSession(): Promise<void>
  {
    if (this.m_state === "idle")
    {
      await this.StartSession();
      return;
    }

    if (this.m_state === "active")
    {
      await this.StopSession("user_stopped");
      return;
    }

    if (this.m_state === "starting" || this.m_state === "stopping")
    {
      this.m_log.Line(`Toggle ignored while session is ${this.m_state}.`);
      return;
    }
  }

  async CommitAndRespond(): Promise<void>
  {
    if (this.m_state !== "active" || this.m_session === undefined)
    {
      void this.m_ui.setStatusBarMessage("Sheaf: start a realtime session first (F15).", 3000);
      return;
    }

    try
    {
      await this.m_session.commitAudioAndCreateResponse();
    }
    catch (error)
    {
      this.m_log.Error("commitAudioAndCreateResponse failed", error);
    }
  }

  async Dispose(): Promise<void>
  {
    const deadline = Date.now() + 30_000;
    while (this.m_state === "starting" && Date.now() < deadline)
    {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    if (this.m_state === "active")
    {
      await this.StopSession("extension_deactivated");
    }

    if (this.m_state === "stopping")
    {
      await this.WaitForStoppingToFinish();
    }
  }

  private async WaitForStoppingToFinish(): Promise<void>
  {
    const deadline = Date.now() + 10_000;
    while (this.m_state === "stopping" && Date.now() < deadline)
    {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  private async StartSession(): Promise<void>
  {
    this.SetState("starting");

    const apiKey = await this.m_secrets.getOpenAiApiKey();
    if (apiKey === undefined || apiKey.length === 0)
    {
      this.SetState("idle");
      void this.m_ui.showErrorMessage(
        "Sheaf realtime: set an OpenAI API key (Secret Storage, sheaf.realtime.openAiApiKey setting, or OPENAI_API_KEY).",
      );
      return;
    }

    const dbPath = path.join(this.m_host.globalStoragePath, "realtime-agent.sqlite3");
    const startSession = this.m_deps.startSession ?? startAgentSession;
    const createCapture = this.m_deps.createMicrophoneCapture ?? CreateMicrophoneCapture;

    let database: RealtimeAgentDb | undefined;
    let session: RealtimeAgentSession | undefined;
    let audioCapture: MicrophoneCapture | undefined;

    const toolCallSet =
      this.m_deps.buildVscodeToolCallSet !== undefined
        ? await Promise.resolve(this.m_deps.buildVscodeToolCallSet())
        : await (async () =>
          {
            const { CreateVscodeEditorAccess } = await import("./tools/editorAccess.js");
            return BuildVscodeToolCallSet({ editorAccess: CreateVscodeEditorAccess() });
          })();

    const agentConfig: AgentStartConfig = {
      systemPrompt: this.m_prefs.getSystemPrompt(),
      initialContext: "",
      toolCallSet,
      model: this.m_prefs.getModel(),
      turnMode: { type: "manual" },
      responseAfterToolOutput: true,
      onSessionEnded: (info) =>
      {
        void this.HandleSessionEndedUnexpectedly(info.reason);
      },
      onEvent: (event, info) =>
      {
        this.m_log.Line(`[${info.sessionId}] ${info.direction} ${event.type}`);
      },
    };

    try
    {
      database = RealtimeAgentDb.open({
        path: dbPath,
        ensureDirectory: true,
      });

      const sessionDeps: AgentSessionDeps = {
        apiKey,
        safetyIdentifier: this.m_prefs.getSafetyIdentifier(),
        database,
      };

      session = await startSession(agentConfig, sessionDeps);

      audioCapture = createCapture({
        inputDevice: this.m_prefs.getInputDevice(),
        onFrame: (pcmBase64) =>
        {
          session?.sendAudioFrame(pcmBase64);
        },
        onError: (captureError) =>
        {
          this.m_log.Error("Microphone capture failed", captureError);
          void this.m_ui.showErrorMessage(`Sheaf realtime: microphone error — ${captureError.message}`);
          void this.StopSession("audio_error");
        },
      });

      audioCapture.start();

      this.m_database = database;
      this.m_session = session;
      this.m_audioCapture = audioCapture;
      this.SetState("active");
    }
    catch (error)
    {
      this.m_log.Error("Failed to start realtime session", error);

      audioCapture?.stop();

      if (session !== undefined)
      {
        try
        {
          await session.stop("start_failed");
        }
        catch (stopError)
        {
          this.m_log.Error("Session stop after start failure", stopError);
        }
      }

      database?.close();

      this.m_database = undefined;
      this.m_session = undefined;
      this.m_audioCapture = undefined;
      this.SetState("idle");

      const message =
        error instanceof RealtimeTransportError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      void this.m_ui.showErrorMessage(`Sheaf realtime: ${message}`);
    }
  }

  private async HandleSessionEndedUnexpectedly(reason: string): Promise<void>
  {
    if (reason !== x_connectionLostReason)
    {
      return;
    }

    this.m_log.Line(`Session ended unexpectedly: ${reason}`);
    void this.m_ui.showErrorMessage("Sheaf realtime: connection to OpenAI was lost.");

    this.m_audioCapture?.stop();
    this.m_audioCapture = undefined;
    this.m_session = undefined;

    this.CloseDatabaseIfOpen();

    if (this.m_state !== "idle")
    {
      this.SetState("idle");
    }
  }

  private async StopSession(reason: string): Promise<void>
  {
    if (this.m_state !== "active")
    {
      return;
    }

    this.SetState("stopping");

    this.m_audioCapture?.stop();
    this.m_audioCapture = undefined;

    const session = this.m_session;
    this.m_session = undefined;

    if (session !== undefined)
    {
      try
      {
        await session.stop(reason);
      }
      catch (error)
      {
        this.m_log.Error("Session stop failed", error);
      }
    }

    this.CloseDatabaseIfOpen();
    this.SetState("idle");
  }

  private CloseDatabaseIfOpen(): void
  {
    if (this.m_database === undefined)
    {
      return;
    }

    try
    {
      this.m_database.close();
    }
    catch (error)
    {
      this.m_log.Error("Database close failed", error);
    }

    this.m_database = undefined;
  }
}
