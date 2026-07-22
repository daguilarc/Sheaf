import Foundation

public final class WhisperBackendBootstrap {
    private let loadBackends: () -> Void
    private let deviceCount: () -> Int
    private let lock = NSLock()
    private var cachedResult: Result<Int, DictatorError>?

    public init(loadBackends: @escaping () -> Void, deviceCount: @escaping () -> Int) {
        self.loadBackends = loadBackends
        self.deviceCount = deviceCount
    }

    public func prepareBackendDeviceCount() throws -> Int {
        lock.lock()
        defer { lock.unlock() }

        if let cachedResult {
            return try cachedResult.get()
        }

        loadBackends()
        let count = deviceCount()
        let result: Result<Int, DictatorError>
        if count > 0 {
            result = .success(count)
        } else {
            result = .failure(.sttFailed("ggml backend initialization found no devices; install whisper-cpp/ggml backends and rebuild Dictator"))
        }
        cachedResult = result
        return try result.get()
    }
}

#if canImport(CWhisper)
import CWhisper

extension WhisperBackendBootstrap {
    static let production = WhisperBackendBootstrap(
        loadBackends: { ggml_backend_load_all() },
        deviceCount: { Int(ggml_backend_dev_count()) }
    )
}
#endif
