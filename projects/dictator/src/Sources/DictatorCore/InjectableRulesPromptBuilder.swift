import Foundation

public enum InjectableRulesPromptBuilder {
    public static func buildSystemPrompt(
        basePrompt: String,
        rawTranscript: String,
        injectableRules: [String: String],
        promptCatalog: SystemPromptCatalog
    ) -> String {
        let matches = matchingRules(rawTranscript: rawTranscript, injectableRules: injectableRules)
        guard !matches.isEmpty else {
            return basePrompt
        }

        var renderedRules: [String] = []
        for (key, promptPath) in matches {
            guard let body = try? promptCatalog.loadPrompt(named: promptPath) else {
                continue
            }
            renderedRules.append(
                """
                Source: \(promptPath)
                Trigger: \(key)
                \(body)
                """
            )
        }

        guard !renderedRules.isEmpty else {
            return basePrompt
        }

        return """
        \(basePrompt)

        ---

        Injectable rules:
        \(renderedRules.joined(separator: "\n\n"))
        """
    }

    static func matchingRules(
        rawTranscript: String,
        injectableRules: [String: String]
    ) -> [(key: String, promptPath: String)] {
        let transcript = rawTranscript.lowercased()
        return injectableRules
            .map { (key: $0.key, promptPath: $0.value) }
            .filter { rule in
                let key = rule.key.trimmingCharacters(in: .whitespacesAndNewlines)
                return !key.isEmpty && transcript.contains(key.lowercased())
            }
            .sorted { lhs, rhs in
                let keyCompare = lhs.key.localizedCaseInsensitiveCompare(rhs.key)
                if keyCompare != .orderedSame {
                    return keyCompare == .orderedAscending
                }
                return lhs.promptPath.localizedCaseInsensitiveCompare(rhs.promptPath) == .orderedAscending
            }
    }
}

public final class InjectableRulesRefinementEngine: RefinementEngine {
    private let basePrompt: String
    private let injectableRules: [String: String]
    private let promptCatalog: SystemPromptCatalog
    private let makeEngine: @Sendable (String) -> any RefinementEngine

    public init(
        basePrompt: String,
        injectableRules: [String: String],
        promptCatalog: SystemPromptCatalog,
        makeEngine: @escaping @Sendable (String) -> any RefinementEngine
    ) {
        self.basePrompt = basePrompt
        self.injectableRules = injectableRules
        self.promptCatalog = promptCatalog
        self.makeEngine = makeEngine
    }

    public func refine(_ request: RefineRequest) async throws -> RefineResponse {
        let systemPrompt = InjectableRulesPromptBuilder.buildSystemPrompt(
            basePrompt: basePrompt,
            rawTranscript: request.raw_transcript,
            injectableRules: injectableRules,
            promptCatalog: promptCatalog
        )
        return try await makeEngine(systemPrompt).refine(request)
    }
}
