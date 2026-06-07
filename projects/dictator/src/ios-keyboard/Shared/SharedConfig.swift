import Foundation

enum KeyboardSessionPhase: String, Codable
{
    case idle
    case launchingHost = "launching_host"
    case hostReady = "host_ready"
    case recording
    case stopping
    case processing
    case completed
    case failed
    case cancelled

    var isTerminal: Bool
    {
        switch self
        {
        case .idle, .completed, .failed, .cancelled:
            return true
        case .launchingHost, .hostReady, .recording, .stopping, .processing:
            return false
        }
    }
}

struct SharedKeyboardSession: Codable, Equatable
{
    let sessionID: String
    let startedAt: Date
    let updatedAt: Date
    let phase: KeyboardSessionPhase
    let errorMessage: String?
    let latestTranscriptUpdatedAt: Date?
    let recordingStartedAt: Date?
    let lastTakeDuration: TimeInterval?

    var isTerminal: Bool
    {
        phase.isTerminal
    }
}

struct DictateAudioResponse: Decodable, Equatable
{
    let raw_transcript: String
    let revised_text: String
    let edit_summary: String
    let uncertainty_flags: [String]
    let transcribe_ms: Int
    let refine_ms: Int
}

enum SharedConfig
{
    static let appGroupIdentifier = "group.com.joyo.dictator"
    static let fallbackServerURL = "http://127.0.0.1:9003"
    static let hostURLKey = "ios_client_host_url"
    static let latestTranscriptKey = "latest_transcript"
    static let latestTranscriptUpdatedAtKey = "latest_transcript_updated_at"
    static let keyboardSessionKey = "keyboard_session_v1"
    static let lastInsertedSessionIDKey = "last_inserted_session_id"
    static let lastInsertedTranscriptUpdatedAtKey = "last_inserted_transcript_updated_at"
    static let diagnosticsFilename = "host_diagnostics.log"
    static let hostAppURLScheme = "dictatorkeyboardhost"
    static let hostAppLaunchURLString = "\(hostAppURLScheme)://open"
    static let hostAppDictationURLString = "\(hostAppURLScheme)://dictation"

    static let darwinDictationStart = "com.joyo.dictator.dictation.start"
    static let darwinDictationStop = "com.joyo.dictator.dictation.stop"
    static let darwinDictationCancelTake = "com.joyo.dictator.dictation.cancel-take"
    static let darwinSessionUpdated = "com.joyo.dictator.dictation.session-updated"

    static let dictationInProgressKey = "dictation_in_progress"
    static let hostSessionActiveKey = "host_session_active"
    static let hostSessionHeartbeatAtKey = "host_session_heartbeat_at"

    private static let diagnosticsLock = NSLock()
    private static let keyboardSessionEncoder: JSONEncoder =
    {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .millisecondsSince1970
        return encoder
    }()
    private static let keyboardSessionDecoder: JSONDecoder =
    {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .millisecondsSince1970
        return decoder
    }()
    private static let visibleTimeFormatter: DateFormatter =
    {
        let formatter = DateFormatter()
        formatter.timeStyle = .medium
        formatter.dateStyle = .none
        return formatter
    }()
    private static var testDiagnosticsLogURLOverride: URL?
    private static var testServerURLStringOverride: String?

    static func loadKeyboardSession() -> SharedKeyboardSession?
    {
        guard let defaults = UserDefaults(suiteName: appGroupIdentifier),
              let data = defaults.data(forKey: keyboardSessionKey)
        else
        {
            return nil
        }

        return try? keyboardSessionDecoder.decode(SharedKeyboardSession.self, from: data)
    }

    static func saveKeyboardSession(_ session: SharedKeyboardSession?)
    {
        guard let defaults = UserDefaults(suiteName: appGroupIdentifier)
        else
        {
            return
        }

        if let session,
           let data = try? keyboardSessionEncoder.encode(session)
        {
            defaults.set(data, forKey: keyboardSessionKey)
            defaults.set(
                session.phase == .recording || session.phase == .hostReady || session.phase == .stopping || session.phase == .processing,
                forKey: hostSessionActiveKey
            )
            defaults.set(session.phase == .recording || session.phase == .launchingHost, forKey: dictationInProgressKey)
            defaults.set(session.updatedAt.timeIntervalSince1970, forKey: hostSessionHeartbeatAtKey)
        }
        else
        {
            defaults.removeObject(forKey: keyboardSessionKey)
            defaults.removeObject(forKey: hostSessionHeartbeatAtKey)
            defaults.set(false, forKey: hostSessionActiveKey)
            defaults.removeObject(forKey: dictationInProgressKey)
        }
    }

    @discardableResult
    static func beginKeyboardLaunchSession(now: Date = Date()) -> SharedKeyboardSession
    {
        let session = SharedKeyboardSession(
            sessionID: UUID().uuidString,
            startedAt: now,
            updatedAt: now,
            phase: .launchingHost,
            errorMessage: nil,
            latestTranscriptUpdatedAt: nil,
            recordingStartedAt: nil,
            lastTakeDuration: nil
        )
        saveKeyboardSession(session)
        postKeyboardSessionUpdated()
        return session
    }

    @discardableResult
    static func updateKeyboardSession(
        sessionID: String,
        phase: KeyboardSessionPhase,
        errorMessage: String? = nil,
        latestTranscriptUpdatedAt: Date? = nil,
        recordingStartedAt: Date? = nil,
        lastTakeDuration: TimeInterval? = nil,
        now: Date = Date()
    ) -> SharedKeyboardSession?
    {
        let existing = loadKeyboardSession()
        guard existing == nil || existing?.sessionID == sessionID
        else
        {
            return nil
        }

        let startedAt = existing?.startedAt ?? now
        let resolvedRecordingStartedAt: Date?
        switch phase
        {
        case .recording:
            resolvedRecordingStartedAt = recordingStartedAt ?? now
        case .launchingHost, .hostReady, .failed, .cancelled, .idle:
            resolvedRecordingStartedAt = nil
        case .stopping, .processing, .completed:
            resolvedRecordingStartedAt = recordingStartedAt ?? existing?.recordingStartedAt
        }

        let resolvedLastTakeDuration: TimeInterval?
        if let lastTakeDuration
        {
            resolvedLastTakeDuration = lastTakeDuration
        }
        else if phase == .processing || phase == .completed
        {
            if let recordingStartedAt = existing?.recordingStartedAt
            {
                resolvedLastTakeDuration = max(0, now.timeIntervalSince(recordingStartedAt))
            }
            else
            {
                resolvedLastTakeDuration = existing?.lastTakeDuration
            }
        }
        else
        {
            resolvedLastTakeDuration = existing?.lastTakeDuration
        }

        let session = SharedKeyboardSession(
            sessionID: sessionID,
            startedAt: startedAt,
            updatedAt: now,
            phase: phase,
            errorMessage: errorMessage,
            latestTranscriptUpdatedAt: latestTranscriptUpdatedAt ?? existing?.latestTranscriptUpdatedAt,
            recordingStartedAt: resolvedRecordingStartedAt,
            lastTakeDuration: resolvedLastTakeDuration
        )
        saveKeyboardSession(session)
        postKeyboardSessionUpdated()
        return session
    }

    @discardableResult
    static func markKeyboardSessionFailed(
        sessionID: String,
        message: String,
        now: Date = Date()
    ) -> SharedKeyboardSession?
    {
        updateKeyboardSession(sessionID: sessionID, phase: .failed, errorMessage: message, now: now)
    }

    static func resetKeyboardSessionState(now: Date = Date())
    {
        saveKeyboardSession(nil)
        postKeyboardSessionUpdated()
    }

    static func currentKeyboardSessionIfFresh(now: Date = Date(), reconcileStale: Bool = true) -> SharedKeyboardSession?
    {
        guard let session = loadKeyboardSession()
        else
        {
            return nil
        }

        guard let staleMessage = staleMessage(for: session, now: now)
        else
        {
            return session
        }

        guard reconcileStale
        else
        {
            return session
        }

        return markKeyboardSessionFailed(sessionID: session.sessionID, message: staleMessage, now: now)
    }

    static func latestCompletedKeyboardSession(now: Date = Date()) -> SharedKeyboardSession?
    {
        guard let session = currentKeyboardSessionIfFresh(now: now)
        else
        {
            return nil
        }
        return session.phase == .completed ? session : nil
    }

    static func hasInsertedTranscript(sessionID: String, updatedAt: Date) -> Bool
    {
        guard let defaults = UserDefaults(suiteName: appGroupIdentifier),
              defaults.string(forKey: lastInsertedSessionIDKey) == sessionID
        else
        {
            return false
        }
        let stored = defaults.double(forKey: lastInsertedTranscriptUpdatedAtKey)
        guard stored > 0
        else
        {
            return false
        }
        return abs(stored - updatedAt.timeIntervalSince1970) < 0.001
    }

    static func markTranscriptInserted(sessionID: String, updatedAt: Date)
    {
        guard let defaults = UserDefaults(suiteName: appGroupIdentifier)
        else
        {
            return
        }
        defaults.set(sessionID, forKey: lastInsertedSessionIDKey)
        defaults.set(updatedAt.timeIntervalSince1970, forKey: lastInsertedTranscriptUpdatedAtKey)
    }

    static func clearInsertedTranscriptTracking()
    {
        guard let defaults = UserDefaults(suiteName: appGroupIdentifier)
        else
        {
            return
        }
        defaults.removeObject(forKey: lastInsertedSessionIDKey)
        defaults.removeObject(forKey: lastInsertedTranscriptUpdatedAtKey)
    }

    static func isHostSessionActive() -> Bool
    {
        guard let session = currentKeyboardSessionIfFresh(reconcileStale: false)
        else
        {
            return false
        }
        switch session.phase
        {
        case .hostReady, .recording, .stopping, .processing:
            return true
        case .idle, .launchingHost, .completed, .failed, .cancelled:
            return false
        }
    }

    static func touchHostSession(now: Date = Date())
    {
        guard let session = loadKeyboardSession(), !session.isTerminal
        else
        {
            return
        }
        _ = updateKeyboardSession(
            sessionID: session.sessionID,
            phase: session.phase,
            errorMessage: session.errorMessage,
            latestTranscriptUpdatedAt: session.latestTranscriptUpdatedAt,
            recordingStartedAt: session.recordingStartedAt,
            lastTakeDuration: session.lastTakeDuration,
            now: now
        )
    }

    static func isHostSessionFresh(now: Date = Date()) -> Bool
    {
        currentKeyboardSessionIfFresh(now: now, reconcileStale: false)?.isTerminal == false
    }

    static func resolvedServerURLString(bundle: Bundle = .main) -> String
    {
        if let override = testServerURLStringOverride
        {
            return override
        }

        if let sharedDefaults = UserDefaults(suiteName: appGroupIdentifier),
           let raw = sharedDefaults.string(forKey: hostURLKey)
        {
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty
            {
                return trimmed
            }
        }

        if let raw = bundle.object(forInfoDictionaryKey: hostURLKey) as? String
        {
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty
            {
                return trimmed
            }
        }

        return fallbackServerURL
    }

    static func saveServerURLString(_ value: String)
    {
        guard let sharedDefaults = UserDefaults(suiteName: appGroupIdentifier)
        else
        {
            return
        }

        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty
        {
            sharedDefaults.removeObject(forKey: hostURLKey)
        }
        else
        {
            sharedDefaults.set(trimmed, forKey: hostURLKey)
        }
    }

    static func saveLatestTranscript(_ transcript: String, now: Date = Date())
    {
        guard let sharedDefaults = UserDefaults(suiteName: appGroupIdentifier)
        else
        {
            return
        }

        sharedDefaults.set(transcript, forKey: latestTranscriptKey)
        sharedDefaults.set(now.timeIntervalSince1970, forKey: latestTranscriptUpdatedAtKey)
    }

    static func loadLatestTranscript() -> String?
    {
        guard let sharedDefaults = UserDefaults(suiteName: appGroupIdentifier),
              let transcript = sharedDefaults.string(forKey: latestTranscriptKey)
        else
        {
            return nil
        }

        let trimmed = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : transcript
    }

    static func loadLatestTranscriptUpdatedAt() -> Date?
    {
        guard let sharedDefaults = UserDefaults(suiteName: appGroupIdentifier)
        else
        {
            return nil
        }

        let timestamp = sharedDefaults.double(forKey: latestTranscriptUpdatedAtKey)
        guard timestamp > 0
        else
        {
            return nil
        }
        return Date(timeIntervalSince1970: timestamp)
    }

    static func dictateAudioEndpointURL(serverURLString: String) -> URL?
    {
        let trimmed = serverURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              var baseURL = URL(string: trimmed)
        else
        {
            return nil
        }

        baseURL.appendPathComponent("v1")
        baseURL.appendPathComponent("dictate-audio")
        return baseURL
    }

    static func makeDictateAudioRequest(
        wavData: Data,
        serverURLString: String,
        sessionID: String,
        requestID: String,
        locale: String = "en-US",
        sampleRate: Int = 16_000,
        timeoutInterval: TimeInterval = 90
    ) -> URLRequest?
    {
        guard let endpoint = dictateAudioEndpointURL(serverURLString: serverURLString)
        else
        {
            return nil
        }

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = timeoutInterval
        request.setValue("audio/wav", forHTTPHeaderField: "Content-Type")
        request.setValue(String(sampleRate), forHTTPHeaderField: "X-Sample-Rate")
        request.setValue(locale, forHTTPHeaderField: "X-Locale")
        request.setValue(sessionID, forHTTPHeaderField: "X-Session-Id")
        request.setValue(requestID, forHTTPHeaderField: "X-Request-Id")
        request.httpBody = wavData
        return request
    }

    static func decodeDictateAudioResponse(from data: Data) throws -> DictateAudioResponse
    {
        try JSONDecoder().decode(DictateAudioResponse.self, from: data)
    }

    static func diagnosticsLogURL() -> URL?
    {
        if let override = testDiagnosticsLogURLOverride
        {
            return override
        }
        return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier)?
            .appendingPathComponent(diagnosticsFilename)
    }

    static func appendDiagnosticsLine(_ line: String)
    {
        _ = appendDiagnosticsEvent(line, source: "host-app")
    }

    @discardableResult
    static func appendDiagnosticsEvent(
        _ message: String,
        source: String,
        sessionID: String? = nil,
        requestID: String? = nil,
        now: Date = Date()
    ) -> String
    {
        let fullLine = formatDiagnosticsLine(message, now: now)
        appendDiagnosticsLineLocally(fullLine)
        return fullLine
    }

    static func resetDiagnosticsTestOverrides()
    {
        testDiagnosticsLogURLOverride = nil
        testServerURLStringOverride = nil
    }

    static func setDiagnosticsTestOverrides(
        logURL: URL? = nil,
        serverURLString: String? = nil
    )
    {
        testDiagnosticsLogURLOverride = logURL
        testServerURLStringOverride = serverURLString
    }

    static func readDiagnosticsLog() -> String?
    {
        guard let url = diagnosticsLogURL()
        else
        {
            return nil
        }
        return try? String(contentsOf: url, encoding: .utf8)
    }

    static func clearDiagnosticsLog()
    {
        guard let url = diagnosticsLogURL()
        else
        {
            return
        }
        try? FileManager.default.removeItem(at: url)
    }

    static func postKeyboardSessionUpdated()
    {
        DarwinNotificationCenter.shared.post(darwinSessionUpdated)
    }

    private static func staleMessage(for session: SharedKeyboardSession, now: Date) -> String?
    {
        let age = now.timeIntervalSince(session.updatedAt)
        let timeout: TimeInterval
        switch session.phase
        {
        case .launchingHost:
            timeout = 8
        case .stopping:
            timeout = 20
        case .processing:
            timeout = max(180, session.lastTakeDuration ?? 0)
        case .hostReady, .recording:
            return nil
        case .idle, .completed, .failed, .cancelled:
            return nil
        }

        guard age > timeout
        else
        {
            return nil
        }

        switch session.phase
        {
        case .launchingHost:
            return "Dictator did not finish launching. Continue in Dictator to record."
        case .stopping, .processing:
            return "Dictation did not finish processing. Open Dictator to continue."
        case .hostReady, .recording:
            return nil
        case .idle, .completed, .failed, .cancelled:
            return nil
        }
    }

    private static func appendDiagnosticsLineLocally(_ line: String)
    {
        guard let url = diagnosticsLogURL()
        else
        {
            return
        }

        let text = line + "\n"
        let data = Data(text.utf8)
        diagnosticsLock.lock()
        defer { diagnosticsLock.unlock() }
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: nil)
        if FileManager.default.fileExists(atPath: url.path),
           let handle = try? FileHandle(forWritingTo: url)
        {
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: data)
            try? handle.close()
            return
        }
        try? data.write(to: url, options: .atomic)
    }

    private static func formatDiagnosticsLine(_ message: String, now: Date) -> String
    {
        diagnosticsLock.lock()
        let rendered = "[\(visibleTimeFormatter.string(from: now))] \(message)"
        diagnosticsLock.unlock()
        return rendered
    }
}
