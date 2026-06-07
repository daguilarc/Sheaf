import Foundation

public struct TalonLiteAST: Sendable, Equatable {
    public let expressions: [Expression]

    public init(expressions: [Expression]) {
        self.expressions = expressions
    }

    public enum Expression: Sendable, Equatable {
        case character(String)
        case operatorCall(OperatorCall)
        case bang
    }

    public enum OperatorCall: Sendable, Equatable {
        case unaryIdentifier(op: String, identifier: String)
        case unaryCharacter(op: String, character: String)
        case naryIdentifier(op: String, identifiers: [String])
        case naryCharacter(op: String, characters: [String])
    }
}

public enum TalonLiteGrammarParseError: Error, Sendable, Equatable {
    case emptyInput
    case invalidToken(String)
    case expectedIdentifier(after: String)
    case expectedCharacter(after: String)
    case expectedBangTerminator(after: String)
    case expectedAtLeastOneArgument(after: String)

    public var message: String {
        switch self {
        case .emptyInput:
            return "No Talon tokens detected"
        case let .invalidToken(token):
            return "Invalid Talon token: \(token)"
        case let .expectedIdentifier(op):
            return "Expected identifier after \(op)"
        case let .expectedCharacter(op):
            return "Expected character after \(op)"
        case let .expectedBangTerminator(op):
            return "Expected blark terminator after \(op) arguments"
        case let .expectedAtLeastOneArgument(op):
            return "Expected at least one argument after \(op)"
        }
    }
}

public enum TalonLiteGrammarParser {
    public static let grammarText = """
    Grammar:
    program = expression ;

    expression =
          character [expression]
        | operator_call [expression]
        | special_bang [expression]
        ;

    operator_call =
          unary_identifier_operator identifier
        | unary_character_operator character
        | binary_identifier_operator identifier identifier
        | binary_character_operator character character
        | nary_identifier_operator identifier+ special_bang
        | nary_character_operator character+ special_bang
        ;

    special_bang = "blark" ;

    unary_identifier_operator = word
    unary_character_operator = shift
    binary_identifier_operator = <empty>
    binary_character_operator = <empty>
    nary_identifier_operator = all cap | all down | hammer | smash | camel | snake | kebab | dotted | conga | slasher | packed | constant | string | dub string | padded
    nary_character_operator = <empty>
    """

    private enum OperatorKind {
        case unaryIdentifier(String)
        case unaryCharacter(String)
        case naryIdentifier(String)
        case naryCharacter(String)
    }

    private static let letterCharacters: Set<String> = [
        "air", "bat", "cap", "drum", "each", "fine", "gust", "harp", "sit", "jury", "crunch", "look", "made",
        "near", "odd", "pit", "quench", "red", "sun", "trap", "urge", "vest", "whale", "plex", "yank", "zip"
    ]

    private static let digitCharacters: Set<String> = [
        "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"
    ]

    private static let punctuationCharacters: Set<String> = [
        "bang", "doublequote", "hash", "dollar", "percent", "ampersand", "apostrophe", "star", "plus", "comma", "dash",
        "dot", "quote", "slash", "colon", "semicolon", "less", "equals", "greater", "question", "at", "backslash", "caret",
        "underscore", "backtick", "pipe", "tilde"
    ]

    private static let braceCharacters: Set<String> = ["paren", "angle", "square", "brace"]
    private static let unaryIdentifierOperators: [[String]] = [["word"]]
    private static let unaryCharacterOperators: [[String]] = [["shift"]]
    private static let naryIdentifierOperators: [[String]] = [
        ["all", "cap"], ["all", "down"], ["hammer"], ["smash"], ["camel"], ["snake"], ["kebab"],
        ["dotted"], ["conga"], ["slasher"], ["packed"], ["constant"], ["string"], ["dub", "string"], ["padded"]
    ]
    private static let naryCharacterOperators: [[String]] = []

    private static let bangToken = "blark"

    public static var letterCharacterTokens: Set<String> { letterCharacters }
    public static var digitCharacterTokens: Set<String> { digitCharacters }
    public static var punctuationCharacterTokens: Set<String> { punctuationCharacters }
    public static var braceCharacterTokens: Set<String> { braceCharacters }
    public static var characterTokens: Set<String> {
        letterCharacters.union(digitCharacters).union(punctuationCharacters).union(braceCharacters)
    }
    public static var unaryIdentifierOperatorTokens: [[String]] { unaryIdentifierOperators }
    public static var unaryCharacterOperatorTokens: [[String]] { unaryCharacterOperators }
    public static var naryIdentifierOperatorTokens: [[String]] { naryIdentifierOperators }
    public static var naryCharacterOperatorTokens: [[String]] { naryCharacterOperators }
    public static var allOperatorTokens: [[String]] {
        unaryIdentifierOperators + unaryCharacterOperators + naryIdentifierOperators + naryCharacterOperators
    }
    public static var bangLiteral: String { bangToken }
    public static var reservedTokens: Set<String> { reservedSingleTokens }

    private static let reservedSingleTokens: Set<String> = {
        let opWords = (unaryIdentifierOperators + unaryCharacterOperators + naryIdentifierOperators + naryCharacterOperators)
            .flatMap { $0 }
        return Set(opWords)
            .union(letterCharacters)
            .union(digitCharacters)
            .union(punctuationCharacters)
            .union(braceCharacters)
            .union([bangToken])
    }()

    public static func parse(_ transcript: String) throws -> TalonLiteAST {
        let tokens = transcript
            .lowercased()
            .split(whereSeparator: { $0.isWhitespace })
            .compactMap(normalizedWord)

        guard !tokens.isEmpty else {
            throw TalonLiteGrammarParseError.emptyInput
        }

        var index = 0
        var expressions: [TalonLiteAST.Expression] = []

        while index < tokens.count {
            let token = tokens[index]

            if token == bangToken {
                expressions.append(.bang)
                index += 1
                continue
            }

            if isCharacter(token) {
                expressions.append(.character(token))
                index += 1
                continue
            }

            if let (kind, consumed) = matchOperator(at: index, tokens: tokens) {
                let op = tokens[index ..< index + consumed].joined(separator: " ")
                index += consumed

                switch kind {
                case .unaryIdentifier:
                    guard index < tokens.count else {
                        throw TalonLiteGrammarParseError.expectedIdentifier(after: op)
                    }
                    let identifier = tokens[index]
                    guard isIdentifier(identifier) else {
                        throw TalonLiteGrammarParseError.expectedIdentifier(after: op)
                    }
                    expressions.append(.operatorCall(.unaryIdentifier(op: op, identifier: identifier)))
                    index += 1
                case .unaryCharacter:
                    guard index < tokens.count else {
                        throw TalonLiteGrammarParseError.expectedCharacter(after: op)
                    }
                    let character = tokens[index]
                    guard isCharacter(character) else {
                        throw TalonLiteGrammarParseError.expectedCharacter(after: op)
                    }
                    expressions.append(.operatorCall(.unaryCharacter(op: op, character: character)))
                    index += 1
                case .naryIdentifier:
                    var identifiers: [String] = []
                    while index < tokens.count, tokens[index] != bangToken {
                        let identifier = tokens[index]
                        guard isIdentifier(identifier) else {
                            throw TalonLiteGrammarParseError.expectedIdentifier(after: op)
                        }
                        identifiers.append(identifier)
                        index += 1
                    }
                    guard !identifiers.isEmpty else {
                        throw TalonLiteGrammarParseError.expectedAtLeastOneArgument(after: op)
                    }
                    guard index < tokens.count, tokens[index] == bangToken else {
                        throw TalonLiteGrammarParseError.expectedBangTerminator(after: op)
                    }
                    index += 1
                    expressions.append(.operatorCall(.naryIdentifier(op: op, identifiers: identifiers)))
                case .naryCharacter:
                    var characters: [String] = []
                    while index < tokens.count, tokens[index] != bangToken {
                        let character = tokens[index]
                        guard isCharacter(character) else {
                            throw TalonLiteGrammarParseError.expectedCharacter(after: op)
                        }
                        characters.append(character)
                        index += 1
                    }
                    guard !characters.isEmpty else {
                        throw TalonLiteGrammarParseError.expectedAtLeastOneArgument(after: op)
                    }
                    guard index < tokens.count, tokens[index] == bangToken else {
                        throw TalonLiteGrammarParseError.expectedBangTerminator(after: op)
                    }
                    index += 1
                    expressions.append(.operatorCall(.naryCharacter(op: op, characters: characters)))
                }
                continue
            }

            throw TalonLiteGrammarParseError.invalidToken(token)
        }

        return TalonLiteAST(expressions: expressions)
    }

    public static func isCharacter(_ token: String) -> Bool {
        letterCharacters.contains(token)
            || digitCharacters.contains(token)
            || punctuationCharacters.contains(token)
            || braceCharacters.contains(token)
    }

    public static func isIdentifier(_ token: String) -> Bool {
        token.allSatisfy { $0.isLetter } && !reservedSingleTokens.contains(token)
    }

    private static func matchOperator(at index: Int, tokens: [String]) -> (OperatorKind, Int)? {
        let candidates: [(OperatorKind, [[String]])] = [
            (.unaryIdentifier("word"), unaryIdentifierOperators),
            (.unaryCharacter("shift"), unaryCharacterOperators),
            (.naryIdentifier(""), naryIdentifierOperators),
            (.naryCharacter(""), naryCharacterOperators)
        ]

        var best: (OperatorKind, Int)?
        for (kind, phrases) in candidates {
            for phrase in phrases {
                guard index + phrase.count <= tokens.count else {
                    continue
                }
                let slice = Array(tokens[index ..< index + phrase.count])
                guard slice == phrase else {
                    continue
                }
                if let current = best, current.1 >= phrase.count {
                    continue
                }
                let matchedKind: OperatorKind
                switch kind {
                case .unaryIdentifier:
                    matchedKind = .unaryIdentifier(phrase.joined(separator: " "))
                case .unaryCharacter:
                    matchedKind = .unaryCharacter(phrase.joined(separator: " "))
                case .naryIdentifier:
                    matchedKind = .naryIdentifier(phrase.joined(separator: " "))
                case .naryCharacter:
                    matchedKind = .naryCharacter(phrase.joined(separator: " "))
                }
                best = (matchedKind, phrase.count)
            }
        }

        return best
    }

    private static func normalizedWord(_ raw: Substring) -> String? {
        let token = String(raw)
        if token.isEmpty {
            return nil
        }

        let trimmed = token.trimmingCharacters(in: CharacterSet(charactersIn: ".,!?;:'\"“”‘’()[]{}<>"))
        return trimmed.isEmpty ? nil : trimmed
    }
}

public enum TalonLiteRenderer {
    private static let letterMap: [String: String] = [
        "air": "a", "bat": "b", "cap": "c", "drum": "d", "each": "e", "fine": "f", "gust": "g", "harp": "h",
        "sit": "i", "jury": "j", "crunch": "k", "look": "l", "made": "m", "near": "n", "odd": "o", "pit": "p",
        "quench": "q", "red": "r", "sun": "s", "trap": "t", "urge": "u", "vest": "v", "whale": "w", "plex": "x",
        "yank": "y", "zip": "z"
    ]

    private static let digitMap: [String: String] = [
        "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4",
        "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9"
    ]

    private static let punctuationMap: [String: String] = [
        "bang": "!", "doublequote": "\"", "hash": "#", "dollar": "$", "percent": "%", "ampersand": "&",
        "apostrophe": "'", "star": "*", "plus": "+", "comma": ",", "dash": "-", "dot": ".", "quote": "'", "slash": "/",
        "colon": ":", "semicolon": ";", "less": "<", "equals": "=", "greater": ">", "question": "?", "at": "@",
        "backslash": "\\", "caret": "^", "underscore": "_", "backtick": "`", "pipe": "|", "tilde": "~"
    ]

    private static let braceOpenAndClose: [String: (open: String, close: String)] = [
        "paren": ("(", ")"),
        "square": ("[", "]"),
        "angle": ("<", ">"),
        "brace": ("{", "}")
    ]

    public static func render(_ ast: TalonLiteAST) throws -> String {
        var output = ""
        var closers: [String] = []

        for expression in ast.expressions {
            switch expression {
            case let .character(token):
                output.append(try renderCharacter(token, applyShift: false, closers: &closers))
            case .bang:
                guard let closer = closers.popLast() else {
                    throw DictatorError.talonPipelineFailed("render: blark encountered with empty brace stack")
                }
                output.append(closer)
            case let .operatorCall(call):
                switch call {
                case let .unaryIdentifier(op: _, identifier: identifier):
                    output.append(identifier)
                case let .unaryCharacter(op: _, character: character):
                    output.append(try renderCharacter(character, applyShift: true, closers: &closers))
                case let .naryIdentifier(op: op, identifiers: identifiers):
                    output.append(formatIdentifiers(op: op, identifiers: identifiers))
                case .naryCharacter:
                    throw DictatorError.talonPipelineFailed("render: n-ary character operators are not supported")
                }
            }
        }

        return output
    }

    private static func renderCharacter(_ token: String, applyShift: Bool, closers: inout [String]) throws -> String {
        if let letter = letterMap[token] {
            return applyShift ? letter.uppercased() : letter
        }

        if let digit = digitMap[token] {
            return digit
        }

        if let punctuation = punctuationMap[token] {
            return punctuation
        }

        if let brace = braceOpenAndClose[token] {
            closers.append(brace.close)
            return brace.open
        }

        throw DictatorError.talonPipelineFailed("render: unknown character token \(token)")
    }

    private static func formatIdentifiers(op: String, identifiers: [String]) -> String {
        switch op {
        case "hammer":
            return identifiers.map(capitalize).joined()
        case "camel":
            guard let first = identifiers.first else {
                return ""
            }
            let head = first.lowercased()
            let tail = identifiers.dropFirst().map(capitalize).joined()
            return head + tail
        case "smash":
            return identifiers.map { $0.lowercased() }.joined()
        case "snake":
            return identifiers.map { $0.lowercased() }.joined(separator: "_")
        case "kebab":
            return identifiers.map { $0.lowercased() }.joined(separator: "-")
        case "dotted":
            return identifiers.map { $0.lowercased() }.joined(separator: ".")
        case "conga":
            return identifiers.map { $0.lowercased() }.joined(separator: "/")
        case "slasher":
            return "/" + identifiers.map { $0.lowercased() }.joined(separator: "/")
        case "packed":
            return identifiers.map { $0.lowercased() }.joined(separator: "::")
        case "constant":
            return identifiers.map { $0.uppercased() }.joined(separator: "_")
        case "string":
            return "'" + identifiers.joined(separator: " ") + "'"
        case "dub string":
            return "\"" + identifiers.joined(separator: " ") + "\""
        case "padded":
            return "\" " + identifiers.joined(separator: " ") + " \""
        case "all cap":
            return identifiers.map { $0.uppercased() }.joined(separator: " ")
        case "all down":
            return identifiers.map { $0.lowercased() }.joined(separator: " ")
        default:
            return identifiers.joined(separator: " ")
        }
    }

    private static func capitalize(_ token: String) -> String {
        guard let first = token.first else {
            return token
        }
        return String(first).uppercased() + String(token.dropFirst()).lowercased()
    }
}
