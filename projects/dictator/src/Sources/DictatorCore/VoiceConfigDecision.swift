import Foundation

public struct VoiceConfigDecision: Sendable, Equatable {
    public enum Kind: String, Sendable {
        case noChange = "no_change"
        case update
    }

    public let kind: Kind
    public let patch: RuntimeConfigPatch?

    public init(kind: Kind, patch: RuntimeConfigPatch? = nil) {
        self.kind = kind
        self.patch = patch
    }
}

public enum VoiceConfigDecisionParser {
    public static func parse(_ rawJSON: String) throws -> VoiceConfigDecision {
        guard let data = rawJSON.data(using: .utf8),
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw DictatorError.configUpdateFailed("decision payload is not valid JSON")
        }

        let allowedTopLevelKeys: Set<String> = ["decision", "update"]
        let unknownTopLevelKeys = Set(json.keys).subtracting(allowedTopLevelKeys)
        if !unknownTopLevelKeys.isEmpty {
            throw DictatorError.configUpdateFailed("decision payload contains unsupported keys: \(unknownTopLevelKeys.sorted())")
        }

        guard let decisionRaw = json["decision"] as? String,
              let kind = VoiceConfigDecision.Kind(rawValue: decisionRaw) else {
            throw DictatorError.configUpdateFailed("decision must be one of no_change/update")
        }

        switch kind {
        case .noChange:
            if json["update"] != nil {
                throw DictatorError.configUpdateFailed("update must be omitted when decision=no_change")
            }
            return VoiceConfigDecision(kind: .noChange)

        case .update:
            guard let update = json["update"] as? [String: Any] else {
                throw DictatorError.configUpdateFailed("update object is required when decision=update")
            }

            let allowedUpdateKeys: Set<String> = ["model", "use_cloud"]
            let unknownUpdateKeys = Set(update.keys).subtracting(allowedUpdateKeys)
            if !unknownUpdateKeys.isEmpty {
                throw DictatorError.configUpdateFailed("update contains unsupported keys: \(unknownUpdateKeys.sorted())")
            }

            let model: String?
            if let rawModel = update["model"] {
                guard let stringModel = rawModel as? String else {
                    throw DictatorError.configUpdateFailed("update.model must be a string")
                }
                let trimmed = stringModel.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty else {
                    throw DictatorError.configUpdateFailed("update.model cannot be empty")
                }
                model = trimmed
            } else {
                model = nil
            }

            let useCloud: Bool?
            if let rawUseCloud = update["use_cloud"] {
                guard let boolUseCloud = rawUseCloud as? Bool else {
                    throw DictatorError.configUpdateFailed("update.use_cloud must be a boolean")
                }
                useCloud = boolUseCloud
            } else {
                useCloud = nil
            }

            let patch = RuntimeConfigPatch(model: model, useCloud: useCloud)
            if patch.isEmpty {
                throw DictatorError.configUpdateFailed("update must include at least one field")
            }

            return VoiceConfigDecision(kind: .update, patch: patch)
        }
    }
}

public protocol VoiceConfigDecisionEngine: Sendable {
    func decide(transcript: String, current: RuntimeConfigFile) async throws -> VoiceConfigDecision
}

public final class OpenAIVoiceConfigDecisionEngine: VoiceConfigDecisionEngine {
    private let model: String
    private let secretStore: SecretStore
    private let session: URLSession

    public init(model: String, secretStore: SecretStore, session: URLSession = .shared) {
        self.model = model
        self.secretStore = secretStore
        self.session = session
    }

    public func decide(transcript: String, current: RuntimeConfigFile) async throws -> VoiceConfigDecision {
        guard let key = try APIKeyResolver.resolve(fallback: { try secretStore.getOpenAIKey() }) else {
            throw DictatorError.missingApiKey
        }

        let payload = ResponsesPayload(
            model: model,
            instructions: Self.instructions,
            input: Self.input(transcript: transcript, current: current)
        )

        var urlRequest = URLRequest(url: URL(string: "https://api.openai.com/v1/responses")!)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        urlRequest.httpBody = try JSONEncoder().encode(payload)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: urlRequest)
        } catch {
            if let urlError = error as? URLError,
               [.notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotFindHost, .cannotConnectToHost].contains(urlError.code)
            {
                throw DictatorError.networkUnavailable
            }
            throw DictatorError.configUpdateFailed(String(describing: error))
        }

        guard let http = response as? HTTPURLResponse else {
            throw DictatorError.configUpdateFailed("invalid server response")
        }
        if http.statusCode == 401 || http.statusCode == 403 {
            throw DictatorError.invalidApiKey
        }
        guard (200 ... 299).contains(http.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "HTTP \(http.statusCode)"
            throw DictatorError.configUpdateFailed(String(message.prefix(220)))
        }

        let decoded = try JSONDecoder().decode(ResponsesOutput.self, from: data)
        guard let output = decoded.firstOutputText else {
            throw DictatorError.configUpdateFailed("LLM did not return decision text")
        }

        return try VoiceConfigDecisionParser.parse(output)
    }

    private static func input(transcript: String, current: RuntimeConfigFile) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let currentJSON = (try? String(data: encoder.encode(current), encoding: .utf8)) ?? "{}"
        return """
        Voice transcript:\n\(transcript)\n\nCurrent runtime config JSON:\n\(currentJSON)
        """
    }

    static let instructions = """
    Decide whether the runtime configuration should change based only on the voice transcript.
    You must output only strict JSON with this shape:
    {"decision":"no_change"}
    or
    {"decision":"update","update":{"model":"<string>","use_cloud":<boolean>}}
    Rules:
    - Use decision=no_change unless there is a clear and explicit config change intent.
    - Allowed update keys are only model and use_cloud.
    - Do not include explanations or markdown.
    """

    private struct ResponsesPayload: Encodable {
        let model: String
        let instructions: String
        let input: String
    }

    private struct ResponsesOutput: Decodable {
        let output_text: String?
        let output: [ResponsesOutputItem]?

        var firstOutputText: String? {
            if let outputText = output_text,
               !outputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return outputText
            }
            return output?
                .flatMap { $0.content ?? [] }
                .compactMap { $0.text }
                .first(where: { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
        }
    }

    private struct ResponsesOutputItem: Decodable {
        let content: [ResponsesContent]?
    }

    private struct ResponsesContent: Decodable {
        let text: String?
    }
}

public final class OllamaVoiceConfigDecisionEngine: VoiceConfigDecisionEngine {
    private let host: String
    private let model: String
    private let session: URLSession

    public init(host: String, model: String, session: URLSession = .shared) {
        self.host = host
        self.model = model
        self.session = session
    }

    public func decide(transcript: String, current: RuntimeConfigFile) async throws -> VoiceConfigDecision {
        guard let url = URL(string: "\(host)/api/generate") else {
            throw DictatorError.configUpdateFailed("invalid Ollama host")
        }

        let payload = GeneratePayload(
            model: model,
            prompt: Self.input(transcript: transcript, current: current),
            system: OpenAIVoiceConfigDecisionEngine.instructions,
            stream: false
        )

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(payload)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            if let urlError = error as? URLError,
               [.notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotFindHost, .cannotConnectToHost].contains(urlError.code)
            {
                throw DictatorError.networkUnavailable
            }
            throw DictatorError.configUpdateFailed(String(describing: error))
        }

        guard let http = response as? HTTPURLResponse else {
            throw DictatorError.configUpdateFailed("invalid Ollama response")
        }
        guard (200 ... 299).contains(http.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "HTTP \(http.statusCode)"
            throw DictatorError.configUpdateFailed(String(message.prefix(220)))
        }

        let decoded = try JSONDecoder().decode(GenerateResponse.self, from: data)
        guard let output = decoded.response else {
            throw DictatorError.configUpdateFailed("Ollama did not return decision text")
        }

        return try VoiceConfigDecisionParser.parse(output)
    }

    private static func input(transcript: String, current: RuntimeConfigFile) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let currentJSON = (try? String(data: encoder.encode(current), encoding: .utf8)) ?? "{}"
        return """
        Voice transcript:\n\(transcript)\n\nCurrent runtime config JSON:\n\(currentJSON)
        """
    }

    private struct GeneratePayload: Encodable {
        let model: String
        let prompt: String
        let system: String
        let stream: Bool
    }

    private struct GenerateResponse: Decodable {
        let response: String?
    }
}
