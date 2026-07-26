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
    interruptCount = 0;
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
    processIdentity;
    interrupt;
    #closed = false;
    constructor(adapter) {
        this.adapter = adapter;
        this.processIdentity = adapter.options.processIdentity;
        if (adapter.options.supportsInterrupt === true) {
            this.interrupt = async () => {
                this.adapter.interruptCount += 1;
            };
        }
    }
    async *submit(context) {
        if (this.#closed) {
            throw new Error("Harness session is closed.");
        }
        this.adapter.submittedTexts.push(context.text);
        this.adapter.submittedContexts.push(context);
        const scriptedEvents = this.adapter.options.scriptedEvents?.[context.inputSequence - 1];
        if (scriptedEvents !== undefined) {
            for await (const event of scriptedEvents) {
                yield event;
            }
            return;
        }
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
        if (this.#closed) {
            return;
        }
        this.#closed = true;
        this.adapter.closeCount += 1;
    }
}
//# sourceMappingURL=fake.js.map