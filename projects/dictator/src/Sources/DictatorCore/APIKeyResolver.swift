import Foundation

public enum APIKeyResolver {
    public static func resolve(
        fallback: () throws -> String?
    ) rethrows -> String? {
        guard let key = try fallback() else {
            return nil
        }
        return normalized(key)
    }

    public static func resolve(
        primary: () throws -> String?,
        fallback: () throws -> String?
    ) rethrows -> String? {
        if let first = try primary(), let normalizedFirst = normalized(first) {
            return normalizedFirst
        }
        guard let second = try fallback() else {
            return nil
        }
        return normalized(second)
    }

    private static func normalized(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
