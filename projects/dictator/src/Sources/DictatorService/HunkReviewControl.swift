import DictatorCore
import Foundation

enum HunkReviewAction: String, Codable, CaseIterable {
    case previousHunk
    case nextHunk
    case previousFile
    case nextFile
    case stage
    case revert
    case undo
}

struct HunkReviewActionAvailability: Codable, Equatable {
    let canGoUp: Bool
    let canGoDown: Bool
    let canGoPrevFile: Bool
    let canGoNextFile: Bool
    let canStage: Bool
    let canRevert: Bool
    let canUndo: Bool

    static let none = HunkReviewActionAvailability(
        canGoUp: false,
        canGoDown: false,
        canGoPrevFile: false,
        canGoNextFile: false,
        canStage: false,
        canRevert: false,
        canUndo: false
    )

    func allows(_ action: HunkReviewAction) -> Bool {
        switch action {
        case .previousHunk:
            return canGoUp
        case .nextHunk:
            return canGoDown
        case .previousFile:
            return canGoPrevFile
        case .nextFile:
            return canGoNextFile
        case .stage:
            return canStage
        case .revert:
            return canRevert
        case .undo:
            return canUndo
        }
    }
}

struct HunkReviewMetadata: Codable, Equatable {
    let id: String
    let file: String
    let index: Int
    let count: Int
    let header: String
    let patchHash: String
}

struct HunkReviewContext: Codable, Equatable, Sendable {
    let sourceProvider: String?
    let repoRoot: String
    let file: String
    let hunkId: String
    let hunkIndex: Int
    let hunkCount: Int
    let header: String
    let patchHash: String
    let patch: String

    init(
        sourceProvider: String? = nil,
        repoRoot: String,
        file: String,
        hunkId: String,
        hunkIndex: Int,
        hunkCount: Int,
        header: String,
        patchHash: String,
        patch: String
    ) {
        self.sourceProvider = sourceProvider
        self.repoRoot = repoRoot
        self.file = file
        self.hunkId = hunkId
        self.hunkIndex = hunkIndex
        self.hunkCount = hunkCount
        self.header = header
        self.patchHash = patchHash
        self.patch = patch
    }

    var effectiveSourceProvider: String {
        sourceProvider ?? "unknown"
    }
}

struct HunkReviewProviderSnapshot: Codable, Equatable {
    let providerId: String
    let focused: Bool
    let paneOpen: Bool
    let repoRoot: String?
    let file: String?
    let fileIndex: Int
    let fileCount: Int
    let hunkIndex: Int
    let hunkCount: Int
    let currentHunk: HunkReviewMetadata?
    let currentHunkReview: HunkReviewContext?
    let actions: HunkReviewActionAvailability
}

struct HunkReviewDisconnectRequest: Codable {
    let providerId: String
}

struct HunkReviewCommandEnvelope: Codable, Equatable {
    let id: String
    let action: HunkReviewAction
}

struct HunkReviewCommandResultRequest: Codable {
    let commandId: String
    let providerId: String
    let result: HunkReviewCommandResult
}

struct HunkReviewCommandResult: Codable, Equatable {
    let ok: Bool
    let action: HunkReviewAction
    let error: String?
    let reviewFacts: HunkReviewCommandReviewFacts?
}

struct HunkReviewCommandReviewFacts: Codable, Equatable {
    let revertedHunk: HunkReviewContext?
    let restoredRevertedHunk: HunkReviewContext?
}

struct HunkReviewProviderDiagnostic: Codable, Equatable {
    let providerId: String
    let sourceProvider: String
    let healthy: Bool
    let focused: Bool
    let paneOpen: Bool
    let file: String?
    let hunkIndex: Int
    let hunkCount: Int
    let canGoUp: Bool
    let canGoDown: Bool
    let canGoPrevFile: Bool
    let canGoNextFile: Bool
    let canStage: Bool
    let canRevert: Bool
    let canUndo: Bool
}

struct HunkReviewDiagnostics: Codable, Equatable {
    let activeProviderId: String?
    let activeSourceProvider: String?
    let providers: [HunkReviewProviderDiagnostic]
    let lastCommandResult: HunkReviewCommandResult?
    let diffReview: DiffReviewDiagnostics?
}

final class HunkReviewRegistry: @unchecked Sendable {
    struct ActiveTarget {
        let providerId: String
        let snapshot: HunkReviewProviderSnapshot
    }

    private struct Instance {
        var snapshot: HunkReviewProviderSnapshot
        var lastContact: Date
        var pendingCommands: [HunkReviewCommandEnvelope]
    }

    private let lock = NSLock()
    private let timeoutSeconds: TimeInterval
    private var instances: [String: Instance] = [:]
    private var lastFocusedProviderId: String?
    private var lastCommandResult: HunkReviewCommandResult?
    private var onChange: (() -> Void)?

    init(timeoutSeconds: TimeInterval = 3.0) {
        self.timeoutSeconds = timeoutSeconds
    }

    func setOnChange(_ onChange: (() -> Void)?) {
        lock.lock()
        self.onChange = onChange
        lock.unlock()
    }

    func update(snapshot: HunkReviewProviderSnapshot, now: Date = Date()) {
        lock.lock()
        var instance = instances[snapshot.providerId] ?? Instance(
            snapshot: snapshot,
            lastContact: now,
            pendingCommands: []
        )
        instance.snapshot = snapshot
        instance.lastContact = now
        instances[snapshot.providerId] = instance
        if snapshot.focused {
            lastFocusedProviderId = snapshot.providerId
        }
        expireLocked(now: now)
        let callback = onChange
        lock.unlock()
        callback?()
    }

    func updateFocus(providerId: String, focused: Bool, now: Date = Date()) {
        lock.lock()
        if var instance = instances[providerId] {
            instance.lastContact = now
            instance.snapshot = HunkReviewProviderSnapshot(
                providerId: instance.snapshot.providerId,
                focused: focused,
                paneOpen: instance.snapshot.paneOpen,
                repoRoot: instance.snapshot.repoRoot,
                file: instance.snapshot.file,
                fileIndex: instance.snapshot.fileIndex,
                fileCount: instance.snapshot.fileCount,
                hunkIndex: instance.snapshot.hunkIndex,
                hunkCount: instance.snapshot.hunkCount,
                currentHunk: instance.snapshot.currentHunk,
                currentHunkReview: instance.snapshot.currentHunkReview,
                actions: instance.snapshot.actions
            )
            instances[providerId] = instance
        }
        if focused {
            lastFocusedProviderId = providerId
        }
        expireLocked(now: now)
        let callback = onChange
        lock.unlock()
        callback?()
    }

    func disconnect(providerId: String) {
        lock.lock()
        instances.removeValue(forKey: providerId)
        if lastFocusedProviderId == providerId {
            lastFocusedProviderId = instances.values
                .filter { $0.snapshot.focused }
                .max { $0.lastContact < $1.lastContact }?
                .snapshot.providerId
        }
        let callback = onChange
        lock.unlock()
        callback?()
    }

    func activeTarget(now: Date = Date()) -> ActiveTarget? {
        lock.lock()
        defer { lock.unlock() }
        expireLocked(now: now)
        guard let providerId = lastFocusedProviderId,
              let instance = instances[providerId],
              isHealthy(instance, now: now),
              instance.snapshot.focused else {
            return nil
        }
        return ActiveTarget(providerId: providerId, snapshot: instance.snapshot)
    }

    func canDispatch(_ action: HunkReviewAction, now: Date = Date()) -> Bool {
        guard let target = activeTarget(now: now) else {
            return false
        }
        return target.snapshot.paneOpen && target.snapshot.actions.allows(action)
    }

    func activeReviewHunk(now: Date = Date()) -> HunkReviewContext? {
        guard let target = activeTarget(now: now),
              target.snapshot.paneOpen else {
            return nil
        }
        return target.snapshot.currentHunkReview
    }

    func enqueueCommand(_ action: HunkReviewAction, now: Date = Date()) -> HunkReviewCommandEnvelope? {
        lock.lock()
        expireLocked(now: now)
        guard let providerId = lastFocusedProviderId,
              var instance = instances[providerId],
              isHealthy(instance, now: now),
              instance.snapshot.focused,
              instance.snapshot.paneOpen,
              instance.snapshot.actions.allows(action) else {
            lock.unlock()
            return nil
        }
        let command = HunkReviewCommandEnvelope(id: UUID().uuidString, action: action)
        instance.pendingCommands.append(command)
        instances[providerId] = instance
        let callback = onChange
        lock.unlock()
        callback?()
        return command
    }

    func nextCommand(providerId: String, now: Date = Date()) -> HunkReviewCommandEnvelope? {
        lock.lock()
        defer { lock.unlock() }
        expireLocked(now: now)
        guard var instance = instances[providerId],
              isHealthy(instance, now: now) else {
            return nil
        }
        instance.lastContact = now
        guard !instance.pendingCommands.isEmpty else {
            instances[providerId] = instance
            return nil
        }
        let command = instance.pendingCommands.removeFirst()
        instances[providerId] = instance
        return command
    }

    func recordResult(_ result: HunkReviewCommandResult) {
        lock.lock()
        lastCommandResult = result
        let callback = onChange
        lock.unlock()
        callback?()
    }

    func diagnostics(now: Date = Date(), diffReview: DiffReviewDiagnostics? = nil) -> HunkReviewDiagnostics {
        lock.lock()
        defer { lock.unlock() }
        expireLocked(now: now)
        let diagnostics = instances.values
            .sorted { $0.snapshot.providerId < $1.snapshot.providerId }
            .map { instance in
                let actions = instance.snapshot.actions
                return HunkReviewProviderDiagnostic(
                    providerId: instance.snapshot.providerId,
                    sourceProvider: instance.snapshot.currentHunkReview?.effectiveSourceProvider ?? "unknown",
                    healthy: isHealthy(instance, now: now),
                    focused: instance.snapshot.focused,
                    paneOpen: instance.snapshot.paneOpen,
                    file: instance.snapshot.file,
                    hunkIndex: instance.snapshot.hunkIndex,
                    hunkCount: instance.snapshot.hunkCount,
                    canGoUp: actions.canGoUp,
                    canGoDown: actions.canGoDown,
                    canGoPrevFile: actions.canGoPrevFile,
                    canGoNextFile: actions.canGoNextFile,
                    canStage: actions.canStage,
                    canRevert: actions.canRevert,
                    canUndo: actions.canUndo
                )
            }
        return HunkReviewDiagnostics(
            activeProviderId: activeTargetLocked(now: now)?.providerId,
            activeSourceProvider: activeTargetLocked(now: now)?
                .snapshot.currentHunkReview?.effectiveSourceProvider,
            providers: diagnostics,
            lastCommandResult: lastCommandResult,
            diffReview: diffReview
        )
    }

    private func activeTargetLocked(now: Date) -> ActiveTarget? {
        guard let providerId = lastFocusedProviderId,
              let instance = instances[providerId],
              isHealthy(instance, now: now),
              instance.snapshot.focused else {
            return nil
        }
        return ActiveTarget(providerId: providerId, snapshot: instance.snapshot)
    }

    private func expireLocked(now: Date) {
        let stale = instances.filter { !isHealthy($0.value, now: now) }.map(\.key)
        for providerId in stale {
            instances.removeValue(forKey: providerId)
        }
        if let focused = lastFocusedProviderId, instances[focused] == nil {
            lastFocusedProviderId = instances.values
                .filter { $0.snapshot.focused && isHealthy($0, now: now) }
                .max { $0.lastContact < $1.lastContact }?
                .snapshot.providerId
        }
    }

    private func isHealthy(_ instance: Instance, now: Date) -> Bool {
        now.timeIntervalSince(instance.lastContact) <= timeoutSeconds
    }
}

final class HunkReviewLaunchpadControlLayer: LaunchpadControlLayer {
    private struct Binding {
        let coordinate: PadCoordinate
        let action: HunkReviewAction?
        let color: PadColor
    }

    private static let bindings: [Binding] = [
        Binding(coordinate: PadCoordinate(x: 0, y: 2), action: .revert, color: PadColor(r: 255, g: 0, b: 0)),
        Binding(coordinate: PadCoordinate(x: 1, y: 2), action: .previousHunk, color: PadColor(r: 255, g: 255, b: 0)),
        Binding(coordinate: PadCoordinate(x: 2, y: 2), action: .stage, color: PadColor(r: 0, g: 255, b: 0)),
        Binding(coordinate: PadCoordinate(x: 3, y: 2), action: .undo, color: PadColor(r: 255, g: 255, b: 255)),
        Binding(coordinate: PadCoordinate(x: 0, y: 3), action: .previousFile, color: PadColor(r: 255, g: 255, b: 0)),
        Binding(coordinate: PadCoordinate(x: 1, y: 3), action: .nextHunk, color: PadColor(r: 255, g: 255, b: 0)),
        Binding(coordinate: PadCoordinate(x: 2, y: 3), action: .nextFile, color: PadColor(r: 255, g: 255, b: 0)),
        Binding(coordinate: PadCoordinate(x: 3, y: 3), action: nil, color: .off)
    ]

    private let registry: HunkReviewRegistry
    private let invalidationBus: RenderInvalidationBus

    init(registry: HunkReviewRegistry, invalidationBus: RenderInvalidationBus) {
        self.registry = registry
        self.invalidationBus = invalidationBus
    }

    func handle(_ event: PadEvent) -> Bool {
        guard let binding = Self.bindings.first(where: { $0.coordinate == event.coordinate }) else {
            return false
        }
        guard event.phase == .press, let action = binding.action else {
            return true
        }
        if registry.enqueueCommand(action) != nil {
            TraceLogger.log("launchpad hunk action queued action=\(action.rawValue)")
            invalidationBus.markDirty(reason: "hunk_review_command")
        } else {
            TraceLogger.log("launchpad hunk action ignored action=\(action.rawValue)")
        }
        return true
    }

    func getColor(at coordinate: PadCoordinate) -> PadColor? {
        guard let binding = Self.bindings.first(where: { $0.coordinate == coordinate }) else {
            return nil
        }
        guard let action = binding.action else {
            return .off
        }
        return registry.canDispatch(action) ? binding.color : .off
    }

    func allCoordinatesForRendering() -> [PadCoordinate] {
        Self.bindings.map(\.coordinate)
    }
}

final class DiffReviewLaunchpadControlLayer: LaunchpadControlLayer {
    private static let coordinate = PadCoordinate(x: 2, y: 7)
    private let registry: HunkReviewRegistry
    private let reviewStore: DiffReviewStore
    private let onPress: () -> Void

    init(
        registry: HunkReviewRegistry,
        reviewStore: DiffReviewStore,
        onPress: @escaping () -> Void
    ) {
        self.registry = registry
        self.reviewStore = reviewStore
        self.onPress = onPress
    }

    func handle(_ event: PadEvent) -> Bool {
        guard event.coordinate == Self.coordinate else {
            return false
        }
        guard event.phase == .press else {
            return true
        }
        onPress()
        return true
    }

    func getColor(at coordinate: PadCoordinate) -> PadColor? {
        guard coordinate == Self.coordinate else {
            return nil
        }
        let diagnostics = reviewStore.diagnostics()
        if diagnostics.reviewRecordingActive {
            return PadColor(r: 255, g: 0, b: 0)
        }
        let hasFocusedHunk = registry.activeReviewHunk() != nil
        if hasFocusedHunk, diagnostics.hasActiveReview {
            return PadColor(r: 0, g: 0, b: 255)
        }
        if hasFocusedHunk {
            return PadColor(r: 90, g: 90, b: 90)
        }
        if diagnostics.hasActiveReview {
            return PadColor(r: 0, g: 255, b: 0)
        }
        return .off
    }

    func allCoordinatesForRendering() -> [PadCoordinate] {
        [Self.coordinate]
    }
}

extension HunkReviewContext {
    func refinementContextBlock() -> RefinementContextBlock {
        RefinementContextBlock(
            title: "Current hunk",
            metadata: [
                "sourceProvider": effectiveSourceProvider,
                "repoRoot": repoRoot,
                "file": file,
                "hunkId": hunkId,
                "hunkIndex": "\(hunkIndex)",
                "hunkCount": "\(hunkCount)",
                "header": header,
                "patchHash": patchHash
            ],
            body: patch
        )
    }
}
