import Foundation

public struct SecretsFile: Codable, Sendable, Equatable {
    public let openai_api_key: String

    public init(openai_api_key: String = "") {
        self.openai_api_key = openai_api_key
    }
}

public struct SecretsStore: SecretStore, Sendable {
    public let fileURL: URL

    public init(
        fileURL: URL = Self.defaultFileURL()
    ) {
        self.fileURL = fileURL
    }

    public static func defaultFileURL(
        currentDirectoryPath: String = FileManager.default.currentDirectoryPath,
        fileManager: FileManager = .default
    ) -> URL {
        let cwd = URL(fileURLWithPath: currentDirectoryPath, isDirectory: true)
        let direct = cwd.appendingPathComponent("Config/secrets.json")
        if fileManager.fileExists(atPath: direct.deletingLastPathComponent().path) {
            return direct
        }

        let nested = cwd.appendingPathComponent("apps/dictator-main/Config/secrets.json")
        if fileManager.fileExists(atPath: nested.deletingLastPathComponent().path) {
            return nested
        }

        return direct
    }

    public static func defaultExampleFileURL(
        currentDirectoryPath: String = FileManager.default.currentDirectoryPath,
        fileManager: FileManager = .default
    ) -> URL {
        let cwd = URL(fileURLWithPath: currentDirectoryPath, isDirectory: true)
        let direct = cwd.appendingPathComponent("Config/secrets.example.json")
        if fileManager.fileExists(atPath: direct.deletingLastPathComponent().path) {
            return direct
        }

        let nested = cwd.appendingPathComponent("apps/dictator-main/Config/secrets.example.json")
        if fileManager.fileExists(atPath: nested.deletingLastPathComponent().path) {
            return nested
        }

        return direct
    }

    public func load() throws -> SecretsFile? {
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            return nil
        }
        do {
            let data = try Data(contentsOf: fileURL)
            return try JSONDecoder().decode(SecretsFile.self, from: data)
        } catch {
            throw DictatorError.configUpdateFailed("invalid secrets file: \(error)")
        }
    }

    public func getOpenAIKey() throws -> String? {
        guard let loaded = try load() else {
            return nil
        }
        let trimmed = loaded.openai_api_key.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    public func setOpenAIKey(_ key: String) throws {
        _ = key
        throw DictatorError.configUpdateFailed("secrets file is read-only")
    }

    public func clearOpenAIKey() throws {
        throw DictatorError.configUpdateFailed("secrets file is read-only")
    }
}
