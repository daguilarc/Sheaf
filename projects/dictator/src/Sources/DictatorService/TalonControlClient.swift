import Foundation

protocol TalonControlProviding: Sendable
{
    func status() async -> TalonControlStatus
    @discardableResult func sleep() async -> TalonControlStatus
    @discardableResult func wake() async -> TalonControlStatus
}

struct TalonControlStatus: Sendable, Equatable
{
    enum State: Sendable, Equatable
    {
        case awake
        case asleep
        case unavailable
        case error(String)
    }

    let state: State
    let speechEnabled: Bool?
    let modes: [String]

    static let unavailable = TalonControlStatus(state: .unavailable, speechEnabled: nil, modes: [])

    var isAwake: Bool
    {
        state == .awake
    }

    var logName: String
    {
        switch state
        {
        case .awake:
            return "awake"
        case .asleep:
            return "asleep"
        case .unavailable:
            return "unavailable"
        case let .error(message):
            return "error(\(message))"
        }
    }
}

final class TalonControlClient: TalonControlProviding, @unchecked Sendable
{
    private struct BridgeStatusResponse: Decodable
    {
        let speech_enabled: Bool?
        let mode: [String]?
        let error: String?
    }

    private let baseURL: URL
    private let urlSession: URLSession
    private let timeout: TimeInterval

    init(
        baseURL: URL = URL(string: "http://127.0.0.1:28579")!,
        urlSession: URLSession = .shared,
        timeout: TimeInterval = 1.25
    )
    {
        self.baseURL = baseURL
        self.urlSession = urlSession
        self.timeout = timeout
    }

    func status() async -> TalonControlStatus
    {
        await request(method: "GET", path: "status")
    }

    @discardableResult func sleep() async -> TalonControlStatus
    {
        await request(method: "POST", path: "sleep")
    }

    @discardableResult func wake() async -> TalonControlStatus
    {
        await request(method: "POST", path: "wake")
    }

    private func request(method: String, path: String) async -> TalonControlStatus
    {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.timeoutInterval = timeout
        request.cachePolicy = .reloadIgnoringLocalCacheData

        do
        {
            let (data, response) = try await urlSession.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else
            {
                return .unavailable
            }

            let decoded = try? JSONDecoder().decode(BridgeStatusResponse.self, from: data)
            if let error = decoded?.error
            {
                return TalonControlStatus(state: .error(error), speechEnabled: decoded?.speech_enabled, modes: decoded?.mode ?? [])
            }
            guard (200..<300).contains(httpResponse.statusCode), let decoded else
            {
                return TalonControlStatus(
                    state: .error("Talon bridge returned HTTP \(httpResponse.statusCode)"),
                    speechEnabled: decoded?.speech_enabled,
                    modes: decoded?.mode ?? []
                )
            }

            return Self.status(from: decoded)
        }
        catch let error as URLError
        {
            switch error.code
            {
            case .cannotConnectToHost, .cannotFindHost, .networkConnectionLost, .notConnectedToInternet, .timedOut:
                return .unavailable
            default:
                return TalonControlStatus(state: .error(error.localizedDescription), speechEnabled: nil, modes: [])
            }
        }
        catch
        {
            return TalonControlStatus(state: .error(String(describing: error)), speechEnabled: nil, modes: [])
        }
    }

    private static func status(from response: BridgeStatusResponse) -> TalonControlStatus
    {
        let modes = response.mode ?? []
        if response.speech_enabled == true && !modes.contains("sleep")
        {
            return TalonControlStatus(state: .awake, speechEnabled: response.speech_enabled, modes: modes)
        }
        return TalonControlStatus(state: .asleep, speechEnabled: response.speech_enabled, modes: modes)
    }
}
