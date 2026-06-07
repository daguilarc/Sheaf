import Foundation
import Testing
@testable import DictatorKeyboardHost

struct DictatorKeyboardHostTests
{
    @Test func fallbackServerURLUsesPort9003()
    {
        #expect(SharedConfig.fallbackServerURL == "http://127.0.0.1:9003")
        #expect(SharedConfig.fallbackServerURL.contains(":9003"))
    }

    @Test func configuredServerURLOverridesDefault() throws
    {
        let suiteName = SharedConfig.appGroupIdentifier
        let defaults = UserDefaults(suiteName: suiteName)
        defaults?.removePersistentDomain(forName: suiteName)
        defer { defaults?.removePersistentDomain(forName: suiteName) }

        SharedConfig.saveServerURLString("http://192.168.0.42:9003")
        #expect(SharedConfig.resolvedServerURLString() == "http://192.168.0.42:9003")
    }

    @Test func dictateAudioEndpointTargetsV1DictateAudio()
    {
        let endpoint = SharedConfig.dictateAudioEndpointURL(serverURLString: "http://127.0.0.1:9003")
        #expect(endpoint?.absoluteString == "http://127.0.0.1:9003/v1/dictate-audio")
        #expect(endpoint?.path == "/v1/dictate-audio")
    }

    @Test func dictateAudioRequestSetsRequiredHeaders() throws
    {
        let wavData = Data([0x01, 0x02, 0x03])
        let request = try #require(
            SharedConfig.makeDictateAudioRequest(
                wavData: wavData,
                serverURLString: "http://127.0.0.1:9003",
                sessionID: "session-abc",
                requestID: "ABCDEF12"
            )
        )

        #expect(request.httpMethod == "POST")
        #expect(request.url?.absoluteString == "http://127.0.0.1:9003/v1/dictate-audio")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "audio/wav")
        #expect(request.value(forHTTPHeaderField: "X-Sample-Rate") == "16000")
        #expect(request.value(forHTTPHeaderField: "X-Locale") == "en-US")
        #expect(request.value(forHTTPHeaderField: "X-Session-Id") == "session-abc")
        #expect(request.value(forHTTPHeaderField: "X-Request-Id") == "ABCDEF12")
        #expect(request.httpBody == wavData)
    }

    @Test func migratedDictateAudioResponseDecodes() throws
    {
        let json = """
        {
          "raw_transcript": "hello world",
          "revised_text": "Hello world.",
          "edit_summary": "capitalized",
          "uncertainty_flags": ["low_confidence"],
          "transcribe_ms": 120,
          "refine_ms": 45
        }
        """
        let decoded = try SharedConfig.decodeDictateAudioResponse(from: Data(json.utf8))
        #expect(decoded.raw_transcript == "hello world")
        #expect(decoded.revised_text == "Hello world.")
        #expect(decoded.edit_summary == "capitalized")
        #expect(decoded.uncertainty_flags == ["low_confidence"])
        #expect(decoded.transcribe_ms == 120)
        #expect(decoded.refine_ms == 45)
    }

    @Test func diagnosticsLoggingPersistsLocallyOnly() throws
    {
        let tempDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: tempDirectory, withIntermediateDirectories: true, attributes: nil)
        let logURL = tempDirectory.appendingPathComponent("host_diagnostics.log")
        defer
        {
            SharedConfig.resetDiagnosticsTestOverrides()
            try? FileManager.default.removeItem(at: tempDirectory)
        }

        SharedConfig.setDiagnosticsTestOverrides(logURL: logURL)
        let line = SharedConfig.appendDiagnosticsEvent("hello from tests", source: "host-app")
        #expect(line.contains("hello from tests"))

        let persisted = try String(contentsOf: logURL, encoding: .utf8)
        #expect(persisted.contains("hello from tests"))
    }

    @Test func darwinNotificationCenterDeliversRegisteredCallback()
    {
        let notificationName = "com.joyo.dictator.test.\(UUID().uuidString)"
        let center = DarwinNotificationCenter.shared
        var received = false
        center.observe(notificationName)
        {
            received = true
        }
        center.post(notificationName)
        center.removeObserver(notificationName)
        #expect(received)
    }

    @Test func keyboardSessionLaunchPersistsAndCanAdvance() throws
    {
        let suiteName = SharedConfig.appGroupIdentifier
        let defaults = UserDefaults(suiteName: suiteName)
        defaults?.removePersistentDomain(forName: suiteName)
        defer { defaults?.removePersistentDomain(forName: suiteName) }

        let startedAt = Date(timeIntervalSince1970: 1_000)
        let launched = SharedConfig.beginKeyboardLaunchSession(now: startedAt)
        let readyAt = startedAt.addingTimeInterval(3)
        let recordingAt = readyAt.addingTimeInterval(1)
        let updated = SharedConfig.updateKeyboardSession(
            sessionID: launched.sessionID,
            phase: .recording,
            now: recordingAt
        )

        let persisted = try #require(SharedConfig.loadKeyboardSession())
        let recording = try #require(updated)
        #expect(persisted.sessionID == launched.sessionID)
        #expect(persisted.startedAt == startedAt)
        #expect(persisted.updatedAt == recordingAt)
        #expect(recording.phase == .recording)
        #expect(SharedConfig.isHostSessionActive())
    }

    @Test func staleLaunchingSessionBecomesFailed() throws
    {
        let suiteName = SharedConfig.appGroupIdentifier
        let defaults = UserDefaults(suiteName: suiteName)
        defaults?.removePersistentDomain(forName: suiteName)
        defer { defaults?.removePersistentDomain(forName: suiteName) }

        let startedAt = Date(timeIntervalSince1970: 2_000)
        let launched = SharedConfig.beginKeyboardLaunchSession(now: startedAt)
        let reconciled = SharedConfig.currentKeyboardSessionIfFresh(now: startedAt.addingTimeInterval(12))

        let failed = try #require(reconciled)
        #expect(failed.sessionID == launched.sessionID)
        #expect(failed.phase == .failed)
        #expect(failed.errorMessage == "Dictator did not finish launching. Continue in Dictator to record.")
    }

    @Test func transcriptInsertionTrackingRequiresMatchingSessionAndTimestamp()
    {
        let suiteName = SharedConfig.appGroupIdentifier
        let defaults = UserDefaults(suiteName: suiteName)
        defaults?.removePersistentDomain(forName: suiteName)
        defer { defaults?.removePersistentDomain(forName: suiteName) }

        let insertedAt = Date(timeIntervalSince1970: 3_000)
        #expect(!SharedConfig.hasInsertedTranscript(sessionID: "session-a", updatedAt: insertedAt))

        SharedConfig.markTranscriptInserted(sessionID: "session-a", updatedAt: insertedAt)

        #expect(SharedConfig.hasInsertedTranscript(sessionID: "session-a", updatedAt: insertedAt))
        #expect(!SharedConfig.hasInsertedTranscript(sessionID: "session-b", updatedAt: insertedAt))
        #expect(!SharedConfig.hasInsertedTranscript(sessionID: "session-a", updatedAt: insertedAt.addingTimeInterval(1)))

        SharedConfig.clearInsertedTranscriptTracking()
        #expect(!SharedConfig.hasInsertedTranscript(sessionID: "session-a", updatedAt: insertedAt))
    }

    @Test func resetKeyboardSessionStateClearsSessionAndLegacyFlags()
    {
        let suiteName = SharedConfig.appGroupIdentifier
        let defaults = UserDefaults(suiteName: suiteName)
        defaults?.removePersistentDomain(forName: suiteName)
        defer { defaults?.removePersistentDomain(forName: suiteName) }

        let session = SharedConfig.beginKeyboardLaunchSession(now: Date(timeIntervalSince1970: 4_000))
        _ = SharedConfig.updateKeyboardSession(sessionID: session.sessionID, phase: .processing)
        SharedConfig.resetKeyboardSessionState()

        #expect(SharedConfig.loadKeyboardSession() == nil)
        #expect((defaults?.bool(forKey: SharedConfig.dictationInProgressKey) ?? false) == false)
        #expect((defaults?.bool(forKey: SharedConfig.hostSessionActiveKey) ?? false) == false)
        #expect(defaults?.object(forKey: SharedConfig.hostSessionHeartbeatAtKey) == nil)
    }

    @Test func hostReadySessionRemainsReusableWithoutIdleTimeout() throws
    {
        let suiteName = SharedConfig.appGroupIdentifier
        let defaults = UserDefaults(suiteName: suiteName)
        defaults?.removePersistentDomain(forName: suiteName)
        defer { defaults?.removePersistentDomain(forName: suiteName) }

        let startedAt = Date(timeIntervalSince1970: 5_000)
        let session = SharedConfig.beginKeyboardLaunchSession(now: startedAt)
        _ = SharedConfig.updateKeyboardSession(
            sessionID: session.sessionID,
            phase: .hostReady,
            now: startedAt.addingTimeInterval(1)
        )

        let stillReady = try #require(SharedConfig.currentKeyboardSessionIfFresh(now: startedAt.addingTimeInterval(3_600)))
        #expect(stillReady.phase == .hostReady)
        #expect(SharedConfig.isHostSessionActive())
    }

    @Test func recordingSessionDoesNotExpireForLongMonologues() throws
    {
        let suiteName = SharedConfig.appGroupIdentifier
        let defaults = UserDefaults(suiteName: suiteName)
        defaults?.removePersistentDomain(forName: suiteName)
        defer { defaults?.removePersistentDomain(forName: suiteName) }

        let startedAt = Date(timeIntervalSince1970: 6_000)
        let session = SharedConfig.beginKeyboardLaunchSession(now: startedAt)
        _ = SharedConfig.updateKeyboardSession(
            sessionID: session.sessionID,
            phase: .recording,
            now: startedAt.addingTimeInterval(1)
        )

        let reconciled = try #require(SharedConfig.currentKeyboardSessionIfFresh(now: startedAt.addingTimeInterval(86_400)))
        #expect(reconciled.phase == .recording)
        #expect(reconciled.errorMessage == nil)
    }

    @Test func cancelledTakeCanReturnSessionToReusableHostReady() throws
    {
        let suiteName = SharedConfig.appGroupIdentifier
        let defaults = UserDefaults(suiteName: suiteName)
        defaults?.removePersistentDomain(forName: suiteName)
        defer { defaults?.removePersistentDomain(forName: suiteName) }

        let startedAt = Date(timeIntervalSince1970: 7_000)
        let session = SharedConfig.beginKeyboardLaunchSession(now: startedAt)
        _ = SharedConfig.updateKeyboardSession(
            sessionID: session.sessionID,
            phase: .recording,
            now: startedAt.addingTimeInterval(1)
        )

        let readyAgain = try #require(SharedConfig.updateKeyboardSession(
            sessionID: session.sessionID,
            phase: .hostReady,
            now: startedAt.addingTimeInterval(2)
        ))

        #expect(readyAgain.phase == .hostReady)
        #expect(SharedConfig.isHostSessionActive())
        #expect(!(defaults?.bool(forKey: SharedConfig.dictationInProgressKey) ?? true))
    }

    @Test func processingTimeoutUsesMaxOfThreeMinutesAndClipLength() throws
    {
        let suiteName = SharedConfig.appGroupIdentifier
        let defaults = UserDefaults(suiteName: suiteName)
        defaults?.removePersistentDomain(forName: suiteName)
        defer { defaults?.removePersistentDomain(forName: suiteName) }

        let startedAt = Date(timeIntervalSince1970: 7_500)
        let session = SharedConfig.beginKeyboardLaunchSession(now: startedAt)
        let recordingStart = startedAt.addingTimeInterval(1)
        let processingStart = recordingStart.addingTimeInterval(240)
        _ = SharedConfig.updateKeyboardSession(
            sessionID: session.sessionID,
            phase: .recording,
            now: recordingStart
        )
        let processing = try #require(SharedConfig.updateKeyboardSession(
            sessionID: session.sessionID,
            phase: .processing,
            now: processingStart
        ))

        #expect(processing.lastTakeDuration == 240)

        let beforeTimeout = try #require(SharedConfig.currentKeyboardSessionIfFresh(now: processingStart.addingTimeInterval(239)))
        #expect(beforeTimeout.phase == .processing)

        let afterTimeout = try #require(SharedConfig.currentKeyboardSessionIfFresh(now: processingStart.addingTimeInterval(241)))
        #expect(afterTimeout.phase == .failed)
        #expect(afterTimeout.errorMessage == "Dictation did not finish processing. Open Dictator to continue.")
    }

    @Test func shortProcessingStillGetsMinimumThreeMinuteTimeout() throws
    {
        let suiteName = SharedConfig.appGroupIdentifier
        let defaults = UserDefaults(suiteName: suiteName)
        defaults?.removePersistentDomain(forName: suiteName)
        defer { defaults?.removePersistentDomain(forName: suiteName) }

        let startedAt = Date(timeIntervalSince1970: 7_700)
        let session = SharedConfig.beginKeyboardLaunchSession(now: startedAt)
        let recordingStart = startedAt.addingTimeInterval(1)
        let processingStart = recordingStart.addingTimeInterval(30)
        _ = SharedConfig.updateKeyboardSession(
            sessionID: session.sessionID,
            phase: .recording,
            now: recordingStart
        )
        _ = SharedConfig.updateKeyboardSession(
            sessionID: session.sessionID,
            phase: .processing,
            now: processingStart
        )

        let beforeTimeout = try #require(SharedConfig.currentKeyboardSessionIfFresh(now: processingStart.addingTimeInterval(179)))
        #expect(beforeTimeout.phase == .processing)

        let afterTimeout = try #require(SharedConfig.currentKeyboardSessionIfFresh(now: processingStart.addingTimeInterval(181)))
        #expect(afterTimeout.phase == .failed)
    }

    @Test func fullSessionCancelMarksSessionCancelledAndInactive() throws
    {
        let suiteName = SharedConfig.appGroupIdentifier
        let defaults = UserDefaults(suiteName: suiteName)
        defaults?.removePersistentDomain(forName: suiteName)
        defer { defaults?.removePersistentDomain(forName: suiteName) }

        let startedAt = Date(timeIntervalSince1970: 8_000)
        let session = SharedConfig.beginKeyboardLaunchSession(now: startedAt)
        _ = SharedConfig.updateKeyboardSession(
            sessionID: session.sessionID,
            phase: .recording,
            now: startedAt.addingTimeInterval(1)
        )

        let cancelled = try #require(SharedConfig.updateKeyboardSession(
            sessionID: session.sessionID,
            phase: .cancelled,
            errorMessage: "Dictation cancelled in Dictator.",
            now: startedAt.addingTimeInterval(2)
        ))

        #expect(cancelled.phase == .cancelled)
        #expect(!SharedConfig.isHostSessionActive())
        #expect(cancelled.errorMessage == "Dictation cancelled in Dictator.")
    }

    @Test func transcriptInsertionTrackingStillWorksAfterCancelledTake()
    {
        let suiteName = SharedConfig.appGroupIdentifier
        let defaults = UserDefaults(suiteName: suiteName)
        defaults?.removePersistentDomain(forName: suiteName)
        defer { defaults?.removePersistentDomain(forName: suiteName) }

        let sessionID = "session-after-cancel"
        let cancelledTakeAt = Date(timeIntervalSince1970: 9_000)
        let completedTakeAt = cancelledTakeAt.addingTimeInterval(5)

        SharedConfig.markTranscriptInserted(sessionID: sessionID, updatedAt: cancelledTakeAt)
        #expect(SharedConfig.hasInsertedTranscript(sessionID: sessionID, updatedAt: cancelledTakeAt))
        #expect(!SharedConfig.hasInsertedTranscript(sessionID: sessionID, updatedAt: completedTakeAt))

        SharedConfig.markTranscriptInserted(sessionID: sessionID, updatedAt: completedTakeAt)
        #expect(SharedConfig.hasInsertedTranscript(sessionID: sessionID, updatedAt: completedTakeAt))
    }
}
