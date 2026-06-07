import Foundation

public struct ServiceRegistryEntry: Sendable, Equatable
{
    public let name: String
    public let host: String
    public let port: Int
    public let command: String
    public let homePath: String?

    public init(
        name: String,
        host: String,
        port: Int,
        command: String,
        homePath: String?
    )
    {
        self.name = name
        self.host = host
        self.port = port
        self.command = command
        self.homePath = homePath
    }
}

public enum ServiceRegistry
{
    public enum RegistryError: Error, Equatable, Sendable
    {
        case servicesFileMissing(path: String)
        case servicesFileInvalid(reason: String)
        case serviceNotFound(name: String)
    }

    public static func load(
        repoRoot: URL,
        serviceName: String,
        fileManager: FileManager = .default
    ) throws -> ServiceRegistryEntry
    {
        let servicesURL = repoRoot
            .appendingPathComponent("config/services.json", isDirectory: false)

        guard fileManager.fileExists(atPath: servicesURL.path) else
        {
            throw RegistryError.servicesFileMissing(path: servicesURL.path)
        }

        let data: Data
        do
        {
            data = try Data(contentsOf: servicesURL)
        }
        catch
        {
            throw RegistryError.servicesFileInvalid(reason: "could not read services file: \(error)")
        }

        let records: [ServiceRegistryRecord]
        do
        {
            records = try JSONDecoder().decode([ServiceRegistryRecord].self, from: data)
        }
        catch
        {
            throw RegistryError.servicesFileInvalid(reason: "invalid services JSON: \(error)")
        }

        guard let match = records.first(where: { $0.name == serviceName }) else
        {
            throw RegistryError.serviceNotFound(name: serviceName)
        }

        return ServiceRegistryEntry(
            name: match.name,
            host: match.host,
            port: match.port,
            command: match.command,
            homePath: match.home_path
        )
    }
}

private struct ServiceRegistryRecord: Decodable
{
    let name: String
    let host: String
    let port: Int
    let command: String
    let home_path: String?
}
