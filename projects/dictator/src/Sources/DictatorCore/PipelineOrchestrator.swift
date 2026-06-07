import Foundation

public final class PipelineOrchestrator: DictatorCoreClient {
    private let sttEngine: STTEngine
    private let refinementEngine: RefinementEngine
    private let voiceConfigInteractionOrchestrator: VoiceConfigInteractionOrchestrator?

    public init(
        sttEngine: STTEngine,
        refinementEngine: RefinementEngine,
        voiceConfigInteractionOrchestrator: VoiceConfigInteractionOrchestrator? = nil
    ) {
        self.sttEngine = sttEngine
        self.refinementEngine = refinementEngine
        self.voiceConfigInteractionOrchestrator = voiceConfigInteractionOrchestrator
    }

    public func transcribe(_ request: TranscribeRequest) async throws -> TranscribeResponse {
        try await sttEngine.transcribe(request)
    }

    public func refine(_ request: RefineRequest) async throws -> RefineResponse {
        try await refinementEngine.refine(request)
    }

    public func dictate(_ request: DictateRequest) async throws -> DictateCallResult {
        let transcribeStart = ContinuousClock.now
        let transcribed = try await transcribe(
            TranscribeRequest(
                audio_b64: request.audio_b64,
                sample_rate: request.sample_rate,
                locale: request.locale,
                session_id: request.session_id
            )
        )
        let transcribeMs = transcribeStart.durationMs

        if transcribed.raw_transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return DictateCallResult(
                response: DictateResponse(
                    raw_transcript: "",
                    revised_text: "",
                    edit_summary: "Transcription empty; skipped refinement.",
                    uncertainty_flags: ["empty_transcript_skipped_refinement"]
                ),
                transcribeMs: transcribeMs,
                refineMs: 0
            )
        }

        let refineStart = ContinuousClock.now
        let refined = try await refine(
            RefineRequest(
                raw_transcript: transcribed.raw_transcript,
                optional_context: request.optional_context,
                style_prefs: request.style_prefs
            )
        )

        return DictateCallResult(
            response: DictateResponse(
                raw_transcript: transcribed.raw_transcript,
                revised_text: refined.revised_text,
                edit_summary: refined.edit_summary,
                uncertainty_flags: refined.uncertainty_flags
            ),
            transcribeMs: transcribeMs,
            refineMs: refineStart.durationMs,
            providerMetadata: refined.providerMetadata
        )
    }

    public func interactForRuntimeConfig(_ request: VoiceConfigInteractionRequest) async throws -> VoiceConfigInteractionResult {
        guard let voiceConfigInteractionOrchestrator else {
            throw DictatorError.configInteractionUnavailable
        }
        return try await voiceConfigInteractionOrchestrator.interact(request)
    }
}

private extension ContinuousClock.Instant {
    var durationMs: Int {
        let duration = ContinuousClock.now - self
        return Int(duration.components.seconds * 1000) + Int(duration.components.attoseconds / 1_000_000_000_000_000)
    }
}
