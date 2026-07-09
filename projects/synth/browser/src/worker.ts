export type RuntimeCommand =
  | { type: "load"; moduleUrl?: string }
  | { type: "create" }
  | { type: "initialize"; dataRoot: string }
  | { type: "prepare"; sampleRate: number; blockSize: number }
  | { type: "process"; frames: number; timestampMicros: number }
  | { type: "message-tick"; timestampMicros: number }
  | { type: "build-ui-frame" }
  | { type: "dispatch-action"; name: string; value: string }
  | { type: "destroy" }
  | { type: "midi"; bytes: number[] }
  | { type: "persistence"; state: string }
  | { type: "status" };

export type RuntimeResponse =
  | { type: "ok" }
  | { type: "created"; handle: number }
  | { type: "ui-frame"; frame: number[] }
  | { type: "destroyed" }
  | { type: "status"; status: string }
  | { type: "error"; error: string };

export interface RuntimeModuleFacade {
  create(): number;
  initialize(handle: number, dataRoot: string): number;
  prepare(handle: number, sampleRate: number, blockSize: number): number;
  process(handle: number, frames: number, timestampMicros: number): number;
  messageTick(handle: number, timestampMicros: number): number;
  buildUiFrame(handle: number): ArrayBuffer;
  dispatchAction(handle: number, name: string, value: string): number;
  destroy(handle: number): void;
}

export type RuntimeModuleLoader = (moduleUrl?: string) => Promise<RuntimeModuleFacade>;

type EmscriptenModule = {
  HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  lengthBytesUTF8(value: string): number;
  stringToUTF8(value: string, pointer: number, maxBytesToWrite: number): void;
  _synth_browser_create(): number;
  _synth_browser_initialize(handle: number, dataRoot: number): number;
  _synth_browser_prepare(handle: number, sampleRate: number, blockSize: number): number;
  _synth_browser_process(handle: number, outputs: number, frames: number, timestampMicros: bigint): number;
  _synth_browser_message_tick(handle: number, timestampMicros: bigint): number;
  _synth_browser_build_ui_frame(handle: number, size: number): number;
  _synth_browser_dispatch_action(handle: number, name: number, value: number): number;
  _synth_browser_destroy(handle: number): void;
};

function withUtf8<T>(module: EmscriptenModule, value: string, operation: (pointer: number) => T): T {
  const pointer = module._malloc(module.lengthBytesUTF8(value) + 1);
  try {
    module.stringToUTF8(value, pointer, module.lengthBytesUTF8(value) + 1);
    return operation(pointer);
  } finally {
    module._free(pointer);
  }
}

export function emscriptenRuntimeFacade(module: EmscriptenModule): RuntimeModuleFacade {
  return {
    create: () => module._synth_browser_create(),
    initialize: (handle, dataRoot) => withUtf8(module, dataRoot, (root) => module._synth_browser_initialize(handle, root)),
    prepare: (handle, sampleRate, blockSize) => module._synth_browser_prepare(handle, sampleRate, blockSize),
    process: (handle, frames, timestampMicros) => module._synth_browser_process(handle, 0, frames, BigInt(timestampMicros)),
    messageTick: (handle, timestampMicros) => module._synth_browser_message_tick(handle, BigInt(timestampMicros)),
    buildUiFrame: (handle) => {
      const sizePointer = module._malloc(4);
      try {
        const framePointer = module._synth_browser_build_ui_frame(handle, sizePointer);
        const size = new DataView(module.HEAPU8.buffer).getUint32(sizePointer, true);
        return module.HEAPU8.slice(framePointer, framePointer + size).buffer;
      } finally {
        module._free(sizePointer);
      }
    },
    dispatchAction: (handle, name, value) => withUtf8(module, name, (namePointer) =>
      withUtf8(module, value, (valuePointer) => module._synth_browser_dispatch_action(handle, namePointer, valuePointer))),
    destroy: (handle) => module._synth_browser_destroy(handle),
  };
}

export const loadEmscriptenRuntime: RuntimeModuleLoader = async (moduleUrl) => {
  if (!moduleUrl) throw new Error("runtime module URL is required");
  const imported = await import(moduleUrl) as { default?: () => Promise<EmscriptenModule>; createSynthBrowserModule?: () => Promise<EmscriptenModule> };
  const factory = imported.default ?? imported.createSynthBrowserModule;
  if (!factory) throw new Error("runtime module does not export an Emscripten factory");
  return emscriptenRuntimeFacade(await factory());
};

export class BrowserRuntimeWorker {
  private module: RuntimeModuleFacade | undefined;
  private handleValue: number | undefined;
  private destroyed = false;

  constructor(private readonly loadModule: RuntimeModuleLoader = loadEmscriptenRuntime) {}

  async handle(command: RuntimeCommand): Promise<RuntimeResponse> {
    try {
      if (this.destroyed) throw new Error("runtime is destroyed");
      switch (command.type) {
        case "load":
          this.module = await this.loadModule(command.moduleUrl);
          return { type: "ok" };
        case "create": {
          if (!this.module) throw new Error("runtime module is not loaded");
          if (this.handleValue !== undefined) throw new Error("runtime is already created");
          this.handleValue = this.module.create();
          if (!this.handleValue) throw new Error("runtime creation failed");
          return { type: "created", handle: this.handleValue };
        }
        case "initialize":
          return this.call((module, handle) => module.initialize(handle, command.dataRoot));
        case "prepare":
          return this.call((module, handle) => module.prepare(handle, command.sampleRate, command.blockSize));
        case "process":
          return this.call((module, handle) => module.process(handle, command.frames, command.timestampMicros));
        case "message-tick":
          return this.call((module, handle) => module.messageTick(handle, command.timestampMicros));
        case "build-ui-frame": {
          const frame = await this.callValue((module, handle) => module.buildUiFrame(handle));
          return { type: "ui-frame", frame: Array.from(new Uint8Array(frame)) };
        }
        case "dispatch-action":
          return this.call((module, handle) => module.dispatchAction(handle, command.name, command.value));
        case "destroy": {
          const module = this.requireModule();
          const handle = this.requireHandle();
          module.destroy(handle);
          this.handleValue = undefined;
          this.destroyed = true;
          return { type: "destroyed" };
        }
        case "midi":
        case "persistence":
          return { type: "status", status: `${command.type} forwarding is not available` };
        case "status":
          return { type: "status", status: this.handleValue === undefined ? "not created" : "running" };
      }
    } catch (error) {
      return { type: "error", error: error instanceof Error ? error.message : "runtime operation failed" };
    }
  }

  private async call(operation: (module: RuntimeModuleFacade, handle: number) => number): Promise<RuntimeResponse> {
    if (operation(this.requireModule(), this.requireHandle()) !== 0) throw new Error("runtime operation failed");
    return { type: "ok" };
  }

  private async callValue<T>(operation: (module: RuntimeModuleFacade, handle: number) => T): Promise<T> {
    return operation(this.requireModule(), this.requireHandle());
  }

  private requireModule(): RuntimeModuleFacade {
    if (!this.module) throw new Error("runtime module is not loaded");
    return this.module;
  }

  private requireHandle(): number {
    if (this.destroyed) throw new Error("runtime is destroyed");
    if (this.handleValue === undefined) throw new Error("runtime is not created");
    return this.handleValue;
  }
}

type WorkerScope = {
  addEventListener(type: "message", listener: (event: MessageEvent<RuntimeCommand>) => void): void;
  postMessage(response: RuntimeResponse): void;
  importScripts?: (...urls: string[]) => void;
};

export function installBrowserRuntimeWorker(scope: WorkerScope, loadModule: RuntimeModuleLoader = loadEmscriptenRuntime) {
  const runtime = new BrowserRuntimeWorker(loadModule);
  scope.addEventListener("message", (event: MessageEvent<RuntimeCommand>) => {
    void runtime.handle(event.data).then((response) => scope.postMessage(response));
  });
}

const globalWorkerScope = globalThis as unknown as WorkerScope;
if (typeof globalWorkerScope.importScripts === "function") {
  installBrowserRuntimeWorker(globalWorkerScope);
}
