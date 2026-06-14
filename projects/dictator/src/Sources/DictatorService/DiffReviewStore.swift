import Foundation

struct DiffReviewHunkSnapshot: Codable, Equatable, Sendable {
    let sourceProvider: String
    let repoRoot: String
    let file: String
    let hunkId: String
    let hunkIndex: Int
    let hunkCount: Int
    let header: String
    let patchHash: String
    let patch: String

    init(_ context: HunkReviewContext) {
        sourceProvider = context.effectiveSourceProvider
        repoRoot = context.repoRoot
        file = context.file
        hunkId = context.hunkId
        hunkIndex = context.hunkIndex
        hunkCount = context.hunkCount
        header = context.header
        patchHash = context.patchHash
        patch = context.patch
    }
}

enum DiffReviewEntry: Equatable, Sendable {
    case comment(hunk: DiffReviewHunkSnapshot, text: String)
    case reverted(hunk: DiffReviewHunkSnapshot)

    var hunk: DiffReviewHunkSnapshot {
        switch self {
        case let .comment(hunk, _), let .reverted(hunk):
            return hunk
        }
    }
}

struct DiffReviewDiagnostics: Codable, Equatable {
    let hasActiveReview: Bool
    let entryCount: Int
    let reviewRecordingActive: Bool
    let lastPostError: String?
}

final class DiffReviewStore: @unchecked Sendable {
    private let lock = NSLock()
    private var entries: [DiffReviewEntry] = []
    private var recordingActive = false
    private var lastPostError: String?
    private var onChange: (() -> Void)?

    var hasActiveReview: Bool {
        lock.lock()
        defer { lock.unlock() }
        return !entries.isEmpty
    }

    var entryCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return entries.count
    }

    func setRecordingActive(_ active: Bool) {
        lock.lock()
        recordingActive = active
        let callback = onChange
        lock.unlock()
        callback?()
    }

    func setOnChange(_ onChange: (() -> Void)?) {
        lock.lock()
        self.onChange = onChange
        lock.unlock()
    }

    func appendComment(hunk context: HunkReviewContext, text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return
        }
        lock.lock()
        entries.append(.comment(hunk: DiffReviewHunkSnapshot(context), text: trimmed))
        lastPostError = nil
        let callback = onChange
        lock.unlock()
        callback?()
    }

    func appendReverted(hunk context: HunkReviewContext) {
        lock.lock()
        entries.append(.reverted(hunk: DiffReviewHunkSnapshot(context)))
        lastPostError = nil
        let callback = onChange
        lock.unlock()
        callback?()
    }

    func removeReverted(hunk context: HunkReviewContext) {
        let snapshot = DiffReviewHunkSnapshot(context)
        lock.lock()
        if let index = entries.lastIndex(where: { entry in
            guard case let .reverted(hunk) = entry else {
                return false
            }
            return hunk.hunkId == snapshot.hunkId
                && hunk.patchHash == snapshot.patchHash
                && hunk.file == snapshot.file
                && hunk.repoRoot == snapshot.repoRoot
        }) {
            entries.remove(at: index)
        }
        let callback = onChange
        lock.unlock()
        callback?()
    }

    func serializedReview() -> String? {
        lock.lock()
        let snapshot = entries
        lock.unlock()
        guard !snapshot.isEmpty else {
            return nil
        }
        return Self.serialize(snapshot)
    }

    func clearAfterSuccessfulPost() {
        lock.lock()
        entries.removeAll()
        lastPostError = nil
        let callback = onChange
        lock.unlock()
        callback?()
    }

    func recordPostError(_ message: String) {
        lock.lock()
        lastPostError = message
        let callback = onChange
        lock.unlock()
        callback?()
    }

    func diagnostics() -> DiffReviewDiagnostics {
        lock.lock()
        defer { lock.unlock() }
        return DiffReviewDiagnostics(
            hasActiveReview: !entries.isEmpty,
            entryCount: entries.count,
            reviewRecordingActive: recordingActive,
            lastPostError: lastPostError
        )
    }

    private static func serialize(_ entries: [DiffReviewEntry]) -> String {
        var lines: [String] = [
            "Code review feedback:",
            ""
        ]
        for (index, entry) in entries.enumerated() {
            let hunk = entry.hunk
            lines.append("\(index + 1). \(hunk.sourceProvider) \(hunk.file) \(hunk.header) [\(hunk.patchHash)]")
            switch entry {
            case let .comment(_, text):
                lines.append(text)
                lines.append("")
                lines.append("```diff")
                lines.append(hunk.patch.trimmingCharacters(in: .newlines))
                lines.append("```")
            case .reverted:
                lines.append("Rejected this hunk. Do not reintroduce it in the next turn.")
                lines.append("")
                lines.append("```diff")
                lines.append(hunk.patch.trimmingCharacters(in: .newlines))
                lines.append("```")
            }
            lines.append("")
        }
        return lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
