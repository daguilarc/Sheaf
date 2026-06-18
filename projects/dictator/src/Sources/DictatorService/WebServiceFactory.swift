import DictatorCore
import Foundation

enum WebServiceFactory
{
    static func makeConfigurationManager(
        runtimeConfigProvider: RuntimeConfigProvider,
        secretStore: APIKeysStore,
        promptCatalog: SystemPromptCatalog,
        audioInputResolver: AudioInputResolving,
        onBufferBytesUpdated: @escaping @Sendable (Int) -> Void
    ) async -> RuntimeConfigurationManager
    {
        let config = await runtimeConfigProvider.currentRuntimeConfig()
        let defaults = await runtimeConfigProvider.startupDefaultConfig()

        return RuntimeConfigurationManager(
            configurations: [
                RuntimeStringConfiguration(
                    name: WebConfigFieldMapping.managerNameByField[WebConfigFieldMapping.audioInput]!,
                    currentValue: config.audioInput ?? "",
                    defaultValue: defaults.audioInput ?? "",
                    options: audioInputOptions(from: audioInputResolver),
                    setter: { value in
                        let updated = try await runtimeConfigProvider.applyInMemoryPatch(
                            RuntimeConfigPatch(audioInput: value)
                        )
                        return updated.audioInput ?? ""
                    }
                ),
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

    private static func audioInputOptions(from resolver: AudioInputResolving) -> [String]
    {
        let devices = resolver.availableInputs()
        let trimmedNames = devices.map { $0.name.trimmingCharacters(in: .whitespacesAndNewlines) }
        let nameCounts = Dictionary(grouping: trimmedNames.filter { !$0.isEmpty }, by: { $0 })
            .mapValues(\.count)
        var seen: Set<String> = [""]
        var options = [""]
        for device in devices
        {
            let name = device.name.trimmingCharacters(in: .whitespacesAndNewlines)
            let value = name.isEmpty || (nameCounts[name] ?? 0) > 1
                ? device.id
                : name
            guard !seen.contains(value) else
            {
                continue
            }
            seen.insert(value)
            options.append(value)
        }
        return options
    }
}
