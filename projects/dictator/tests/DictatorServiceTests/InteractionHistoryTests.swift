import XCTest
@testable import DictatorService

final class InteractionHistoryTests: XCTestCase {
    func testPersistenceAppendsToHourlyFileAndLoadsChronologically() async throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let buffer = DictationInteractionBuffer(maxBytes: 1024 * 1024)
        let store = InteractionHistoryStore(
            buffer: buffer,
            dataDirectoryURL: tempDir,
            initialLoadBytes: 1024 * 1024,
            onChanged: nil
        )

        let first = makeInteraction(occurredAt: isoDate("2026-02-24T12:10:00Z"), whisperOutput: "a", finalOutput: "b")
        let second = makeInteraction(occurredAt: isoDate("2026-02-24T12:20:00Z"), whisperOutput: "c", finalOutput: "d")
        let third = makeInteraction(occurredAt: isoDate("2026-02-24T13:05:00Z"), whisperOutput: "e", finalOutput: "f")

        await store.startInitialLoadIfNeeded()
        await store.waitUntilReady()

        await store.append(first)
        await store.append(second)
        await store.append(third)

        let files = try FileManager.default.contentsOfDirectory(
            at: tempDir.appendingPathComponent("interactions", isDirectory: true),
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ).map(\.lastPathComponent).sorted()
        XCTAssertEqual(files, ["2026-02-24T12Z.jsonl", "2026-02-24T13Z.jsonl"])

        let reloadedBuffer = DictationInteractionBuffer(maxBytes: 1024 * 1024)
        let reloadedStore = InteractionHistoryStore(
            buffer: reloadedBuffer,
            dataDirectoryURL: tempDir,
            initialLoadBytes: 1024 * 1024,
            onChanged: nil
        )
        await reloadedStore.startInitialLoadIfNeeded()
        await reloadedStore.waitUntilReady()

        XCTAssertEqual(reloadedBuffer.snapshot().map(\.id), [first.id, second.id, third.id])
    }

    func testStartupLoadHonorsByteBudgetFromNewestBackward() async throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let writerBuffer = DictationInteractionBuffer(maxBytes: 1024 * 1024)
        let writerStore = InteractionHistoryStore(
            buffer: writerBuffer,
            dataDirectoryURL: tempDir,
            initialLoadBytes: 1024 * 1024,
            onChanged: nil
        )
        await writerStore.startInitialLoadIfNeeded()
        await writerStore.waitUntilReady()

        let older = makeInteraction(occurredAt: isoDate("2026-02-24T10:00:00Z"), whisperOutput: "o", finalOutput: "o")
        let latest = makeInteraction(occurredAt: isoDate("2026-02-24T11:00:00Z"), whisperOutput: String(repeating: "x", count: 256), finalOutput: String(repeating: "y", count: 256))

        await writerStore.append(older)
        await writerStore.append(latest)

        let constrainedBuffer = DictationInteractionBuffer(maxBytes: 1024 * 1024)
        let constrainedStore = InteractionHistoryStore(
            buffer: constrainedBuffer,
            dataDirectoryURL: tempDir,
            initialLoadBytes: 64,
            onChanged: nil
        )
        await constrainedStore.startInitialLoadIfNeeded()
        await constrainedStore.waitUntilReady()

        // Latest hour file should load first even when it exceeds the small byte budget.
        XCTAssertEqual(constrainedBuffer.snapshot().map(\.id), [latest.id])
    }

    func testPersistenceRoundTripsErrorMessageField() async throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let buffer = DictationInteractionBuffer(maxBytes: 1024 * 1024)
        let store = InteractionHistoryStore(
            buffer: buffer,
            dataDirectoryURL: tempDir,
            initialLoadBytes: 1024 * 1024,
            onChanged: nil
        )
        await store.startInitialLoadIfNeeded()
        await store.waitUntilReady()

        let failed = makeInteraction(
            occurredAt: isoDate("2026-02-24T12:10:00Z"),
            whisperOutput: "",
            finalOutput: "Talon pipeline failed: reparse: Invalid Talon token: nope",
            errorMessage: "Talon pipeline failed: reparse: Invalid Talon token: nope"
        )
        await store.append(failed)

        let reloadedBuffer = DictationInteractionBuffer(maxBytes: 1024 * 1024)
        let reloadedStore = InteractionHistoryStore(
            buffer: reloadedBuffer,
            dataDirectoryURL: tempDir,
            initialLoadBytes: 1024 * 1024,
            onChanged: nil
        )
        await reloadedStore.startInitialLoadIfNeeded()
        await reloadedStore.waitUntilReady()

        XCTAssertEqual(reloadedBuffer.snapshot().first?.errorMessage, failed.errorMessage)
    }

    private func makeInteraction(
        occurredAt: Date,
        whisperOutput: String,
        finalOutput: String,
        errorMessage: String? = nil
    ) -> DictationInteraction {
        DictationInteraction(
            id: UUID(),
            occurredAt: occurredAt,
            whisperOutput: whisperOutput,
            finalOutput: finalOutput,
            mode: .revision,
            systemPromptPath: "intent_refiner_v1.md",
            systemPromptBody: "prompt",
            model: "qwen2.5:7b-instruct",
            provider: "ollama",
            optionalContext: [:],
            editSummary: "summary",
            uncertaintyFlags: [],
            errorMessage: errorMessage,
            timings: DictationInteractionTimings(transcribeMs: 1, refineMs: 2, insertMs: 3, totalPipelineMs: 6)
        )
    }

    private func isoDate(_ value: String) -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value) ?? Date()
    }

    private func makeTempDir() throws -> URL {
        let base = FileManager.default.temporaryDirectory
        let dir = base.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
}
