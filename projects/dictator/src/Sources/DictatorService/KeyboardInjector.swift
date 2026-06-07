import ApplicationServices
import Foundation
import QuartzCore

enum KeyboardModifier: String, Decodable, Hashable {
    case shift
    case command
    case option
    case control
}

enum KeyboardKey: String, Decodable {
    case tab
    case up
    case down
    case left
    case right
    case enter
    case backspace
    case space
    case c
    case v
    case x
    case z
    case f13
    case f14
    case f15
    case f16
    case f17
    case f18
    case f19
    case f20

    var keyCode: CGKeyCode {
        switch self {
        case .tab:
            return 48
        case .up:
            return 126
        case .down:
            return 125
        case .left:
            return 123
        case .right:
            return 124
        case .enter:
            return 36
        case .backspace:
            return 51
        case .space:
            return 49
        case .c:
            return 8
        case .v:
            return 9
        case .x:
            return 7
        case .z:
            return 6
        case .f13:
            return 105
        case .f14:
            return 107
        case .f15:
            return 113
        case .f16:
            return 106
        case .f17:
            return 64
        case .f18:
            return 79
        case .f19:
            return 80
        case .f20:
            return 90
        }
    }
}

final class KeyboardInjector {
    private static let duplicateWindowSeconds: CFTimeInterval = 0.012

    enum DispatchFailureReason: String {
        case accessibilityPermissionMissing
        case eventConstructionFailed
    }

    struct DispatchResult {
        let key: KeyboardKey
        let success: Bool
        let failureReason: DispatchFailureReason?
    }

    private let onDispatchResult: ((DispatchResult) -> Void)?
    private let lock = NSLock()
    private var lastDispatchByKey: [KeyboardKey: CFTimeInterval] = [:]

    init(onDispatchResult: ((DispatchResult) -> Void)? = nil) {
        self.onDispatchResult = onDispatchResult
    }

    static func hasAccessibilityPermission() -> Bool {
        AXIsProcessTrusted()
    }

    @discardableResult
    static func requestAccessibilityPermissionPrompt() -> Bool {
        let key = kAXTrustedCheckOptionPrompt.takeRetainedValue() as String
        let options = [key: true] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }

    @discardableResult
    func send(_ key: KeyboardKey, modifiers: Set<KeyboardModifier> = []) -> Bool {
        TraceLogger.log("keyboard inject attempt key=\(key.rawValue)")
        guard Self.hasAccessibilityPermission() else {
            TraceLogger.log("keyboard inject failed key=\(key.rawValue) reason=accessibility_permission_missing")
            onDispatchResult?(DispatchResult(key: key, success: false, failureReason: .accessibilityPermissionMissing))
            return false
        }

        let now = CACurrentMediaTime()
        lock.lock()
        let lastDispatch = lastDispatchByKey[key]
        if let lastDispatch, (now - lastDispatch) <= Self.duplicateWindowSeconds {
            lock.unlock()
            TraceLogger.log(
                "keyboard inject suppressed duplicate key=\(key.rawValue) deltaMs=\(Int((now - lastDispatch) * 1000))"
            )
            onDispatchResult?(DispatchResult(key: key, success: true, failureReason: nil))
            return true
        }
        lastDispatchByKey[key] = now
        lock.unlock()

        guard let source = CGEventSource(stateID: .hidSystemState),
              let keyDown = CGEvent(keyboardEventSource: source, virtualKey: key.keyCode, keyDown: true),
              let keyUp = CGEvent(keyboardEventSource: source, virtualKey: key.keyCode, keyDown: false) else {
            TraceLogger.log("keyboard inject failed key=\(key.rawValue) reason=event_construction_failed")
            onDispatchResult?(DispatchResult(key: key, success: false, failureReason: .eventConstructionFailed))
            return false
        }

        let eventFlags = flags(from: modifiers)
        keyDown.flags = eventFlags
        keyUp.flags = eventFlags

        postPair(keyDown: keyDown, keyUp: keyUp, tap: .cgSessionEventTap, key: key)
        TraceLogger.log("keyboard inject success key=\(key.rawValue) tap=cgSession modifiers=\(modifiers)")
        onDispatchResult?(DispatchResult(key: key, success: true, failureReason: nil))
        return true
    }

    private func postPair(keyDown: CGEvent, keyUp: CGEvent, tap: CGEventTapLocation, key: KeyboardKey) {
        keyDown.post(tap: tap)
        keyUp.post(tap: tap)
        TraceLogger.log("keyboard inject post attempted key=\(key.rawValue) tap=\(tap.logName)")
    }
}

private func flags(from modifiers: Set<KeyboardModifier>) -> CGEventFlags {
    var flags: CGEventFlags = []
    if modifiers.contains(.shift) {
        flags.insert(.maskShift)
    }
    if modifiers.contains(.command) {
        flags.insert(.maskCommand)
    }
    if modifiers.contains(.option) {
        flags.insert(.maskAlternate)
    }
    if modifiers.contains(.control) {
        flags.insert(.maskControl)
    }
    return flags
}

private extension CGEventTapLocation {
    var logName: String {
        switch self {
        case .cghidEventTap:
            return "cghid"
        case .cgSessionEventTap:
            return "cgSession"
        case .cgAnnotatedSessionEventTap:
            return "cgAnnotatedSession"
        @unknown default:
            return "unknown"
        }
    }
}
