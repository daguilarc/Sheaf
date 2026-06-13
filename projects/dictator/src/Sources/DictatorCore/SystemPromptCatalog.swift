import Foundation

public struct SystemPromptCatalog {
    public enum EntryKind: Sendable, Equatable {
        case directory
        case file
    }

    public struct Entry: Sendable, Equatable {
        public let name: String
        public let relativePath: String
        public let kind: EntryKind

        public init(name: String, relativePath: String, kind: EntryKind) {
            self.name = name
            self.relativePath = relativePath
            self.kind = kind
        }
    }

    public static let defaultPromptFile = "intent_refiner_v1.md"
    public static let defaultReviewPromptFile = "code_review_refiner_v1.md"

    private let directoryURL: URL
    private let fileManager: FileManager

    public init(
        directoryURL: URL = Self.defaultDirectoryURL(),
        fileManager: FileManager = .default
    ) {
        self.directoryURL = directoryURL
        self.fileManager = fileManager
    }

    public static let defaultRelativeDirectory = "projects/dictator/src/prompts/system-prompts"

    public static func defaultDirectoryURL(
        currentDirectoryPath: String = FileManager.default.currentDirectoryPath,
        fileManager: FileManager = .default
    ) -> URL {
        let cwd = URL(fileURLWithPath: currentDirectoryPath, isDirectory: true)
        if let repoRoot = SheafRootDiscovery.findRepoRoot(startingAt: cwd, fileManager: fileManager) {
            let repoCandidate = repoRoot.appendingPathComponent(defaultRelativeDirectory, isDirectory: true)
            if fileManager.fileExists(atPath: repoCandidate.path) {
                return repoCandidate
            }
        }

        let direct = cwd.appendingPathComponent(defaultRelativeDirectory, isDirectory: true)
        if fileManager.fileExists(atPath: direct.path) {
            return direct
        }

        let legacy = cwd.appendingPathComponent("prompts/system-prompts", isDirectory: true)
        if fileManager.fileExists(atPath: legacy.path) {
            return legacy
        }

        return direct
    }

    public func listPromptFiles() throws -> [String] {
        guard fileManager.fileExists(atPath: directoryURL.path) else {
            return [Self.defaultPromptFile]
        }

        let enumerator = fileManager.enumerator(
            at: directoryURL,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        )

        var files: [String] = []
        while let url = enumerator?.nextObject() as? URL {
            let values = try url.resourceValues(forKeys: [.isRegularFileKey])
            guard values.isRegularFile == true else {
                continue
            }
            files.append(relativePath(for: url))
        }

        let sorted = files.sorted()
        return sorted.isEmpty ? [Self.defaultPromptFile] : sorted
    }

    public func listEntries(in relativeDirectory: String = "") throws -> [Entry] {
        let normalizedDirectory = try normalizeRelativePath(relativeDirectory, allowEmpty: true)
        let baseURL = normalizedDirectory.isEmpty
            ? directoryURL
            : directoryURL.appendingPathComponent(normalizedDirectory, isDirectory: true)

        var isDirectory: ObjCBool = false
        guard fileManager.fileExists(atPath: baseURL.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            throw DictatorError.configUpdateFailed("system prompt directory not found: \(normalizedDirectory)")
        }

        let urls = try fileManager.contentsOfDirectory(
            at: baseURL,
            includingPropertiesForKeys: [.isDirectoryKey, .isRegularFileKey],
            options: [.skipsHiddenFiles]
        )

        let entries = try urls.compactMap { url -> Entry? in
            let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isRegularFileKey])
            if values.isDirectory == true {
                return Entry(
                    name: url.lastPathComponent,
                    relativePath: relativePath(for: url),
                    kind: .directory
                )
            }
            if values.isRegularFile == true {
                return Entry(
                    name: url.lastPathComponent,
                    relativePath: relativePath(for: url),
                    kind: .file
                )
            }
            return nil
        }

        return entries.sorted { lhs, rhs in
            if lhs.kind != rhs.kind {
                return lhs.kind == .directory
            }
            return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
        }
    }

    public func loadPrompt(named relativePath: String) throws -> String {
        let normalized = try normalizeRelativePath(relativePath, allowEmpty: false)
        let path = directoryURL.appendingPathComponent(normalized)
        let content = try String(contentsOf: path, encoding: .utf8)
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw DictatorError.configUpdateFailed("system prompt file is empty: \(normalized)")
        }
        return trimmed
    }

    public func resolvePrompt(named relativePath: String) -> String {
        do {
            return try loadPrompt(named: relativePath)
        } catch {
            return RefinementPromptBuilder.fallbackInstructions
        }
    }

    public func sanitizeRelativePath(_ value: String) -> String {
        do {
            let normalized = try normalizeRelativePath(value, allowEmpty: true)
            return normalized.isEmpty ? Self.defaultPromptFile : normalized
        } catch {
            return Self.defaultPromptFile
        }
    }

    private func normalizeRelativePath(_ value: String, allowEmpty: Bool) throws -> String {
        let trimmed = value
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\\", with: "/")

        if trimmed.isEmpty {
            if allowEmpty {
                return ""
            }
            throw DictatorError.configUpdateFailed("system prompt path cannot be empty")
        }

        if trimmed.hasPrefix("/") {
            throw DictatorError.configUpdateFailed("system prompt path must be relative")
        }

        var components: [String] = []
        for component in trimmed.split(separator: "/", omittingEmptySubsequences: true) {
            let part = String(component)
            if part == "." {
                continue
            }
            if part == ".." {
                guard !components.isEmpty else {
                    throw DictatorError.configUpdateFailed("system prompt path escapes prompt directory")
                }
                components.removeLast()
                continue
            }
            components.append(part)
        }

        let normalized = components.joined(separator: "/")
        if normalized.isEmpty {
            if allowEmpty {
                return ""
            }
            throw DictatorError.configUpdateFailed("system prompt path cannot be empty")
        }
        return normalized
    }

    private func relativePath(for url: URL) -> String {
        let basePath = directoryURL.standardizedFileURL.path
        let absolutePath = url.standardizedFileURL.path
        let prefix = basePath.hasSuffix("/") ? basePath : basePath + "/"
        if absolutePath.hasPrefix(prefix) {
            return String(absolutePath.dropFirst(prefix.count))
        }
        return url.lastPathComponent
    }
}
