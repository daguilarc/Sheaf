export type BrowserAudioWorker = {
  startAudioWorklet?: (context?: AudioContext) => Promise<AudioBridgeStart>;
  audioInputChannels?: () => Promise<number>;
  setAudioInputSource?: (source: AudioNode, physicalChannels: number, statusCode: number) => Promise<void>;
  clearAudioInputSource?: (statusCode: number) => Promise<void>;
};

export type AudioBridgeStart = { started: true } | { started: false; diagnostic: string };

export type AudioBridgeOptions = {
  audioContext?: AudioContext;
};

// Mirrors `synth_browser::BrowserAudioInputStatus`. The numeric values are the
// ABI status codes the native runtime validates and the Audio page renders, so
// entries may be appended but never reordered.
export const AudioInputStatusCode = {
  notRequested: 0,
  requesting: 1,
  online: 2,
  permissionDenied: 3,
  apiUnavailable: 4,
  prerequisiteBlocked: 5,
  streamEnded: 6,
  channelCountUnreported: 7,
} as const;

export type AudioInputState = {
  requestedChannels: number;
  activeChannels: number;
  statusCode: number;
  // A stable kebab-case reason for the page-level status text. The Audio page's
  // own line is composed natively from the published status code; this names the
  // specific prerequisite or failure behind it.
  diagnostic: string;
};

// The capture the bridge currently owns. The node's native handle is not held
// here: registration goes through the module-local handle path in `worker.ts`,
// which is the only layer that may hand an `AudioNode` to Emscripten.
type RegisteredAudioInput = { node: AudioNode; stream: MediaStream; physicalChannels: number };

const MAX_BROWSER_AUDIO_INPUT_CHANNELS = 32;

// Pinned by sbw-4: an *ideal* channel count so a device that cannot supply the
// request degrades to a shortfall instead of failing, and voice processing off
// so the browser does not silently downmix a multichannel interface to mono.
function captureConstraints(requestedChannels: number): MediaStreamConstraints {
  return {
    audio: {
      channelCount: { ideal: requestedChannels },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  };
}

function classifyCaptureFailure(error: unknown): { statusCode: number; diagnostic: string } {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError")
    return { statusCode: AudioInputStatusCode.permissionDenied, diagnostic: "permission-denied" };
  if (name === "SecurityError")
    return { statusCode: AudioInputStatusCode.prerequisiteBlocked, diagnostic: "capture-blocked" };
  return {
    statusCode: AudioInputStatusCode.apiUnavailable,
    diagnostic: `capture-failed:${name || "unknown"}`,
  };
}

function positiveChannelCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

export class AudioBridge {
  private started = false;
  private stopped = false;
  private requestedInputChannels = 0;
  private input: RegisteredAudioInput | undefined;
  private inputStatusCode: number = AudioInputStatusCode.notRequested;
  private inputDiagnostic = "";
  // Capture transitions are serialized. `track.onended` can fire while a retry
  // or a teardown is already in flight, and two overlapping acquisitions would
  // register two sources against one worklet input bus.
  private inputWork: Promise<void> = Promise.resolve();

  constructor(private readonly worker: BrowserAudioWorker, private readonly options: AudioBridgeOptions = {}) {}

  async startFromUserActivation(): Promise<AudioBridgeStart> {
    if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === "undefined")
      return { started: false, diagnostic: "cross-origin-isolation-required" };
    if (this.stopped) return { started: false, diagnostic: "audio-bridge-stopped" };
    if (this.started) return { started: true };
    if (!this.worker.startAudioWorklet)
      return { started: false, diagnostic: "native-audio-worklet-required" };
    // Discovery first: a zero-input application must reach native startup
    // without the media device API ever being touched (sbw-4).
    this.requestedInputChannels = await this.discoverRequestedInputChannels();
    // Capture is registered and its physical count published before the worklet
    // node exists, so the node's first callback already sees the real count.
    await this.serializeInputWork(() => this.acquireInput());
    const result = await this.worker.startAudioWorklet(this.options.audioContext);
    this.started = result.started;
    if (!result.started)
      await this.serializeInputWork(() => this.releaseInput(AudioInputStatusCode.notRequested, ""));
    return result;
  }

  // The user-initiated path back from an offline capture (sbw-4): it reacquires
  // into the existing AudioContext, worklet node, engine, and application, and
  // is never called from the realtime callback or on a timer.
  async retryInput(): Promise<void> {
    await this.serializeInputWork(() => (this.stopped ? Promise.resolve() : this.acquireInput()));
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      await this.whenInputSettled();
      return;
    }
    this.stopped = true;
    this.started = false;
    await this.serializeInputWork(() => this.releaseInput(AudioInputStatusCode.notRequested, ""));
  }

  inputState(): AudioInputState {
    return {
      requestedChannels: this.requestedInputChannels,
      activeChannels: this.input?.physicalChannels ?? 0,
      statusCode: this.inputStatusCode,
      diagnostic: this.inputDiagnostic,
    };
  }

  // Resolves once every capture transition queued so far has finished. Capture
  // loss arrives asynchronously through `track.onended`, so hosts and tests need
  // a way to observe the settled state instead of guessing at timers.
  whenInputSettled(): Promise<void> {
    return this.inputWork;
  }

  private async discoverRequestedInputChannels(): Promise<number> {
    if (!this.worker.audioInputChannels) return 0;
    const requested = await this.worker.audioInputChannels();
    return positiveChannelCount(requested) ?? 0;
  }

  private serializeInputWork(work: () => Promise<void>): Promise<void> {
    const next = this.inputWork.then(work, work);
    this.inputWork = next.then(() => {}, () => {});
    return this.inputWork;
  }

  private async acquireInput(): Promise<void> {
    if (this.requestedInputChannels <= 0) return;
    if (this.requestedInputChannels > MAX_BROWSER_AUDIO_INPUT_CHANNELS) {
      // Native startup rejects this configuration outright; prompting for a
      // microphone the application can never be started with would be gratuitous.
      await this.releaseInput(AudioInputStatusCode.notRequested, "input-channel-limit-exceeded");
      return;
    }
    if (!this.worker.setAudioInputSource) {
      await this.releaseInput(AudioInputStatusCode.apiUnavailable, "input-registration-unavailable");
      return;
    }
    const context = this.options.audioContext;
    if (!context) {
      await this.releaseInput(AudioInputStatusCode.prerequisiteBlocked, "audio-context-unavailable");
      return;
    }
    if (!globalThis.isSecureContext) {
      await this.releaseInput(AudioInputStatusCode.prerequisiteBlocked, "insecure-context");
      return;
    }
    const mediaDevices = navigator.mediaDevices;
    if (typeof mediaDevices?.getUserMedia !== "function") {
      await this.releaseInput(AudioInputStatusCode.apiUnavailable, "media-devices-unavailable");
      return;
    }

    await this.releaseInput(AudioInputStatusCode.requesting, "");
    let stream: MediaStream;
    try {
      stream = await mediaDevices.getUserMedia(captureConstraints(this.requestedInputChannels));
    } catch (error) {
      const failure = classifyCaptureFailure(error);
      await this.releaseInput(failure.statusCode, failure.diagnostic);
      return;
    }
    // A stop or a second retry can win the race against the permission prompt;
    // the stream it left behind is still ours to release.
    if (this.stopped) {
      stopStream(stream);
      return;
    }
    const track = stream.getAudioTracks()[0];
    if (!track) {
      stopStream(stream);
      await this.releaseInput(AudioInputStatusCode.streamEnded, "no-audio-track");
      return;
    }

    const source = context.createMediaStreamSource(stream);
    const reported = positiveChannelCount(track.getSettings?.().channelCount);
    const statusCode = reported === undefined
      ? AudioInputStatusCode.channelCountUnreported
      : AudioInputStatusCode.online;
    // D5's fallback chain: the track's own setting, else the source node's count,
    // else one channel. The result is clamped to the request so a device with
    // more channels than the application addresses never inflates the active count.
    const derived = reported ?? positiveChannelCount(source.channelCount) ?? 1;
    const physicalChannels = Math.min(derived, this.requestedInputChannels);
    try {
      await this.worker.setAudioInputSource(source, physicalChannels, statusCode);
    } catch {
      source.disconnect();
      stopStream(stream);
      await this.releaseInput(AudioInputStatusCode.apiUnavailable, "input-registration-failed");
      return;
    }
    this.input = { node: source, stream, physicalChannels };
    this.inputStatusCode = statusCode;
    this.inputDiagnostic = reported === undefined ? "channel-count-unreported" : "";
    track.onended = () => {
      void this.serializeInputWork(() => this.handleStreamEnded(track));
    };
  }

  private async handleStreamEnded(track: MediaStreamTrack): Promise<void> {
    // A handler left over from a stream this bridge has already replaced or
    // released must not knock the current capture offline.
    if (!this.input || !this.input.stream.getTracks().includes(track)) return;
    await this.releaseInput(AudioInputStatusCode.streamEnded, "stream-ended");
  }

  // Clears the native active count first, so no audio callback can read a source
  // that is about to be disconnected, then releases the media resources and
  // leaves the output callback and AudioContext untouched.
  private async releaseInput(statusCode: number, diagnostic: string): Promise<void> {
    if (this.requestedInputChannels <= 0) return;
    this.inputStatusCode = statusCode;
    this.inputDiagnostic = diagnostic;
    try {
      await this.worker.clearAudioInputSource?.(statusCode);
    } catch {
      // A destroyed or unavailable runtime cannot hold the media resources open.
    }
    const input = this.input;
    if (!input) return;
    this.input = undefined;
    input.node.disconnect();
    stopStream(input.stream);
  }
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.onended = null;
    track.stop();
  }
}
