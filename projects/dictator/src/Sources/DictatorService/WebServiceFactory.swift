import DictatorCore
import Foundation

enum WebServiceFactory
{
    static func makeConfigurationManager(
        runtimeConfigProvider: RuntimeConfigProvider,
        secretStore: APIKeysStore,
        promptCatalog: SystemPromptCatalog,
        onBufferBytesUpdated: @escaping @Sendable (Int) -> Void
    ) async -> RuntimeConfigurationManager
    {
        let config = await runtimeConfigProvider.currentRuntimeConfig()
        let defaults = await runtimeConfigProvider.startupDefaultConfig()

        return RuntimeConfigurationManager(
            configurations: [
                RuntimeBooleanConfiguration(
                    name: WebConfigFieldMapping.managerNameByField[WebConfigFieldMapping.useCloud]!,
                    currentValue: config.useCloud,
                    defaultValue: defaults.useCloud,
                    runtimeConfigProvider: runtimeConfigProvider
                ),
                RuntimeModelConfiguration(
                    name: WebConfigFieldMapping.managerNameByField[WebConfigFieldMapping.cloudModel]!,
                    currentValue: config.cloudModel,
                    defaultValue: defaults.cloudModel,
                    target: .cloud,
                    optionsSource: .openAI(secretStore: secretStore),
                    runtimeConfigProvider: runtimeConfigProvider,
                    host: config.ollamaHost
                ),
                RuntimeModelConfiguration(
                    name: WebConfigFieldMapping.managerNameByField[WebConfigFieldMapping.localModel]!,
                    currentValue: config.localModel,
                    defaultValue: defaults.localModel,
                    target: .local,
                    optionsSource: .ollama,
                    runtimeConfigProvider: runtimeConfigProvider,
                    host: config.ollamaHost
                ),
                RuntimeSystemPromptConfiguration(
                    name: WebConfigFieldMapping.managerNameByField[WebConfigFieldMapping.systemPrompt]!,
                    currentValue: config.systemPrompt,
                    defaultValue: defaults.systemPrompt,
                    runtimeConfigProvider: runtimeConfigProvider,
                    target: .primary,
                    promptCatalog: promptCatalog
                ),
                RuntimeSystemPromptConfiguration(
                    name: WebConfigFieldMapping.managerNameByField[WebConfigFieldMapping.auxiliarySystemPrompt1]!,
                    currentValue: config.auxiliarySystemPrompt1,
                    defaultValue: defaults.auxiliarySystemPrompt1,
                    runtimeConfigProvider: runtimeConfigProvider,
                    target: .auxiliary1,
                    promptCatalog: promptCatalog
                ),
                RuntimeSystemPromptConfiguration(
                    name: WebConfigFieldMapping.managerNameByField[WebConfigFieldMapping.auxiliarySystemPrompt2]!,
                    currentValue: config.auxiliarySystemPrompt2,
                    defaultValue: defaults.auxiliarySystemPrompt2,
                    runtimeConfigProvider: runtimeConfigProvider,
                    target: .auxiliary2,
                    promptCatalog: promptCatalog
                ),
                RuntimeSystemPromptConfiguration(
                    name: WebConfigFieldMapping.managerNameByField[WebConfigFieldMapping.reviewSystemPrompt]!,
                    currentValue: config.reviewSystemPrompt,
                    defaultValue: defaults.reviewSystemPrompt,
                    runtimeConfigProvider: runtimeConfigProvider,
                    target: .review,
                    promptCatalog: promptCatalog
                ),
                RuntimeInteractionsBufferConfiguration(
                    name: WebConfigFieldMapping.managerNameByField[WebConfigFieldMapping.interactionsBufferBytes]!,
                    currentValueBytes: config.interactionsBufferBytes,
                    defaultValueBytes: defaults.interactionsBufferBytes,
                    runtimeConfigProvider: runtimeConfigProvider,
                    onBytesUpdated: onBufferBytesUpdated
                )
            ]
        )
    }
}
