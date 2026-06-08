export const x_pileNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const x_sessionIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const x_reservedNames = new Set([".", ".."]);
export function IsValidPileName(name) {
    if (name.length === 0 || x_reservedNames.has(name)) {
        return false;
    }
    if (name.includes("/") || name.includes("\\")) {
        return false;
    }
    return x_pileNamePattern.test(name);
}
export function IsValidSessionId(sessionId) {
    if (sessionId.length === 0 || x_reservedNames.has(sessionId)) {
        return false;
    }
    if (sessionId.includes("/") || sessionId.includes("\\")) {
        return false;
    }
    return x_sessionIdPattern.test(sessionId);
}
//# sourceMappingURL=validation.js.map