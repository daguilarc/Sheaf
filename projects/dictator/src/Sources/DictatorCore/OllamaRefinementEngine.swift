import Foundation

public final class OllamaRefinementEngine: RefinementEngine {
    private let host: String
    private let model: String
    private let systemPrompt: String
    private let session: URLSession

    public init(
        host: String = "http://127.0.0.1:11434",
        model: String = "qwen2.5:7b-instruct",
        systemPrompt: String? = nil,
        session: URLSession = .shared
    ) {
        self.host = host
        self.model = model
        self.systemPrompt = systemPrompt ?? RefinementPromptBuilder.fallbackInstructions
        self.session = session
    }

    public func refine(_ request: RefineRequest) async throws -> RefineResponse {
        let payload = GeneratePayload(
            model: model,
            prompt: RefinementPromptBuilder.buildInput(
                rawTranscript: request.raw_transcript,
                optionalContext: request.optional_context ?? [:],
                contextBlocks: request.context_blocks ?? []
            ),
            system: systemPrompt,
            stream: false
        )

        guard let url = URL(string: "\(host)/api/generate") else {
            throw DictatorError.refinementFailed("Invalid Ollama host")
        }
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
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
            throw DictatorError.refinementFailed(String(describing: error))
        }

        guard let http = response as? HTTPURLResponse else {
            throw DictatorError.refinementFailed("Invalid Ollama response")
        }
        guard (200 ... 299).contains(http.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "HTTP \(http.statusCode)"
            throw DictatorError.refinementFailed(String(message.prefix(220)))
        }

        let decoded = try JSONDecoder().decode(GenerateResponse.self, from: data)
        guard let revised = decoded.response?.trimmingCharacters(in: .whitespacesAndNewlines), !revised.isEmpty else {
            throw DictatorError.refinementFailed("Ollama response did not include output text")
        }

        return RefineResponse(
            revised_text: revised,
            edit_summary: "Refined with Ollama model.",
            uncertainty_flags: []
        )
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
