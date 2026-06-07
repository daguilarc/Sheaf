import Foundation

public final class InMemorySecretStore: SecretStore, @unchecked Sendable {
    private let lock = NSLock()
    private var openAIKey: String?

    public init(openAIKey: String? = nil) {
        self.openAIKey = Self.normalized(openAIKey)
    }

    public func getOpenAIKey() throws -> String? {
        lock.lock()
        defer { lock.unlock() }
        return openAIKey
    }

    public func setOpenAIKey(_ key: String) throws {
        guard let normalized = Self.normalized(key) else {
            throw DictatorError.configUpdateFailed("OpenAI key cannot be empty")
        }
        lock.lock()
        openAIKey = normalized
        lock.unlock()
    }

    public func clearOpenAIKey() throws {
        lock.lock()
        openAIKey = nil
        lock.unlock()
    }

    private static func normalized(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
            return nil
        }
        return value
    }
}
