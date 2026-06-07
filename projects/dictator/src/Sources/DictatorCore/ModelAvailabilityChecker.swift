import Foundation

public protocol ModelAvailabilityChecking: Sendable {
    func resolveModel(
        requestedModel: String,
        useCloud: Bool,
        configuration: LLMRuntimeConfiguration
    ) async throws -> String
}

public final class LiveModelAvailabilityChecker: ModelAvailabilityChecking {
    private let session: URLSession
    private let secretStore: SecretStore

    public init(session: URLSession = .shared, secretStore: SecretStore) {
        self.session = session
        self.secretStore = secretStore
    }

    public func resolveModel(
        requestedModel: String,
        useCloud: Bool,
        configuration: LLMRuntimeConfiguration
    ) async throws -> String {
        let requested = requestedModel.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !requested.isEmpty else {
            throw DictatorError.configUpdateFailed("model cannot be empty")
        }

        let availableModels = try await availableModels(useCloud: useCloud, configuration: configuration)
        guard !availableModels.isEmpty else {
            throw DictatorError.configUpdateFailed("no models available for selected provider")
        }

        return bestMatch(for: requested, in: availableModels)
    }

    private func availableModels(useCloud: Bool, configuration: LLMRuntimeConfiguration) async throws -> [String] {
        if useCloud {
            return try await fetchOpenAIModels()
        }
        return try await fetchOllamaModels(host: configuration.ollamaHost)
    }

    private func fetchOllamaModels(host: String) async throws -> [String] {
        guard let url = URL(string: "\(host)/api/tags") else {
            throw DictatorError.configUpdateFailed("invalid Ollama host")
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"

        let (data, response) = try await send(request, context: "Ollama model list")
        guard let http = response as? HTTPURLResponse else {
            throw DictatorError.configUpdateFailed("invalid Ollama response")
        }
        guard (200 ... 299).contains(http.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "HTTP \(http.statusCode)"
            throw DictatorError.configUpdateFailed("Ollama model list failed: \(String(message.prefix(220)))")
        }

        let decoded = try JSONDecoder().decode(OllamaTagsResponse.self, from: data)
        return decoded.models.map(\.name)
    }

    private func fetchOpenAIModels() async throws -> [String] {
        guard let key = try APIKeyResolver.resolve(fallback: { try secretStore.getOpenAIKey() }) else {
            throw DictatorError.missingApiKey
        }

        var request = URLRequest(url: URL(string: "https://api.openai.com/v1/models")!)
        request.httpMethod = "GET"
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await send(request, context: "OpenAI model list")
        guard let http = response as? HTTPURLResponse else {
            throw DictatorError.configUpdateFailed("invalid OpenAI response")
        }
        if http.statusCode == 401 || http.statusCode == 403 {
            throw DictatorError.invalidApiKey
        }
        guard (200 ... 299).contains(http.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "HTTP \(http.statusCode)"
            throw DictatorError.configUpdateFailed("OpenAI model list failed: \(String(message.prefix(220)))")
        }

        let decoded = try JSONDecoder().decode(OpenAIModelsResponse.self, from: data)
        return decoded.data.map(\.id)
    }

    private func send(_ request: URLRequest, context: String) async throws -> (Data, URLResponse) {
        do {
            return try await session.data(for: request)
        } catch {
            if let urlError = error as? URLError,
               [.notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotFindHost, .cannotConnectToHost].contains(urlError.code)
            {
                throw DictatorError.networkUnavailable
            }
            throw DictatorError.configUpdateFailed("\(context) request failed: \(error)")
        }
    }

    private func bestMatch(for requested: String, in availableModels: [String]) -> String {
        let requestedNormalized = normalize(requested)

        if let exact = availableModels.first(where: { normalize($0) == requestedNormalized }) {
            return exact
        }

        let scored = availableModels.map { candidate in
            let candidateNormalized = normalize(candidate)
            return (
                model: candidate,
                containsBonus: candidateNormalized.contains(requestedNormalized) || requestedNormalized.contains(candidateNormalized),
                distance: levenshtein(requestedNormalized, candidateNormalized)
            )
        }

        return scored
            .sorted {
                if $0.containsBonus != $1.containsBonus {
                    return $0.containsBonus && !$1.containsBonus
                }
                if $0.distance != $1.distance {
                    return $0.distance < $1.distance
                }
                return $0.model < $1.model
            }
            .first?.model ?? requested
    }

    private func normalize(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private func levenshtein(_ lhs: String, _ rhs: String) -> Int {
        let left = Array(lhs)
        let right = Array(rhs)

        if left.isEmpty { return right.count }
        if right.isEmpty { return left.count }

        var previous = Array(0 ... right.count)
        for i in 1 ... left.count {
            var current = [i] + Array(repeating: 0, count: right.count)
            for j in 1 ... right.count {
                let cost = left[i - 1] == right[j - 1] ? 0 : 1
                current[j] = min(
                    previous[j] + 1,
                    current[j - 1] + 1,
                    previous[j - 1] + cost
                )
            }
            previous = current
        }
        return previous[right.count]
    }
}

private struct OllamaTagsResponse: Decodable {
    let models: [OllamaTag]
}

private struct OllamaTag: Decodable {
    let name: String
}

private struct OpenAIModelsResponse: Decodable {
    let data: [OpenAIModel]
}

private struct OpenAIModel: Decodable {
    let id: String
}
