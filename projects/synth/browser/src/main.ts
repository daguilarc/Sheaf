import { AudioBridge, AudioBridgeOptions, BrowserAudioWorker } from "./audio.js";
import { ActivationLease } from "./activation.js";
import { CatalogClient } from "./catalog-client.js";
import { runtimeIdentityForCatalogApp, validateBrowserRuntimeIdentity } from "./catalog.js";
import type { BrowserRuntimeIdentity, CatalogApp } from "./catalog.js";
import { SheafPatchLauncher } from "./launcher.js";
import { BrowserMidiManager, BrowserMidiWorkerRuntime } from "./midi.js";
import { materializePackage as materializeCatalogPackage } from "./package-loader.js";
import type { MaterializedPackage, MaterializedRuntimeModule } from "./package-loader.js";
import { BrowserUiBackend } from "./ui.js";
import type { RuntimeCommand, RuntimeModuleLoader, RuntimeResponse, RuntimeVersions } from "./worker.js";
import { BrowserRuntimeWorker, loadEmscriptenRuntime } from "./worker.js";

export type RuntimeClient = {
  request(command: RuntimeCommand): Promise<RuntimeResponse>;
  startAudioWorklet?(context?: AudioContext): Promise<{ started: true } | { started: false; diagnostic: string }>;
  onStatus?(handler: (response: RuntimeResponse) => void): void;
  terminate?(): void | Promise<void>;
};

export type SynthBrowserAppOptions = {
  module?: MaterializedRuntimeModule;
  moduleUrl?: string;
  runtimeIdentity?: BrowserRuntimeIdentity;
  frameIntervalMs?: number;
  runtimeClient?: RuntimeClient;
  runtimeClientFactory?: () => RuntimeClient;
  runtimeModuleLoader?: RuntimeModuleLoader;
  runtimeVersions?: RuntimeVersions;
  activationLease?: ActivationLease;
  disposeModule?: () => void;
  audioOptions?: AudioBridgeOptions;
};

export type SynthBrowserLauncherOptions = {
  sourcesUrl?: string;
  client?: CatalogClient;
  select?: (app: CatalogApp) => Promise<void>;
  activationLeaseFactory?: () => ActivationLease;
  materializePackage?: (app: CatalogApp) => Promise<MaterializedPackage>;
  installApp?: typeof installSynthBrowserApp;
  runtimeClientFactory?: () => RuntimeClient;
  audioOptions?: AudioBridgeOptions;
  frameIntervalMs?: number;
};

const DEFAULT_RUNTIME_IDENTITY: BrowserRuntimeIdentity = Object.freeze({
  publisherId: "sheaf",
  appId: "direct-runtime",
  runtimeConfigVersion: 1,
});
const ROOT_OWNER = Symbol.for("sheaf.synth-browser.root-owner");

function directModuleMapping(moduleUrl: string): MaterializedRuntimeModule {
  const parsed = new URL(moduleUrl, location.href);
  const filename = parsed.pathname.slice(parsed.pathname.lastIndexOf("/") + 1);
  const stem = filename.endsWith(".js") ? filename.slice(0, -3) : filename;
  const wasmFilename = `${stem}.wasm`;
  return Object.freeze({
    entryUrl: parsed.href,
    locateFile: Object.freeze({
      [filename]: parsed.href,
      [wasmFilename]: new URL(wasmFilename, parsed).href,
    }),
    mainScriptUrlOrBlob: parsed.href,
  });
}

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
    startAudioWorklet: async (context) => {
      const response = await runtime.startAudioWorklet(context);
      if (response.type === "ok") return { started: true };
      return { started: false, diagnostic: response.type === "error" ? response.error : "audio-worklet-start-failed" };
    },
    onStatus: (handler) => { statusHandlers.add(handler); },
    terminate: async () => { await request({ type: "destroy" }); },
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
    terminate: async () => {
      await request({ type: "destroy" });
      worker.terminate();
    },
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
  private stopped = false;
  private stopPromise: Promise<void> | undefined;
  private unloadInstalled = false;
  private readonly unload = () => { void this.stop(); };

  constructor(
    private readonly root: HTMLElement,
    private readonly runtime: RuntimeClient,
    private readonly options: Required<Pick<SynthBrowserAppOptions, "module" | "runtimeIdentity" | "frameIntervalMs">> &
      Pick<SynthBrowserAppOptions, "audioOptions" | "runtimeVersions" | "activationLease" | "disposeModule"> &
      Readonly<{ claimRuntimeRoot: () => void; midiAccess?: Awaited<ReturnType<ActivationLease["consume"]>>["midiAccess"] }>,
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
    const module: MaterializedRuntimeModule = {
      entryUrl: this.options.module.entryUrl,
      locateFile: this.options.module.locateFile,
      mainScriptUrlOrBlob: this.options.module.mainScriptUrlOrBlob,
    };
    await this.expectOk(await this.runtime.request({ type: "load", module, versions: this.options.runtimeVersions }));
    await this.expectOk(await this.runtime.request({
      type: "create",
      documentTimeOriginMillis: performance.timeOrigin,
    }));
    await this.expectOk(await this.runtime.request({ type: "initialize", identity: this.options.runtimeIdentity }));
    const audioConfig = await this.runtime.request({ type: "audio-config" });
    if (audioConfig.type !== "audio-config") throw new Error("runtime did not return audio configuration");
    const audioWorker: BrowserAudioWorker = {};
    if (this.runtime.startAudioWorklet)
      audioWorker.startAudioWorklet = (context) => this.runtime.startAudioWorklet!(context);
    this.audio = new AudioBridge(audioWorker, this.options.audioOptions);
    if (this.options.midiAccess) {
      this.activationStarted = true;
      const [audio, midi] = await Promise.all([
        this.audio.startFromUserActivation(),
        this.midi.startWithAccess(this.options.midiAccess),
      ]);
      if (!audio.started) throw new Error(`audio activation failed: ${audio.diagnostic}`);
      if (midi.status !== "online") throw new Error(`MIDI activation failed: ${midi.reason ?? "unavailable"}`);
      this.renderStatus({ type: "status", status: "audio:online; midi:online" });
    }
    this.options.claimRuntimeRoot();
    await this.renderFrame();
    this.frameTimer = setInterval(() => { this.requestFrame(); }, this.options.frameIntervalMs);
    addEventListener("pagehide", this.unload);
    addEventListener("beforeunload", this.unload);
    this.unloadInstalled = true;
    this.renderStatus({ type: "status", status: "running" });
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopped = true;
    if (this.unloadInstalled) {
      removeEventListener("pagehide", this.unload);
      removeEventListener("beforeunload", this.unload);
      this.unloadInstalled = false;
    }
    if (this.frameTimer !== undefined) clearInterval(this.frameTimer);
    this.frameTimer = undefined;
    this.ui.dispose();
    this.audio?.shutdown();
    this.midi.stop();
    this.stopPromise = this.finishStop();
    return this.stopPromise;
  }

  private async finishStop(): Promise<void> {
    try {
      await this.runtime.terminate?.();
    } finally {
      this.options.activationLease?.dispose();
      this.options.disposeModule?.();
    }
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
  const moduleUrl = options.moduleUrl ?? root.dataset.synthModule;
  if (!options.module && !moduleUrl) throw new Error("a materialized runtime module or explicit moduleUrl is required");
  const module = options.module ?? directModuleMapping(moduleUrl!);
  const runtimeIdentity = validateBrowserRuntimeIdentity(options.runtimeIdentity ?? DEFAULT_RUNTIME_IDENTITY);
  let app: SynthBrowserApp | undefined;
  try {
    const resources = options.activationLease ? await options.activationLease.consume() : undefined;
    const runtime = options.runtimeClient ?? options.runtimeClientFactory?.() ??
      createDirectRuntimeClient(options.runtimeModuleLoader ?? loadEmscriptenRuntime);
    app = new SynthBrowserApp(root, runtime, {
      module,
      runtimeIdentity,
      frameIntervalMs: options.frameIntervalMs ?? 1000 / 30,
      audioOptions: resources ? { ...options.audioOptions, audioContext: resources.audioContext } : options.audioOptions,
      runtimeVersions: options.runtimeVersions,
      activationLease: options.activationLease,
      disposeModule: options.disposeModule,
      midiAccess: resources?.midiAccess,
      claimRuntimeRoot: () => { claimRoot(root); },
    });
    await app.start();
    return app;
  } catch (error) {
    if (app) await app.stop();
    else {
      options.activationLease?.dispose();
      options.disposeModule?.();
    }
    throw error;
  }
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
  const select = options.select ?? ((app: CatalogApp) => {
    // This callback is invoked synchronously by SheafPatchLauncher's DOM event
    // handler. Acquire both gesture-bound resources before entering async work.
    const activationLease = options.activationLeaseFactory?.() ?? ActivationLease.acquire();
    return launchCatalogApplication(root, app, activationLease, options);
  });
  const launcher = new SheafPatchLauncher(root, {
    client: options.client ?? new CatalogClient({ sourcesUrl }),
    select,
    ownsRoot,
  });
  await launcher.start();
  return launcher;
}

async function launchCatalogApplication(
  root: HTMLElement,
  app: CatalogApp,
  activationLease: ActivationLease,
  options: SynthBrowserLauncherOptions,
): Promise<void> {
  let materialized: MaterializedPackage | undefined;
  try {
    materialized = await (options.materializePackage ?? materializeCatalogPackage)(app);
    await (options.installApp ?? installSynthBrowserApp)(root, {
      module: materialized,
      runtimeVersions: {
        abiVersion: app.browser.abiVersion,
        uiProtocolVersion: app.browser.uiProtocolVersion,
        runtimeConfigVersion: app.browser.runtimeConfigVersion,
      },
      runtimeIdentity: runtimeIdentityForCatalogApp(app),
      activationLease,
      disposeModule: () => materialized!.dispose(),
      runtimeClientFactory: options.runtimeClientFactory,
      audioOptions: options.audioOptions,
      frameIntervalMs: options.frameIntervalMs,
    });
  } catch (error) {
    materialized?.dispose();
    activationLease.dispose();
    throw error;
  }
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
