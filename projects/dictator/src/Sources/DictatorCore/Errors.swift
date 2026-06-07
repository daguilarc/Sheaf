import Foundation

public enum DictatorError: Error, Sendable {
    case missingApiKey
    case invalidApiKey
    case networkUnavailable
    case refinementFailed(String)
    case sttFailed(String)
    case permissionsDenied(String)
    case configUpdateFailed(String)
    case configInteractionUnavailable
    case talonPipelineFailed(String)
}

extension DictatorError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .missingApiKey:
            return "Missing OpenAI API key"
        case .invalidApiKey:
            return "Invalid OpenAI API key"
        case .networkUnavailable:
            return "Network unavailable"
        case let .refinementFailed(message):
            return "Refinement failed: \(message)"
        case let .sttFailed(message):
            return "Speech recognition failed: \(message)"
        case let .permissionsDenied(scope):
            return "Permission denied: \(scope)"
        case let .configUpdateFailed(message):
            return "Runtime config update failed: \(message)"
        case .configInteractionUnavailable:
            return "Runtime config interaction is unavailable"
        case let .talonPipelineFailed(message):
            return "Talon pipeline failed: \(message)"
        }
    }
}
