import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { FindRepositoryRoot, GetDefaultSheafChatPaths, } from "./repo_paths.js";
export const x_defaultAgentIdleOffloadSeconds = 300;
export class ConfigLoadError extends Error {
    constructor(message) {
        super(message);
        this.name = "ConfigLoadError";
    }
}
function RequireRepoRoot(repoRoot) {
    const resolved = repoRoot ?? FindRepositoryRoot();
    if (resolved === undefined) {
        throw new ConfigLoadError("repository root not found");
    }
    return resolved;
}
async function FileExists(filePath) {
    try {
        await access(filePath);
        return true;
    }
    catch {
        return false;
    }
}
function ParseOptionalString(value) {
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function ResolveLocalInferenceUrl(globalConfig) {
    const nested = globalConfig.sheaf_chat?.local_inference_url;
    const topLevel = globalConfig.local_inference_url;
    return ParseOptionalString(nested ?? topLevel);
}
function ResolveAgentIdleOffloadSeconds(globalConfig) {
    const nested = globalConfig.sheaf_chat?.agent_idle_offload_seconds;
    const topLevel = globalConfig.agent_idle_offload_seconds;
    const value = nested ?? topLevel;
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        return Math.floor(value);
    }
    return x_defaultAgentIdleOffloadSeconds;
}
export async function LoadSheafChatConfig(options = {}) {
    const repoRoot = RequireRepoRoot(options.repoRoot);
    const paths = GetDefaultSheafChatPaths(repoRoot);
    const globalConfigPath = options.globalConfigPath ?? paths.globalConfigFile;
    const apiKeysPath = options.apiKeysPath ?? paths.apiKeysFile;
    let globalConfig = {};
    if (await FileExists(globalConfigPath)) {
        const raw = await readFile(globalConfigPath, "utf8");
        globalConfig = JSON.parse(raw);
    }
    let apiKeys = {};
    if (await FileExists(apiKeysPath)) {
        const raw = await readFile(apiKeysPath, "utf8");
        apiKeys = JSON.parse(raw);
    }
    const localInferenceUrl = ResolveLocalInferenceUrl(globalConfig);
    const localInferenceApiKey = ParseOptionalString(apiKeys.local_inference_api_key);
    const localInferenceAvailable = localInferenceUrl !== null && localInferenceApiKey !== null;
    return {
        repoRoot,
        paths,
        localInferenceUrl,
        localInferenceApiKey,
        agentIdleOffloadSeconds: ResolveAgentIdleOffloadSeconds(globalConfig),
        localInferenceAvailable,
    };
}
export function BuildLocalModelMetadata(config, modelId = "local-default") {
    return {
        provider: "local",
        id: modelId,
        displayName: modelId,
        available: config.localInferenceAvailable,
    };
}
export function ResolveConfigDirectory(repoRoot) {
    return path.join(repoRoot, "config");
}
//# sourceMappingURL=config.js.map