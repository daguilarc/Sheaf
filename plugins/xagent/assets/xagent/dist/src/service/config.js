import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDefaultLogRoot } from "../logs.js";
export const XAGENT_SERVICE_NAME = "xagent";
export const XAGENT_DEFAULT_BIND_PORT = 9005;
export const XAGENT_DEFAULT_BIND_HOST = "127.0.0.1";
// Service-side HTTP timeouts shared between the server (so it can apply them
// to the underlying http.Server) and the client (so it can cap individual
// MCP await POSTs below the same ceiling). Kept here rather than in
// server.ts so the client-only plugin asset bundle — which excludes the
// full server module — can import the constant without pulling in the
// entire supervised service.
//
export const x_ServiceRequestTimeoutMs = 7_200_000;
export const x_ServiceHeadersTimeoutMs = 7_270_000;
export function findSheafRoot(startDir) {
    let current = resolve(startDir);
    while (true) {
        if (existsSync(join(current, "config", "services.json"))
            && existsSync(join(current, "structure"))) {
            return current;
        }
        const parent = dirname(current);
        if (parent === current) {
            throw new Error(`Sheaf root not found from ${startDir}`);
        }
        current = parent;
    }
}
export function resolveXagentLogRoot(repoRoot) {
    return getDefaultLogRoot(repoRoot);
}
export async function loadXagentServiceConfig(options = {}) {
    const servicesJsonPath = options.servicesJsonPath
        ?? join(findSheafRoot(options.startDir ?? process.cwd()), "config", "services.json");
    const services = await readServiceRegistry(servicesJsonPath);
    const entry = services.find((service) => service.name === XAGENT_SERVICE_NAME);
    if (entry === undefined) {
        throw new Error(`"${XAGENT_SERVICE_NAME}" service is not registered in ${servicesJsonPath}`);
    }
    if (!isLoopbackHost(entry.host)) {
        throw new Error(`"${XAGENT_SERVICE_NAME}" service must bind to loopback; found ${entry.host}`);
    }
    const repoRoot = dirname(dirname(servicesJsonPath));
    return {
        repoRoot,
        bindHost: entry.host,
        bindPort: entry.port,
        command: entry.command,
        logRoot: resolveXagentLogRoot(repoRoot),
    };
}
async function readServiceRegistry(servicesJsonPath) {
    const raw = await readFile(servicesJsonPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
        throw new Error(`Service registry ${servicesJsonPath} must be a JSON array`);
    }
    return parsed.map((entry, index) => {
        if (!isRecord(entry) || typeof entry.name !== "string" || typeof entry.host !== "string" || !Number.isInteger(entry.port) || typeof entry.command !== "string") {
            throw new Error(`Invalid service registry entry at index ${index} in ${servicesJsonPath}`);
        }
        return {
            name: entry.name,
            host: entry.host,
            port: entry.port,
            command: entry.command,
        };
    });
}
function isLoopbackHost(host) {
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function defaultStartDir() {
    return dirname(fileURLToPath(import.meta.url));
}
//# sourceMappingURL=config.js.map