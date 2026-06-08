import type { ModelMetadata } from "../shared/types.js";
import { type SheafChatPaths } from "./repo_paths.js";
export declare const x_defaultAgentIdleOffloadSeconds = 300;
export interface GlobalConfigFile {
    local_inference_url?: string;
    agent_idle_offload_seconds?: number;
    sheaf_chat?: {
        local_inference_url?: string;
        agent_idle_offload_seconds?: number;
    };
}
export interface ApiKeysFile {
    local_inference_api_key?: string;
    openai_api_key?: string;
}
export interface SheafChatConfig {
    repoRoot: string;
    paths: SheafChatPaths;
    localInferenceUrl: string | null;
    localInferenceApiKey: string | null;
    agentIdleOffloadSeconds: number;
    localInferenceAvailable: boolean;
}
export interface LoadSheafChatConfigOptions {
    repoRoot?: string;
    globalConfigPath?: string;
    apiKeysPath?: string;
}
export declare class ConfigLoadError extends Error {
    constructor(message: string);
}
export declare function LoadSheafChatConfig(options?: LoadSheafChatConfigOptions): Promise<SheafChatConfig>;
export declare function BuildLocalModelMetadata(config: SheafChatConfig, modelId?: string): ModelMetadata;
export declare function ResolveConfigDirectory(repoRoot: string): string;
//# sourceMappingURL=config.d.ts.map