import DictatorCore
import Foundation

enum VSCodeHunkAction: String, Codable, CaseIterable {
    case previousHunk
    case nextHunk
    case previousFile
    case nextFile
    case stage
    case revert
    case undo
}

struct VSCodeHunkActionAvailability: Codable, Equatable {
    let canGoUp: Bool
    let canGoDown: Bool
    let canGoPrevFile: Bool
    let canGoNextFile: Bool
    let canStage: Bool
    let canRevert: Bool
    let canUndo: Bool

    static let none = VSCodeHunkActionAvailability(
        canGoUp: false,
        canGoDown: false,
        canGoPrevFile: false,
        canGoNextFile: false,
        canStage: false,
        canRevert: false,
        canUndo: false
    )

    func allows(_ action: VSCodeHunkAction) -> Bool {
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

struct VSCodeHunkMetadata: Codable, Equatable {
    let id: String
    let file: String
    let index: Int
    let count: Int
    let header: String
    let patchHash: String
}

struct VSCodeHunkReviewContext: Codable, Equatable, Sendable {
    let repoRoot: String
    let file: String
    let hunkId: String
    let hunkIndex: Int
    let hunkCount: Int
    let header: String
    let patchHash: String
    let patch: String
}

struct VSCodeHunkPaneSnapshot: Codable, Equatable {
    let windowId: String
    let focused: Bool
    let paneOpen: Bool
    let repoRoot: String?
    let file: String?
    let fileIndex: Int
    let fileCount: Int
    let hunkIndex: Int
    let hunkCount: Int
    let currentHunk: VSCodeHunkMetadata?
    let currentHunkReview: VSCodeHunkReviewContext?
    let actions: VSCodeHunkActionAvailability
}

struct VSCodeHunkHeartbeatRequest: Codable {
    let windowId: String
    let focused: Bool
}

struct VSCodeHunkDisconnectRequest: Codable {
    let windowId: String
}

struct VSCodeHunkCommandEnvelope: Codable, Equatable {
    let id: String
    let action: VSCodeHunkAction
}

struct VSCodeHunkCommandResultRequest: Codable {
    let commandId: String
    let windowId: String
    let result: VSCodeHunkCommandResult
}

struct VSCodeHunkCommandResult: Codable, Equatable {
    let ok: Bool
    let action: VSCodeHunkAction
    let error: String?
    let reviewFacts: VSCodeHunkCommandReviewFacts?
}

struct VSCodeHunkCommandReviewFacts: Codable, Equatable {
    let revertedHunk: VSCodeHunkReviewContext?
    let restoredRevertedHunk: VSCodeHunkReviewContext?
}

struct VSCodeHunkInstanceDiagnostic: Codable, Equatable {
    let windowId: String
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

struct VSCodeHunkDiagnostics: Codable, Equatable {
    let activeWindowId: String?
    let instances: [VSCodeHunkInstanceDiagnostic]
    let lastCommandResult: VSCodeHunkCommandResult?
    let diffReview: DiffReviewDiagnostics?
}

final class VSCodeHunkRegistry: @unchecked Sendable {
    struct ActiveTarget {
        let windowId: String
        let snapshot: VSCodeHunkPaneSnapshot
    }

    private struct Instance {
        var snapshot: VSCodeHunkPaneSnapshot
        var lastHeartbeat: Date
        var pendingCommands: [VSCodeHunkCommandEnvelope]
    }

    private let lock = NSLock()
    private let timeoutSeconds: TimeInterval
    private var instances: [String: Instance] = [:]
    private var lastFocusedWindowId: String?
    private var lastCommandResult: VSCodeHunkCommandResult?
    private var onChange: (() -> Void)?

    init(timeoutSeconds: TimeInterval = 3.0) {
        self.timeoutSeconds = timeoutSeconds
    }

    func setOnChange(_ onChange: (() -> Void)?) {
        lock.lock()
        self.onChange = onChange
        lock.unlock()
    }

    func update(snapshot: VSCodeHunkPaneSnapshot, now: Date = Date()) {
        lock.lock()
        var instance = instances[snapshot.windowId] ?? Instance(
            snapshot: snapshot,
            lastHeartbeat: now,
            pendingCommands: []
        )
        instance.snapshot = snapshot
        instance.lastHeartbeat = now
        instances[snapshot.windowId] = instance
        if snapshot.focused {
            lastFocusedWindowId = snapshot.windowId
        }
        expireLocked(now: now)
        let callback = onChange
        lock.unlock()
        callback?()
    }

    func heartbeat(windowId: String, focused: Bool, now: Date = Date()) {
        lock.lock()
        if var instance = instances[windowId] {
            instance.lastHeartbeat = now
            instance.snapshot = VSCodeHunkPaneSnapshot(
                windowId: instance.snapshot.windowId,
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
            instances[windowId] = instance
        }
        if focused {
            lastFocusedWindowId = windowId
        }
        expireLocked(now: now)
        let callback = onChange
        lock.unlock()
        callback?()
    }

    func disconnect(windowId: String) {
        lock.lock()
        instances.removeValue(forKey: windowId)
        if lastFocusedWindowId == windowId {
            lastFocusedWindowId = instances.values
                .filter { $0.snapshot.focused }
                .max { $0.lastHeartbeat < $1.lastHeartbeat }?
                .snapshot.windowId
        }
        let callback = onChange
        lock.unlock()
        callback?()
    }

    func activeTarget(now: Date = Date()) -> ActiveTarget? {
        lock.lock()
        defer { lock.unlock() }
        expireLocked(now: now)
        guard let windowId = lastFocusedWindowId,
              let instance = instances[windowId],
              isHealthy(instance, now: now),
              instance.snapshot.focused else {
            return nil
        }
        return ActiveTarget(windowId: windowId, snapshot: instance.snapshot)
    }

    func canDispatch(_ action: VSCodeHunkAction, now: Date = Date()) -> Bool {
        guard let target = activeTarget(now: now) else {
            return false
        }
        return target.snapshot.paneOpen && target.snapshot.actions.allows(action)
    }

    func activeReviewHunk(now: Date = Date()) -> VSCodeHunkReviewContext? {
        guard let target = activeTarget(now: now),
              target.snapshot.paneOpen else {
            return nil
        }
        return target.snapshot.currentHunkReview
    }

    func enqueueCommand(_ action: VSCodeHunkAction, now: Date = Date()) -> VSCodeHunkCommandEnvelope? {
        lock.lock()
        expireLocked(now: now)
        guard let windowId = lastFocusedWindowId,
              var instance = instances[windowId],
              isHealthy(instance, now: now),
              instance.snapshot.focused,
              instance.snapshot.paneOpen,
              instance.snapshot.actions.allows(action) else {
            lock.unlock()
            return nil
        }
        let command = VSCodeHunkCommandEnvelope(id: UUID().uuidString, action: action)
        instance.pendingCommands.append(command)
        instances[windowId] = instance
        let callback = onChange
        lock.unlock()
        callback?()
        return command
    }

    func nextCommand(windowId: String, now: Date = Date()) -> VSCodeHunkCommandEnvelope? {
        lock.lock()
        defer { lock.unlock() }
        expireLocked(now: now)
        guard var instance = instances[windowId],
              isHealthy(instance, now: now),
              !instance.pendingCommands.isEmpty else {
            return nil
        }
        let command = instance.pendingCommands.removeFirst()
        instances[windowId] = instance
        return command
    }

    func recordResult(_ result: VSCodeHunkCommandResult) {
        lock.lock()
        lastCommandResult = result
        let callback = onChange
        lock.unlock()
        callback?()
    }

    func diagnostics(now: Date = Date(), diffReview: DiffReviewDiagnostics? = nil) -> VSCodeHunkDiagnostics {
        lock.lock()
        defer { lock.unlock() }
        expireLocked(now: now)
        let diagnostics = instances.values
            .sorted { $0.snapshot.windowId < $1.snapshot.windowId }
            .map { instance in
                let actions = instance.snapshot.actions
                return VSCodeHunkInstanceDiagnostic(
                    windowId: instance.snapshot.windowId,
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
        return VSCodeHunkDiagnostics(
            activeWindowId: activeTargetLocked(now: now)?.windowId,
            instances: diagnostics,
            lastCommandResult: lastCommandResult,
            diffReview: diffReview
        )
    }

    private func activeTargetLocked(now: Date) -> ActiveTarget? {
        guard let windowId = lastFocusedWindowId,
              let instance = instances[windowId],
              isHealthy(instance, now: now),
              instance.snapshot.focused else {
            return nil
        }
        return ActiveTarget(windowId: windowId, snapshot: instance.snapshot)
    }

    private func expireLocked(now: Date) {
        let stale = instances.filter { !isHealthy($0.value, now: now) }.map(\.key)
        for windowId in stale {
            instances.removeValue(forKey: windowId)
        }
        if let focused = lastFocusedWindowId, instances[focused] == nil {
            lastFocusedWindowId = instances.values
                .filter { $0.snapshot.focused && isHealthy($0, now: now) }
                .max { $0.lastHeartbeat < $1.lastHeartbeat }?
                .snapshot.windowId
        }
    }

    private func isHealthy(_ instance: Instance, now: Date) -> Bool {
        now.timeIntervalSince(instance.lastHeartbeat) <= timeoutSeconds
    }
}

final class VSCodeHunkLaunchpadControlLayer: LaunchpadControlLayer {
    private struct Binding {
        let coordinate: PadCoordinate
        let action: VSCodeHunkAction?
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

    private let registry: VSCodeHunkRegistry
    private let invalidationBus: RenderInvalidationBus

    init(registry: VSCodeHunkRegistry, invalidationBus: RenderInvalidationBus) {
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
            TraceLogger.log("launchpad vscode hunk action queued action=\(action.rawValue)")
            invalidationBus.markDirty(reason: "vscode_hunk_command")
        } else {
            TraceLogger.log("launchpad vscode hunk action ignored action=\(action.rawValue)")
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
    private let registry: VSCodeHunkRegistry
    private let reviewStore: DiffReviewStore
    private let onPress: () -> Void

    init(
        registry: VSCodeHunkRegistry,
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

extension VSCodeHunkReviewContext {
    func refinementContextBlock() -> RefinementContextBlock {
        RefinementContextBlock(
            title: "Current hunk",
            metadata: [
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
