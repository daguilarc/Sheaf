import Foundation

public struct VoiceConfigInteractionRequest: Codable, Sendable {
    public let audio_b64: String
    public let sample_rate: Int
    public let locale: String
    public let session_id: String

    public init(audio_b64: String, sample_rate: Int, locale: String, session_id: String) {
        self.audio_b64 = audio_b64
        self.sample_rate = sample_rate
        self.locale = locale
        self.session_id = session_id
    }
}

public struct VoiceConfigInteractionResult: Codable, Sendable {
    public let transcript: String
    public let decision: String
    public let updated: Bool
    public let runtime_config: RuntimeConfigFile

    public init(transcript: String, decision: String, updated: Bool, runtime_config: RuntimeConfigFile) {
        self.transcript = transcript
        self.decision = decision
        self.updated = updated
        self.runtime_config = runtime_config
    }
}

public final class VoiceConfigInteractionOrchestrator: Sendable {
    private let sttEngine: any STTEngine
    private let runtimeConfigProvider: RuntimeConfigProvider
    private let secretStore: SecretStore
    private let session: URLSession
    private let decisionEngineFactory: (@Sendable (LLMRuntimeConfiguration) -> any VoiceConfigDecisionEngine)?
    private let modelAvailabilityChecker: any ModelAvailabilityChecking

    public init(
        sttEngine: any STTEngine,
        runtimeConfigProvider: RuntimeConfigProvider,
        secretStore: SecretStore,
        session: URLSession = .shared,
        decisionEngineFactory: (@Sendable (LLMRuntimeConfiguration) -> any VoiceConfigDecisionEngine)? = nil,
        modelAvailabilityChecker: (any ModelAvailabilityChecking)? = nil
    ) {
        self.sttEngine = sttEngine
        self.runtimeConfigProvider = runtimeConfigProvider
        self.secretStore = secretStore
        self.session = session
        self.decisionEngineFactory = decisionEngineFactory
        self.modelAvailabilityChecker = modelAvailabilityChecker ?? LiveModelAvailabilityChecker(
            session: session,
            secretStore: secretStore
        )
    }

    public func interact(_ request: VoiceConfigInteractionRequest) async throws -> VoiceConfigInteractionResult {
        let transcribed = try await sttEngine.transcribe(
            TranscribeRequest(
                audio_b64: request.audio_b64,
                sample_rate: request.sample_rate,
                locale: request.locale,
                session_id: request.session_id
            )
        )

        let transcript = transcribed.raw_transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        if transcript.isEmpty {
            let current = await runtimeConfigProvider.currentRuntimeConfig()
            return VoiceConfigInteractionResult(
                transcript: "",
                decision: VoiceConfigDecision.Kind.noChange.rawValue,
                updated: false,
                runtime_config: current
            )
        }

        let currentConfig = await runtimeConfigProvider.currentRuntimeConfig()
        let effectiveConfiguration = await runtimeConfigProvider.currentConfiguration()
        let decisionEngine = decisionEngineFactory?(effectiveConfiguration)
            ?? makeDecisionEngine(configuration: effectiveConfiguration)
        let decision = try await decisionEngine.decide(transcript: transcript, current: currentConfig)

        switch decision.kind {
        case .noChange:
            return VoiceConfigInteractionResult(
                transcript: transcript,
                decision: VoiceConfigDecision.Kind.noChange.rawValue,
                updated: false,
                runtime_config: currentConfig
            )
        case .update:
            guard let patch = decision.patch else {
                throw DictatorError.configUpdateFailed("decision=update missing patch")
            }
            let targetUseCloud = patch.useCloud ?? currentConfig.useCloud
            let requestedModel = patch.model ?? currentConfig.model
            let resolvedModel = try await modelAvailabilityChecker.resolveModel(
                requestedModel: requestedModel,
                useCloud: targetUseCloud,
                configuration: effectiveConfiguration
            )

            let validatedPatch = RuntimeConfigPatch(
                model: resolvedModel,
                useCloud: patch.useCloud
            )
            let updated = try await runtimeConfigProvider.applyInMemoryPatch(validatedPatch)
            return VoiceConfigInteractionResult(
                transcript: transcript,
                decision: VoiceConfigDecision.Kind.update.rawValue,
                updated: true,
                runtime_config: updated
            )
        }
    }

    private func makeDecisionEngine(configuration: LLMRuntimeConfiguration) -> any VoiceConfigDecisionEngine {
        switch configuration.provider {
        case .openai:
            return OpenAIVoiceConfigDecisionEngine(
                model: configuration.openAIModel,
                secretStore: secretStore,
                session: session
            )
        case .ollama:
            return OllamaVoiceConfigDecisionEngine(
                host: configuration.ollamaHost,
                model: configuration.ollamaModel,
                session: session
            )
        }
    }
}
