import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const x_globalConfigRelative = "config/global_config.json";
const x_apiKeysRelative = "config/api_keys.json";
const x_servicesJsonRelative = "config/services.json";
const x_dataDirRelative = "data/sheaf-chat";
const x_sessionsDirRelative = "data/sheaf-chat/sessions";
const x_authDirRelative = "data/sheaf-chat/auth";
const x_moduleDir = typeof __dirname === "string"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));
export function FindRepositoryRoot(startPath) {
    const startDir = path.resolve(startPath ?? process.cwd());
    let current = startDir;
    while (current !== path.dirname(current)) {
        const servicesJsonPath = path.join(current, "config", "services.json");
        const structureDir = path.join(current, "structure");
        if (existsSync(servicesJsonPath) && existsSync(structureDir)) {
            return current;
        }
        current = path.dirname(current);
    }
    return undefined;
}
export function ResolveRepositoryPath(relativePath, root) {
    const repoRoot = root ?? FindRepositoryRoot(x_moduleDir) ?? FindRepositoryRoot();
    if (repoRoot === undefined) {
        throw new Error("repository root not found");
    }
    return path.join(repoRoot, relativePath);
}
export function GetDefaultSheafChatPaths(root) {
    const repoRoot = root ?? FindRepositoryRoot(x_moduleDir) ?? FindRepositoryRoot();
    if (repoRoot === undefined) {
        throw new Error("repository root not found");
    }
    return {
        globalConfigFile: path.join(repoRoot, x_globalConfigRelative),
        apiKeysFile: path.join(repoRoot, x_apiKeysRelative),
        servicesJsonFile: path.join(repoRoot, x_servicesJsonRelative),
        dataDir: path.join(repoRoot, x_dataDirRelative),
        sessionsDir: path.join(repoRoot, x_sessionsDirRelative),
        authDir: path.join(repoRoot, x_authDirRelative),
    };
}
export { x_apiKeysRelative, x_authDirRelative, x_dataDirRelative, x_globalConfigRelative, x_servicesJsonRelative, x_sessionsDirRelative, };
//# sourceMappingURL=repo_paths.js.map