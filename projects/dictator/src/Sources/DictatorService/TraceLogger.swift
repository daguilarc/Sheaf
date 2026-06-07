import Foundation

enum TraceLogger {
    private static let defaultLogURL = URL(fileURLWithPath: "/tmp/dictator-trace.log")
    private static let formatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private static let lock = NSLock()
    private static var configuredLogURL: URL = defaultLogURL

    static func configure(logDirectoryPath: String?) {
        lock.lock()
        defer { lock.unlock() }

        guard let logDirectoryPath = logDirectoryPath?.trimmingCharacters(in: .whitespacesAndNewlines),
              !logDirectoryPath.isEmpty else {
            configuredLogURL = defaultLogURL
            ensureLogFileExists(at: configuredLogURL)
            return
        }

        let directoryURL = URL(fileURLWithPath: logDirectoryPath, isDirectory: true)
        configuredLogURL = directoryURL.appendingPathComponent("trace.log", isDirectory: false)
        ensureLogFileExists(at: configuredLogURL)
    }

    static func reset() {
        lock.lock()
        let current = configuredLogURL
        lock.unlock()
        ensureLogFileExists(at: current)
    }

    static func log(_ message: String) {
        lock.lock()
        let logURL = configuredLogURL
        lock.unlock()

        let timestamp = formatter.string(from: Date())
        let line = "[\(timestamp)] \(message)\n"

        if let data = line.data(using: .utf8) {
            ensureLogFileExists(at: logURL)
            if let handle = try? FileHandle(forWritingTo: logURL) {
                _ = try? handle.seekToEnd()
                try? handle.write(contentsOf: data)
                try? handle.close()
            }
        }

        fputs(line, stderr)
    }

    static var path: String {
        lock.lock()
        let path = configuredLogURL.path
        lock.unlock()
        return path
    }

    private static func ensureLogFileExists(at url: URL) {
        let directoryURL = url.deletingLastPathComponent()
        try? FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil)
        }
    }
}
