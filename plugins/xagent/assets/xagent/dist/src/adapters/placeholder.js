export class PlaceholderHarnessAdapter {
    harness;
    capabilities = {
        forwardsModel: false,
        forwardsThinkingLevel: false,
        streamsDeltas: false,
    };
    constructor(harness) {
        this.harness = harness;
    }
    async start(_options) {
        const error = new Error(`${this.harness} adapter is not implemented yet.`);
        Object.assign(error, { code: "harness_unavailable" });
        throw error;
    }
}
//# sourceMappingURL=placeholder.js.map