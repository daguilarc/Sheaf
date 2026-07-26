export declare const XAGENT_SERVICE_NAME = "xagent";
export declare const XAGENT_DEFAULT_BIND_PORT = 9005;
export declare const XAGENT_DEFAULT_BIND_HOST = "127.0.0.1";
export type XagentServiceConfig = {
    readonly repoRoot: string;
    readonly bindHost: string;
    readonly bindPort: number;
    readonly command: string;
    readonly logRoot: string;
};
export type LoadXagentServiceConfigOptions = {
    readonly startDir?: string;
    readonly servicesJsonPath?: string;
};
export declare function findSheafRoot(startDir: string): string;
export declare function resolveXagentLogRoot(repoRoot: string): string;
export declare function loadXagentServiceConfig(options?: LoadXagentServiceConfigOptions): Promise<XagentServiceConfig>;
export declare function defaultStartDir(): string;
//# sourceMappingURL=config.d.ts.map