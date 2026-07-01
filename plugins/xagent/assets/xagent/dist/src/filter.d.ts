import type { OutputEvent, OutputMode } from "./events.js";
export type FilterClock = {
    now(): number;
};
export type OutputFilterOptions = {
    readonly mode: OutputMode;
    readonly clock?: FilterClock;
    readonly deltaIntervalMs?: number;
};
export declare class OutputFilter {
    #private;
    constructor(options: OutputFilterOptions);
    handle(event: OutputEvent): OutputEvent[];
    flush(): OutputEvent[];
}
export declare function createOutputFilter(options: OutputFilterOptions): OutputFilter;
//# sourceMappingURL=filter.d.ts.map