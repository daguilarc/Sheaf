import Foundation

public struct LLMRuntimeConfiguration: Sendable {
    public enum Provider: String, Sendable {
        case ollama
        case openai
    }

    public enum Fallback: String, Sendable {
        case openai
        case none
    }

    public let provider: Provider
    public let ollamaHost: String
    public let ollamaModel: String
    public let fallback: Fallback
    public let openAIModel: String
    public let systemPrompt: String
    public let ollamaBinPath: String

    public init(
        provider: Provider,
        ollamaHost: String,
        ollamaModel: String,
        fallback: Fallback,
        openAIModel: String,
        systemPrompt: String = SystemPromptCatalog.defaultPromptFile,
        ollamaBinPath: String = RuntimeConfigFile.defaultOllamaBinPath
    ) {
        self.provider = provider
        self.ollamaHost = Self.trimTrailingSlash(ollamaHost)
        self.ollamaModel = ollamaModel
        self.fallback = fallback
        self.openAIModel = openAIModel
        self.systemPrompt = systemPrompt
        self.ollamaBinPath = ollamaBinPath
    }

    public static func fromRuntimeConfig(_ runtimeConfig: RuntimeConfigFile) -> LLMRuntimeConfiguration {
        LLMRuntimeConfiguration(
            provider: runtimeConfig.useCloud ? .openai : .ollama,
            ollamaHost: runtimeConfig.ollamaHost,
            ollamaModel: runtimeConfig.localModel,
            fallback: Fallback(rawValue: normalized(runtimeConfig.fallbackMode)) ?? .openai,
            openAIModel: runtimeConfig.cloudModel,
            systemPrompt: runtimeConfig.systemPrompt,
            ollamaBinPath: runtimeConfig.ollamaBinPath
        )
    }

    private static func normalized(_ value: String?) -> String {
        value?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased() ?? ""
    }

    private static func trimTrailingSlash(_ value: String) -> String {
        var result = value
        while result.count > 1, result.hasSuffix("/") {
            result.removeLast()
        }
        return result
    }
}
