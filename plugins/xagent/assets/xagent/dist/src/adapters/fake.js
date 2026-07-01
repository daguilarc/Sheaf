export class FakeHarnessAdapter {
    options;
    harness = "codex";
    capabilities = {
        forwardsModel: true,
        forwardsThinkingLevel: true,
        streamsDeltas: true,
    };
    submittedTexts = [];
    submittedContexts = [];
    startCount = 0;
    closeCount = 0;
    constructor(options = {}) {
        this.options = options;
    }
    async start(_options) {
        this.startCount += 1;
        return new FakeHarnessSession(this);
    }
}
class FakeHarnessSession {
    adapter;
    providerThreadId = "fake-thread-1";
    constructor(adapter) {
        this.adapter = adapter;
    }
    async *submit(context) {
        this.adapter.submittedTexts.push(context.text);
        this.adapter.submittedContexts.push(context);
        const turnId = context.turnId;
        const messageId = `message_${context.inputSequence}`;
        const toolCallId = `tool_${context.inputSequence}`;
        if (this.adapter.options.includeRawProvider === true) {
            yield {
                type: "raw.provider",
                harness: "codex",
                payload: { event: "fake.raw", text: context.text },
            };
        }
        if (this.adapter.options.includeDeltas === true) {
            yield {
                type: "message.delta",
                turn_id: turnId,
                message_id: messageId,
                role: "assistant",
                delta: `partial ${context.text}`,
            };
        }
        if (this.adapter.options.includeToolEvents === true) {
            yield {
                type: "tool.started",
                turn_id: turnId,
                tool_call_id: toolCallId,
                name: "fake_tool",
                input: { text: context.text },
            };
            yield {
                type: "tool.completed",
                turn_id: turnId,
                tool_call_id: toolCallId,
                name: "fake_tool",
                status: "completed",
                output: { path: `/tmp/fake/${context.text}`, token: "sk-testsecret" },
            };
        }
        const finalText = `fake response to ${context.text}`;
        yield {
            type: "message.completed",
            turn_id: turnId,
            message_id: messageId,
            role: "assistant",
            text: finalText,
        };
        yield {
            type: "turn.completed",
            turn_id: turnId,
            final_text: finalText,
            provider_thread_id: this.providerThreadId,
        };
    }
    async close() {
        this.adapter.closeCount += 1;
    }
}
//# sourceMappingURL=fake.js.map