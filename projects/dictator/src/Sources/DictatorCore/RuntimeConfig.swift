import Foundation

public enum OpenAIReasoningEffort: String, Codable, Sendable, CaseIterable {
    case none
    case low
    case medium
    case high
    case xhigh
    case max
}

public enum LaunchpadModel: String, Codable, Sendable, CaseIterable {
    case proMk3 = "pro_mk3"
    case miniMk3 = "mini_mk3"

    public static let defaultPreferences: [LaunchpadModel] = [.proMk3, .miniMk3]
}

public struct RuntimeConfigFile: Codable, Sendable, Equatable {
    public static let defaultInteractionsBufferBytes: Int = 100 * 1024 * 1024
    public static let defaultOllamaHost = "http://127.0.0.1:11434"
    public static let defaultCloudModel = "gpt-4.1-mini"
    public static let defaultLocalModel = "qwen2.5:7b-instruct"
    public static let defaultFallbackMode = "openai"
    public static let defaultSTTModelPath = "models/ggml-base.en.bin"
    public static let defaultSTTLanguage = "en"
    public static let defaultOllamaBinPath = "/opt/homebrew/bin/ollama"
    public static let defaultDataDir = "data/dictator"
    public static let defaultSystemPromptsDir = "projects/dictator/src/prompts/system-prompts"
    public static let defaultDictatorServerHost = "0.0.0.0"
    public static let defaultDictatorServerPort = 9003
    public static let defaultDictatorServerEnabled = true
    public static let defaultInjectableRules: [String: String] = [:]
    public static let defaultAudioInput: String? = nil
    public static let defaultLaunchpadModels = LaunchpadModel.defaultPreferences

    public let version: Int
    public let cloudModel: String
    public let localModel: String
    public let reasoningEffort: OpenAIReasoningEffort?
    public let audioInput: String?
    public let systemPrompt: String
    public let auxiliarySystemPrompt1: String
    public let auxiliarySystemPrompt2: String
    public let interactionsBufferBytes: Int
    public let useCloud: Bool
    public let fallbackMode: String
    public let ollamaHost: String
    public let sttModelPath: String
    public let sttLanguage: String
    public let ollamaBinPath: String
    public let dataDir: String
    public let systemPromptsDir: String
    public let dictatorServerHost: String
    public let dictatorServerPort: Int
    public let dictatorServerEnabled: Bool
    public let injectableRules: [String: String]
    public let launchpadModels: [LaunchpadModel]
    public let updatedAt: String

    public var model: String {
        useCloud ? cloudModel : localModel
    }

    public init(
        version: Int = 2,
        cloudModel: String,
        localModel: String,
        reasoningEffort: OpenAIReasoningEffort? = nil,
        audioInput: String? = Self.defaultAudioInput,
        systemPrompt: String = SystemPromptCatalog.defaultPromptFile,
        auxiliarySystemPrompt1: String = SystemPromptCatalog.defaultPromptFile,
        auxiliarySystemPrompt2: String = SystemPromptCatalog.defaultPromptFile,
        interactionsBufferBytes: Int = Self.defaultInteractionsBufferBytes,
        useCloud: Bool,
        fallbackMode: String = Self.defaultFallbackMode,
        ollamaHost: String = Self.defaultOllamaHost,
        sttModelPath: String = Self.defaultSTTModelPath,
        sttLanguage: String = Self.defaultSTTLanguage,
        ollamaBinPath: String = Self.defaultOllamaBinPath,
        dataDir: String = Self.defaultDataDir,
        systemPromptsDir: String = Self.defaultSystemPromptsDir,
        dictatorServerHost: String = Self.defaultDictatorServerHost,
        dictatorServerPort: Int = Self.defaultDictatorServerPort,
        dictatorServerEnabled: Bool = Self.defaultDictatorServerEnabled,
        injectableRules: [String: String] = Self.defaultInjectableRules,
        launchpadModels: [LaunchpadModel] = Self.defaultLaunchpadModels,
        updatedAt: String
    ) {
        self.version = version
        self.cloudModel = cloudModel
        self.localModel = localModel
        self.reasoningEffort = reasoningEffort
        self.audioInput = Self.normalizedNonEmpty(audioInput)
        self.systemPrompt = systemPrompt
        self.auxiliarySystemPrompt1 = auxiliarySystemPrompt1
        self.auxiliarySystemPrompt2 = auxiliarySystemPrompt2
        self.interactionsBufferBytes = interactionsBufferBytes
        self.useCloud = useCloud
        self.fallbackMode = fallbackMode
        self.ollamaHost = Self.trimTrailingSlash(ollamaHost)
        self.sttModelPath = sttModelPath
        self.sttLanguage = sttLanguage
        self.ollamaBinPath = ollamaBinPath
        self.dataDir = dataDir
        self.systemPromptsDir = systemPromptsDir
        self.dictatorServerHost = dictatorServerHost
        self.dictatorServerPort = dictatorServerPort
        self.dictatorServerEnabled = dictatorServerEnabled
        self.injectableRules = Self.normalizedInjectableRules(injectableRules)
        self.launchpadModels = Self.validatedLaunchpadModels(launchpadModels)
        self.updatedAt = updatedAt
    }

    public init(version: Int = 1, model: String, useCloud: Bool, updatedAt: String) {
        self.init(
            version: version,
            cloudModel: model,
            localModel: model,
            useCloud: useCloud,
            updatedAt: updatedAt
        )
    }

    enum CodingKeys: String, CodingKey {
        case version
        case model
        case cloudModel = "cloud_model"
        case localModel = "local_model"
        case reasoningEffort = "reasoning_effort"
        case audioInput = "audio_input"
        case audioInputCamel = "audioInput"
        case systemPrompt = "system_prompt"
        case auxiliarySystemPrompt1 = "auxiliary_system_prompt_1"
        case auxiliarySystemPrompt2 = "auxiliary_system_prompt_2"
        case interactionsBufferBytes = "interactions_buffer_bytes"
        case useCloud = "use_cloud"
        case fallbackMode = "fallback_mode"
        case ollamaHost = "ollama_host"
        case sttModelPath = "stt_model_path"
        case sttLanguage = "stt_language"
        case ollamaBinPath = "ollama_bin_path"
        case dataDir = "data_dir"
        case systemPromptsDir = "system_prompts_dir"
        case dictatorServerHost = "dictator_server_host"
        case dictatorServerPort = "dictator_server_port"
        case dictatorServerEnabled = "dictator_server_enabled"
        case injectableRules = "injectable_rules"
        case launchpadModels = "launchpad_models"
        case launchpadModel = "launchpad_model"
        case updatedAt = "updated_at"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        let version = try container.decodeIfPresent(Int.self, forKey: .version) ?? 1
        let useCloud = try container.decode(Bool.self, forKey: .useCloud)
        let updatedAt = try container.decode(String.self, forKey: .updatedAt)

        let cloudModel = try container.decodeIfPresent(String.self, forKey: .cloudModel)
        let localModel = try container.decodeIfPresent(String.self, forKey: .localModel)
        let reasoningEffort = try container.decodeIfPresent(OpenAIReasoningEffort.self, forKey: .reasoningEffort)
        let audioInput = try container.decodeIfPresent(String.self, forKey: .audioInput)
            ?? container.decodeIfPresent(String.self, forKey: .audioInputCamel)
        let systemPrompt = try container.decodeIfPresent(String.self, forKey: .systemPrompt)
        let auxiliarySystemPrompt1 = try container.decodeIfPresent(String.self, forKey: .auxiliarySystemPrompt1)
        let auxiliarySystemPrompt2 = try container.decodeIfPresent(String.self, forKey: .auxiliarySystemPrompt2)
        let interactionsBufferBytes = try container.decodeIfPresent(Int.self, forKey: .interactionsBufferBytes)
        let fallbackMode = try container.decodeIfPresent(String.self, forKey: .fallbackMode)
        let ollamaHost = try container.decodeIfPresent(String.self, forKey: .ollamaHost)
        let sttModelPath = try container.decodeIfPresent(String.self, forKey: .sttModelPath)
        let sttLanguage = try container.decodeIfPresent(String.self, forKey: .sttLanguage)
        let ollamaBinPath = try container.decodeIfPresent(String.self, forKey: .ollamaBinPath)
        let dataDir = try container.decodeIfPresent(String.self, forKey: .dataDir)
        let systemPromptsDir = try container.decodeIfPresent(String.self, forKey: .systemPromptsDir)
        let dictatorServerHost = try container.decodeIfPresent(String.self, forKey: .dictatorServerHost)
        let dictatorServerPort = try container.decodeIfPresent(Int.self, forKey: .dictatorServerPort)
        let dictatorServerEnabled = try container.decodeIfPresent(Bool.self, forKey: .dictatorServerEnabled)
        let injectableRules = try container.decodeIfPresent([String: String].self, forKey: .injectableRules)
        let launchpadModels = try container.decodeIfPresent([LaunchpadModel].self, forKey: .launchpadModels)
        let legacyLaunchpadModel = try container.decodeIfPresent(LaunchpadModel.self, forKey: .launchpadModel)
        let legacyModel = try container.decodeIfPresent(String.self, forKey: .model)

        let resolvedCloudModel = cloudModel ?? legacyModel ?? Self.defaultCloudModel
        let resolvedLocalModel = localModel ?? legacyModel ?? Self.defaultLocalModel
        let resolvedSystemPrompt = systemPrompt ?? SystemPromptCatalog.defaultPromptFile
        let resolvedAuxiliarySystemPrompt1 = auxiliarySystemPrompt1 ?? SystemPromptCatalog.defaultPromptFile
        let resolvedAuxiliarySystemPrompt2 = auxiliarySystemPrompt2 ?? SystemPromptCatalog.defaultPromptFile
        let resolvedInteractionsBufferBytes = interactionsBufferBytes ?? Self.defaultInteractionsBufferBytes
        let resolvedFallbackMode = Self.normalizedNonEmpty(fallbackMode) ?? Self.defaultFallbackMode
        let resolvedOllamaHost = Self.normalizedNonEmpty(ollamaHost) ?? Self.defaultOllamaHost
        let resolvedSTTModelPath = Self.normalizedNonEmpty(sttModelPath) ?? Self.defaultSTTModelPath
        let resolvedSTTLanguage = Self.normalizedNonEmpty(sttLanguage) ?? Self.defaultSTTLanguage
        let resolvedOllamaBinPath = Self.normalizedNonEmpty(ollamaBinPath) ?? Self.defaultOllamaBinPath
        let resolvedDataDir = Self.normalizedNonEmpty(dataDir) ?? Self.defaultDataDir
        let resolvedSystemPromptsDir = Self.normalizedNonEmpty(systemPromptsDir) ?? Self.defaultSystemPromptsDir
        let resolvedDictatorServerHost = Self.normalizedNonEmpty(dictatorServerHost) ?? Self.defaultDictatorServerHost
        let resolvedDictatorServerPort = dictatorServerPort ?? Self.defaultDictatorServerPort
        let resolvedDictatorServerEnabled = dictatorServerEnabled ?? Self.defaultDictatorServerEnabled
        let resolvedInjectableRules = injectableRules ?? Self.defaultInjectableRules
        let resolvedLaunchpadModels = try Self.validatedDecodedLaunchpadModels(
            launchpadModels ?? legacyLaunchpadModel.map { [$0] } ?? Self.defaultLaunchpadModels,
            codingPath: container.codingPath + [launchpadModels == nil ? CodingKeys.launchpadModel : CodingKeys.launchpadModels]
        )

        self.init(
            version: version,
            cloudModel: resolvedCloudModel,
            localModel: resolvedLocalModel,
            reasoningEffort: reasoningEffort,
            audioInput: audioInput,
            systemPrompt: resolvedSystemPrompt,
            auxiliarySystemPrompt1: resolvedAuxiliarySystemPrompt1,
            auxiliarySystemPrompt2: resolvedAuxiliarySystemPrompt2,
            interactionsBufferBytes: resolvedInteractionsBufferBytes,
            useCloud: useCloud,
            fallbackMode: resolvedFallbackMode,
            ollamaHost: resolvedOllamaHost,
            sttModelPath: resolvedSTTModelPath,
            sttLanguage: resolvedSTTLanguage,
            ollamaBinPath: resolvedOllamaBinPath,
            dataDir: resolvedDataDir,
            systemPromptsDir: resolvedSystemPromptsDir,
            dictatorServerHost: resolvedDictatorServerHost,
            dictatorServerPort: resolvedDictatorServerPort,
            dictatorServerEnabled: resolvedDictatorServerEnabled,
            injectableRules: resolvedInjectableRules,
            launchpadModels: resolvedLaunchpadModels,
            updatedAt: updatedAt
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(version, forKey: .version)
        try container.encode(cloudModel, forKey: .cloudModel)
        try container.encode(localModel, forKey: .localModel)
        try container.encodeIfPresent(reasoningEffort, forKey: .reasoningEffort)
        try container.encodeIfPresent(audioInput, forKey: .audioInput)
        try container.encode(systemPrompt, forKey: .systemPrompt)
        try container.encode(auxiliarySystemPrompt1, forKey: .auxiliarySystemPrompt1)
        try container.encode(auxiliarySystemPrompt2, forKey: .auxiliarySystemPrompt2)
        try container.encode(interactionsBufferBytes, forKey: .interactionsBufferBytes)
        try container.encode(useCloud, forKey: .useCloud)
        try container.encode(fallbackMode, forKey: .fallbackMode)
        try container.encode(ollamaHost, forKey: .ollamaHost)
        try container.encode(sttModelPath, forKey: .sttModelPath)
        try container.encode(sttLanguage, forKey: .sttLanguage)
        try container.encode(ollamaBinPath, forKey: .ollamaBinPath)
        try container.encode(dataDir, forKey: .dataDir)
        try container.encode(systemPromptsDir, forKey: .systemPromptsDir)
        try container.encode(dictatorServerHost, forKey: .dictatorServerHost)
        try container.encode(dictatorServerPort, forKey: .dictatorServerPort)
        try container.encode(dictatorServerEnabled, forKey: .dictatorServerEnabled)
        try container.encode(injectableRules, forKey: .injectableRules)
        try container.encode(launchpadModels, forKey: .launchpadModels)
        try container.encode(updatedAt, forKey: .updatedAt)
    }

    public static func bootstrap(now: Date = Date()) -> RuntimeConfigFile {
        RuntimeConfigFile(
            version: 2,
            cloudModel: Self.defaultCloudModel,
            localModel: Self.defaultLocalModel,
            systemPrompt: SystemPromptCatalog.defaultPromptFile,
            auxiliarySystemPrompt1: SystemPromptCatalog.defaultPromptFile,
            auxiliarySystemPrompt2: SystemPromptCatalog.defaultPromptFile,
            useCloud: false,
            dataDir: Self.defaultDataDir,
            systemPromptsDir: Self.defaultSystemPromptsDir,
            dictatorServerHost: Self.defaultDictatorServerHost,
            dictatorServerPort: Self.defaultDictatorServerPort,
            dictatorServerEnabled: Self.defaultDictatorServerEnabled,
            injectableRules: Self.defaultInjectableRules,
            launchpadModels: Self.defaultLaunchpadModels,
            updatedAt: Self.timestamp(from: now)
        )
    }

    public func resolvedDataDirectoryURL(
        currentDirectoryPath: String = FileManager.default.currentDirectoryPath
    ) -> URL {
        Self.resolvePathURL(dataDir, currentDirectoryPath: currentDirectoryPath, isDirectory: true)
    }

    public func resolvedSystemPromptsDirectoryURL(
        currentDirectoryPath: String = FileManager.default.currentDirectoryPath
    ) -> URL {
        Self.resolvePathURL(systemPromptsDir, currentDirectoryPath: currentDirectoryPath, isDirectory: true)
    }

    public func resolvedSTTModelPath(
        currentDirectoryPath: String = FileManager.default.currentDirectoryPath
    ) -> String {
        Self.resolvePathURL(sttModelPath, currentDirectoryPath: currentDirectoryPath, isDirectory: false).path
    }

    static func timestamp(from date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    static func normalizedNonEmpty(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
            return nil
        }
        return value
    }

    static func normalizedInjectableRules(_ rules: [String: String]) -> [String: String] {
        var normalized: [String: String] = [:]
        for (key, promptPath) in rules {
            let normalizedKey = key.trimmingCharacters(in: .whitespacesAndNewlines)
            let normalizedPath = promptPath.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !normalizedKey.isEmpty, !normalizedPath.isEmpty else {
                continue
            }
            normalized[normalizedKey] = normalizedPath
        }
        return normalized
    }

    private static func validatedLaunchpadModels(_ models: [LaunchpadModel]) -> [LaunchpadModel] {
        guard !models.isEmpty else {
            return Self.defaultLaunchpadModels
        }
        var seen: Set<LaunchpadModel> = []
        var result: [LaunchpadModel] = []
        for model in models where !seen.contains(model) {
            seen.insert(model)
            result.append(model)
        }
        return result
    }

    private static func validatedDecodedLaunchpadModels(
        _ models: [LaunchpadModel],
        codingPath: [CodingKey]
    ) throws -> [LaunchpadModel] {
        guard !models.isEmpty else {
            throw DecodingError.dataCorrupted(
                DecodingError.Context(codingPath: codingPath, debugDescription: "launchpad_models cannot be empty")
            )
        }
        guard Set(models).count == models.count else {
            throw DecodingError.dataCorrupted(
                DecodingError.Context(codingPath: codingPath, debugDescription: "launchpad_models cannot contain duplicates")
            )
        }
        return models
    }

    public static func validateInjectableRule(key: String, promptPath: String?) throws -> String {
        let trimmedKey = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedKey.isEmpty else {
            throw DictatorError.configUpdateFailed("injectable rule key cannot be empty")
        }
        guard let promptPath else {
            return trimmedKey
        }
        let trimmedPath = promptPath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedPath.isEmpty else {
            throw DictatorError.configUpdateFailed("injectable rule prompt path cannot be empty")
        }
        guard !trimmedPath.hasPrefix("/") else {
            throw DictatorError.configUpdateFailed("injectable rule prompt path must be relative")
        }
        let normalizedPath = trimmedPath.replacingOccurrences(of: "\\", with: "/")
        var depth = 0
        for component in normalizedPath.split(separator: "/", omittingEmptySubsequences: true) {
            let part = String(component)
            if part == "." {
                continue
            }
            if part == ".." {
                depth -= 1
            } else {
                depth += 1
            }
            if depth < 0 {
                throw DictatorError.configUpdateFailed("injectable rule prompt path escapes prompt directory")
            }
        }
        return trimmedKey
    }

    private static func trimTrailingSlash(_ value: String) -> String {
        var result = value
        while result.count > 1, result.hasSuffix("/") {
            result.removeLast()
        }
        return result
    }

    private static func resolvePathURL(_ value: String, currentDirectoryPath: String, isDirectory: Bool) -> URL {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("/") {
            return URL(fileURLWithPath: trimmed, isDirectory: isDirectory)
        }

        let cwdURL = URL(fileURLWithPath: currentDirectoryPath, isDirectory: true)
        let cwdCandidate = cwdURL.appendingPathComponent(trimmed, isDirectory: isDirectory)
        let repoRoot = SheafRootDiscovery.findRepoRoot(startingAt: cwdURL)
        let repoCandidate = repoRoot?.appendingPathComponent(trimmed, isDirectory: isDirectory)

        if shouldPreferRepoRoot(forRelativePath: trimmed), let repoCandidate {
            return repoCandidate
        }

        let fm = FileManager.default
        if fm.fileExists(atPath: cwdCandidate.path) {
            return cwdCandidate
        }
        if let repoCandidate, fm.fileExists(atPath: repoCandidate.path) {
            return repoCandidate
        }

        return cwdCandidate
    }

    private static func shouldPreferRepoRoot(forRelativePath relativePath: String) -> Bool {
        relativePath.hasPrefix("projects/dictator/")
            || relativePath.hasPrefix("config/")
            || relativePath == "config"
            || relativePath.hasPrefix("data/dictator")
            || relativePath == "data/dictator"
            || relativePath.hasPrefix("logs/dictator")
            || relativePath == "logs/dictator"
            || relativePath.hasPrefix("prompts/")
            || relativePath.hasPrefix("contracts/")
            || relativePath.hasPrefix("skills/")
    }
}

public struct RuntimeConfigPatch: Sendable, Equatable {
    public let model: String?
    public let cloudModel: String?
    public let localModel: String?
    public let audioInput: String??
    public let systemPrompt: String?
    public let auxiliarySystemPrompt1: String?
    public let auxiliarySystemPrompt2: String?
    public let interactionsBufferBytes: Int?
    public let useCloud: Bool?
    public let injectableRules: [String: String]?
    public let injectableRuleUpsert: InjectableRuleUpsert?
    public let injectableRuleDeleteKey: String?

    public init(
        model: String? = nil,
        cloudModel: String? = nil,
        localModel: String? = nil,
        audioInput: String?? = nil,
        systemPrompt: String? = nil,
        auxiliarySystemPrompt1: String? = nil,
        auxiliarySystemPrompt2: String? = nil,
        interactionsBufferBytes: Int? = nil,
        useCloud: Bool? = nil,
        injectableRules: [String: String]? = nil,
        injectableRuleUpsert: InjectableRuleUpsert? = nil,
        injectableRuleDeleteKey: String? = nil
    ) {
        self.model = model
        self.cloudModel = cloudModel
        self.localModel = localModel
        self.audioInput = audioInput
        self.systemPrompt = systemPrompt
        self.auxiliarySystemPrompt1 = auxiliarySystemPrompt1
        self.auxiliarySystemPrompt2 = auxiliarySystemPrompt2
        self.interactionsBufferBytes = interactionsBufferBytes
        self.useCloud = useCloud
        self.injectableRules = injectableRules
        self.injectableRuleUpsert = injectableRuleUpsert
        self.injectableRuleDeleteKey = injectableRuleDeleteKey
    }

    var isEmpty: Bool {
        model == nil
            && cloudModel == nil
            && localModel == nil
            && audioInput == nil
            && systemPrompt == nil
            && auxiliarySystemPrompt1 == nil
            && auxiliarySystemPrompt2 == nil
            && interactionsBufferBytes == nil
            && useCloud == nil
            && injectableRules == nil
            && injectableRuleUpsert == nil
            && injectableRuleDeleteKey == nil
    }
}

public struct InjectableRuleUpsert: Sendable, Equatable {
    public let key: String
    public let promptPath: String

    public init(key: String, promptPath: String) {
        self.key = key
        self.promptPath = promptPath
    }
}

public struct RuntimeConfigStore {
    public let fileURL: URL
    private let fileManager: FileManager

    public init(fileURL: URL, fileManager: FileManager = .default) {
        self.fileURL = fileURL
        self.fileManager = fileManager
    }

    public static func defaultFileURL(
        currentDirectoryPath: String = FileManager.default.currentDirectoryPath,
        fileManager: FileManager = .default
    ) -> URL {
        let cwd = URL(fileURLWithPath: currentDirectoryPath, isDirectory: true)
        if let repoRoot = SheafRootDiscovery.findRepoRoot(startingAt: cwd, fileManager: fileManager) {
            return repoRoot.appendingPathComponent("config/dictator.json", isDirectory: false)
        }

        return cwd.appendingPathComponent("config/dictator.json", isDirectory: false)
    }

    public static func defaultExampleFileURL(
        currentDirectoryPath: String = FileManager.default.currentDirectoryPath,
        fileManager: FileManager = .default
    ) -> URL {
        let cwd = URL(fileURLWithPath: currentDirectoryPath, isDirectory: true)
        if let repoRoot = SheafRootDiscovery.findRepoRoot(startingAt: cwd, fileManager: fileManager) {
            return repoRoot.appendingPathComponent("config/dictator.example.json", isDirectory: false)
        }

        return cwd.appendingPathComponent("config/dictator.example.json", isDirectory: false)
    }

    public static func defaultSafeFileURL(
        currentDirectoryPath: String = FileManager.default.currentDirectoryPath,
        fileManager: FileManager = .default
    ) -> URL {
        defaultExampleFileURL(currentDirectoryPath: currentDirectoryPath, fileManager: fileManager)
    }

    public func load() throws -> RuntimeConfigFile? {
        guard fileManager.fileExists(atPath: fileURL.path) else {
            return nil
        }
        let data = try Data(contentsOf: fileURL)
        return try JSONDecoder().decode(RuntimeConfigFile.self, from: data)
    }

    public func save(_ config: RuntimeConfigFile) throws {
        try fileManager.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(config)
        let tmpURL = fileURL.appendingPathExtension("tmp")
        try data.write(to: tmpURL, options: .atomic)

        if fileManager.fileExists(atPath: fileURL.path) {
            _ = try fileManager.replaceItemAt(fileURL, withItemAt: tmpURL)
        } else {
            try fileManager.moveItem(at: tmpURL, to: fileURL)
        }
    }
}

public actor RuntimeConfigProvider {
    private let store: RuntimeConfigStore
    private let defaultConfig: RuntimeConfigFile
    private var runtimeConfig: RuntimeConfigFile

    public init(
        store: RuntimeConfigStore = RuntimeConfigStore(fileURL: RuntimeConfigStore.defaultFileURL()),
        defaultStore: RuntimeConfigStore? = RuntimeConfigStore(fileURL: RuntimeConfigStore.defaultExampleFileURL())
    ) {
        self.store = store

        let defaultFromExample = try? defaultStore?.load()
        let startupDefault = defaultFromExample ?? RuntimeConfigFile.bootstrap()
        self.defaultConfig = startupDefault

        let loaded = try? store.load()
        let initialConfig = loaded ?? startupDefault
        self.runtimeConfig = initialConfig
    }

    public func currentRuntimeConfig() -> RuntimeConfigFile {
        runtimeConfig
    }

    public func currentConfiguration() -> LLMRuntimeConfiguration {
        LLMRuntimeConfiguration.fromRuntimeConfig(runtimeConfig)
    }

    public func startupDefaultConfig() -> RuntimeConfigFile {
        defaultConfig
    }

    @discardableResult
    public func applyPatch(_ patch: RuntimeConfigPatch, now: Date = Date()) throws -> RuntimeConfigFile {
        let next = try resolvedConfig(for: patch, now: now)

        do {
            try store.save(next)
        } catch {
            throw DictatorError.configUpdateFailed("failed to persist runtime config: \(error)")
        }

        runtimeConfig = next
        return next
    }

    @discardableResult
    public func applyInMemoryPatch(_ patch: RuntimeConfigPatch, now: Date = Date()) throws -> RuntimeConfigFile {
        let next = try resolvedConfig(for: patch, now: now)
        runtimeConfig = next
        return next
    }

    private func resolvedConfig(for patch: RuntimeConfigPatch, now: Date) throws -> RuntimeConfigFile {
        if patch.isEmpty {
            throw DictatorError.configUpdateFailed("refusing empty config patch")
        }

        let resolvedUseCloud = patch.useCloud ?? runtimeConfig.useCloud
        let patchedModel = patch.model?.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedCloudModel = (patch.cloudModel?.trimmingCharacters(in: .whitespacesAndNewlines))
            ?? (resolvedUseCloud ? (patchedModel ?? runtimeConfig.cloudModel) : runtimeConfig.cloudModel)
        let resolvedLocalModel = (patch.localModel?.trimmingCharacters(in: .whitespacesAndNewlines))
            ?? (resolvedUseCloud ? runtimeConfig.localModel : (patchedModel ?? runtimeConfig.localModel))
        let resolvedAudioInput = patch.audioInput.map(RuntimeConfigFile.normalizedNonEmpty) ?? runtimeConfig.audioInput
        let resolvedSystemPrompt = patch.systemPrompt?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? runtimeConfig.systemPrompt
        let resolvedAuxiliarySystemPrompt1 = patch.auxiliarySystemPrompt1?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? runtimeConfig.auxiliarySystemPrompt1
        let resolvedAuxiliarySystemPrompt2 = patch.auxiliarySystemPrompt2?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? runtimeConfig.auxiliarySystemPrompt2
        let resolvedInteractionsBufferBytes = patch.interactionsBufferBytes ?? runtimeConfig.interactionsBufferBytes
        var resolvedInjectableRules = patch.injectableRules.map(RuntimeConfigFile.normalizedInjectableRules)
            ?? runtimeConfig.injectableRules

        if let upsert = patch.injectableRuleUpsert {
            let key = try RuntimeConfigFile.validateInjectableRule(
                key: upsert.key,
                promptPath: upsert.promptPath
            )
            resolvedInjectableRules[key] = upsert.promptPath.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if let deleteKey = patch.injectableRuleDeleteKey {
            let key = try RuntimeConfigFile.validateInjectableRule(key: deleteKey, promptPath: nil)
            resolvedInjectableRules.removeValue(forKey: key)
        }

        if resolvedCloudModel.isEmpty {
            throw DictatorError.configUpdateFailed("cloud model cannot be empty")
        }
        if resolvedLocalModel.isEmpty {
            throw DictatorError.configUpdateFailed("local model cannot be empty")
        }
        if resolvedSystemPrompt.isEmpty {
            throw DictatorError.configUpdateFailed("system prompt cannot be empty")
        }
        if resolvedAuxiliarySystemPrompt1.isEmpty {
            throw DictatorError.configUpdateFailed("auxiliary system prompt 1 cannot be empty")
        }
        if resolvedAuxiliarySystemPrompt2.isEmpty {
            throw DictatorError.configUpdateFailed("auxiliary system prompt 2 cannot be empty")
        }
        if resolvedInteractionsBufferBytes <= 0 {
            throw DictatorError.configUpdateFailed("interactions buffer size must be > 0 bytes")
        }

        let next = RuntimeConfigFile(
            version: runtimeConfig.version,
            cloudModel: resolvedCloudModel,
            localModel: resolvedLocalModel,
            reasoningEffort: runtimeConfig.reasoningEffort,
            audioInput: resolvedAudioInput,
            systemPrompt: resolvedSystemPrompt,
            auxiliarySystemPrompt1: resolvedAuxiliarySystemPrompt1,
            auxiliarySystemPrompt2: resolvedAuxiliarySystemPrompt2,
            interactionsBufferBytes: resolvedInteractionsBufferBytes,
            useCloud: resolvedUseCloud,
            fallbackMode: runtimeConfig.fallbackMode,
            ollamaHost: runtimeConfig.ollamaHost,
            sttModelPath: runtimeConfig.sttModelPath,
            sttLanguage: runtimeConfig.sttLanguage,
            ollamaBinPath: runtimeConfig.ollamaBinPath,
            dataDir: runtimeConfig.dataDir,
            systemPromptsDir: runtimeConfig.systemPromptsDir,
            dictatorServerHost: runtimeConfig.dictatorServerHost,
            dictatorServerPort: runtimeConfig.dictatorServerPort,
            dictatorServerEnabled: runtimeConfig.dictatorServerEnabled,
            injectableRules: resolvedInjectableRules,
            launchpadModels: runtimeConfig.launchpadModels,
            updatedAt: RuntimeConfigFile.timestamp(from: now)
        )
        return next
    }

    public func reloadFromDisk() throws {
        guard let loaded = try store.load() else {
            return
        }
        runtimeConfig = loaded
    }

    public func persistCurrentToDisk() throws {
        do {
            try store.save(runtimeConfig)
        } catch {
            throw DictatorError.configUpdateFailed("failed to persist runtime config: \(error)")
        }
    }

    @discardableResult
    public func restoreDefaultsToDisk(now: Date = Date()) throws -> RuntimeConfigFile {
        let restored = RuntimeConfigFile(
            version: defaultConfig.version,
            cloudModel: defaultConfig.cloudModel,
            localModel: defaultConfig.localModel,
            reasoningEffort: defaultConfig.reasoningEffort,
            audioInput: defaultConfig.audioInput,
            systemPrompt: defaultConfig.systemPrompt,
            auxiliarySystemPrompt1: defaultConfig.auxiliarySystemPrompt1,
            auxiliarySystemPrompt2: defaultConfig.auxiliarySystemPrompt2,
            interactionsBufferBytes: defaultConfig.interactionsBufferBytes,
            useCloud: defaultConfig.useCloud,
            fallbackMode: defaultConfig.fallbackMode,
            ollamaHost: defaultConfig.ollamaHost,
            sttModelPath: defaultConfig.sttModelPath,
            sttLanguage: defaultConfig.sttLanguage,
            ollamaBinPath: defaultConfig.ollamaBinPath,
            dataDir: defaultConfig.dataDir,
            systemPromptsDir: defaultConfig.systemPromptsDir,
            dictatorServerHost: defaultConfig.dictatorServerHost,
            dictatorServerPort: defaultConfig.dictatorServerPort,
            dictatorServerEnabled: defaultConfig.dictatorServerEnabled,
            injectableRules: defaultConfig.injectableRules,
            launchpadModels: defaultConfig.launchpadModels,
            updatedAt: RuntimeConfigFile.timestamp(from: now)
        )

        do {
            try store.save(restored)
        } catch {
            throw DictatorError.configUpdateFailed("failed to restore runtime config defaults: \(error)")
        }

        runtimeConfig = restored
        return restored
    }

    @discardableResult
    public func loadFromStoreIntoMemory(_ sourceStore: RuntimeConfigStore) throws -> RuntimeConfigFile {
        guard let loaded = try sourceStore.load() else {
            throw DictatorError.configUpdateFailed("safe runtime config file is missing")
        }
        runtimeConfig = loaded
        return loaded
    }
}
