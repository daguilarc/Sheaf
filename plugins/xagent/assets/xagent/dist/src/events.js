export const harnessNames = ["codex", "pi", "cursor", "claude_code"];
export const outputModes = ["subagent", "full"];
export const thinkingLevels = ["low", "medium", "high", "xhigh"];
export const roles = ["assistant", "user", "system", "tool"];
export const statusLevels = ["info", "warning", "error"];
export class EventSequencer {
    runId;
    clock;
    #sequence = 0;
    constructor(runId, clock = () => new Date()) {
        this.runId = runId;
        this.clock = clock;
    }
    stamp(event) {
        this.#sequence += 1;
        return {
            ...event,
            schema_version: 1,
            run_id: this.runId,
            sequence: this.#sequence,
            timestamp: this.clock().toISOString(),
        };
    }
}
//# sourceMappingURL=events.js.map