import type { HarnessName } from "../events.js";
import type { HarnessAdapter, HarnessCapabilities, HarnessSession, HarnessStartOptions } from "./types.js";

export class PlaceholderHarnessAdapter implements HarnessAdapter {
  readonly capabilities: HarnessCapabilities = {
    forwardsModel: false,
    forwardsThinkingLevel: false,
    streamsDeltas: false,
  };

  constructor(readonly harness: HarnessName) {}

  async start(_options: HarnessStartOptions): Promise<HarnessSession> {
    const error = new Error(`${this.harness} adapter is not implemented yet.`);
    Object.assign(error, { code: "harness_unavailable" });
    throw error;
  }
}
