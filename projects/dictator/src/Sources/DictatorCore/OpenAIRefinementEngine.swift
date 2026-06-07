import Foundation

public final class OpenAIRefinementEngine: RefinementEngine {
    private let model: String
    private let systemPrompt: String
    private let secretStore: SecretStore
    private let session: URLSession

    public init(
        model: String = "gpt-4.1-mini",
        systemPrompt: String? = nil,
        secretStore: SecretStore,
        session: URLSession = .shared
    ) {
        self.model = model
        self.systemPrompt = systemPrompt ?? RefinementPromptBuilder.fallbackInstructions
        self.secretStore = secretStore
        self.session = session
    }

    public func refine(_ request: RefineRequest) async throws -> RefineResponse {
        guard let key = try APIKeyResolver.resolve(fallback: { try secretStore.getOpenAIKey() }) else {
            throw DictatorError.missingApiKey
        }

        let payload = ResponsesPayload(
            model: model,
            instructions: systemPrompt,
            input: Self.buildInput(rawTranscript: request.raw_transcript, optionalContext: request.optional_context ?? [:])
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
            throw DictatorError.refinementFailed(String(describing: error))
        }

        guard let http = response as? HTTPURLResponse else {
            throw DictatorError.refinementFailed("Invalid server response")
        }

        if http.statusCode == 401 || http.statusCode == 403 {
            throw DictatorError.invalidApiKey
        }
        guard (200 ... 299).contains(http.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "HTTP \(http.statusCode)"
            throw DictatorError.refinementFailed(String(message.prefix(220)))
        }

        let decoded = try JSONDecoder().decode(ResponsesOutput.self, from: data)
        guard let text = decoded.firstOutputText?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
            throw DictatorError.refinementFailed("OpenAI response did not include output text")
        }

        return RefineResponse(
            revised_text: text,
            edit_summary: "Refined with OpenAI model.",
            uncertainty_flags: []
        )
    }

    static func buildInput(rawTranscript: String, optionalContext: [String: String]) -> String {
        RefinementPromptBuilder.buildInput(rawTranscript: rawTranscript, optionalContext: optionalContext)
    }

    private struct ResponsesPayload: Encodable {
        let model: String
        let instructions: String
        let input: String
    }

    private struct ResponsesOutput: Decodable {
        let output_text: String?
        let output: [ResponsesOutputItem]?

        var firstOutputText: String? {
            if let outputText = output_text, !outputText.isEmpty {
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
