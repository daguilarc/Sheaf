import Foundation

public final class RuntimeConfigRefinementEngine: RefinementEngine {
    private let runtimeConfigProvider: RuntimeConfigProvider
    private let secretStore: SecretStore
    private let session: URLSession
    private let canUseOpenAI: @Sendable () -> Bool

    public init(
        runtimeConfigProvider: RuntimeConfigProvider,
        secretStore: SecretStore,
        session: URLSession = .shared,
        canUseOpenAI: @escaping @Sendable () -> Bool
    ) {
        self.runtimeConfigProvider = runtimeConfigProvider
        self.secretStore = secretStore
        self.session = session
        self.canUseOpenAI = canUseOpenAI
    }

    public func refine(_ request: RefineRequest) async throws -> RefineResponse {
        let runtimeConfig = await runtimeConfigProvider.currentRuntimeConfig()
        let configuration = await runtimeConfigProvider.currentConfiguration()
        let promptCatalog = SystemPromptCatalog(
            directoryURL: runtimeConfig.resolvedSystemPromptsDirectoryURL()
        )
        let baseSystemPrompt = promptCatalog.resolvePrompt(named: configuration.systemPrompt)
        let engine = InjectableRulesRefinementEngine(
            basePrompt: baseSystemPrompt,
            injectableRules: runtimeConfig.injectableRules,
            promptCatalog: promptCatalog,
            makeEngine: { [configuration, secretStore, session, canUseOpenAI] systemPrompt in
                ProviderRoutingRefinementEngine(
                    configuration: configuration,
                    ollamaEngine: OllamaRefinementEngine(
                        host: configuration.ollamaHost,
                        model: configuration.ollamaModel,
                        systemPrompt: systemPrompt,
                        session: session
                    ),
                    openAIEngine: OpenAIRefinementEngine(
                        model: configuration.openAIModel,
                        reasoningEffort: configuration.reasoningEffort,
                        systemPrompt: systemPrompt,
                        secretStore: secretStore,
                        session: session
                    ),
                    canUseOpenAI: canUseOpenAI
                )
            }
        )
        return try await engine.refine(request)
    }
}
