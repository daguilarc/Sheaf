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
        let systemPrompt = SystemPromptCatalog(
            directoryURL: runtimeConfig.resolvedSystemPromptsDirectoryURL()
        ).resolvePrompt(named: configuration.systemPrompt)
        let router = ProviderRoutingRefinementEngine(
            configuration: configuration,
            ollamaEngine: OllamaRefinementEngine(
                host: configuration.ollamaHost,
                model: configuration.ollamaModel,
                systemPrompt: systemPrompt,
                session: session
            ),
            openAIEngine: OpenAIRefinementEngine(
                model: configuration.openAIModel,
                systemPrompt: systemPrompt,
                secretStore: secretStore,
                session: session
            ),
            canUseOpenAI: canUseOpenAI
        )
        return try await router.refine(request)
    }
}
