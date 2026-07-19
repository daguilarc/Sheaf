import { AudioBridge, AudioBridgeOptions, BrowserAudioWorker } from "./audio.js";
import { CatalogClient } from "./catalog-client.js";
import type { CatalogApp } from "./catalog.js";
import { SheafPatchLauncher } from "./launcher.js";
import { BrowserMidiManager, BrowserMidiWorkerRuntime } from "./midi.js";
import { BrowserUiBackend } from "./ui.js";
import type { RuntimeCommand, RuntimeModuleLoader, RuntimeResponse } from "./worker.js";
import { BrowserRuntimeWorker, loadEmscriptenRuntime } from "./worker.js";

export type RuntimeClient = {
  request(command: RuntimeCommand): Promise<RuntimeResponse>;
  startAudioWorklet?(): Promise<{ started: true } | { started: false; diagnostic: string }>;
  onStatus?(handler: (response: RuntimeResponse) => void): void;
  terminate?(): void;
};

export type SynthBrowserAppOptions = {
  moduleUrl?: string;
  dataRoot?: string;
  frameIntervalMs?: number;
  runtimeClient?: RuntimeClient;
  runtimeModuleLoader?: RuntimeModuleLoader;
  audioOptions?: AudioBridgeOptions;
};

export type SynthBrowserLauncherOptions = {
  sourcesUrl?: string;
  client?: CatalogClient;
  select?: (app: CatalogApp) => Promise<void>;
  navigateToLauncher?: () => void;
};

const DEFAULT_MODULE_URL = "/dist/wasm/app.js";
const DEFAULT_DATA_ROOT = "/data";
const ROOT_OWNER = Symbol.for("sheaf.synth-browser.root-owner");

function claimRoot(root: HTMLElement): () => boolean {
  const ownedRoot = root as HTMLElement & { [key: symbol]: unknown };
  const owner = Object.freeze({});
  ownedRoot[ROOT_OWNER] = owner;
  // Symbol.for makes this supersession guard stable across fresh main.js evaluations.
  return () => ownedRoot[ROOT_OWNER] === owner;
}

export function createDirectRuntimeClient(loadModule: RuntimeModuleLoader = loadEmscriptenRuntime): RuntimeClient {
  const statusHandlers = new Set<(response: RuntimeResponse) => void>();
  const runtime = new BrowserRuntimeWorker(
    loadModule,
    undefined,
    (response) => statusHandlers.forEach((handler) => handler(response)),
  );
  let queue: Promise<void> = Promise.resolve();

  const request = (command: RuntimeCommand): Promise<RuntimeResponse> => {
    const run = () => runtime.handle(command);
    const response = queue.then(run, run);
    queue = response.then(() => {}, () => {});
    return response;
  };

  return {
    request,
    startAudioWorklet: async () => {
      const response = await request({ type: "start-audio-worklet" });
      if (response.type === "ok") return { started: true };
      return { started: false, diagnostic: response.type === "error" ? response.error : "audio-worklet-start-failed" };
    },
    onStatus: (handler) => { statusHandlers.add(handler); },
    terminate: () => { void request({ type: "destroy" }); },
  };
}

export function createWorkerRuntimeClient(workerUrl = new URL("./worker.js", import.meta.url)): RuntimeClient {
  const worker = new Worker(workerUrl, { type: "module" });
  const statusHandlers = new Set<(response: RuntimeResponse) => void>();
  let queue: Promise<void> = Promise.resolve();

  worker.addEventListener("message", (event: MessageEvent<RuntimeResponse>) => {
    if (event.data.type === "page-status") statusHandlers.forEach((handler) => handler(event.data));
  });

  const request = (command: RuntimeCommand): Promise<RuntimeResponse> => {
    const run = () => new Promise<RuntimeResponse>((resolve) => {
      const receive = (event: MessageEvent<RuntimeResponse>) => {
        if (event.data.type === "page-status") return;
        worker.removeEventListener("message", receive);
        resolve(event.data);
      };
      worker.addEventListener("message", receive);
      worker.postMessage(command);
    });
    const response = queue.then(run, run);
    queue = response.then(() => {}, () => {});
    return response;
  };

  return {
    request,
    onStatus: (handler) => { statusHandlers.add(handler); },
    terminate: () => worker.terminate(),
  };
}

export class SynthBrowserApp {
  private readonly ui: BrowserUiBackend;
  private audio: AudioBridge | undefined;
  private readonly midi: BrowserMidiManager;
  private frameTimer: ReturnType<typeof setInterval> | undefined;
  private activationStarted = false;
  private frameInFlight = false;
  private frameRequested = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly runtime: RuntimeClient,
    private readonly options: Required<Pick<SynthBrowserAppOptions, "moduleUrl" | "dataRoot" | "frameIntervalMs">> &
      Pick<SynthBrowserAppOptions, "audioOptions">,
  ) {
    this.ui = new BrowserUiBackend(root, (action) => {
      void this.dispatchAction(action);
      void this.startUserActivation();
    });
    this.midi = new BrowserMidiManager(new BrowserMidiWorkerRuntime((command) => this.runtime.request(command)));
    this.runtime.onStatus?.((status) => this.renderStatus(status));
  }

  async start(): Promise<void> {
    this.renderStatus({ type: "status", status: "starting" });
    await this.expectOk(await this.runtime.request({ type: "load", moduleUrl: this.options.moduleUrl }));
    await this.runtime.request({ type: "create" });
    await this.expectOk(await this.runtime.request({ type: "initialize", dataRoot: this.options.dataRoot }));
    const audioConfig = await this.runtime.request({ type: "audio-config" });
    if (audioConfig.type !== "audio-config") throw new Error("runtime did not return audio configuration");
    const channels = audioConfig.channels;
    const audioWorker: BrowserAudioWorker = {
      postMessage: (message) => { void this.runtime.request(message); },
    };
    if (this.runtime.startAudioWorklet) audioWorker.startAudioWorklet = () => this.runtime.startAudioWorklet!();
    this.audio = new AudioBridge(audioWorker, { ...this.options.audioOptions, channels });
    await this.renderFrame();
    this.frameTimer = setInterval(() => { this.requestFrame(); }, this.options.frameIntervalMs);
    this.renderStatus({ type: "status", status: "running" });
  }

  stop(): void {
    if (this.frameTimer !== undefined) clearInterval(this.frameTimer);
    this.frameTimer = undefined;
    this.audio?.shutdown();
    this.midi.stop();
    this.runtime.terminate?.();
  }

  private async startUserActivation(): Promise<void> {
    if (this.activationStarted) return;
    this.activationStarted = true;
    if (!this.audio) return;
    const [audio, midi] = await Promise.all([
      this.audio.startFromUserActivation(),
      this.midi.startFromUserActivation(),
    ]);
    this.renderStatus({ type: "status", status: `audio:${audio.started ? "online" : audio.diagnostic}; midi:${midi.status}` });
  }

  private async dispatchAction(action: { name: string; value: string }): Promise<void> {
    const response = await this.runtime.request({ type: "dispatch-action", ...action });
    if (response.type === "ui-frame") this.ui.renderFrame(Uint8Array.from(response.frame).buffer);
    else if (response.type === "error") this.renderStatus({ type: "status", status: response.error });
  }

  private requestFrame(): void {
    if (this.frameInFlight) {
      this.frameRequested = true;
      return;
    }
    this.frameInFlight = true;
    void this.renderFrame()
      .catch((error) => this.renderStatus({ type: "status", status: error instanceof Error ? error.message : "browser render failed" }))
      .finally(() => {
        this.frameInFlight = false;
        if (!this.frameRequested) return;
        this.frameRequested = false;
        this.requestFrame();
      });
  }

  private async renderFrame(): Promise<void> {
    await this.expectOk(await this.runtime.request({ type: "message-tick", timestampMicros: Math.round(performance.now() * 1000) }));
    const response = await this.runtime.request({ type: "build-ui-frame" });
    if (response.type === "ui-frame") this.ui.renderFrame(Uint8Array.from(response.frame).buffer);
    else if (response.type === "error") this.renderStatus({ type: "status", status: response.error });
  }

  private async expectOk(response: RuntimeResponse): Promise<void> {
    if (response.type === "error") throw new Error(response.error);
  }

  private renderStatus(response: RuntimeResponse): void {
    const text = response.type === "page-status" ? response.status : response.type === "status" ? response.status : undefined;
    if (!text) return;
    this.root.dataset.synthStatus = text;
  }
}

export async function installSynthBrowserApp(root: HTMLElement, options: SynthBrowserAppOptions = {}): Promise<SynthBrowserApp> {
  claimRoot(root);
  const moduleUrl = options.moduleUrl ?? root.dataset.synthModule ?? DEFAULT_MODULE_URL;
  const dataRoot = options.dataRoot ?? DEFAULT_DATA_ROOT;
  const runtime = options.runtimeClient ?? createDirectRuntimeClient(options.runtimeModuleLoader ?? loadEmscriptenRuntime);
  const app = new SynthBrowserApp(root, runtime, {
    moduleUrl,
    dataRoot,
    frameIntervalMs: options.frameIntervalMs ?? 1000 / 30,
    audioOptions: options.audioOptions,
  });
  await app.start();
  return app;
}

export function installBrowserAudioActivation(
  target: EventTarget,
  worker: BrowserAudioWorker,
  options: AudioBridgeOptions = {},
): AudioBridge {
  const bridge = new AudioBridge(worker, options);
  target.addEventListener("pointerdown", () => { void bridge.startFromUserActivation(); }, { once: true });
  return bridge;
}

export async function installSheafPatchLauncher(
  root: HTMLElement,
  options: SynthBrowserLauncherOptions = {},
): Promise<SheafPatchLauncher> {
  const ownsRoot = claimRoot(root);
  const sourcesUrl = options.sourcesUrl ?? root.dataset.synthCatalogSources ?? "/catalog-sources.json";
  const launcher = new SheafPatchLauncher(root, {
    client: options.client ?? new CatalogClient({ sourcesUrl }),
    select: options.select ?? (async () => { throw new Error("Application launch is not available in this build"); }),
    navigateToLauncher: options.navigateToLauncher,
    ownsRoot,
  });
  await launcher.start();
  return launcher;
}

const root = document.querySelector<HTMLElement>("#synth-root");
if (root?.dataset.synthLauncher === "true") {
  void installSheafPatchLauncher(root).catch((error) => {
    root.dataset.synthStatus = error instanceof Error ? error.message : "catalog launcher startup failed";
  });
} else if (root?.dataset.synthAuto === "true") {
  void installSynthBrowserApp(root).catch((error) => {
    root.dataset.synthStatus = error instanceof Error ? error.message : "browser runtime startup failed";
  });
}
