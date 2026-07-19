import {
  SUPPORTED_BROWSER_ABI_VERSION,
  SUPPORTED_RUNTIME_CONFIG_VERSION,
  SUPPORTED_UI_PROTOCOL_VERSION,
  SharedRingBuffer,
} from "./protocol.js";
import type { AudioBridgeDescriptor, MidiAction, MidiEndpoint, MidiOutput } from "./protocol.js";
import { BROWSER_PERSISTENCE_STATUS_PATH, BrowserPersistence } from "./persistence.js";
import type { BrowserFileSystem, BrowserPersistenceFactory } from "./persistence.js";
import type { MaterializedRuntimeModule } from "./package-loader.js";

export type RuntimeCommand =
  | { type: "load"; module: MaterializedRuntimeModule; versions?: RuntimeVersions }
  | { type: "create" }
  | { type: "initialize"; dataRoot: string }
  | { type: "audio-config" }
  | { type: "prepare"; sampleRate: number; blockSize: number }
  | { type: "process"; frames: number; timestampMicros: number }
  | { type: "configure-audio"; sampleRate: number; blockSize: number; bridge: AudioBridgeDescriptor }
  | { type: "render-audio"; timestampMicros: number }
  | { type: "start-audio-worklet" }
  | { type: "audio-worklet-stats" }
  | { type: "message-tick"; timestampMicros: number }
  | { type: "build-ui-frame" }
  | { type: "dispatch-action"; name: string; value: string }
  | { type: "destroy" }
  | { type: "midi-endpoints"; endpoints: MidiEndpoint[] }
  | { type: "midi-input"; controllerIx: number; bytes: number[]; timestampMicros: number }
  | { type: "drain-midi-output" }
  | { type: "persistence"; state: string }
  | { type: "persistence-status" }
  | { type: "status" };

export type RuntimeResponse =
  | { type: "ok" }
  | { type: "created"; handle: number }
  | { type: "audio-config"; channels: number }
  | { type: "audio-worklet-stats"; blocks: number; peakMicrounits: number; deadlineMicrounits: number }
  | { type: "ui-frame"; frame: number[] }
  | { type: "destroyed" }
  | { type: "midi-actions"; actions: MidiAction[] }
  | { type: "midi-output"; output?: MidiOutput }
  | { type: "status"; status: string }
  | { type: "page-status"; path: string; status: string }
  | { type: "error"; error: string };

export interface RuntimeModuleFacade {
  readonly abiVersion: number;
  readonly uiProtocolVersion: number;
  readonly runtimeConfigVersion: number;
  filesystem?: BrowserFileSystem;
  create(): number;
  audioOutputChannels(handle: number): number;
  initialize(handle: number, dataRoot: string): number;
  prepare(handle: number, sampleRate: number, blockSize: number): number;
  process(handle: number, frames: number, timestampMicros: number): number;
  renderAudio?(handle: number, channels: number, frames: number, timestampMicros: number): { status: number; outputs: Float32Array[] };
  startAudioWorklet?(handle: number): number;
  audioWorkletStats?(handle: number): { blocks: number; peakMicrounits: number; deadlineMicrounits: number };
  messageTick(handle: number, timestampMicros: number): number;
  buildUiFrame(handle: number): ArrayBuffer;
  dispatchAction(handle: number, name: string, value: string): number;
  hasPersistenceChanges?(handle: number): boolean;
  submitMidiEndpoints(handle: number, endpoints: MidiEndpoint[]): number;
  dequeueMidiAction(handle: number): MidiAction | undefined;
  deliverMidi(handle: number, controllerIx: number, bytes: number[], timestampMicros: number): number;
  dequeueMidiOutput(handle: number): MidiOutput | undefined;
  destroy(handle: number): void;
}

export type RuntimeModuleLoader = (module: MaterializedRuntimeModule) => Promise<RuntimeModuleFacade>;

export type RuntimeVersions = Readonly<{
  abiVersion: number;
  uiProtocolVersion: number;
  runtimeConfigVersion: number;
}>;

export const SUPPORTED_RUNTIME_VERSIONS: RuntimeVersions = Object.freeze({
  abiVersion: SUPPORTED_BROWSER_ABI_VERSION,
  uiProtocolVersion: SUPPORTED_UI_PROTOCOL_VERSION,
  runtimeConfigVersion: SUPPORTED_RUNTIME_CONFIG_VERSION,
});

export function negotiateRuntimeVersions(
  actual: RuntimeVersions,
  required: RuntimeVersions = actual,
): RuntimeVersions {
  for (const field of ["abiVersion", "uiProtocolVersion", "runtimeConfigVersion"] as const) {
    if (required[field] !== SUPPORTED_RUNTIME_VERSIONS[field]) {
      throw new Error(`${field} incompatible: required ${required[field]}, supported ${SUPPORTED_RUNTIME_VERSIONS[field]}`);
    }
    if (actual[field] !== required[field]) {
      throw new Error(`${field} mismatch: required ${required[field]}, module reports ${actual[field]}`);
    }
  }
  return Object.freeze({
    abiVersion: actual.abiVersion,
    uiProtocolVersion: actual.uiProtocolVersion,
    runtimeConfigVersion: actual.runtimeConfigVersion,
  });
}

type EmscriptenModule = {
  FS: BrowserFileSystem;
  IDBFS?: unknown;
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  lengthBytesUTF8(value: string): number;
  stringToUTF8(value: string, pointer: number, maxBytesToWrite: number): void;
  _synth_browser_abi_version(): number;
  _synth_browser_ui_protocol_version(): number;
  _synth_browser_runtime_config_version(): number;
  _synth_browser_create(): number;
  _synth_browser_audio_output_channels(handle: number): number;
  _synth_browser_initialize(handle: number, dataRoot: number): number;
  _synth_browser_prepare(handle: number, sampleRate: number, blockSize: number): number;
  _synth_browser_process(handle: number, outputs: number, outputChannels: number, frames: number, timestampMicros: bigint): number;
  _synth_browser_start_audio_worklet?(handle: number): number;
  _synth_browser_audio_worklet_block_count?(handle: number): number;
  _synth_browser_audio_worklet_peak_microunits?(handle: number): number;
  _synth_browser_audio_worklet_deadline_microunits?(handle: number): number;
  _synth_browser_message_tick(handle: number, timestampMicros: bigint): number;
  _synth_browser_build_ui_frame(handle: number, size: number): number;
  _synth_browser_dispatch_action(handle: number, name: number, value: number): number;
  _synth_browser_consume_persistence_dirty?(handle: number): number;
  _synth_browser_submit_midi_endpoints(handle: number, endpoints: number, count: number): number;
  _synth_browser_dequeue_midi_action(handle: number, action: number): number;
  _synth_browser_deliver_midi(handle: number, controllerIx: number, bytes: number, size: number, timestampMicros: bigint): number;
  _synth_browser_dequeue_midi_output(handle: number, controllerIx: number, size: number): number;
  _synth_browser_destroy(handle: number): void;
};

type EmscriptenFactoryOptions = Readonly<{
  locateFile(path: string, prefix?: string): string;
  mainScriptUrlOrBlob: string;
}>;

type EmscriptenModuleImport = Readonly<{
  default?: (options: EmscriptenFactoryOptions) => Promise<EmscriptenModule>;
  createSynthBrowserModule?: (options: EmscriptenFactoryOptions) => Promise<EmscriptenModule>;
}>;

export type RuntimeModuleImporter = (entryUrl: string) => Promise<EmscriptenModuleImport>;

function withUtf8<T>(module: EmscriptenModule, value: string, operation: (pointer: number) => T): T {
  const pointer = module._malloc(module.lengthBytesUTF8(value) + 1);
  try {
    module.stringToUTF8(value, pointer, module.lengthBytesUTF8(value) + 1);
    return operation(pointer);
  } finally {
    module._free(pointer);
  }
}

function withBytes<T>(module: EmscriptenModule, bytes: Uint8Array, operation: (pointer: number) => T): T {
  const pointer = bytes.length === 0 ? 0 : module._malloc(bytes.length);
  try {
    if (pointer !== 0) module.HEAPU8.set(bytes, pointer);
    return operation(pointer);
  } finally {
    if (pointer !== 0) module._free(pointer);
  }
}

const MIDI_ENDPOINT_SIZE = 20;
const MIDI_ACTION_SIZE = 24;
const MIDI_ACTION_TYPES: MidiAction["type"][] = ["open-input", "open-output", "close-input", "close-output", "update-input-ref", "update-output-ref", "resync"];

function decodeUtf8(module: EmscriptenModule, pointer: number, size: number): string {
  return new TextDecoder().decode(module.HEAPU8.slice(pointer, pointer + size));
}

export function emscriptenRuntimeFacade(module: EmscriptenModule): RuntimeModuleFacade {
  return {
    abiVersion: module._synth_browser_abi_version(),
    uiProtocolVersion: module._synth_browser_ui_protocol_version(),
    runtimeConfigVersion: module._synth_browser_runtime_config_version(),
    create: () => module._synth_browser_create(),
    audioOutputChannels: (handle) => module._synth_browser_audio_output_channels(handle),
    initialize: (handle, dataRoot) => withUtf8(module, dataRoot, (root) => module._synth_browser_initialize(handle, root)),
    prepare: (handle, sampleRate, blockSize) => module._synth_browser_prepare(handle, sampleRate, blockSize),
    process: (handle, frames, timestampMicros) => module._synth_browser_process(handle, 0, 0, frames, BigInt(timestampMicros)),
    startAudioWorklet: module._synth_browser_start_audio_worklet
      ? (handle) => module._synth_browser_start_audio_worklet!(handle)
      : undefined,
    audioWorkletStats: module._synth_browser_audio_worklet_block_count &&
      module._synth_browser_audio_worklet_peak_microunits &&
      module._synth_browser_audio_worklet_deadline_microunits
      ? (handle) => ({
        blocks: module._synth_browser_audio_worklet_block_count!(handle),
        peakMicrounits: module._synth_browser_audio_worklet_peak_microunits!(handle),
        deadlineMicrounits: module._synth_browser_audio_worklet_deadline_microunits!(handle),
      })
      : undefined,
    renderAudio: (handle, channels, frames, timestampMicros) => {
      const outputPointers = module._malloc(channels * Uint32Array.BYTES_PER_ELEMENT);
      const channelPointers = Array.from({ length: channels }, () => module._malloc(frames * Float32Array.BYTES_PER_ELEMENT));
      try {
        const pointers = new DataView(module.HEAPU8.buffer);
        channelPointers.forEach((pointer, index) => pointers.setUint32(outputPointers + index * Uint32Array.BYTES_PER_ELEMENT, pointer, true));
        const status = module._synth_browser_process(handle, outputPointers, channels, frames, BigInt(timestampMicros));
        return { status, outputs: channelPointers.map((pointer) => module.HEAPF32.slice(pointer / Float32Array.BYTES_PER_ELEMENT, pointer / Float32Array.BYTES_PER_ELEMENT + frames)) };
      } finally {
        channelPointers.forEach((pointer) => module._free(pointer));
        module._free(outputPointers);
      }
    },
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
    hasPersistenceChanges: module._synth_browser_consume_persistence_dirty
      ? (handle) => module._synth_browser_consume_persistence_dirty!(handle) !== 0
      : undefined,
    submitMidiEndpoints: (handle, endpoints) => {
      const encoded = endpoints.map((endpoint) => ({ ...endpoint, identifier: new TextEncoder().encode(endpoint.identifier), name: new TextEncoder().encode(endpoint.name) }));
      const allocated = encoded.flatMap((endpoint) => [endpoint.identifier, endpoint.name]).map((bytes) => bytes.length === 0 ? 0 : module._malloc(bytes.length));
      const endpointPointer = endpoints.length === 0 ? 0 : module._malloc(endpoints.length * MIDI_ENDPOINT_SIZE);
      try {
        const view = new DataView(module.HEAPU8.buffer);
        for (let index = 0; index < encoded.length; index++) {
          const endpoint = encoded[index];
          const identifierPointer = allocated[index * 2];
          const namePointer = allocated[index * 2 + 1];
          if (identifierPointer !== 0) module.HEAPU8.set(endpoint.identifier, identifierPointer);
          if (namePointer !== 0) module.HEAPU8.set(endpoint.name, namePointer);
          const offset = endpointPointer + index * MIDI_ENDPOINT_SIZE;
          view.setUint32(offset, identifierPointer, true);
          view.setUint32(offset + 4, endpoint.identifier.length, true);
          view.setUint32(offset + 8, namePointer, true);
          view.setUint32(offset + 12, endpoint.name.length, true);
          view.setUint32(offset + 16, endpoint.kind === "input" ? 0 : 1, true);
        }
        return module._synth_browser_submit_midi_endpoints(handle, endpointPointer, endpoints.length);
      } finally {
        if (endpointPointer !== 0) module._free(endpointPointer);
        allocated.filter((pointer) => pointer !== 0).forEach((pointer) => module._free(pointer));
      }
    },
    dequeueMidiAction: (handle) => {
      const actionPointer = module._malloc(MIDI_ACTION_SIZE);
      try {
        const status = module._synth_browser_dequeue_midi_action(handle, actionPointer);
        if (status === 0) return undefined;
        if (status !== 1) throw new Error("runtime failed to dequeue MIDI action");
        const view = new DataView(module.HEAPU8.buffer);
        const type = MIDI_ACTION_TYPES[view.getUint32(actionPointer, true)];
        if (!type) throw new Error("runtime returned invalid MIDI action");
        const identifierPointer = view.getUint32(actionPointer + 8, true);
        const identifierSize = view.getUint32(actionPointer + 12, true);
        const namePointer = view.getUint32(actionPointer + 16, true);
        const nameSize = view.getUint32(actionPointer + 20, true);
        return { type, controllerIx: view.getUint32(actionPointer + 4, true), identifier: decodeUtf8(module, identifierPointer, identifierSize), name: decodeUtf8(module, namePointer, nameSize) };
      } finally {
        module._free(actionPointer);
      }
    },
    deliverMidi: (handle, controllerIx, bytes, timestampMicros) => withBytes(module, Uint8Array.from(bytes), (pointer) =>
      module._synth_browser_deliver_midi(handle, controllerIx, pointer, bytes.length, BigInt(timestampMicros))),
    dequeueMidiOutput: (handle) => {
      const metadata = module._malloc(8);
      try {
        const pointer = module._synth_browser_dequeue_midi_output(handle, metadata, metadata + 4);
        const view = new DataView(module.HEAPU8.buffer);
        const size = view.getUint32(metadata + 4, true);
        return pointer === 0 ? undefined : { controllerIx: view.getUint32(metadata, true), bytes: Array.from(module.HEAPU8.slice(pointer, pointer + size)) };
      } finally {
        module._free(metadata);
      }
    },
    destroy: (handle) => module._synth_browser_destroy(handle),
  };
}

function normalizedMaterializedPath(requestedPath: string): string {
  if (typeof requestedPath !== "string" || requestedPath.length === 0 || requestedPath.startsWith("/") ||
      requestedPath.includes("\\") || requestedPath.includes("?") || requestedPath.includes("#") || requestedPath.includes("%") || requestedPath.includes(":"))
    throw new Error(`Emscripten requested unmapped package path ${String(requestedPath)}`);
  const normalized = requestedPath.startsWith("./") ? requestedPath.slice(2) : requestedPath;
  if (normalized.split("/").some((segment) => segment === "" || segment === "." || segment === ".."))
    throw new Error(`Emscripten requested unmapped package path ${requestedPath}`);
  return normalized;
}

const importRuntimeModule: RuntimeModuleImporter = async (entryUrl) => import(entryUrl) as Promise<EmscriptenModuleImport>;

export async function loadEmscriptenRuntime(
  materialized: MaterializedRuntimeModule,
  importer: RuntimeModuleImporter = importRuntimeModule,
): Promise<RuntimeModuleFacade> {
  if (!materialized || typeof materialized.entryUrl !== "string" || materialized.entryUrl.length === 0)
    throw new Error("materialized runtime entry URL is required");
  if (!materialized.locateFile || typeof materialized.locateFile !== "object" || Array.isArray(materialized.locateFile))
    throw new Error("materialized runtime locateFile map is required");
  if (typeof materialized.mainScriptUrlOrBlob !== "string" || materialized.mainScriptUrlOrBlob.length === 0)
    throw new Error("materialized runtime mainScriptUrlOrBlob is required");
  const imported = await importer(materialized.entryUrl);
  const factory = imported.default ?? imported.createSynthBrowserModule;
  if (!factory) throw new Error("runtime module does not export an Emscripten factory");
  const module = await factory({
    locateFile: (requestedPath) => {
      const normalized = normalizedMaterializedPath(requestedPath);
      const url = materialized.locateFile[normalized];
      if (typeof url !== "string" || url.length === 0)
        throw new Error(`Emscripten requested unmapped package path ${requestedPath}; file was not materialized`);
      return url;
    },
    mainScriptUrlOrBlob: materialized.mainScriptUrlOrBlob,
  });
  const idbfs = module.IDBFS ?? module.FS.filesystems?.IDBFS;
  if (!idbfs) throw new Error("runtime module does not include IDBFS");
  return { ...emscriptenRuntimeFacade(module), filesystem: {
    filesystems: { IDBFS: idbfs },
    mkdir: (path) => module.FS.mkdir(path),
    mount: (type, options, path) => module.FS.mount(type, options, path),
    syncfs: (populate, complete) => module.FS.syncfs(populate, complete),
  } };
}

export class BrowserRuntimeWorker {
  private module: RuntimeModuleFacade | undefined;
  private handleValue: number | undefined;
  private audioBridge: SharedRingBuffer | undefined;
  private audioBlockSize: number | undefined;
  private persistence: BrowserPersistence | undefined;
  private destroyed = false;

  constructor(
    private readonly loadModule: RuntimeModuleLoader = loadEmscriptenRuntime,
    private readonly createPersistence: BrowserPersistenceFactory | undefined = undefined,
    private readonly emitStatus: (response: RuntimeResponse) => void = () => {},
  ) {}

  async handle(command: RuntimeCommand): Promise<RuntimeResponse> {
    try {
      if (this.destroyed) throw new Error("runtime is destroyed");
      switch (command.type) {
        case "load":
        {
          const module = await this.loadModule(command.module);
          negotiateRuntimeVersions(module, command.versions);
          const persistence = module.filesystem ? (this.createPersistence ?? defaultPersistenceFactory)(module.filesystem, (status) => {
            this.emitStatus({ type: "page-status", path: BROWSER_PERSISTENCE_STATUS_PATH, status });
          }) : undefined;
          this.module = module;
          this.persistence = persistence;
          return { type: "ok" };
        }
        case "create": {
          if (!this.module) throw new Error("runtime module is not loaded");
          if (this.handleValue !== undefined) throw new Error("runtime is already created");
          this.handleValue = this.module.create();
          if (!this.handleValue) throw new Error("runtime creation failed");
          return { type: "created", handle: this.handleValue };
        }
        case "initialize": {
          if (this.persistence) {
            await this.persistence.start();
            return this.call((module, handle) => module.initialize(handle, this.persistence!.paths.dataRoot));
          }
          return this.call((module, handle) => module.initialize(handle, command.dataRoot));
        }
        case "audio-config":
          return { type: "audio-config", channels: this.requireModule().audioOutputChannels(this.requireHandle()) };
        case "prepare":
          return this.call((module, handle) => module.prepare(handle, command.sampleRate, command.blockSize));
        case "process":
          return this.call((module, handle) => module.process(handle, command.frames, command.timestampMicros));
        case "configure-audio":
          this.audioBridge = SharedRingBuffer.fromDescriptor(command.bridge);
          this.audioBlockSize = command.blockSize;
          return this.call((module, handle) => module.prepare(handle, command.sampleRate, command.blockSize));
        case "render-audio": {
          const bridge = this.audioBridge;
          const frames = this.audioBlockSize;
          if (!bridge || !frames) throw new Error("audio bridge is not configured");
          const module = this.requireModule();
          const handle = this.requireHandle();
          if (!module.renderAudio) throw new Error("runtime does not support audio output buffers");
          const rendered = module.renderAudio(handle, bridge.descriptor().channels, frames, command.timestampMicros);
          if (rendered.status !== 0) throw new Error("runtime operation failed");
          bridge.write(rendered.outputs, frames);
          return { type: "ok" };
        }
        case "start-audio-worklet": {
          const module = this.requireModule();
          if (!module.startAudioWorklet) throw new Error("runtime does not support AudioWorklet callback");
          return this.call((module, handle) => module.startAudioWorklet!(handle));
        }
        case "audio-worklet-stats": {
          const module = this.requireModule();
          if (!module.audioWorkletStats) throw new Error("runtime does not expose AudioWorklet stats");
          return { type: "audio-worklet-stats", ...module.audioWorkletStats(this.requireHandle()) };
        }
        case "message-tick":
          await this.call((module, handle) => module.messageTick(handle, command.timestampMicros));
          this.syncPersistenceIfRuntimeDirty();
          return { type: "ok" };
        case "build-ui-frame":
          return this.buildUiFrameResponse();
        case "dispatch-action": {
          await this.call((module, handle) => module.dispatchAction(handle, command.name, command.value));
          this.syncPersistenceIfRuntimeDirty();
          return this.buildUiFrameResponse();
        }
        case "midi-endpoints": {
          const module = this.requireModule();
          const handle = this.requireHandle();
          if (module.submitMidiEndpoints(handle, command.endpoints) !== 0) throw new Error("runtime operation failed");
          const actions: MidiAction[] = [];
          for (let action = module.dequeueMidiAction(handle); action !== undefined; action = module.dequeueMidiAction(handle)) actions.push(action);
          return { type: "midi-actions", actions };
        }
        case "midi-input":
          return this.call((module, handle) => module.deliverMidi(handle, command.controllerIx, command.bytes, command.timestampMicros));
        case "drain-midi-output":
          return { type: "midi-output", output: this.requireModule().dequeueMidiOutput(this.requireHandle()) };
        case "destroy": {
          const module = this.requireModule();
          const handle = this.requireHandle();
          module.destroy(handle);
          this.handleValue = undefined;
          this.destroyed = true;
          return { type: "destroyed" };
        }
        case "persistence":
          if (!this.persistence) return { type: "status", status: "persistence unavailable" };
          this.persistence.scheduleSync();
          return { type: "page-status", path: BROWSER_PERSISTENCE_STATUS_PATH, status: this.persistence.status() };
        case "persistence-status":
          if (!this.persistence) return { type: "status", status: "persistence unavailable" };
          return { type: "page-status", path: BROWSER_PERSISTENCE_STATUS_PATH, status: this.persistence.status() };
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

  private async buildUiFrameResponse(): Promise<RuntimeResponse> {
    const frame = await this.callValue((module, handle) => module.buildUiFrame(handle));
    return { type: "ui-frame", frame: Array.from(new Uint8Array(frame)) };
  }

  private syncPersistenceIfRuntimeDirty(): void {
    const module = this.requireModule();
    if (!this.persistence || !module.hasPersistenceChanges?.(this.requireHandle())) return;
    this.persistence.scheduleSync();
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

function defaultPersistenceFactory(filesystem: BrowserFileSystem, reportStatus: (status: string) => void): BrowserPersistence {
  return new BrowserPersistence(filesystem, {}, reportStatus);
}

type WorkerScope = {
  addEventListener(type: "message", listener: (event: MessageEvent<RuntimeCommand>) => void): void;
  postMessage(response: RuntimeResponse): void;
  importScripts?: (...urls: string[]) => void;
};

export function installBrowserRuntimeWorker(scope: WorkerScope, loadModule: RuntimeModuleLoader = loadEmscriptenRuntime) {
  const runtime = new BrowserRuntimeWorker(
    loadModule,
    (filesystem, reportStatus) => new BrowserPersistence(filesystem, {}, reportStatus),
    (response) => scope.postMessage(response),
  );
  scope.addEventListener("message", (event: MessageEvent<RuntimeCommand>) => {
    void runtime.handle(event.data).then((response) => scope.postMessage(response));
  });
}

const globalWorkerScope = globalThis as unknown as WorkerScope;
if (typeof globalWorkerScope.importScripts === "function") {
  installBrowserRuntimeWorker(globalWorkerScope);
}
