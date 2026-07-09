import type { MidiAction, MidiEndpoint, MidiOutput } from "./protocol.js";
import type { RuntimeCommand, RuntimeResponse } from "./worker.js";

export interface BrowserMidiRuntime {
  submitEndpoints(endpoints: MidiEndpoint[]): Promise<MidiAction[]>;
  deliverMidi(controllerIx: number, bytes: number[], timestampMicros: number): Promise<void>;
  dequeueMidiOutput(): Promise<MidiOutput | undefined>;
}

export class BrowserMidiWorkerRuntime implements BrowserMidiRuntime {
  constructor(private readonly request: (command: RuntimeCommand) => Promise<RuntimeResponse>) {}

  async submitEndpoints(endpoints: MidiEndpoint[]): Promise<MidiAction[]> {
    const response = await this.request({ type: "midi-endpoints", endpoints });
    if (response.type !== "midi-actions") throw new Error("runtime rejected MIDI endpoint snapshot");
    return response.actions;
  }

  async deliverMidi(controllerIx: number, bytes: number[], timestampMicros: number): Promise<void> {
    const response = await this.request({ type: "midi-input", controllerIx, bytes, timestampMicros });
    if (response.type !== "ok") throw new Error("runtime rejected MIDI bytes");
  }

  async dequeueMidiOutput(): Promise<MidiOutput | undefined> {
    const response = await this.request({ type: "drain-midi-output" });
    if (response.type !== "midi-output") throw new Error("runtime rejected MIDI output drain");
    return response.output;
  }
}

type MidiMessage = { data: Uint8Array; timeStamp: number };
type MidiInputPort = { id: string; name?: string | null; state?: string; onmidimessage: ((message: MidiMessage) => void) | null };
type MidiOutputPort = { id: string; name?: string | null; state?: string; send(bytes: number[] | Uint8Array): void };
type MidiAccess = {
  inputs: { values(): IterableIterator<MidiInputPort> };
  outputs: { values(): IterableIterator<MidiOutputPort> };
  onstatechange: ((event: unknown) => void) | null;
};

export type BrowserMidiStatus = "offline" | "requesting" | "online";
export type BrowserMidiStartResult = { status: BrowserMidiStatus; reason?: string };
export type BrowserMidiManagerOptions = {
  requestMIDIAccess?: (options: { sysex: true }) => Promise<MidiAccess>;
  setInterval?: (handler: () => void, milliseconds: number) => ReturnType<typeof setInterval>;
  clearInterval?: (handle: ReturnType<typeof setInterval>) => void;
  pollIntervalMs?: number;
  nowMicros?: () => number;
};

type InputBinding = { identifier: string; port: MidiInputPort; handler: (message: MidiMessage) => void };
type OutputBinding = { identifier: string; port: MidiOutputPort };

export class BrowserMidiManager {
  private access: MidiAccess | undefined;
  private statusValue: BrowserMidiStatus = "offline";
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly inputs = new Map<number, InputBinding>();
  private readonly outputs = new Map<number, OutputBinding>();
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly runtime: BrowserMidiRuntime, private readonly options: BrowserMidiManagerOptions = {}) {}

  status(): BrowserMidiStatus { return this.statusValue; }

  async startFromUserActivation(): Promise<BrowserMidiStartResult> {
    if (this.access) return { status: this.statusValue };
    this.statusValue = "requesting";
    try {
      this.access = this.options.requestMIDIAccess
        ? await this.options.requestMIDIAccess({ sysex: true })
        : await (navigator.requestMIDIAccess({ sysex: true }) as unknown as Promise<MidiAccess>);
      this.access.onstatechange = () => { void this.poll(); };
      const schedule = this.options.setInterval ?? setInterval;
      this.timer = schedule(() => { void this.poll(); }, this.options.pollIntervalMs ?? 500);
      await this.poll();
      this.statusValue = "online";
      return { status: this.statusValue };
    } catch (error) {
      this.statusValue = "offline";
      return { status: this.statusValue, reason: error instanceof Error ? error.message : "Web MIDI unavailable" };
    }
  }

  poll(): Promise<void> {
    if (!this.access) return Promise.resolve();
    const next = this.queue.then(() => this.reconcile(), () => this.reconcile());
    this.queue = next.catch(() => {});
    return next;
  }

  async drainOutputs(): Promise<void> {
    for (let count = 0; count < 256; count++) {
      const output = await this.runtime.dequeueMidiOutput();
      if (!output) return;
      this.outputs.get(output.controllerIx)?.port.send(output.bytes);
    }
  }

  stop(): void {
    if (this.timer !== undefined) {
      (this.options.clearInterval ?? clearInterval)(this.timer);
      this.timer = undefined;
    }
    if (this.access) this.access.onstatechange = null;
    for (const controllerIx of this.inputs.keys()) this.closeInput(controllerIx);
    this.outputs.clear();
    this.access = undefined;
    this.statusValue = "offline";
  }

  private async reconcile(): Promise<void> {
    const access = this.access;
    if (!access) return;
    const endpoints: MidiEndpoint[] = [];
    for (const port of access.inputs.values()) {
      if (port.state !== "disconnected") endpoints.push({ identifier: port.id, name: port.name ?? "", kind: "input" });
    }
    for (const port of access.outputs.values()) {
      if (port.state !== "disconnected") endpoints.push({ identifier: port.id, name: port.name ?? "", kind: "output" });
    }
    const actions = await this.runtime.submitEndpoints(endpoints);
    for (const action of actions) this.applyAction(action, access);
    await this.drainOutputs();
  }

  private applyAction(action: MidiAction, access: MidiAccess): void {
    switch (action.type) {
      case "open-input": {
        const port = this.inputFor(access, action.identifier);
        if (!port) return;
        const existing = this.inputs.get(action.controllerIx);
        if (existing?.identifier === port.id && existing.port === port) return;
        this.closeInput(action.controllerIx);
        const handler = (message: MidiMessage) => {
          const timestampMicros = Number.isFinite(message.timeStamp) ? Math.round(message.timeStamp * 1000) : (this.options.nowMicros?.() ?? 0);
          void this.runtime.deliverMidi(action.controllerIx, Array.from(message.data), timestampMicros);
        };
        port.onmidimessage = handler;
        this.inputs.set(action.controllerIx, { identifier: port.id, port, handler });
        return;
      }
      case "close-input":
        this.closeInput(action.controllerIx);
        return;
      case "open-output": {
        const port = this.outputFor(access, action.identifier);
        if (port) this.outputs.set(action.controllerIx, { identifier: port.id, port });
        return;
      }
      case "close-output":
        this.outputs.delete(action.controllerIx);
        return;
      case "update-input-ref":
      case "update-output-ref":
      case "resync":
        return;
    }
  }

  private closeInput(controllerIx: number): void {
    const binding = this.inputs.get(controllerIx);
    if (!binding) return;
    if (binding.port.onmidimessage === binding.handler) binding.port.onmidimessage = null;
    this.inputs.delete(controllerIx);
  }

  private inputFor(access: MidiAccess, identifier: string | undefined): MidiInputPort | undefined {
    return [...access.inputs.values()].find((port) => port.id === identifier && port.state !== "disconnected");
  }

  private outputFor(access: MidiAccess, identifier: string | undefined): MidiOutputPort | undefined {
    return [...access.outputs.values()].find((port) => port.id === identifier && port.state !== "disconnected");
  }
}
