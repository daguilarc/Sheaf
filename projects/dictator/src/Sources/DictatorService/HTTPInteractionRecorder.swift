import DictatorCore
import Foundation

enum HTTPInteractionRecorder
{
    static func MakeSuccessHandler(
        interactionStore: InteractionHistoryStore,
        runtimeConfigProvider: RuntimeConfigProvider
    ) -> @Sendable (DictationHTTPSuccessRecord) async -> Void
    {
        return { record in
            let runtimeConfiguration = await runtimeConfigProvider.currentConfiguration()
            let runtimeConfig = await runtimeConfigProvider.currentRuntimeConfig()
            let systemPromptPath = runtimeConfig.systemPrompt
            let systemPromptBody = ResolvedSystemPromptBody(
                runtimeConfig: runtimeConfig,
                promptPath: systemPromptPath
            )
            var context = record.optionalContext ?? [:]
            context["request_source"] = "http"
            context["session_id"] = record.sessionID
            context["request_id"] = record.requestID
            context["sample_rate"] = String(record.sampleRate)
            context["locale"] = record.locale

            let effectiveProvider = EffectiveProvider(
                editSummary: record.response.edit_summary,
                runtimeConfiguration: runtimeConfiguration
            )
            let effectiveModel = effectiveProvider == LLMRuntimeConfiguration.Provider.openai.rawValue
                ? runtimeConfiguration.openAIModel
                : runtimeConfiguration.ollamaModel

            let interaction = DictationInteraction(
                whisperOutput: record.response.raw_transcript,
                finalOutput: record.response.revised_text,
                mode: .revision,
                systemPromptPath: systemPromptPath,
                systemPromptBody: systemPromptBody,
                model: effectiveModel,
                provider: effectiveProvider,
                optionalContext: context,
                editSummary: record.response.edit_summary,
                uncertaintyFlags: record.response.uncertainty_flags,
                timings: DictationInteractionTimings(
                    transcribeMs: record.transcribeMs,
                    refineMs: record.refineMs,
                    insertMs: 0,
                    totalPipelineMs: record.totalPipelineMs
                )
            )

            await interactionStore.append(interaction)
        }
    }

    static func MakeFailureHandler(
        interactionStore: InteractionHistoryStore,
        runtimeConfigProvider: RuntimeConfigProvider
    ) -> @Sendable (DictationHTTPFailureRecord) async -> Void
    {
        return { record in
            let runtimeConfiguration = await runtimeConfigProvider.currentConfiguration()
            let runtimeConfig = await runtimeConfigProvider.currentRuntimeConfig()
            let systemPromptPath = runtimeConfig.systemPrompt
            let systemPromptBody = ResolvedSystemPromptBody(
                runtimeConfig: runtimeConfig,
                promptPath: systemPromptPath
            )
            var context = record.optionalContext ?? [:]
            context["request_source"] = "http"
            context["session_id"] = record.sessionID
            context["request_id"] = record.requestID
            context["sample_rate"] = String(record.sampleRate)
            context["locale"] = record.locale

            let provider = runtimeConfiguration.provider.rawValue
            let model = provider == LLMRuntimeConfiguration.Provider.openai.rawValue
                ? runtimeConfiguration.openAIModel
                : runtimeConfiguration.ollamaModel

            let interaction = DictationInteraction(
                whisperOutput: "",
                finalOutput: record.errorMessage,
                mode: .revision,
                systemPromptPath: systemPromptPath,
                systemPromptBody: systemPromptBody,
                model: model,
                provider: provider,
                optionalContext: context,
                editSummary: "Dictation pipeline failed.",
                uncertaintyFlags: [],
                errorMessage: record.errorMessage,
                timings: DictationInteractionTimings(
                    transcribeMs: 0,
                    refineMs: 0,
                    insertMs: 0,
                    totalPipelineMs: 0
                )
            )

            await interactionStore.append(interaction)
        }
    }

    private static func ResolvedSystemPromptBody(runtimeConfig: RuntimeConfigFile, promptPath: String) -> String
    {
        SystemPromptCatalog(
            directoryURL: runtimeConfig.resolvedSystemPromptsDirectoryURL()
        ).resolvePrompt(named: promptPath)
    }

    private static func EffectiveProvider(
        editSummary: String,
        runtimeConfiguration: LLMRuntimeConfiguration
    ) -> String
    {
        if editSummary.localizedCaseInsensitiveContains("OpenAI")
        {
            return "openai"
        }
        if editSummary.localizedCaseInsensitiveContains("Ollama")
        {
            return "ollama"
        }
        return runtimeConfiguration.provider.rawValue
    }
}
