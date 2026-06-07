import Foundation
import DictatorCore

enum OllamaBootstrapResult {
    case notRequired
    case alreadyRunning
    case started(process: Process)
    case startFailed(String)
}

enum OllamaBootstrapper {
    static func ensureRunningIfNeeded(
        configuration: LLMRuntimeConfiguration,
        reachabilityTimeout: TimeInterval = 0.6
    ) -> OllamaBootstrapResult {
        guard shouldAttemptAutoStart(configuration: configuration) else {
            return .notRequired
        }

        if isReachable(host: configuration.ollamaHost, timeout: reachabilityTimeout) {
            return .alreadyRunning
        }

        do {
            let process = try startServeProcess(configuration: configuration)
            return .started(process: process)
        } catch {
            return .startFailed(String(describing: error))
        }
    }

    static func shouldAttemptAutoStart(configuration: LLMRuntimeConfiguration) -> Bool {
        guard configuration.provider == .ollama else {
            return false
        }
        return isLoopbackHost(configuration.ollamaHost)
    }

    static func isLoopbackHost(_ hostURL: String) -> Bool {
        guard let url = URL(string: hostURL), let host = url.host?.lowercased() else {
            return false
        }
        return host == "localhost" || host == "127.0.0.1" || host == "::1"
    }

    private static func isReachable(host: String, timeout: TimeInterval) -> Bool {
        guard let url = URL(string: "\(host)/api/tags") else {
            return false
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = timeout

        let semaphore = DispatchSemaphore(value: 0)
        var reachable = false
        URLSession.shared.dataTask(with: request) { _, response, _ in
            if let http = response as? HTTPURLResponse, (200 ... 299).contains(http.statusCode) {
                reachable = true
            }
            semaphore.signal()
        }.resume()

        _ = semaphore.wait(timeout: .now() + timeout + 0.2)
        return reachable
    }

    private static func startServeProcess(configuration: LLMRuntimeConfiguration) throws -> Process {
        let configuredBinary = configuration.ollamaBinPath.trimmingCharacters(in: .whitespacesAndNewlines)
        let process = Process()
        if !configuredBinary.isEmpty {
            process.executableURL = URL(fileURLWithPath: configuredBinary)
            process.arguments = ["serve"]
        } else {
            process.executableURL = URL(fileURLWithPath: RuntimeConfigFile.defaultOllamaBinPath)
            process.arguments = ["serve"]
        }
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
        return process
    }
}
