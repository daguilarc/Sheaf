import { randomUUID } from "node:crypto";
export const x_chatEnvelopeVersion = 1;
export function CreateChatEnvelope(input) {
    const envelope = {
        v: x_chatEnvelopeVersion,
        kind: input.kind,
        id: input.id ?? randomUUID(),
        pile: input.pile,
        sessionId: input.sessionId,
        timestamp: input.timestamp ?? new Date().toISOString(),
    };
    if (input.clientId !== undefined) {
        envelope.clientId = input.clientId;
    }
    if (input.sequence !== undefined) {
        envelope.sequence = input.sequence;
    }
    if (input.payload !== undefined) {
        envelope.payload = input.payload;
    }
    return envelope;
}
//# sourceMappingURL=envelope.js.map