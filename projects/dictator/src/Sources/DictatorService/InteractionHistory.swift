import Foundation
import DictatorCore

enum DictationInteractionMode: String, Sendable, Equatable {
    case rawDictation = "raw_dictation"
    case revision
    case textReplacement = "text_replacement"
    case talonLite = "talon_lite"
}

struct DictationInteractionTimings: Sendable, Equatable {
    let transcribeMs: Int
    let refineMs: Int
    let insertMs: Int
    let totalPipelineMs: Int
}

struct DictationInteraction: Sendable, Equatable {
    let id: UUID
    let occurredAt: Date
    let whisperOutput: String
    let finalOutput: String
    let mode: DictationInteractionMode
    let systemPromptPath: String
    let systemPromptBody: String
    let model: String
    let provider: String
    let optionalContext: [String: String]
    let editSummary: String
    let uncertaintyFlags: [String]
    let fallbackUsed: Bool?
    let errorMessage: String?
    let timings: DictationInteractionTimings
    let trackedSizeBytes: Int

    init(
        id: UUID = UUID(),
        occurredAt: Date = Date(),
        whisperOutput: String,
        finalOutput: String,
        mode: DictationInteractionMode,
        systemPromptPath: String,
        systemPromptBody: String,
        model: String,
        provider: String,
        optionalContext: [String: String],
        editSummary: String,
        uncertaintyFlags: [String],
        fallbackUsed: Bool? = nil,
        errorMessage: String? = nil,
        timings: DictationInteractionTimings
    ) {
        self.id = id
        self.occurredAt = occurredAt
        self.whisperOutput = whisperOutput
        self.finalOutput = finalOutput
        self.mode = mode
        self.systemPromptPath = systemPromptPath
        self.systemPromptBody = systemPromptBody
        self.model = model
        self.provider = provider
        self.optionalContext = optionalContext
        self.editSummary = editSummary
        self.uncertaintyFlags = uncertaintyFlags
        self.fallbackUsed = fallbackUsed
        self.errorMessage = errorMessage
        self.timings = timings
        self.trackedSizeBytes = whisperOutput.utf8.count + finalOutput.utf8.count + (errorMessage?.utf8.count ?? 0)
    }
}

final class DictationInteractionBuffer {
    static let defaultMaxBytes = RuntimeConfigFile.defaultInteractionsBufferBytes

    private let lock = NSLock()
    private var maxBytes: Int
    private var interactions: [DictationInteraction] = []
    private var totalTrackedBytes = 0

    init(maxBytes: Int = DictationInteractionBuffer.defaultMaxBytes) {
        self.maxBytes = max(1, maxBytes)
    }

    func setMaxBytes(_ newMaxBytes: Int) {
        lock.lock()
        maxBytes = max(1, newMaxBytes)
        evictIfNeeded()
        lock.unlock()
    }

    func append(_ interaction: DictationInteraction) {
        lock.lock()
        interactions.append(interaction)
        totalTrackedBytes += interaction.trackedSizeBytes
        evictIfNeeded()
        lock.unlock()
    }

    func snapshot() -> [DictationInteraction] {
        lock.lock()
        let copy = interactions
        lock.unlock()
        return copy
    }

    func currentTrackedBytes() -> Int {
        lock.lock()
        let value = totalTrackedBytes
        lock.unlock()
        return value
    }

    private func evictIfNeeded() {
        while totalTrackedBytes > maxBytes, !interactions.isEmpty {
            let removed = interactions.removeFirst()
            totalTrackedBytes -= removed.trackedSizeBytes
        }
    }
}

enum InteractionDataPathResolver {
    static func defaultDataDirectory(
        runtimeConfig: RuntimeConfigFile,
        currentDirectoryPath: String = FileManager.default.currentDirectoryPath
    ) -> URL {
        runtimeConfig.resolvedDataDirectoryURL(currentDirectoryPath: currentDirectoryPath)
    }
}

actor InteractionHistoryStore {
    private let buffer: DictationInteractionBuffer
    private let persistence: InteractionPersistence
    private let initialLoadBytes: Int
    private let onChanged: (@MainActor () -> Void)?
    private var initialLoadTask: Task<Void, Never>?

    init(
        buffer: DictationInteractionBuffer,
        dataDirectoryURL: URL,
        initialLoadBytes: Int,
        onChanged: (@MainActor () -> Void)? = nil
    ) {
        self.buffer = buffer
        self.persistence = InteractionPersistence(dataDirectoryURL: dataDirectoryURL)
        self.initialLoadBytes = max(1, initialLoadBytes)
        self.onChanged = onChanged
    }

    func startInitialLoadIfNeeded() {
        guard initialLoadTask == nil else {
            return
        }

        initialLoadTask = Task.detached(priority: .utility) { [weak self] in
            guard let self else {
                return
            }
            await self.loadInitialInteractions()
        }
    }

    func setMaxBytes(_ bytes: Int) {
        buffer.setMaxBytes(bytes)
    }

    func waitUntilReady() async {
        if let initialLoadTask {
            await initialLoadTask.value
        }
    }

    func append(_ interaction: DictationInteraction) async {
        await waitUntilReady()
        buffer.append(interaction)
        do {
            try persistence.append(interaction)
        } catch {
            TraceLogger.log("interaction persistence append failed: \(error)")
        }
        await notifyChanged()
    }

    private func loadInitialInteractions() async {
        do {
            let loaded = try persistence.loadRecent(maxBytes: initialLoadBytes)
            for interaction in loaded {
                buffer.append(interaction)
            }
            TraceLogger.log("interaction startup load complete (count=\(loaded.count), maxBytes=\(initialLoadBytes))")
        } catch {
            TraceLogger.log("interaction startup load failed: \(error)")
        }
        await notifyChanged()
    }

    private func notifyChanged() async {
        await onChanged?()
    }
}

private struct StoredInteractionEnvelope: Codable {
    let schemaVersion: Int
    let eventType: String
    let recordedAt: String
    let payload: StoredInteractionPayload

    init(interaction: DictationInteraction) {
        schemaVersion = 1
        eventType = "dictation_interaction"
        recordedAt = Self.timestamp(from: interaction.occurredAt)
        payload = StoredInteractionPayload(interaction: interaction)
    }

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case eventType = "event_type"
        case recordedAt = "recorded_at"
        case payload
    }

    func toInteraction() -> DictationInteraction {
        payload.toInteraction(fallbackRecordedAt: recordedAt)
    }

    static func timestamp(from date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}

private struct StoredInteractionPayload: Codable {
    let id: String?
    let occurredAt: String?
    let whisperOutput: String?
    let finalOutput: String?
    let mode: String?
    let systemPromptPath: String?
    let systemPromptBody: String?
    let model: String?
    let provider: String?
    let optionalContext: [String: String]?
    let editSummary: String?
    let uncertaintyFlags: [String]?
    let fallbackUsed: Bool?
    let errorMessage: String?
    let timings: StoredInteractionTimings?

    enum CodingKeys: String, CodingKey {
        case id
        case occurredAt = "occurred_at"
        case whisperOutput = "whisper_output"
        case finalOutput = "final_output"
        case mode
        case systemPromptPath = "system_prompt_path"
        case systemPromptBody = "system_prompt_body"
        case model
        case provider
        case optionalContext = "optional_context"
        case editSummary = "edit_summary"
        case uncertaintyFlags = "uncertainty_flags"
        case fallbackUsed = "fallback_used"
        case errorMessage = "error_message"
        case timings
    }

    init(interaction: DictationInteraction) {
        id = interaction.id.uuidString
        occurredAt = StoredInteractionEnvelope.timestamp(from: interaction.occurredAt)
        whisperOutput = interaction.whisperOutput
        finalOutput = interaction.finalOutput
        mode = interaction.mode.rawValue
        systemPromptPath = interaction.systemPromptPath
        systemPromptBody = interaction.systemPromptBody
        model = interaction.model
        provider = interaction.provider
        optionalContext = interaction.optionalContext
        editSummary = interaction.editSummary
        uncertaintyFlags = interaction.uncertaintyFlags
        fallbackUsed = interaction.fallbackUsed
        errorMessage = interaction.errorMessage
        timings = StoredInteractionTimings(interaction.timings)
    }

    func toInteraction(fallbackRecordedAt: String) -> DictationInteraction {
        let id = UUID(uuidString: id ?? "") ?? UUID()
        let occurredAt = Self.date(from: occurredAt ?? fallbackRecordedAt) ?? Date()
        let mode = DictationInteractionMode(rawValue: mode ?? "") ?? .revision
        return DictationInteraction(
            id: id,
            occurredAt: occurredAt,
            whisperOutput: whisperOutput ?? "",
            finalOutput: finalOutput ?? "",
            mode: mode,
            systemPromptPath: systemPromptPath ?? "",
            systemPromptBody: systemPromptBody ?? "",
            model: model ?? "unknown",
            provider: provider ?? "unknown",
            optionalContext: optionalContext ?? [:],
            editSummary: editSummary ?? "",
            uncertaintyFlags: uncertaintyFlags ?? [],
            fallbackUsed: fallbackUsed,
            errorMessage: errorMessage,
            timings: timings?.toTimings() ?? DictationInteractionTimings(transcribeMs: 0, refineMs: 0, insertMs: 0, totalPipelineMs: 0)
        )
    }

    private static func date(from value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let parsed = formatter.date(from: value) {
            return parsed
        }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }
}

private struct StoredInteractionTimings: Codable {
    let transcribeMs: Int?
    let refineMs: Int?
    let insertMs: Int?
    let totalPipelineMs: Int?

    enum CodingKeys: String, CodingKey {
        case transcribeMs = "transcribe_ms"
        case refineMs = "refine_ms"
        case insertMs = "insert_ms"
        case totalPipelineMs = "total_pipeline_ms"
    }

    init(_ timings: DictationInteractionTimings) {
        transcribeMs = timings.transcribeMs
        refineMs = timings.refineMs
        insertMs = timings.insertMs
        totalPipelineMs = timings.totalPipelineMs
    }

    func toTimings() -> DictationInteractionTimings {
        DictationInteractionTimings(
            transcribeMs: transcribeMs ?? 0,
            refineMs: refineMs ?? 0,
            insertMs: insertMs ?? 0,
            totalPipelineMs: totalPipelineMs ?? 0
        )
    }
}

private struct InteractionPersistence {
    private let interactionsDirectoryURL: URL
    private let fileManager: FileManager

    init(dataDirectoryURL: URL, fileManager: FileManager = .default) {
        self.interactionsDirectoryURL = dataDirectoryURL.appendingPathComponent("interactions", isDirectory: true)
        self.fileManager = fileManager
    }

    func append(_ interaction: DictationInteraction) throws {
        try ensureDirectory()
        let fileURL = interactionsDirectoryURL.appendingPathComponent(hourlyFileName(for: interaction.occurredAt))
        let encoder = JSONEncoder()
        let line = try encoder.encode(StoredInteractionEnvelope(interaction: interaction)) + Data([0x0A])

        if !fileManager.fileExists(atPath: fileURL.path) {
            fileManager.createFile(atPath: fileURL.path, contents: nil)
        }

        let handle = try FileHandle(forWritingTo: fileURL)
        defer { try? handle.close() }
        try handle.seekToEnd()
        try handle.write(contentsOf: line)
    }

    func loadRecent(maxBytes: Int) throws -> [DictationInteraction] {
        try ensureDirectory()
        let allFiles = try listedHourlyFilesSortedDescending()
        guard !allFiles.isEmpty else {
            return []
        }

        var selected: [URL] = []
        var consumedBytes = 0
        for fileURL in allFiles {
            let fileSize = (try? fileURL.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            if selected.isEmpty || consumedBytes + fileSize <= maxBytes {
                selected.append(fileURL)
                consumedBytes += fileSize
            } else {
                break
            }
        }

        // Read oldest->newest so buffer remains chronological.
        var decoded: [DictationInteraction] = []
        for fileURL in selected.reversed() {
            let data = try Data(contentsOf: fileURL)
            guard !data.isEmpty else { continue }

            let lines = data.split(separator: 0x0A)
            for line in lines {
                guard !line.isEmpty else { continue }
                do {
                    let envelope = try JSONDecoder().decode(StoredInteractionEnvelope.self, from: Data(line))
                    decoded.append(envelope.toInteraction())
                } catch {
                    TraceLogger.log("interaction load skipped malformed line file=\(fileURL.lastPathComponent): \(error)")
                }
            }
        }

        return decoded.sorted { lhs, rhs in
            if lhs.occurredAt == rhs.occurredAt {
                return lhs.id.uuidString < rhs.id.uuidString
            }
            return lhs.occurredAt < rhs.occurredAt
        }
    }

    private func ensureDirectory() throws {
        try fileManager.createDirectory(at: interactionsDirectoryURL, withIntermediateDirectories: true)
    }

    private func listedHourlyFilesSortedDescending() throws -> [URL] {
        let listed = try fileManager.contentsOfDirectory(
            at: interactionsDirectoryURL,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        )

        return listed
            .filter { $0.pathExtension == "jsonl" }
            .sorted { $0.lastPathComponent > $1.lastPathComponent }
    }

    private func hourlyFileName(for date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd'T'HH'Z'"
        return "\(formatter.string(from: date)).jsonl"
    }
}
