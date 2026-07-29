import type { SupervisionScheduler } from "../supervision/types.js";
export declare const x_AwaitLivenessPingIntervalMs = 30000;
export type AwaitLivenessProgressNotification = {
    readonly method: "notifications/progress";
    readonly params: {
        readonly progressToken: string | number;
        readonly progress: number;
        readonly message: string;
    };
};
export type AwaitLivenessPingOptions = {
    readonly progressToken: string | number;
    readonly intervalMs: number;
    readonly isVouching: () => boolean;
    readonly sendNotification: (notification: AwaitLivenessProgressNotification) => Promise<void>;
    readonly signal: AbortSignal;
    readonly scheduler?: SupervisionScheduler;
};
export declare function StartAwaitLivenessPings(options: AwaitLivenessPingOptions): () => void;
//# sourceMappingURL=await_liveness.d.ts.map