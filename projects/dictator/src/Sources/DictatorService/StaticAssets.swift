import Foundation

enum StaticAssetError: Error
{
    case notFound
}

struct StaticAssetResponse: Sendable
{
    let contentType: String
    let body: Data
}

enum StaticAssets
{
    static let webRootRelativePath = "projects/dictator/src/web"

    static func resolveWebRoot(repoRoot: URL) -> URL
    {
        repoRoot.appendingPathComponent(webRootRelativePath, isDirectory: true)
    }

    static func load(repoRoot: URL, assetPath: String) throws -> StaticAssetResponse
    {
        let normalized = try normalizeAssetPath(assetPath)
        let fileURL = resolveWebRoot(repoRoot: repoRoot).appendingPathComponent(normalized, isDirectory: false)
        guard FileManager.default.fileExists(atPath: fileURL.path) else
        {
            throw StaticAssetError.notFound
        }

        let data = try Data(contentsOf: fileURL)
        return StaticAssetResponse(contentType: contentType(for: normalized), body: data)
    }

    private static func normalizeAssetPath(_ value: String) throws -> String
    {
        let trimmed = value
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\\", with: "/")

        if trimmed.isEmpty || trimmed.hasPrefix("/")
        {
            throw StaticAssetError.notFound
        }

        var components: [String] = []
        for component in trimmed.split(separator: "/", omittingEmptySubsequences: true)
        {
            let part = String(component)
            if part == "."
            {
                continue
            }
            if part == ".."
            {
                throw StaticAssetError.notFound
            }
            components.append(part)
        }

        let normalized = components.joined(separator: "/")
        if normalized.isEmpty
        {
            throw StaticAssetError.notFound
        }
        return normalized
    }

    private static func contentType(for path: String) -> String
    {
        let lower = path.lowercased()
        if lower.hasSuffix(".html")
        {
            return "text/html; charset=utf-8"
        }
        if lower.hasSuffix(".css")
        {
            return "text/css; charset=utf-8"
        }
        if lower.hasSuffix(".js")
        {
            return "application/javascript; charset=utf-8"
        }
        if lower.hasSuffix(".json")
        {
            return "application/json; charset=utf-8"
        }
        if lower.hasSuffix(".svg")
        {
            return "image/svg+xml"
        }
        if lower.hasSuffix(".png")
        {
            return "image/png"
        }
        return "application/octet-stream"
    }
}
