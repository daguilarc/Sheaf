import Foundation

enum RefinementPromptBuilder {
    static let fallbackInstructions = """
    You are an intent-preserving voice transcription refiner.

    Input context:
    - The user text comes from a full voice-to-text pipeline (Whisper + refinement).
    - Transcription may contain errors, missing punctuation, repeated words, or misheard phrases.

    Operating modes:
    1) Transcript refinement mode (default): improve transcript quality while preserving meaning.
    2) Selected-text transform mode: when optional context includes selected input text, treat transcript as the user's modification request for that selected text.

    Your task:
    1) Rewrite the text to reflect the speaker's intended meaning, not just literal transcript wording.
    2) Correct likely transcription errors, grammar, punctuation, and clarity issues.
    3) Preserve tone and important details, but remove obvious filler, false starts, and rambling when they do not add meaning.
    4) If the speaker changes their mind (e.g., 'I thought X, but actually Y'), prioritize the final decision/intent (Y) in the refined output.
    5) When earlier and later statements conflict, treat later statements as updates unless the speaker explicitly says both should be kept.
    6) Do not invent facts. If meaning is ambiguous, produce the most likely interpretation and keep wording neutral.

    Conflict resolution rule:
    - If a statement includes a correction, reversal, or preference update ('actually', 'instead', 'rather', 'on second thought', 'change that'), treat it as the active intent and de-emphasize superseded wording.

    Context usage rule:
    - Optional context may indicate the active dictation target (app/site/coding-agent hint). Use it to disambiguate wording and intent, but do not invent facts.
    - If selected input text is provided in context, apply the spoken request to that selected text.

    Output format:
    - Return only the final output text for the active mode.
    - Do not include explanations, notes, or meta-commentary unless explicitly requested.
    """

    static func buildInput(
        rawTranscript: String,
        optionalContext: [String: String],
        contextBlocks: [RefinementContextBlock] = []
    ) -> String {
        let selectedText = optionalContext["selected_text"]?.trimmingCharacters(in: .whitespacesAndNewlines)
        if contextBlocks.isEmpty, let selectedText, !selectedText.isEmpty {
            return """
            Take the following input and modify it based on the following request.

            Input text:
            \(selectedText)

            Request:
            \(rawTranscript)
            """
        }

        var contextLines: [String] = []
        if let dictationContext = optionalContext["dictation_context"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !dictationContext.isEmpty
        {
            contextLines.append(dictationContext)
        }
        if let activeApp = optionalContext["active_app"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !activeApp.isEmpty
        {
            contextLines.append("Active app: \(activeApp)")
        }
        if let activeSite = optionalContext["active_site"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !activeSite.isEmpty
        {
            contextLines.append("Active site: \(activeSite)")
        }

        let renderedBlocks = renderContextBlocks(contextBlocks)

        if contextLines.isEmpty, renderedBlocks.isEmpty {
            return rawTranscript
        }

        var sections: [String] = []
        if !contextLines.isEmpty {
            sections.append("Context:\n" + contextLines.map { "- \($0)" }.joined(separator: "\n"))
        }
        if !renderedBlocks.isEmpty {
            sections.append(renderedBlocks)
        }
        sections.append("Transcript:\n\(rawTranscript)")
        return sections.joined(separator: "\n\n")
    }

    private static func renderContextBlocks(_ blocks: [RefinementContextBlock]) -> String {
        blocks.compactMap { block in
            let title = block.title.trimmingCharacters(in: .whitespacesAndNewlines)
            let body = block.body.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !title.isEmpty, !body.isEmpty else {
                return nil
            }
            let metadata = block.metadata
                .filter { !$0.key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
                .sorted { $0.key < $1.key }
                .map { "\($0.key): \($0.value)" }
                .joined(separator: "\n")
            if metadata.isEmpty {
                return """
                Context block: \(title)
                \(body)
                End context block: \(title)
                """
            }
            return """
            Context block: \(title)
            \(metadata)

            \(body)
            End context block: \(title)
            """
        }
        .joined(separator: "\n\n")
    }
}
