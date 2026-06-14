import Foundation
import NIOHTTP1

enum WebRoute: Equatable
{
    case indexHTML
    case staticAsset(path: String)
    case apiStatus
    case apiConfig
    case apiConfigPatch
    case apiConfigReset
    case apiConfigOptions(fieldName: String)
    case apiPrompts(directory: String)
    case apiPromptPreview(path: String)
    case apiPromptSelection
    case apiInjectableRules
    case apiInjectableRulesUpsert
    case apiInjectableRulesDelete(key: String)
    case apiInteractions
    case apiInteractionDetail(id: String)
    case apiModels(provider: String)
    case apiKeyStatus
    case apiRPCDiagnostics
}

enum WebRouter
{
    static func route(for head: HTTPRequestHead) throws -> WebRoute?
    {
        let parsed = parseURI(head.uri)
        let path = parsed.path
        let query = parsed.query

        switch (head.method, path)
        {
        case (.GET, "/"):
            return .indexHTML
        case (.GET, let assetPath) where assetPath.hasPrefix("/assets/"):
            let relative = String(assetPath.dropFirst("/assets/".count))
            return .staticAsset(path: relative)
        case (.GET, "/api/status"):
            return .apiStatus
        case (.GET, "/api/config"):
            return .apiConfig
        case (.PATCH, "/api/config"):
            return .apiConfigPatch
        case (.POST, "/api/config/reset"):
            return .apiConfigReset
        case (.GET, "/api/config/options"):
            guard let fieldName = query["name"], !fieldName.isEmpty else
            {
                throw WebRouterError.badRequest("name query parameter is required")
            }
            return .apiConfigOptions(fieldName: fieldName)
        case (.GET, "/api/prompts"):
            return .apiPrompts(directory: query["dir"] ?? "")
        case (.GET, "/api/prompts/preview"):
            guard let promptPath = query["path"], !promptPath.isEmpty else
            {
                throw WebRouterError.badRequest("path query parameter is required")
            }
            return .apiPromptPreview(path: promptPath)
        case (.POST, "/api/prompts/selection"):
            return .apiPromptSelection
        case (.GET, "/api/injectable-rules"):
            return .apiInjectableRules
        case (.POST, "/api/injectable-rules"):
            return .apiInjectableRulesUpsert
        case (.DELETE, "/api/injectable-rules"):
            guard let key = query["key"], !key.isEmpty else
            {
                throw WebRouterError.badRequest("key query parameter is required")
            }
            return .apiInjectableRulesDelete(key: key)
        case (.GET, "/api/interactions"):
            return .apiInteractions
        case (.GET, let detailPath) where detailPath.hasPrefix("/api/interactions/"):
            let id = String(detailPath.dropFirst("/api/interactions/".count))
            guard !id.isEmpty else
            {
                throw WebRouterError.notFound
            }
            return .apiInteractionDetail(id: id)
        case (.GET, "/api/models"):
            guard let provider = query["provider"], !provider.isEmpty else
            {
                throw WebRouterError.badRequest("provider query parameter is required")
            }
            return .apiModels(provider: provider)
        case (.GET, "/api/api-key-status"):
            return .apiKeyStatus
        case (.GET, "/api/rpc/diagnostics"):
            return .apiRPCDiagnostics
        default:
            return nil
        }
    }

    private static func parseURI(_ uri: String) -> (path: String, query: [String: String])
    {
        guard let questionMark = uri.firstIndex(of: "?") else
        {
            return (uri, [:])
        }

        let path = String(uri[..<questionMark])
        let queryString = String(uri[uri.index(after: questionMark)...])
        var query: [String: String] = [:]
        for pair in queryString.split(separator: "&")
        {
            let parts = pair.split(separator: "=", maxSplits: 1).map(String.init)
            guard let key = parts.first, !key.isEmpty else
            {
                continue
            }
            let value = parts.count > 1 ? decodeQueryComponent(parts[1]) : ""
            query[key] = value
        }
        return (path, query)
    }

    private static func decodeQueryComponent(_ value: String) -> String
    {
        value
            .replacingOccurrences(of: "+", with: " ")
            .removingPercentEncoding ?? value
    }
}

enum WebRouterError: Error
{
    case notFound
    case methodNotAllowed
    case badRequest(String)

    var status: HTTPResponseStatus
    {
        switch self
        {
        case .notFound:
            return .notFound
        case .methodNotAllowed:
            return .methodNotAllowed
        case .badRequest:
            return .badRequest
        }
    }

    var message: String
    {
        switch self
        {
        case .notFound:
            return "Not found."
        case .methodNotAllowed:
            return "Method not allowed."
        case let .badRequest(message):
            return message
        }
    }
}
