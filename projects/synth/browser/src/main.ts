import { AudioBridge, AudioBridgeOptions, BrowserAudioWorker } from "./audio.js";
import { BrowserMidiManager, BrowserMidiWorkerRuntime } from "./midi.js";
import { BrowserUiBackend } from "./ui.js";
import type { RuntimeCommand, RuntimeModuleLoader, RuntimeResponse } from "./worker.js";
import { BrowserRuntimeWorker, loadEmscriptenRuntime } from "./worker.js";

export type RuntimeClient = {
  request(command: RuntimeCommand): Promise<RuntimeResponse>;
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

const DEFAULT_MODULE_URL = "/dist/wasm/app.js";
const DEFAULT_DATA_ROOT = "/data";

export function createDirectRuntimeClient(loadModule: RuntimeModuleLoader = loadEmscriptenRuntime): RuntimeClient {
  const statusHandlers = new Set<(response: RuntimeResponse) => void>();
  const runtime = new BrowserRuntimeWorker(
    loadModule,
    undefined,
    (response) => statusHandlers.forEach((handler) => handler(response)),
  );
  return {
    request: (command) => runtime.handle(command),
    onStatus: (handler) => { statusHandlers.add(handler); },
  };
}

export function createWorkerRuntimeClient(workerUrl = new URL("./worker.js", import.meta.url)): RuntimeClient {
  const worker = new Worker(workerUrl, { type: "module" });
  const statusHandlers = new Set<(response: RuntimeResponse) => void>();
  let queue: Promise<void> = Promise.resolve();

  const request = (command: RuntimeCommand): Promise<RuntimeResponse> => {
    const run = () => new Promise<RuntimeResponse>((resolve) => {
      const receive = (event: MessageEvent<RuntimeResponse>) => {
        if (event.data.type === "page-status") {
          statusHandlers.forEach((handler) => handler(event.data));
          return;
        }
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

  constructor(
    private readonly root: HTMLElement,
    private readonly runtime: RuntimeClient,
    private readonly options: Required<Pick<SynthBrowserAppOptions, "moduleUrl" | "dataRoot" | "frameIntervalMs">> &
      Pick<SynthBrowserAppOptions, "audioOptions">,
  ) {
    this.ui = new BrowserUiBackend(root, (action) => {
      void this.runtime.request({ type: "dispatch-action", ...action });
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
    const channels = audioConfig.type === "audio-config" ? audioConfig.channels : 2;
    this.audio = new AudioBridge({
      postMessage: (message) => { void this.runtime.request(message); },
    } satisfies BrowserAudioWorker, { ...this.options.audioOptions, channels });
    await this.renderFrame();
    this.frameTimer = setInterval(() => { void this.renderFrame(); }, this.options.frameIntervalMs);
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

  private async renderFrame(): Promise<void> {
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
  const moduleUrl = options.moduleUrl ?? root.dataset.synthModule ?? DEFAULT_MODULE_URL;
  const dataRoot = options.dataRoot ?? DEFAULT_DATA_ROOT;
  const runtime = options.runtimeClient ?? (options.runtimeModuleLoader ? createDirectRuntimeClient(options.runtimeModuleLoader) : createWorkerRuntimeClient());
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

const root = document.querySelector<HTMLElement>("#synth-root");
if (root?.dataset.synthAuto === "true") {
  void installSynthBrowserApp(root).catch((error) => {
    root.dataset.synthStatus = error instanceof Error ? error.message : "browser runtime startup failed";
  });
}
