import Foundation

final class DarwinNotificationCenter {
    static let shared = DarwinNotificationCenter()
    private var callbacks: [String: () -> Void] = [:]

    func post(_ name: String) {
        let center = CFNotificationCenterGetDarwinNotifyCenter()
        CFNotificationCenterPostNotification(
            center,
            CFNotificationName(name as CFString),
            nil,
            nil,
            true
        )
    }

    func observe(_ name: String, callback: @escaping () -> Void) {
        callbacks[name] = callback
        let center = CFNotificationCenterGetDarwinNotifyCenter()
        CFNotificationCenterAddObserver(
            center,
            Unmanaged.passUnretained(self).toOpaque(),
            Self.darwinCallback,
            name as CFString,
            nil,
            .deliverImmediately
        )
    }

    func removeObserver(_ name: String) {
        let center = CFNotificationCenterGetDarwinNotifyCenter()
        CFNotificationCenterRemoveObserver(
            center,
            Unmanaged.passUnretained(self).toOpaque(),
            CFNotificationName(name as CFString),
            nil
        )
        callbacks.removeValue(forKey: name)
    }

    private static let darwinCallback: CFNotificationCallback = {
        _, observer, name, _, _ in
        guard let observer = observer,
              let name = name?.rawValue as String? else { return }
        let mgr = Unmanaged<DarwinNotificationCenter>
            .fromOpaque(observer).takeUnretainedValue()
        mgr.callbacks[name]?()
    }
}
