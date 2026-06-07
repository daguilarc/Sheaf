import DictatorCore
import Foundation

public enum APIClientError: Error {
    case emptyTranscript
}

// Compatibility adapter: preserves existing call sites while routing to in-process DictatorCore.
public final class APIClient {
    private let coreClient: any DictatorCoreClient

    public init(coreClient: any DictatorCoreClient) {
        self.coreClient = coreClient
    }

    public var baseURLDescription: String {
        "in-process://dictator-core"
    }

    public func dictate(_ payload: DictateRequest) async throws -> DictateCallResult {
        try await coreClient.dictate(payload)
    }

    public func transcribe(_ payload: TranscribeRequest) async throws -> TranscribeResponse {
        let decoded = try await coreClient.transcribe(payload)
        if decoded.raw_transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            throw APIClientError.emptyTranscript
        }
        return decoded
    }

    public static func decodeDictateResponse(from data: Data) throws -> DictateResponse {
        try JSONDecoder().decode(DictateResponse.self, from: data)
    }

    public static func decodeTranscribeResponse(from data: Data) throws -> TranscribeResponse {
        try JSONDecoder().decode(TranscribeResponse.self, from: data)
    }
}
