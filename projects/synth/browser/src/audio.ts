export type BrowserAudioWorker = {
  startAudioWorklet?: (context?: AudioContext) => Promise<AudioBridgeStart>;
};

export type AudioBridgeStart = { started: true } | { started: false; diagnostic: string };

export type AudioBridgeOptions = {
  audioContext?: AudioContext;
};

export class AudioBridge {
  private started = false;
  private stopped = false;

  constructor(private readonly worker: BrowserAudioWorker, private readonly options: AudioBridgeOptions = {}) {}

  async startFromUserActivation(): Promise<AudioBridgeStart> {
    if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === "undefined")
      return { started: false, diagnostic: "cross-origin-isolation-required" };
    if (this.stopped) return { started: false, diagnostic: "audio-bridge-stopped" };
    if (this.started) return { started: true };
    if (!this.worker.startAudioWorklet)
      return { started: false, diagnostic: "native-audio-worklet-required" };
    const result = await this.worker.startAudioWorklet(this.options.audioContext);
    this.started = result.started;
    return result;
  }

  shutdown() {
    if (this.stopped) return;
    this.stopped = true;
    this.started = false;
  }
}
