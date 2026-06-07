import Foundation

public protocol DictatorCoreClient: Sendable {
    func transcribe(_ request: TranscribeRequest) async throws -> TranscribeResponse
    func refine(_ request: RefineRequest) async throws -> RefineResponse
    func dictate(_ request: DictateRequest) async throws -> DictateCallResult
    func interactForRuntimeConfig(_ request: VoiceConfigInteractionRequest) async throws -> VoiceConfigInteractionResult
}

public protocol AudioInputPort: Sendable {
    func startCapture() async throws
    func stopCapture() throws -> (audioData: Data, sampleRate: Int)
}

public protocol STTEngine: Sendable {
    func transcribe(_ request: TranscribeRequest) async throws -> TranscribeResponse
}

public protocol RefinementEngine: Sendable {
    func refine(_ request: RefineRequest) async throws -> RefineResponse
}

public protocol SecretStore: Sendable {
    func getOpenAIKey() throws -> String?
    func setOpenAIKey(_ key: String) throws
    func clearOpenAIKey() throws
}
