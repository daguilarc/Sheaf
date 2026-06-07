import AppKit

final class LaunchpadArrowCycleEventTapController {
    private let isHoldCycleSessionActive: () -> Bool
    private let onArrowKeyDown: (_ keyCode: UInt16, _ timestamp: TimeInterval) -> Void

    private var eventTap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?

    init(
        isHoldCycleSessionActive: @escaping () -> Bool,
        onArrowKeyDown: @escaping (_ keyCode: UInt16, _ timestamp: TimeInterval) -> Void
    ) {
        self.isHoldCycleSessionActive = isHoldCycleSessionActive
        self.onArrowKeyDown = onArrowKeyDown
    }

    deinit {
        disarm()
    }

    var isArmed: Bool {
        eventTap != nil
    }

    @discardableResult
    func arm() -> Bool {
        disarm()

        let keyDownMask = CGEventMask(1) << CGEventType.keyDown.rawValue
        guard let eventTap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .defaultTap,
            eventsOfInterest: keyDownMask,
            callback: Self.eventTapCallback,
            userInfo: UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque())
        ) else {
            TraceLogger.log("launchpad next_window event tap arm failed: tap_create")
            return false
        }

        guard let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0) else {
            CFMachPortInvalidate(eventTap)
            TraceLogger.log("launchpad next_window event tap arm failed: run_loop_source_create")
            return false
        }

        self.eventTap = eventTap
        self.runLoopSource = runLoopSource
        CFRunLoopAddSource(CFRunLoopGetMain(), runLoopSource, .commonModes)
        CGEvent.tapEnable(tap: eventTap, enable: true)
        TraceLogger.log("launchpad next_window event tap armed")
        return true
    }

    func disarm() {
        if let runLoopSource {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), runLoopSource, .commonModes)
            self.runLoopSource = nil
        }
        if let eventTap {
            CFMachPortInvalidate(eventTap)
            self.eventTap = nil
        }
    }

    private func handleEvent(type: CGEventType, event: CGEvent) -> Unmanaged<CGEvent>? {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let eventTap {
                CGEvent.tapEnable(tap: eventTap, enable: true)
                TraceLogger.log("launchpad next_window event tap re-enabled type=\(type.rawValue)")
            }
            return Unmanaged.passUnretained(event)
        }

        let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
        let shouldConsume = LaunchpadArrowCycleEventTapConsumption.shouldConsume(
            eventType: type,
            keyCode: keyCode,
            isHoldCycleSessionActive: isHoldCycleSessionActive()
        )

        guard shouldConsume, keyCode >= 0, keyCode <= Int64(UInt16.max) else {
            return Unmanaged.passUnretained(event)
        }

        onArrowKeyDown(UInt16(keyCode), ProcessInfo.processInfo.systemUptime)
        return nil
    }

    private static let eventTapCallback: CGEventTapCallBack = { _, type, event, userInfo in
        guard let userInfo else {
            return Unmanaged.passUnretained(event)
        }
        let controller = Unmanaged<LaunchpadArrowCycleEventTapController>.fromOpaque(userInfo).takeUnretainedValue()
        return controller.handleEvent(type: type, event: event)
    }
}
