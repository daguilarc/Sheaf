import { MAX_BROWSER_AUDIO_INPUT_CHANNELS, browserAudioInputLimitDiagnostic } from "./audio-input-limits.js";

export type BrowserAudioWorker = {
  startAudioWorklet?: (context?: AudioContext) => Promise<AudioBridgeStart>;
  audioInputChannels?: () => Promise<number>;
  // Resolves to the module-local native handle the source is registered under,
  // so the bridge can retain the exact identity the native graph holds.
  setAudioInputSource?: (source: AudioNode, physicalChannels: number, statusCode: number) => Promise<number>;
  clearAudioInputSource?: (statusCode: number) => Promise<void>;
  // The unload-safe clear. A page being unloaded is not required to run any
  // promise continuation, so teardown needs a path that completes before it
  // returns.
  clearAudioInputSourceNow?: (statusCode: number) => void;
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
  insecureContext: 8,
  permissionsPolicyBlocked: 9,
  audioContextUnavailable: 10,
} as const;

export type AudioInputState = {
  requestedChannels: number;
  activeChannels: number;
  statusCode: number;
  // A stable kebab-case reason. Each missing prerequisite has its own published
  // status code, so this refines rather than replaces the Audio page's line.
  diagnostic: string;
  // The module-local handle the current source is registered under, or 0 when
  // nothing is registered.
  nativeHandle: number;
};

// The capture the bridge currently owns, including the exact native handle the
// registration returned. Registration itself stays in `worker.ts`, which owns
// the module-local object cache and is the only layer that hands an `AudioNode`
// to Emscripten; the bridge retains the identity that cache minted rather than
// registering a second time to learn it.
type RegisteredAudioInput = {
  node: AudioNode;
  stream: MediaStream;
  nativeHandle: number;
  physicalChannels: number;
};

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
    return { statusCode: AudioInputStatusCode.permissionsPolicyBlocked, diagnostic: "capture-blocked" };
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
    if (this.requestedInputChannels > MAX_BROWSER_AUDIO_INPUT_CHANNELS) {
      this.inputStatusCode = AudioInputStatusCode.apiUnavailable;
      this.inputDiagnostic = browserAudioInputLimitDiagnostic(this.requestedInputChannels);
      return { started: false, diagnostic: this.inputDiagnostic };
    }
    // Start the activation-bound capture request, but do not serialize output
    // startup, first render, or unload handler installation behind a permission
    // prompt the user may leave open indefinitely. When capture settles, the
    // native publication still stores the physical count before graph
    // attachment, so the first callback that can read that source sees the
    // registered count.
    if (this.requestedInputChannels > 0)
      void this.serializeInputWork(() => this.acquireInput());
    const result = await this.worker.startAudioWorklet(this.options.audioContext);
    if (this.stopped)
      return { started: false, diagnostic: "audio-bridge-stopped" };
    this.started = result.started;
    if (!result.started) {
      this.releaseNow();
      return result;
    }
    if (this.input)
      void this.serializeInputWork(() => this.reconcileInputAfterWorkletStart());
    return result;
  }

  // The user-initiated path back from an offline capture (sbw-4): it reacquires
  // into the existing AudioContext, worklet node, engine, and application, and
  // is never called from the realtime callback or on a timer.
  async retryInput(): Promise<void> {
    if (this.requestedInputChannels > MAX_BROWSER_AUDIO_INPUT_CHANNELS) return;
    await this.serializeInputWork(() => (this.stopped ? Promise.resolve() : this.acquireInput()));
  }

  // Unload-safe teardown: everything releasable without yielding happens before
  // this returns, because a page being unloaded or frozen into the back/forward
  // cache is not required to run any promise continuation. Idempotent, and an
  // acquisition still in flight observes `stopped` and releases what it holds.
  releaseNow(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.started = false;
    this.releaseInputNow(AudioInputStatusCode.notRequested, "");
  }

  async stop(): Promise<void> {
    this.releaseNow();
    await this.whenInputSettled();
  }

  inputState(): AudioInputState {
    return {
      requestedChannels: this.requestedInputChannels,
      activeChannels: this.input?.physicalChannels ?? 0,
      statusCode: this.inputStatusCode,
      diagnostic: this.inputDiagnostic,
      nativeHandle: this.input?.nativeHandle ?? 0,
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
    if (this.stopped) return;
    if (this.requestedInputChannels <= 0) return;
    if (this.requestedInputChannels > MAX_BROWSER_AUDIO_INPUT_CHANNELS) {
      // Native startup rejects this configuration outright; prompting for a
      // microphone the application can never be started with would be gratuitous.
      await this.releaseInput(
        AudioInputStatusCode.apiUnavailable,
        browserAudioInputLimitDiagnostic(this.requestedInputChannels),
      );
      return;
    }
    const registerSource = this.worker.setAudioInputSource?.bind(this.worker);
    if (!registerSource) {
      await this.releaseInput(AudioInputStatusCode.apiUnavailable, "input-registration-unavailable");
      return;
    }
    const context = this.options.audioContext;
    if (!context) {
      await this.releaseInput(AudioInputStatusCode.audioContextUnavailable, "audio-context-unavailable");
      return;
    }
    if (!globalThis.isSecureContext) {
      await this.releaseInput(AudioInputStatusCode.insecureContext, "insecure-context");
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
      if (this.stopped) return;
      const failure = classifyCaptureFailure(error);
      await this.releaseInput(failure.statusCode, failure.diagnostic);
      return;
    }
    // Provisional ownership starts here: the stream is this bridge's to release
    // on every path below that does not hand it to `this.input`, and the end
    // handler is installed before any awaited work so a track that ends while
    // registration is in flight is observed rather than left falsely online.
    const track = stream.getAudioTracks()[0];
    let endedDuringAcquisition = false;
    if (track) track.onended = () => { endedDuringAcquisition = true; };
    let source: MediaStreamAudioSourceNode | undefined;
    let acquired: RegisteredAudioInput | undefined;
    try {
      // A stop or a second retry can win the race against the permission prompt.
      if (this.stopped) return;
      if (!track) {
        await this.releaseInput(AudioInputStatusCode.streamEnded, "no-audio-track");
        return;
      }
      source = context.createMediaStreamSource(stream);
      const reported = positiveChannelCount(track.getSettings?.().channelCount);
      const statusCode = reported === undefined
        ? AudioInputStatusCode.channelCountUnreported
        : AudioInputStatusCode.online;
      // D5's fallback chain: the track's own setting, else the source node's count,
      // else one channel. The result is clamped to the request so a device with
      // more channels than the application addresses never inflates the active count.
      const derived = reported ?? positiveChannelCount(source.channelCount) ?? 1;
      const physicalChannels = Math.min(derived, this.requestedInputChannels);
      const nativeHandle = await registerSource(source, physicalChannels, statusCode);
      // A stop -- including an unload -- can land while this registration is in
      // flight. `releaseNow()` cleared whatever was published when it ran, not
      // the claim the call above has just published, so that late claim has to
      // be taken back down here or the native side keeps a handle and a count
      // for a source nobody owns any more.
      if (this.stopped) {
        await this.releaseInput(AudioInputStatusCode.notRequested, "");
        return;
      }
      if (endedDuringAcquisition || track.readyState === "ended") {
        // The registration landed on a source whose track is already gone, so the
        // native claim has to come back down before the source does.
        await this.releaseInput(AudioInputStatusCode.streamEnded, "stream-ended");
        return;
      }
      acquired = { node: source, stream, nativeHandle, physicalChannels };
      this.input = acquired;
      this.inputStatusCode = statusCode;
      this.inputDiagnostic = reported === undefined ? "channel-count-unreported" : "";
      track.onended = () => {
        void this.serializeInputWork(() => this.handleStreamEnded(track));
      };
    } catch {
      // Source construction or registration threw. The native side may or may
      // not have taken the source, so drop the claim rather than assume which.
      await this.releaseInput(AudioInputStatusCode.apiUnavailable, "input-registration-failed");
    } finally {
      if (!acquired) {
        source?.disconnect();
        stopStream(stream);
      }
    }
  }

  private async reconcileInputAfterWorkletStart(): Promise<void> {
    if (this.stopped || !this.input) return;
    const input = this.input;
    const registerSource = this.worker.setAudioInputSource?.bind(this.worker);
    if (!registerSource) {
      await this.releaseInput(AudioInputStatusCode.apiUnavailable, "input-registration-unavailable");
      return;
    }
    try {
      const nativeHandle = await registerSource(input.node, input.physicalChannels, this.inputStatusCode);
      if (this.stopped) {
        await this.releaseInput(AudioInputStatusCode.notRequested, "");
        return;
      }
      if (this.input === input)
        input.nativeHandle = nativeHandle;
    } catch {
      if (!this.stopped && this.input === input)
        await this.releaseInput(AudioInputStatusCode.apiUnavailable, "input-registration-failed");
    }
  }

  private async handleStreamEnded(track: MediaStreamTrack): Promise<void> {
    // A handler left over from a stream this bridge has already replaced or
    // released must not knock the current capture offline.
    if (!this.input || !this.input.stream.getTracks().includes(track)) return;
    await this.releaseInput(AudioInputStatusCode.streamEnded, "stream-ended");
  }

  // Clears the native active count first, so no audio callback can read a source
  // that is about to be disconnected, then releases the media resources and
  // leaves the output callback and AudioContext untouched. Used inside the
  // capture chain, where awaiting the clear keeps it strictly ordered ahead of
  // the disconnect.
  private async releaseInput(statusCode: number, diagnostic: string): Promise<void> {
    if (this.requestedInputChannels <= 0) return;
    this.inputStatusCode = statusCode;
    this.inputDiagnostic = diagnostic;
    try {
      await this.worker.clearAudioInputSource?.(statusCode);
    } catch {
      // A destroyed or unavailable runtime cannot hold the media resources open.
    }
    this.releaseCaptureResources();
  }

  // The same release with the same clear-then-disconnect-then-stop order, done
  // without yielding. A host that has no synchronous clear still gets the media
  // released here and the native clear queued behind it -- late, but not lost.
  private releaseInputNow(statusCode: number, diagnostic: string): void {
    if (this.requestedInputChannels <= 0) return;
    this.inputStatusCode = statusCode;
    this.inputDiagnostic = diagnostic;
    let cleared = false;
    try {
      if (this.worker.clearAudioInputSourceNow) {
        this.worker.clearAudioInputSourceNow(statusCode);
        cleared = true;
      }
    } catch {
      // A destroyed or unavailable runtime cannot hold the media resources open.
      cleared = true;
    }
    if (!cleared) {
      void this.serializeInputWork(async () => {
        try {
          await this.worker.clearAudioInputSource?.(statusCode);
        } catch {
          // Same: teardown never fails on account of an absent runtime.
        }
      });
    }
    this.releaseCaptureResources();
  }

  private releaseCaptureResources(): void {
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
