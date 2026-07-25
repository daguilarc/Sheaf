import type { Page } from "@playwright/test";

export const TWISTER_DEVICE_NAME = "Midi Fighter Twister";

type FakeMidiPortKind = "input" | "output";

type FakeMidiPortSnapshot = {
  id: string;
  name: string;
  state: "connected" | "disconnected";
  type: FakeMidiPortKind;
};

type FakeMidiWindow = Window & {
  __controllerWizardMidi?: {
    access: {
      inputs: Map<string, FakeMidiPortSnapshot & { onmidimessage: ((event: { data: Uint8Array; timeStamp: number }) => void) | null }>;
      outputs: Map<string, FakeMidiPortSnapshot & {
        sent: Array<{ bytes: number[]; timestamp?: number }>;
        send(bytes: number[] | Uint8Array, timestamp?: number): void;
        clear(): void;
      }>;
      onstatechange: ((event: { port: FakeMidiPortSnapshot }) => void) | null;
    };
  };
};

export async function installTwisterPair(page: Page, ordinal: number): Promise<void> {
  await page.evaluate(({ ordinal, name }) => {
    const midiWindow = window as FakeMidiWindow;
    midiWindow.__controllerWizardMidi ??= {
      access: { inputs: new Map(), outputs: new Map(), onstatechange: null },
    };
    const input = {
      id: `twister-in-${ordinal}`,
      name,
      state: "connected" as const,
      type: "input" as const,
      onmidimessage: null,
    };
    const output = {
      id: `twister-out-${ordinal}`,
      name,
      state: "connected" as const,
      type: "output" as const,
      sent: [] as Array<{ bytes: number[]; timestamp?: number }>,
      send(bytes: number[] | Uint8Array, timestamp?: number) {
        this.sent.push({ bytes: Array.from(bytes), timestamp });
      },
      clear() {
        this.sent.length = 0;
      },
    };
    const { access } = midiWindow.__controllerWizardMidi;
    access.inputs.set(input.id, input);
    access.outputs.set(output.id, output);
    access.onstatechange?.({ port: input });
    access.onstatechange?.({ port: output });
  }, { ordinal, name: TWISTER_DEVICE_NAME });
}

export async function removeTwisterPair(page: Page, ordinal: number): Promise<void> {
  await page.evaluate((ordinal) => {
    const midiWindow = window as FakeMidiWindow;
    const access = midiWindow.__controllerWizardMidi?.access;
    if (!access) return;
    const input = access.inputs.get(`twister-in-${ordinal}`);
    const output = access.outputs.get(`twister-out-${ordinal}`);
    if (input) {
      input.state = "disconnected";
      access.inputs.delete(input.id);
      access.onstatechange?.({ port: input });
    }
    if (output) {
      output.state = "disconnected";
      access.outputs.delete(output.id);
      access.onstatechange?.({ port: output });
    }
  }, ordinal);
}
