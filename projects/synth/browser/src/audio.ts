import { AUDIO_RING_STATE, AudioBridgeDescriptor, SharedRingBuffer } from "./protocol.js";

export type BrowserAudioWorker = {
  postMessage(message: { type: "configure-audio"; sampleRate: number; blockSize: number; bridge: AudioBridgeDescriptor } |
                       { type: "render-audio"; timestampMicros: number }): void;
  startAudioWorklet?: () => Promise<AudioBridgeStart>;
};

export type AudioBridgeStart = { started: true } | { started: false; diagnostic: string };

export type AudioBridgeOptions = {
  blockSize?: number;
  channels?: number;
  capacityBlocks?: number;
  audioContext?: AudioContext;
  audioContextFactory?: () => AudioContext;
  audioWorkletNodeFactory?: (context: AudioContext, processorOptions: AudioBridgeDescriptor) => AudioWorkletNode;
};

export class AudioBridge {
  private readonly blockSize: number;
  private readonly channels: number;
  private readonly capacityFrames: number;
  private ring: SharedRingBuffer | undefined;
  private context: AudioContext | undefined;
  private node: AudioWorkletNode | undefined;
  private renderTimer: number | undefined;
  private ownsContext = false;

  constructor(private readonly worker: BrowserAudioWorker, private readonly options: AudioBridgeOptions = {}) {
    this.blockSize = options.blockSize ?? 128;
    this.channels = options.channels ?? 2;
    this.capacityFrames = this.blockSize * (options.capacityBlocks ?? 8);
  }

  async startFromUserActivation(): Promise<AudioBridgeStart> {
    if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === "undefined")
      return { started: false, diagnostic: "cross-origin-isolation-required" };
    if (this.context) return { started: true };
    if (!this.options.audioContext && this.worker.startAudioWorklet) return this.worker.startAudioWorklet();

    const context = this.options.audioContext ?? this.options.audioContextFactory?.() ?? new AudioContext();
    this.ownsContext = !this.options.audioContext;
    try {
      await context.audioWorklet.addModule(new URL("./audio-worklet.js", import.meta.url));
      const ring = this.ring ??= SharedRingBuffer.create(this.channels, this.capacityFrames);
      const descriptor = ring.descriptor();
      const node = this.options.audioWorkletNodeFactory?.(context, descriptor) ??
        new AudioWorkletNode(context, "synth-audio-ring-buffer", {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [descriptor.channels],
          processorOptions: descriptor,
        });
      node.connect(context.destination);
      if (this.ownsContext) await context.resume();
      this.context = context;
      this.node = node;
      this.worker.postMessage({ type: "configure-audio", sampleRate: context.sampleRate, blockSize: this.blockSize, bridge: descriptor });
      this.requestRender();
      this.renderTimer = globalThis.setInterval(() => this.requestRender(), Math.max(1, Math.round(this.blockSize * 1000 / context.sampleRate)));
      return { started: true };
    } catch (error) {
      if (this.ownsContext) void context.close();
      this.ownsContext = false;
      throw error;
    }
  }

  shutdown() {
    if (this.ring) Atomics.store(new Int32Array(this.ring.descriptor().state), AUDIO_RING_STATE.shutdown, 1);
    if (this.renderTimer !== undefined) globalThis.clearInterval(this.renderTimer);
    this.renderTimer = undefined;
    this.node?.disconnect();
    this.node = undefined;
    if (this.ownsContext) void this.context?.close();
    this.context = undefined;
    this.ownsContext = false;
  }

  private requestRender() {
    this.worker.postMessage({ type: "render-audio", timestampMicros: Math.round(performance.now() * 1000) });
  }
}
