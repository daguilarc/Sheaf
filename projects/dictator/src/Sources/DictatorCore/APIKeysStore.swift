import Foundation

public struct APIKeysFile: Codable, Sendable, Equatable
{
    public let openai_api_key: String?

    public init(openai_api_key: String? = nil)
    {
        self.openai_api_key = openai_api_key
    }
}

public struct APIKeysStore: SecretStore, Sendable
{
    public let fileURL: URL

    public init(fileURL: URL = Self.defaultFileURL())
    {
        self.fileURL = fileURL
    }

    public static func defaultFileURL(
        currentDirectoryPath: String = FileManager.default.currentDirectoryPath,
        fileManager: FileManager = .default
    ) -> URL
    {
        let cwd = URL(fileURLWithPath: currentDirectoryPath, isDirectory: true)
        if let repoRoot = SheafRootDiscovery.findRepoRoot(startingAt: cwd, fileManager: fileManager)
        {
            return repoRoot.appendingPathComponent("config/api_keys.json", isDirectory: false)
        }

        return cwd.appendingPathComponent("config/api_keys.json", isDirectory: false)
    }

    public static func defaultExampleFileURL(
        currentDirectoryPath: String = FileManager.default.currentDirectoryPath,
        fileManager: FileManager = .default
    ) -> URL
    {
        let cwd = URL(fileURLWithPath: currentDirectoryPath, isDirectory: true)
        if let repoRoot = SheafRootDiscovery.findRepoRoot(startingAt: cwd, fileManager: fileManager)
        {
            return repoRoot.appendingPathComponent("config/api_keys.example.json", isDirectory: false)
        }

        return cwd.appendingPathComponent("config/api_keys.example.json", isDirectory: false)
    }

    public func load() throws -> APIKeysFile?
    {
        guard FileManager.default.fileExists(atPath: fileURL.path) else
        {
            return nil
        }

        do
        {
            let data = try Data(contentsOf: fileURL)
            return try JSONDecoder().decode(APIKeysFile.self, from: data)
        }
        catch
        {
            throw DictatorError.configUpdateFailed("invalid API keys file: \(error)")
        }
    }

    public func getOpenAIKey() throws -> String?
    {
        guard let loaded = try load() else
        {
            return nil
        }

        return APIKeyResolver.resolve
        {
            loaded.openai_api_key
        }
    }

    public func setOpenAIKey(_ key: String) throws
    {
        _ = key
        throw DictatorError.configUpdateFailed("API keys file is read-only")
    }

    public func clearOpenAIKey() throws
    {
        throw DictatorError.configUpdateFailed("API keys file is read-only")
    }
}
