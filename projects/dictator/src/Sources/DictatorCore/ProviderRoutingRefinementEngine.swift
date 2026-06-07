import Foundation

public final class ProviderRoutingRefinementEngine: RefinementEngine {
    private let configuration: LLMRuntimeConfiguration
    private let ollamaEngine: any RefinementEngine
    private let openAIEngine: any RefinementEngine
    private let canUseOpenAI: @Sendable () -> Bool

    public init(
        configuration: LLMRuntimeConfiguration,
        ollamaEngine: any RefinementEngine,
        openAIEngine: any RefinementEngine,
        canUseOpenAI: @escaping @Sendable () -> Bool
    ) {
        self.configuration = configuration
        self.ollamaEngine = ollamaEngine
        self.openAIEngine = openAIEngine
        self.canUseOpenAI = canUseOpenAI
    }

    public func refine(_ request: RefineRequest) async throws -> RefineResponse {
        switch configuration.provider {
        case .openai:
            return try await openAIEngine.refine(request).withProviderMetadata(
                provider: .openai,
                model: configuration.openAIModel,
                fallbackUsed: false
            )
        case .ollama:
            do {
                return try await ollamaEngine.refine(request).withProviderMetadata(
                    provider: .ollama,
                    model: configuration.ollamaModel,
                    fallbackUsed: false
                )
            } catch {
                guard configuration.fallback == .openai, canUseOpenAI() else {
                    throw error
                }
                return try await openAIEngine.refine(request).withProviderMetadata(
                    provider: .openai,
                    model: configuration.openAIModel,
                    fallbackUsed: true
                )
            }
        }
    }
}

private extension RefineResponse {
    func withProviderMetadata(
        provider: LLMRuntimeConfiguration.Provider,
        model: String,
        fallbackUsed: Bool
    ) -> RefineResponse {
        RefineResponse(
            revised_text: revised_text,
            edit_summary: edit_summary,
            uncertainty_flags: uncertainty_flags,
            providerMetadata: RefinementProviderMetadata(
                provider: provider,
                model: model,
                fallbackUsed: fallbackUsed
            )
        )
    }
}
