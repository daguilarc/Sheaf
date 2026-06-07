import Foundation

public protocol TalonLiteLLMCorrectionEngine: Sendable {
    func correctToGrammar(_ transcript: String) async throws -> String
}

public final class RuntimeConfigTalonLiteLLMCorrectionEngine: TalonLiteLLMCorrectionEngine {
    private let runtimeConfigProvider: RuntimeConfigProvider
    private let secretStore: SecretStore
    private let session: URLSession
    private let canUseOpenAI: @Sendable () -> Bool

    public init(
        runtimeConfigProvider: RuntimeConfigProvider,
        secretStore: SecretStore,
        session: URLSession = .shared,
        canUseOpenAI: @escaping @Sendable () -> Bool
    ) {
        self.runtimeConfigProvider = runtimeConfigProvider
        self.secretStore = secretStore
        self.session = session
        self.canUseOpenAI = canUseOpenAI
    }

    public func correctToGrammar(_ transcript: String) async throws -> String {
        let configuration = await runtimeConfigProvider.currentConfiguration()

        let ollamaEngine = OllamaTalonLiteLLMCorrectionEngine(
            host: configuration.ollamaHost,
            model: configuration.ollamaModel,
            session: session
        )
        let openAIEngine = OpenAITalonLiteLLMCorrectionEngine(
            model: configuration.openAIModel,
            secretStore: secretStore,
            session: session
        )

        switch configuration.provider {
        case .openai:
            return try await openAIEngine.correctToGrammar(transcript)
        case .ollama:
            do {
                return try await ollamaEngine.correctToGrammar(transcript)
            } catch {
                guard configuration.fallback == .openai, canUseOpenAI() else {
                    throw error
                }
                return try await openAIEngine.correctToGrammar(transcript)
            }
        }
    }
}

public final class OpenAITalonLiteLLMCorrectionEngine: TalonLiteLLMCorrectionEngine {
    private let model: String
    private let secretStore: SecretStore
    private let session: URLSession

    public init(
        model: String,
        secretStore: SecretStore,
        session: URLSession = .shared
    ) {
        self.model = model
        self.secretStore = secretStore
        self.session = session
    }

    public func correctToGrammar(_ transcript: String) async throws -> String {
        guard let key = try APIKeyResolver.resolve(fallback: { try secretStore.getOpenAIKey() }) else {
            throw DictatorError.missingApiKey
        }

        let payload = ResponsesPayload(
            model: model,
            instructions: Self.instructions,
            input: Self.input(transcript: transcript)
        )

        var request = URLRequest(url: URL(string: "https://api.openai.com/v1/responses")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
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
            throw DictatorError.talonPipelineFailed("llm_correction: \(String(describing: error))")
        }

        guard let http = response as? HTTPURLResponse else {
            throw DictatorError.talonPipelineFailed("llm_correction: invalid server response")
        }
        if http.statusCode == 401 || http.statusCode == 403 {
            throw DictatorError.invalidApiKey
        }
        guard (200 ... 299).contains(http.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "HTTP \(http.statusCode)"
            throw DictatorError.talonPipelineFailed("llm_correction: \(String(message.prefix(220)))")
        }

        let decoded = try JSONDecoder().decode(ResponsesOutput.self, from: data)
        guard let output = decoded.firstOutputText,
              !output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            throw DictatorError.talonPipelineFailed("llm_correction: OpenAI response did not include output text")
        }

        return output.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static let instructions = """
    You are correcting Whisper transcripts into Talon Lite utterances.

    \(TalonLiteGrammarParser.grammarText)

    Rules:
    - Output a single corrected Talon Lite transcript that matches the grammar exactly.
    - Use only tokens and operators allowed by the grammar.
    - Do not include explanations, JSON, markdown, or extra commentary.
    - If unsure, output the closest valid grammar-conforming utterance.
    """

    private static func input(transcript: String) -> String {
        """
        Whisper transcript (possibly incorrect):
        \(transcript)
        """
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

public final class OllamaTalonLiteLLMCorrectionEngine: TalonLiteLLMCorrectionEngine {
    private let host: String
    private let model: String
    private let session: URLSession

    public init(host: String, model: String, session: URLSession = .shared) {
        self.host = host
        self.model = model
        self.session = session
    }

    public func correctToGrammar(_ transcript: String) async throws -> String {
        guard let url = URL(string: "\(host)/api/generate") else {
            throw DictatorError.talonPipelineFailed("llm_correction: invalid Ollama host")
        }

        let payload = GeneratePayload(
            model: model,
            prompt: "Whisper transcript (possibly incorrect):\n\(transcript)",
            system: OpenAITalonLiteLLMCorrectionEngine.instructions,
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
            throw DictatorError.talonPipelineFailed("llm_correction: \(String(describing: error))")
        }

        guard let http = response as? HTTPURLResponse else {
            throw DictatorError.talonPipelineFailed("llm_correction: invalid Ollama response")
        }

        guard (200 ... 299).contains(http.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "HTTP \(http.statusCode)"
            throw DictatorError.talonPipelineFailed("llm_correction: \(String(message.prefix(220)))")
        }

        let decoded = try JSONDecoder().decode(GenerateResponse.self, from: data)
        guard let output = decoded.response,
              !output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            throw DictatorError.talonPipelineFailed("llm_correction: Ollama response did not include output text")
        }

        return output.trimmingCharacters(in: .whitespacesAndNewlines)
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

public struct TalonLitePipelineResult: Sendable, Equatable {
    public let rawTranscript: String
    public let grammarTranscript: String
    public let outputText: String
    public let wasLLMCorrected: Bool
    public let transcribeMs: Int
    public let pipelineMs: Int

    public init(
        rawTranscript: String,
        grammarTranscript: String,
        outputText: String,
        wasLLMCorrected: Bool,
        transcribeMs: Int,
        pipelineMs: Int
    ) {
        self.rawTranscript = rawTranscript
        self.grammarTranscript = grammarTranscript
        self.outputText = outputText
        self.wasLLMCorrected = wasLLMCorrected
        self.transcribeMs = transcribeMs
        self.pipelineMs = pipelineMs
    }
}

public final class TalonLitePipelineOrchestrator: Sendable {
    private let sttEngine: STTEngine
    private let correctionEngine: TalonLiteLLMCorrectionEngine
    private let trace: (@Sendable (String) -> Void)?

    public init(
        sttEngine: STTEngine,
        correctionEngine: TalonLiteLLMCorrectionEngine,
        trace: (@Sendable (String) -> Void)? = nil
    ) {
        self.sttEngine = sttEngine
        self.correctionEngine = correctionEngine
        self.trace = trace
    }

    public func process(_ request: TranscribeRequest) async throws -> TalonLitePipelineResult {
        let start = ContinuousClock.now
        let transcribeStart = ContinuousClock.now
        let transcribed = try await sttEngine.transcribe(
            TranscribeRequest(
                audio_b64: request.audio_b64,
                sample_rate: request.sample_rate,
                locale: request.locale,
                session_id: request.session_id,
                decode_mode: .talonLite
            )
        )
        let transcribeMs = transcribeStart.durationMs
        let rawTranscript = transcribed.raw_transcript
        let normalizedTranscript = Self.lettersOnlyTranscript(from: rawTranscript)
        trace?("talon-lite raw transcript: \(Self.logSafeText(rawTranscript))")
        trace?("talon-lite normalized transcript: \(Self.logSafeText(normalizedTranscript))")

        do {
            let ast = try TalonLiteGrammarParser.parse(normalizedTranscript)
            let rendered = try TalonLiteRenderer.render(ast)
            trace?("talon-lite parse/render success without correction")
            return TalonLitePipelineResult(
                rawTranscript: rawTranscript,
                grammarTranscript: normalizedTranscript,
                outputText: rendered,
                wasLLMCorrected: false,
                transcribeMs: transcribeMs,
                pipelineMs: start.durationMs
            )
        } catch let parseError as TalonLiteGrammarParseError {
            trace?("talon-lite parse failed before correction: \(parseError.message)")
            if let repair = TalonLiteLocalRepair.repair(normalizedTranscript) {
                trace?("talon-lite local repair success [\(repair.reason)]: \(Self.logSafeText(repair.transcript))")
                do {
                    let ast = try TalonLiteGrammarParser.parse(repair.transcript)
                    let rendered = try TalonLiteRenderer.render(ast)
                    return TalonLitePipelineResult(
                        rawTranscript: rawTranscript,
                        grammarTranscript: repair.transcript,
                        outputText: rendered,
                        wasLLMCorrected: false,
                        transcribeMs: transcribeMs,
                        pipelineMs: start.durationMs
                    )
                } catch let repairParseError as TalonLiteGrammarParseError {
                    trace?("talon-lite local repair reparse failed: \(repairParseError.message)")
                } catch let error as DictatorError {
                    trace?("talon-lite local repair render failed: \(error)")
                } catch {
                    trace?("talon-lite local repair failed unexpectedly: \(error)")
                }
            } else {
                trace?("talon-lite local repair unavailable")
            }

            let corrected = try await correctionEngine.correctToGrammar(normalizedTranscript)
            trace?("talon-lite llm corrected transcript: \(Self.logSafeText(corrected))")

            let ast: TalonLiteAST
            do {
                ast = try TalonLiteGrammarParser.parse(corrected)
            } catch let reparseError as TalonLiteGrammarParseError {
                trace?("talon-lite reparse failed: \(reparseError.message)")
                throw DictatorError.talonPipelineFailed("reparse: \(reparseError.message)")
            }

            do {
                let rendered = try TalonLiteRenderer.render(ast)
                return TalonLitePipelineResult(
                    rawTranscript: rawTranscript,
                    grammarTranscript: corrected,
                    outputText: rendered,
                    wasLLMCorrected: true,
                    transcribeMs: transcribeMs,
                    pipelineMs: start.durationMs
                )
            } catch let error as DictatorError {
                throw error
            } catch {
                throw DictatorError.talonPipelineFailed("render: \(String(describing: error))")
            }
        } catch let error as DictatorError {
            throw error
        } catch {
            throw DictatorError.talonPipelineFailed("parse: \(String(describing: error))")
        }
    }

    private static func logSafeText(_ text: String) -> String {
        text.replacingOccurrences(of: "\n", with: "\\n")
    }

    private static func lettersOnlyTranscript(from input: String) -> String {
        let mapped = input.map { ch -> Character in
            if ch.isLetter || ch.isWhitespace {
                return ch
            }
            return " "
        }
        return String(mapped).split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }
}

private enum TalonLiteLocalRepair {
    struct Result: Equatable {
        let transcript: String
        let reason: String
    }

    private enum OperatorKind {
        case unaryIdentifier
        case unaryCharacter
        case naryIdentifier
        case naryCharacter
    }

    private struct OperatorSpec {
        let phrase: [String]
        let kind: OperatorKind
    }

    private static let bang = TalonLiteGrammarParser.bangLiteral
    private static let characterTokens = TalonLiteGrammarParser.characterTokens
    private static let operatorSpecs: [OperatorSpec] = (
        TalonLiteGrammarParser.unaryIdentifierOperatorTokens.map { OperatorSpec(phrase: $0, kind: .unaryIdentifier) }
            + TalonLiteGrammarParser.unaryCharacterOperatorTokens.map { OperatorSpec(phrase: $0, kind: .unaryCharacter) }
            + TalonLiteGrammarParser.naryIdentifierOperatorTokens.map { OperatorSpec(phrase: $0, kind: .naryIdentifier) }
            + TalonLiteGrammarParser.naryCharacterOperatorTokens.map { OperatorSpec(phrase: $0, kind: .naryCharacter) }
    ).sorted { lhs, rhs in
        lhs.phrase.count > rhs.phrase.count
    }

    static func repair(_ transcript: String) -> Result? {
        let tokens = transcript
            .split(whereSeparator: { $0.isWhitespace })
            .map(String.init)
        guard !tokens.isEmpty else {
            return nil
        }

        var index = 0
        var output: [String] = []
        var reasons: [String] = []

        while index < tokens.count {
            let token = tokens[index]

            if token == bang {
                output.append(token)
                index += 1
                continue
            }

            if TalonLiteGrammarParser.isCharacter(token) {
                output.append(token)
                index += 1
                continue
            }

            if let characterRepair = nearestReservedMatch(for: token, in: characterTokens) {
                output.append(characterRepair)
                reasons.append("character_token")
                index += 1
                continue
            }

            guard let spec = nearestOperatorMatch(at: index, tokens: tokens) else {
                return nil
            }

            output.append(contentsOf: spec.phrase)
            if spec.wasCorrected {
                reasons.append("operator_token")
            }
            index += spec.phrase.count

            switch spec.kind {
            case .unaryIdentifier:
                guard index < tokens.count, TalonLiteGrammarParser.isIdentifier(tokens[index]) else {
                    return nil
                }
                output.append(tokens[index])
                index += 1
            case .unaryCharacter:
                guard index < tokens.count else {
                    return nil
                }
                let next = tokens[index]
                if TalonLiteGrammarParser.isCharacter(next) {
                    output.append(next)
                    index += 1
                } else if let repaired = nearestReservedMatch(for: next, in: characterTokens) {
                    output.append(repaired)
                    reasons.append("character_token")
                    index += 1
                } else {
                    return nil
                }
            case .naryIdentifier:
                var identifierCount = 0
                while index < tokens.count {
                    let next = tokens[index]
                    if next == bang {
                        output.append(next)
                        index += 1
                        break
                    }
                    if let repairedBang = nearestReservedMatch(for: next, in: [bang]), repairedBang == bang {
                        output.append(bang)
                        reasons.append("terminator_token")
                        index += 1
                        break
                    }
                    guard TalonLiteGrammarParser.isIdentifier(next) else {
                        return nil
                    }
                    output.append(next)
                    identifierCount += 1
                    index += 1
                }
                guard identifierCount > 0 else {
                    return nil
                }
                if output.last != bang {
                    output.append(bang)
                    reasons.append("missing_terminator")
                }
            case .naryCharacter:
                var characterCount = 0
                while index < tokens.count {
                    let next = tokens[index]
                    if next == bang {
                        output.append(next)
                        index += 1
                        break
                    }
                    if let repairedBang = nearestReservedMatch(for: next, in: [bang]), repairedBang == bang {
                        output.append(bang)
                        reasons.append("terminator_token")
                        index += 1
                        break
                    }
                    if TalonLiteGrammarParser.isCharacter(next) {
                        output.append(next)
                        characterCount += 1
                        index += 1
                        continue
                    }
                    if let repairedCharacter = nearestReservedMatch(for: next, in: characterTokens) {
                        output.append(repairedCharacter)
                        reasons.append("character_token")
                        characterCount += 1
                        index += 1
                        continue
                    }
                    return nil
                }
                guard characterCount > 0 else {
                    return nil
                }
                if output.last != bang {
                    output.append(bang)
                    reasons.append("missing_terminator")
                }
            }
        }

        let repaired = output.joined(separator: " ")
        guard repaired != transcript, !reasons.isEmpty else {
            return nil
        }
        return Result(transcript: repaired, reason: reasons.joined(separator: ","))
    }

    private struct OperatorMatch {
        let phrase: [String]
        let kind: OperatorKind
        let wasCorrected: Bool
    }

    private static func nearestOperatorMatch(at index: Int, tokens: [String]) -> OperatorMatch? {
        var best: (distance: Int, spec: OperatorSpec)?

        for spec in operatorSpecs {
            guard index + spec.phrase.count <= tokens.count else {
                continue
            }
            let slice = Array(tokens[index ..< index + spec.phrase.count])
            let pairs = Array(zip(slice, spec.phrase))
            let distances = pairs.map { editDistance($0.0, $0.1) }
            guard zip(distances, pairs).allSatisfy({ distance, pair in
                distance <= threshold(for: pair.1)
            }) else {
                continue
            }
            let totalDistance = distances.reduce(0, +)
            if totalDistance == 0 {
                return OperatorMatch(phrase: spec.phrase, kind: spec.kind, wasCorrected: false)
            }
            if let best, best.distance <= totalDistance {
                continue
            }
            best = (totalDistance, spec)
        }

        guard let best else {
            return nil
        }
        return OperatorMatch(phrase: best.spec.phrase, kind: best.spec.kind, wasCorrected: true)
    }

    private static func nearestReservedMatch<S: Sequence>(for token: String, in candidates: S) -> String? where S.Element == String {
        var bestCandidate: String?
        var bestDistance = Int.max

        for candidate in candidates {
            let distance = editDistance(token, candidate)
            guard distance <= threshold(for: candidate), distance < bestDistance else {
                continue
            }
            bestCandidate = candidate
            bestDistance = distance
        }

        return bestDistance == 0 ? nil : bestCandidate
    }

    private static func threshold(for candidate: String) -> Int {
        candidate.count >= 6 ? 2 : 1
    }

    private static func editDistance(_ lhs: String, _ rhs: String) -> Int {
        let lhsChars = Array(lhs)
        let rhsChars = Array(rhs)
        var previous = Array(0 ... rhsChars.count)

        for (i, l) in lhsChars.enumerated() {
            var current = [i + 1]
            current.reserveCapacity(rhsChars.count + 1)
            for (j, r) in rhsChars.enumerated() {
                let substitutionCost = l == r ? 0 : 1
                current.append(
                    min(
                        previous[j + 1] + 1,
                        current[j] + 1,
                        previous[j] + substitutionCost
                    )
                )
            }
            previous = current
        }

        return previous.last ?? rhsChars.count
    }
}

private extension ContinuousClock.Instant {
    var durationMs: Int {
        let duration = ContinuousClock.now - self
        return Int(duration.components.seconds * 1000) + Int(duration.components.attoseconds / 1_000_000_000_000_000)
    }
}
