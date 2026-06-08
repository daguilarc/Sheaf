import { readFile } from "node:fs/promises";
export async function LoadServiceRegistry(servicesJsonPath) {
    const raw = await readFile(servicesJsonPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
        throw new Error("services.json must contain an array");
    }
    return parsed;
}
export function FindServiceByName(services, serviceName) {
    return services.find((service) => service.name === serviceName);
}
//# sourceMappingURL=service_registry.js.map