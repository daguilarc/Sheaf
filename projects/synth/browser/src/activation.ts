import type { MidiAccess, MidiPort } from "./midi.js";

export type ActivationResources = Readonly<{
  audioContext: AudioContext;
  midiAccess: MidiAccess;
}>;

export type ActivationLeaseOptions = Readonly<{
  audioContextFactory?: () => AudioContext;
  requestMIDIAccess?: (options: { sysex: true }) => Promise<MidiAccess>;
}>;

function closeMidiAccess(access: MidiAccess): void {
  access.onstatechange = null;
  const ports = new Set<MidiPort>([
    ...access.inputs.values(),
    ...access.outputs.values(),
  ]);
  for (const port of ports) {
    try {
      void port.close?.();
    } catch {
      // Teardown is best-effort across browser and test MIDI port implementations.
    }
  }
}

export class ActivationLease {
  private consumed = false;
  private disposed = false;
  private readonly resources: Promise<ActivationResources>;

  private constructor(
    private readonly audioContext: AudioContext,
    private readonly midiAccess: Promise<MidiAccess>,
    audioReady: Promise<void>,
  ) {
    this.resources = Promise.all([audioReady, midiAccess]).then(([, access]) => Object.freeze({
      audioContext,
      midiAccess: access,
    }));
    void this.resources.catch(() => this.dispose());
  }

  static acquire(options: ActivationLeaseOptions = {}): ActivationLease {
    const audioContext = options.audioContextFactory?.() ?? new AudioContext();
    let audioReady: Promise<void>;
    try {
      audioReady = Promise.resolve(audioContext.resume());
    } catch (error) {
      audioReady = Promise.reject(error);
    }

    let midiAccess: Promise<MidiAccess>;
    try {
      midiAccess = options.requestMIDIAccess
        ? Promise.resolve(options.requestMIDIAccess({ sysex: true }))
        : Promise.resolve(navigator.requestMIDIAccess({ sysex: true }) as unknown as Promise<MidiAccess>);
    } catch (error) {
      midiAccess = Promise.reject(error);
    }
    return new ActivationLease(audioContext, midiAccess, audioReady);
  }

  async consume(): Promise<ActivationResources> {
    if (this.consumed) throw new Error("activation lease has already been consumed");
    if (this.disposed) throw new Error("activation lease has been disposed");
    this.consumed = true;
    try {
      const resources = await this.resources;
      if (this.disposed) throw new Error("activation lease has been disposed");
      return resources;
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      void this.audioContext.close();
    } catch {
      // A rejected close cannot restore a failed or unloaded application session.
    }
    void this.midiAccess.then(closeMidiAccess, () => {});
  }
}
