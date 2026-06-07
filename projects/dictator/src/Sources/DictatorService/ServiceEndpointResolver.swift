import Foundation

public struct ResolvedServiceEndpoint: Sendable, Equatable
{
    public let host: String
    public let port: Int
    public let usedCLIOverride: Bool

    public init(host: String, port: Int, usedCLIOverride: Bool)
    {
        self.host = host
        self.port = port
        self.usedCLIOverride = usedCLIOverride
    }
}

public enum ServiceEndpointResolver
{
    public static func resolve(
        registryEntry: ServiceRegistryEntry,
        cliHost: String?,
        cliPort: Int?
    ) -> ResolvedServiceEndpoint
    {
        let trimmedHost = cliHost?.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedHost = (trimmedHost?.isEmpty == false) ? trimmedHost! : registryEntry.host
        let resolvedPort = cliPort ?? registryEntry.port
        let usedCLIOverride = (trimmedHost?.isEmpty == false) || cliPort != nil

        return ResolvedServiceEndpoint(
            host: resolvedHost,
            port: resolvedPort,
            usedCLIOverride: usedCLIOverride
        )
    }
}

public struct CLIServiceOverrides: Sendable, Equatable
{
    public let host: String?
    public let port: Int?

    public init(host: String? = nil, port: Int? = nil)
    {
        self.host = host
        self.port = port
    }
}

public enum CLIServiceOverridesParser
{
    public static func parse(arguments: [String]) -> CLIServiceOverrides
    {
        var host: String?
        var port: Int?
        var index = 0

        while index < arguments.count
        {
            let argument = arguments[index]

            if argument == "--host", index + 1 < arguments.count
            {
                host = arguments[index + 1]
                index += 2
                continue
            }

            if argument == "--port", index + 1 < arguments.count
            {
                if let parsed = Int(arguments[index + 1])
                {
                    port = parsed
                }
                index += 2
                continue
            }

            if argument.hasPrefix("--host=")
            {
                host = String(argument.dropFirst("--host=".count))
                index += 1
                continue
            }

            if argument.hasPrefix("--port=")
            {
                let value = String(argument.dropFirst("--port=".count))
                port = Int(value)
                index += 1
                continue
            }

            index += 1
        }

        return CLIServiceOverrides(host: host, port: port)
    }
}
