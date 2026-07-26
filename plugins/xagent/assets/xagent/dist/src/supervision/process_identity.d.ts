import type { OwnedProcessIdentity } from "../adapters/types.js";
export type ProcessInspection = {
    readonly pid: number;
    readonly process_group_id?: number;
    readonly start_identity: string;
};
export type ProcessInspector = {
    inspect(pid: number): Promise<ProcessInspection | undefined>;
    terminateProcessGroup(processGroupId: number): Promise<void>;
};
export declare const platformProcessInspector: ProcessInspector;
export declare function captureOwnedProcessIdentity(pid: number, clock?: () => Date): OwnedProcessIdentity | undefined;
//# sourceMappingURL=process_identity.d.ts.map