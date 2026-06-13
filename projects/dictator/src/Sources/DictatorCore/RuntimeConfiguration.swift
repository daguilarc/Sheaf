import Foundation

public enum RuntimeConfigurationValue: Sendable, Equatable {
    case string(String)
    case bool(Bool)
}

public struct RuntimeConfigurationSnapshot: Sendable, Equatable {
    public let name: String
    public let currentValue: RuntimeConfigurationValue
    public let defaultValue: RuntimeConfigurationValue
    public let options: [RuntimeConfigurationValue]

    public init(
        name: String,
        currentValue: RuntimeConfigurationValue,
        defaultValue: RuntimeConfigurationValue,
        options: [RuntimeConfigurationValue] = []
    ) {
        self.name = name
        self.currentValue = currentValue
        self.defaultValue = defaultValue
        self.options = options
    }
}

open class RuntimeConfiguration: @unchecked Sendable {
    public let name: String
    public let defaultValue: RuntimeConfigurationValue
    private let lock = NSLock()
    private var currentValueStorage: RuntimeConfigurationValue

    public var currentValue: RuntimeConfigurationValue {
        lock.lock()
        defer { lock.unlock() }
        return currentValueStorage
    }

    public init(name: String, currentValue: RuntimeConfigurationValue, defaultValue: RuntimeConfigurationValue) {
        self.name = name
        self.currentValueStorage = currentValue
        self.defaultValue = defaultValue
    }

    open func getOptions() async throws -> [RuntimeConfigurationValue] {
        fatalError("Subclasses must override getOptions()")
    }

    open func set(_ value: RuntimeConfigurationValue) async throws {
        fatalError("Subclasses must override set(_:)")
    }

    public func snapshot() async throws -> RuntimeConfigurationSnapshot {
        RuntimeConfigurationSnapshot(
            name: name,
            currentValue: currentValue,
            defaultValue: defaultValue,
            options: try await getOptions()
        )
    }

    public func snapshotWithoutOptions() -> RuntimeConfigurationSnapshot {
        RuntimeConfigurationSnapshot(
            name: name,
            currentValue: currentValue,
            defaultValue: defaultValue,
            options: []
        )
    }

    func updateCurrentValue(_ value: RuntimeConfigurationValue) {
        lock.lock()
        currentValueStorage = value
        lock.unlock()
    }
}

public final class RuntimeModelConfiguration: RuntimeConfiguration, @unchecked Sendable {
    public enum Target: Sendable {
        case cloud
        case local
    }

    public enum OptionsSource: Sendable {
        case ollama
        case openAI(secretStore: SecretStore)
    }

    private let runtimeConfigProvider: RuntimeConfigProvider
    private let target: Target
    private let optionsSource: OptionsSource
    private let host: String
    private let session: URLSession
    private static let cloudModelPresets: [(label: String, modelID: String)] = [
        ("gpt-4.1-mini", "gpt-4.1-mini"),
        ("gpt-5.2", "gpt-5.2")
    ]

    public init(
        name: String,
        currentValue: String,
        defaultValue: String,
        target: Target,
        optionsSource: OptionsSource,
        runtimeConfigProvider: RuntimeConfigProvider,
        host: String,
        session: URLSession = .shared
    ) {
        self.runtimeConfigProvider = runtimeConfigProvider
        self.target = target
        self.optionsSource = optionsSource
        self.host = host
        self.session = session
        super.init(
            name: name,
            currentValue: .string(currentValue),
            defaultValue: .string(defaultValue)
        )
    }

    public override func getOptions() async throws -> [RuntimeConfigurationValue] {
        let models = try await availableModels()
        return models.map { .string($0) }
    }

    private func availableModels() async throws -> [String] {
        switch optionsSource {
        case .ollama:
            return try await fetchOllamaModels()
        case .openAI:
            return Self.cloudModelPresets.map(\.label)
        }
    }

    private func fetchOllamaModels() async throws -> [String] {
        guard let url = URL(string: "\(host)/api/tags") else {
            throw DictatorError.configUpdateFailed("invalid Ollama host")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"

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
            throw DictatorError.configUpdateFailed("Ollama model list request failed: \(error)")
        }

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

    public override func set(_ value: RuntimeConfigurationValue) async throws {
        guard case let .string(requestedModel) = value else {
            throw DictatorError.configUpdateFailed("\(name) must be a string")
        }

        let availableModels = try await availableModels()
        let resolvedModel = bestMatch(for: requestedModel, in: availableModels)
        let resolvedModelID = canonicalCloudModelID(for: resolvedModel)

        let updated: RuntimeConfigFile
        switch target {
        case .cloud:
            updated = try await runtimeConfigProvider.applyInMemoryPatch(
                RuntimeConfigPatch(cloudModel: resolvedModelID)
            )
            updateCurrentValue(.string(displayCloudModelValue(for: updated.cloudModel)))
        case .local:
            updated = try await runtimeConfigProvider.applyInMemoryPatch(
                RuntimeConfigPatch(localModel: resolvedModel)
            )
            updateCurrentValue(.string(updated.localModel))
        }
    }

    private func bestMatch(for requested: String, in availableModels: [String]) -> String {
        let trimmed = requested.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return trimmed
        }
        guard !availableModels.isEmpty else {
            return trimmed
        }

        let requestedNormalized = normalize(trimmed)
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
            .first?.model ?? trimmed
    }

    private func normalize(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private func canonicalCloudModelID(for requested: String) -> String {
        guard target == .cloud else {
            return requested
        }

        let requestedNormalized = normalize(requested)
        if let preset = Self.cloudModelPresets.first(where: { normalize($0.label) == requestedNormalized || normalize($0.modelID) == requestedNormalized }) {
            return preset.modelID
        }
        return requested
    }

    private func displayCloudModelValue(for modelID: String) -> String {
        guard target == .cloud else {
            return modelID
        }
        let normalized = normalize(modelID)
        return Self.cloudModelPresets.first(where: { normalize($0.modelID) == normalized })?.label ?? modelID
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

public final class RuntimeBooleanConfiguration: RuntimeConfiguration, @unchecked Sendable {
    private let runtimeConfigProvider: RuntimeConfigProvider

    public init(
        name: String,
        currentValue: Bool,
        defaultValue: Bool,
        runtimeConfigProvider: RuntimeConfigProvider
    ) {
        self.runtimeConfigProvider = runtimeConfigProvider
        super.init(
            name: name,
            currentValue: .bool(currentValue),
            defaultValue: .bool(defaultValue)
        )
    }

    public override func getOptions() async throws -> [RuntimeConfigurationValue] {
        [.bool(false), .bool(true)]
    }

    public override func set(_ value: RuntimeConfigurationValue) async throws {
        guard case let .bool(boolValue) = value else {
            throw DictatorError.configUpdateFailed("\(name) must be a boolean")
        }

        let updated = try await runtimeConfigProvider.applyInMemoryPatch(
            RuntimeConfigPatch(useCloud: boolValue)
        )
        updateCurrentValue(.bool(updated.useCloud))
    }
}

public final class RuntimeSystemPromptConfiguration: RuntimeConfiguration, @unchecked Sendable {
    public enum Target: Sendable {
        case primary
        case auxiliary1
        case auxiliary2
        case review
    }

    private let runtimeConfigProvider: RuntimeConfigProvider
    private let promptCatalog: SystemPromptCatalog
    private let target: Target

    public init(
        name: String,
        currentValue: String,
        defaultValue: String,
        runtimeConfigProvider: RuntimeConfigProvider,
        target: Target = .primary,
        promptCatalog: SystemPromptCatalog = SystemPromptCatalog()
    ) {
        self.runtimeConfigProvider = runtimeConfigProvider
        self.promptCatalog = promptCatalog
        self.target = target
        super.init(
            name: name,
            currentValue: .string(currentValue),
            defaultValue: .string(defaultValue)
        )
    }

    public override func getOptions() async throws -> [RuntimeConfigurationValue] {
        try promptCatalog.listPromptFiles().map { .string($0) }
    }

    public override func set(_ value: RuntimeConfigurationValue) async throws {
        guard case let .string(promptFile) = value else {
            throw DictatorError.configUpdateFailed("\(name) must be a string")
        }
        let sanitizedPath = promptCatalog.sanitizeRelativePath(promptFile)
        let available = try promptCatalog.listPromptFiles()
        guard available.contains(sanitizedPath) else {
            throw DictatorError.configUpdateFailed("unknown system prompt path: \(sanitizedPath)")
        }
        let patch: RuntimeConfigPatch
        switch target {
        case .primary:
            patch = RuntimeConfigPatch(systemPrompt: sanitizedPath)
        case .auxiliary1:
            patch = RuntimeConfigPatch(auxiliarySystemPrompt1: sanitizedPath)
        case .auxiliary2:
            patch = RuntimeConfigPatch(auxiliarySystemPrompt2: sanitizedPath)
        case .review:
            patch = RuntimeConfigPatch(reviewSystemPrompt: sanitizedPath)
        }
        let updated = try await runtimeConfigProvider.applyInMemoryPatch(
            patch
        )
        let updatedValue: String
        switch target {
        case .primary:
            updatedValue = updated.systemPrompt
        case .auxiliary1:
            updatedValue = updated.auxiliarySystemPrompt1
        case .auxiliary2:
            updatedValue = updated.auxiliarySystemPrompt2
        case .review:
            updatedValue = updated.reviewSystemPrompt
        }
        updateCurrentValue(.string(updatedValue))
    }
}

public final class RuntimeInteractionsBufferConfiguration: RuntimeConfiguration, @unchecked Sendable {
    private let runtimeConfigProvider: RuntimeConfigProvider
    private let onBytesUpdated: ((Int) -> Void)?
    private let optionsMegabytes: [Int]
    private static let bytesPerMB = 1024 * 1024

    public init(
        name: String,
        currentValueBytes: Int,
        defaultValueBytes: Int,
        runtimeConfigProvider: RuntimeConfigProvider,
        optionsMegabytes: [Int] = [25, 50, 100, 200, 500],
        onBytesUpdated: ((Int) -> Void)? = nil
    ) {
        self.runtimeConfigProvider = runtimeConfigProvider
        self.optionsMegabytes = optionsMegabytes
        self.onBytesUpdated = onBytesUpdated
        super.init(
            name: name,
            currentValue: .string(Self.displayValue(forBytes: currentValueBytes)),
            defaultValue: .string(Self.displayValue(forBytes: defaultValueBytes))
        )
    }

    public override func getOptions() async throws -> [RuntimeConfigurationValue] {
        optionsMegabytes.map { .string("\($0) MB") }
    }

    public override func set(_ value: RuntimeConfigurationValue) async throws {
        guard case let .string(stringValue) = value else {
            throw DictatorError.configUpdateFailed("\(name) must be a string")
        }

        let bytes = try Self.parseMegabytes(from: stringValue) * Self.bytesPerMB
        let updated = try await runtimeConfigProvider.applyInMemoryPatch(
            RuntimeConfigPatch(interactionsBufferBytes: bytes)
        )
        updateCurrentValue(.string(Self.displayValue(forBytes: updated.interactionsBufferBytes)))
        onBytesUpdated?(updated.interactionsBufferBytes)
    }

    private static func parseMegabytes(from value: String) throws -> Int {
        let digits = value.filter(\.isNumber)
        guard let parsed = Int(digits), parsed > 0 else {
            throw DictatorError.configUpdateFailed("invalid interactions buffer size: \(value)")
        }
        return parsed
    }

    private static func displayValue(forBytes bytes: Int) -> String {
        "\(max(1, bytes / bytesPerMB)) MB"
    }
}

public actor RuntimeConfigurationManager {
    private let configurations: [RuntimeConfiguration]

    public init(configurations: [RuntimeConfiguration]) {
        self.configurations = configurations
    }

    public func list() async throws -> [RuntimeConfigurationSnapshot] {
        var snapshots: [RuntimeConfigurationSnapshot] = []
        snapshots.reserveCapacity(configurations.count)
        for configuration in configurations {
            snapshots.append(configuration.snapshotWithoutOptions())
        }
        return snapshots
    }

    public func getOptions(name: String) async throws -> [RuntimeConfigurationValue] {
        guard let configuration = configurations.first(where: { $0.name == name }) else {
            throw DictatorError.configUpdateFailed("unknown runtime configuration: \(name)")
        }
        return try await configuration.getOptions()
    }

    public func set(name: String, value: RuntimeConfigurationValue) async throws {
        guard let configuration = configurations.first(where: { $0.name == name }) else {
            throw DictatorError.configUpdateFailed("unknown runtime configuration: \(name)")
        }
        try await configuration.set(value)
    }

    public func resetToDefaults() async throws {
        for configuration in configurations {
            try await configuration.set(configuration.defaultValue)
        }
    }
}

private struct OllamaTagsResponse: Decodable {
    let models: [OllamaTag]
}

private struct OllamaTag: Decodable {
    let name: String
}
