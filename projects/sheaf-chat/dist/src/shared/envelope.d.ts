export declare const x_chatEnvelopeVersion = 1;
export interface ChatEnvelope {
    v: typeof x_chatEnvelopeVersion;
    kind: string;
    id: string;
    pile: string;
    sessionId: string;
    clientId?: string;
    sequence?: number;
    timestamp: string;
    payload?: unknown;
}
export interface CreateChatEnvelopeInput {
    kind: string;
    pile: string;
    sessionId: string;
    clientId?: string;
    sequence?: number;
    payload?: unknown;
    id?: string;
    timestamp?: string;
}
export declare function CreateChatEnvelope(input: CreateChatEnvelopeInput): ChatEnvelope;
//# sourceMappingURL=envelope.d.ts.map