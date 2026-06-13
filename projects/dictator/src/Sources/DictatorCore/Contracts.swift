import Foundation

public enum TranscriptionDecodeMode: String, Codable, Sendable {
    case standard
    case talonLite = "talon_lite"
}

public struct TranscribeRequest: Codable, Sendable {
    public let audio_b64: String
    public let sample_rate: Int
    public let locale: String
    public let session_id: String
    public let decode_mode: TranscriptionDecodeMode

    public init(
        audio_b64: String,
        sample_rate: Int,
        locale: String,
        session_id: String,
        decode_mode: TranscriptionDecodeMode = .standard
    ) {
        self.audio_b64 = audio_b64
        self.sample_rate = sample_rate
        self.locale = locale
        self.session_id = session_id
        self.decode_mode = decode_mode
    }
}

public struct TranscribeSegment: Codable, Sendable {
    public let start_ms: Int
    public let end_ms: Int
    public let text: String

    public init(start_ms: Int, end_ms: Int, text: String) {
        self.start_ms = start_ms
        self.end_ms = end_ms
        self.text = text
    }
}

public struct TranscribeResponse: Codable, Sendable {
    public let raw_transcript: String
    public let segments: [TranscribeSegment]
    public let confidence: Double
    public let duration_ms: Int

    public init(raw_transcript: String, segments: [TranscribeSegment], confidence: Double, duration_ms: Int) {
        self.raw_transcript = raw_transcript
        self.segments = segments
        self.confidence = confidence
        self.duration_ms = duration_ms
    }
}

public struct RefineRequest: Codable, Sendable {
    public let raw_transcript: String
    public let optional_context: [String: String]?
    public let style_prefs: [String: String]?
    public let context_blocks: [RefinementContextBlock]?

    public init(
        raw_transcript: String,
        optional_context: [String: String]? = nil,
        style_prefs: [String: String]? = nil,
        context_blocks: [RefinementContextBlock]? = nil
    ) {
        self.raw_transcript = raw_transcript
        self.optional_context = optional_context
        self.style_prefs = style_prefs
        self.context_blocks = context_blocks
    }
}

public struct RefinementContextBlock: Codable, Sendable, Equatable {
    public let title: String
    public let metadata: [String: String]
    public let body: String

    public init(title: String, metadata: [String: String] = [:], body: String) {
        self.title = title
        self.metadata = metadata
        self.body = body
    }
}

public struct RefineResponse: Codable, Sendable {
    public let revised_text: String
    public let edit_summary: String
    public let uncertainty_flags: [String]
    public let providerMetadata: RefinementProviderMetadata?

    public init(
        revised_text: String,
        edit_summary: String,
        uncertainty_flags: [String],
        providerMetadata: RefinementProviderMetadata? = nil
    ) {
        self.revised_text = revised_text
        self.edit_summary = edit_summary
        self.uncertainty_flags = uncertainty_flags
        self.providerMetadata = providerMetadata
    }

    enum CodingKeys: String, CodingKey {
        case revised_text
        case edit_summary
        case uncertainty_flags
        case providerMetadata = "provider_metadata"
    }
}

public struct RefinementProviderMetadata: Codable, Sendable, Equatable {
    public let provider: String
    public let model: String
    public let fallbackUsed: Bool

    public init(provider: LLMRuntimeConfiguration.Provider, model: String, fallbackUsed: Bool) {
        self.provider = provider.rawValue
        self.model = model
        self.fallbackUsed = fallbackUsed
    }

    enum CodingKeys: String, CodingKey {
        case provider
        case model
        case fallbackUsed = "fallback_used"
    }
}

public struct DictateRequest: Codable, Sendable {
    public let audio_b64: String
    public let sample_rate: Int
    public let locale: String
    public let session_id: String
    public let optional_context: [String: String]?
    public let style_prefs: [String: String]?

    public init(
        audio_b64: String,
        sample_rate: Int,
        locale: String,
        session_id: String,
        optional_context: [String: String]? = nil,
        style_prefs: [String: String]? = nil
    ) {
        self.audio_b64 = audio_b64
        self.sample_rate = sample_rate
        self.locale = locale
        self.session_id = session_id
        self.optional_context = optional_context
        self.style_prefs = style_prefs
    }
}

public struct DictateResponse: Codable, Sendable {
    public let raw_transcript: String
    public let revised_text: String
    public let edit_summary: String
    public let uncertainty_flags: [String]

    public init(raw_transcript: String, revised_text: String, edit_summary: String, uncertainty_flags: [String]) {
        self.raw_transcript = raw_transcript
        self.revised_text = revised_text
        self.edit_summary = edit_summary
        self.uncertainty_flags = uncertainty_flags
    }
}

public struct DictateCallResult: Sendable {
    public let response: DictateResponse
    public let transcribeMs: Int
    public let refineMs: Int
    public let providerMetadata: RefinementProviderMetadata?

    public init(
        response: DictateResponse,
        transcribeMs: Int,
        refineMs: Int,
        providerMetadata: RefinementProviderMetadata? = nil
    ) {
        self.response = response
        self.transcribeMs = transcribeMs
        self.refineMs = refineMs
        self.providerMetadata = providerMetadata
    }
}
