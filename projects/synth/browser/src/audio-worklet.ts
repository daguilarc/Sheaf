declare abstract class AudioWorkletProcessor {
  constructor(options?: AudioWorkletNodeOptions);
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
declare function registerProcessor(name: string, processor: new (options: { processorOptions: WorkletBridge }) => AudioWorkletProcessor): void;

type WorkletBridge = { channels: number; capacityFrames: number; samples: SharedArrayBuffer; state: SharedArrayBuffer };

const readFrame = 0;
const availableFrames = 2;
const underflowCount = 3;
const shutdown = 4;

class SynthAudioRingBufferProcessor extends AudioWorkletProcessor {
  private readonly samples: Float32Array;
  private readonly state: Int32Array;
  private readonly channels: number;
  private readonly capacityFrames: number;

  constructor(options: { processorOptions: WorkletBridge }) {
    super(options);
    const bridge = options.processorOptions;
    this.samples = new Float32Array(bridge.samples);
    this.state = new Int32Array(bridge.state);
    this.channels = bridge.channels;
    this.capacityFrames = bridge.capacityFrames;
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (Atomics.load(this.state, shutdown) !== 0) return false;
    const output = outputs[0] ?? [];
    const frameCount = output[0]?.length ?? 0;
    const count = Math.min(frameCount, Atomics.load(this.state, availableFrames));
    const start = Atomics.load(this.state, readFrame);
    for (let channel = 0; channel < output.length; channel++) {
      const target = output[channel];
      const base = (channel % this.channels) * this.capacityFrames;
      for (let frame = 0; frame < target.length; frame++)
        target[frame] = frame < count ? this.samples[base + ((start + frame) % this.capacityFrames)] : 0;
    }
    if (count > 0) {
      Atomics.store(this.state, readFrame, (start + count) % this.capacityFrames);
      Atomics.sub(this.state, availableFrames, count);
    }
    if (count < frameCount) Atomics.add(this.state, underflowCount, 1);
    return true;
  }
}

registerProcessor("synth-audio-ring-buffer", SynthAudioRingBufferProcessor);
