import Foundation

public enum SheafRootDiscovery
{
    public static let servicesConfigRelativePath = "config/services.json"
    public static let dictatorProjectRelativePath = "projects/dictator"

    public enum DiscoveryError: Error, Equatable, Sendable
    {
        case repoRootNotFound(startingPath: String)
    }

    public static func isSheafRepoRoot(_ url: URL, fileManager: FileManager = .default) -> Bool
    {
        let standardized = url.standardizedFileURL
        let servicesPath = standardized
            .appendingPathComponent(servicesConfigRelativePath, isDirectory: false)
            .path
        let dictatorProjectPath = standardized
            .appendingPathComponent(dictatorProjectRelativePath, isDirectory: true)
            .path

        return fileManager.fileExists(atPath: servicesPath)
            && fileManager.fileExists(atPath: dictatorProjectPath)
    }

    public static func findRepoRoot(
        startingAt startURL: URL? = nil,
        fileManager: FileManager = .default,
        maxDepth: Int = 12
    ) -> URL?
    {
        let initial = (startURL ?? URL(
            fileURLWithPath: FileManager.default.currentDirectoryPath,
            isDirectory: true
        )).standardizedFileURL

        var current = initial
        for _ in 0..<maxDepth
        {
            if isSheafRepoRoot(current, fileManager: fileManager)
            {
                return current
            }

            let parent = current.deletingLastPathComponent()
            if parent.path == current.path
            {
                break
            }
            current = parent
        }

        return nil
    }

    public static func requireRepoRoot(
        startingAt startURL: URL? = nil,
        fileManager: FileManager = .default
    ) throws -> URL
    {
        let startingPath = (startURL ?? URL(
            fileURLWithPath: FileManager.default.currentDirectoryPath,
            isDirectory: true
        )).standardizedFileURL.path

        guard let repoRoot = findRepoRoot(startingAt: startURL, fileManager: fileManager) else
        {
            throw DiscoveryError.repoRootNotFound(startingPath: startingPath)
        }

        return repoRoot
    }
}
