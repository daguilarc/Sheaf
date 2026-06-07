import AVFoundation
import SwiftUI
import UIKit

struct HostAppRootView: View {
    private struct TracedRequestError: Error {
        let base: Error
        let traces: [String]
    }

    private struct UploadResult
    {
        let response: DictateAudioResponse
        let traces: [String]
    }

    private enum DictationState {
        case idle
        case recording
        case waitingForServer
        case error(String)
    }

    @State private var state: DictationState = .idle
    @State private var latestTranscript: String?
    @State private var latestTranscriptUpdatedAt: Date?
    @State private var diagnostics: [String] = []
    @State private var serverURLDraft: String = ""
    @State private var isRunningProbe = false
    @State private var keyboardSessionActive = false
    @State private var keyboardRecording = false
    @State private var activeKeyboardSessionID: String?
    @Environment(\.scenePhase) private var scenePhase

    private let recorder = AudioSnippetRecorder()
    private let sessionID = UUID().uuidString

    private var configuredServerURL: String {
        SharedConfig.resolvedServerURLString(bundle: .main)
    }

    var body: some View {
        NavigationStack {
            Form {
                if keyboardSessionActive {
                    Section {
                        VStack(spacing: 8) {
                            Text(keyboardRecording ? "Recording for keyboard..." : "Keyboard session active")
                                .font(.headline)
                            Text(keyboardRecording
                                 ? "Return to your app. Tap Stop in the keyboard when done."
                                 : "Dictator is ready for the next recording.")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                            Button("End Session") {
                                cancelKeyboardSession(message: "Dictation cancelled in Dictator.")
                            }
                            .foregroundStyle(.red)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                    }
                }

                Section("Dictation") {
                    Text(statusText)
                        .font(.footnote)
                        .foregroundStyle(stateIsError ? Color.red : Color.secondary)

                    Button(buttonTitle, action: handleDictationTap)
                        .buttonStyle(.borderedProminent)
                        .disabled(isWaitingForServer)

                    if let latestTranscript {
                        Text("Latest transcript:")
                            .font(.subheadline)
                            .fontWeight(.semibold)
                        Text(latestTranscript)
                            .font(.body)

                        if let latestTranscriptUpdatedAt {
                            Text("Saved: \(latestTranscriptUpdatedAt.formatted(date: .abbreviated, time: .standard))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    } else {
                        Text("No transcript has been saved yet.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("Keyboard Setup") {
                    Text("1. Enable Dictator keyboard in Settings > General > Keyboard.")
                    Text("2. Switch to the Dictator keyboard in any text field.")
                    Text("3. Tap Dictate in the keyboard to open Dictator and begin a keyboard session.")
                    Text("4. Return to your app, tap Record to start a take, then tap Stop when you are done speaking.")
                    Text("5. Tap End Session in Dictator when you are completely finished.")
                }

                Section("Status") {
                    Text("Server URL: \(configuredServerURL)")
                    TextField("http://host:9003", text: $serverURLDraft)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button("Save Server URL") {
                        SharedConfig.saveServerURLString(serverURLDraft)
                        addTrace("Server URL override saved: \(SharedConfig.resolvedServerURLString(bundle: .main))")
                    }
                    Text("Transcripts are saved to the app group for the keyboard extension.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    if let session = SharedConfig.loadKeyboardSession() {
                        Text("Session: \(session.sessionID) [\(session.phase.rawValue)]")
                            .font(.caption)
                            .textSelection(.enabled)
                        if let message = session.errorMessage, !message.isEmpty {
                            Text("Session error: \(message)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                        }
                    } else {
                        Text("Session: none")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("Diagnostics") {
                    Button("Refresh Trace") {
                        refreshDiagnosticsFromDisk()
                    }

                    Button("Run Connectivity Probe") {
                        Task {
                            await runConnectivityProbe()
                        }
                    }
                    .disabled(isRunningProbe)

                    Button("Copy Trace") {
                        copyTraceToClipboard()
                    }

                    Button("Clear Trace") {
                        diagnostics.removeAll()
                        SharedConfig.clearDiagnosticsLog()
                    }

                    if let logURL = SharedConfig.diagnosticsLogURL() {
                        Text("Log file: \(logURL.path)")
                            .font(.caption2)
                            .textSelection(.enabled)
                    }

                    if diagnostics.isEmpty {
                        Text("No trace events yet.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(Array(diagnostics.suffix(20).enumerated()), id: \.offset) { _, line in
                            Text(line)
                                .font(.caption2)
                                .textSelection(.enabled)
                        }
                    }
                }
            }
            .navigationTitle("Dictator Keyboard")
        }
        .task {
            refreshLatestTranscript()
            serverURLDraft = configuredServerURL
            refreshDiagnosticsFromDisk()
            reconcilePersistedKeyboardSession(reason: "initial task")
        }
        .onOpenURL { url in
            refreshDiagnosticsFromDisk()
            addTrace("App opened via URL: \(url.absoluteString)")
            if url.host == "dictation" {
                startKeyboardDictation()
            }
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                refreshDiagnosticsFromDisk()
                reconcilePersistedKeyboardSession(reason: "scene active")
            } else if newPhase == .background, keyboardSessionActive,
                      let sessionID = activeKeyboardSessionID,
                      let session = SharedConfig.loadKeyboardSession(),
                      session.sessionID == sessionID,
                      session.phase == .hostReady || session.phase == .recording {
                _ = SharedConfig.updateKeyboardSession(
                    sessionID: sessionID,
                    phase: keyboardRecording ? .recording : .hostReady
                )
            } else if newPhase == .background,
                      let session = SharedConfig.loadKeyboardSession(),
                      session.sessionID == activeKeyboardSessionID,
                      session.phase == .launchingHost {
                _ = SharedConfig.markKeyboardSessionFailed(
                    sessionID: session.sessionID,
                    message: "Dictator was backgrounded before recording began."
                )
            }
        }
    }

    private var stateIsError: Bool {
        if case .error = state {
            return true
        }
        return false
    }

    private var isWaitingForServer: Bool {
        if case .waitingForServer = state {
            return true
        }
        return false
    }

    private var buttonTitle: String {
        switch state {
        case .idle, .error:
            return "Start Recording"
        case .recording:
            return "Stop Recording"
        case .waitingForServer:
            return "Processing..."
        }
    }

    private var statusText: String {
        switch state {
        case .idle:
            return "Ready"
        case .recording:
            return "Recording..."
        case .waitingForServer:
            return "Waiting for Dictator server..."
        case let .error(message):
            return message
        }
    }

    private func handleDictationTap() {
        switch state {
        case .idle, .error:
            startRecording()
        case .recording:
            Task {
                await finishRecordingAndSend()
            }
        case .waitingForServer:
            return
        }
    }

    private func refreshLatestTranscript() {
        latestTranscript = SharedConfig.loadLatestTranscript()
        latestTranscriptUpdatedAt = SharedConfig.loadLatestTranscriptUpdatedAt()
    }

    private func startRecording() {
        do {
            try recorder.activateSession()
            try recorder.startContinuousCapture()
            try recorder.beginTake(sessionID: sessionID)
            addTrace("Mic recording started.")
            state = .recording
        } catch {
            state = .error(microphoneErrorMessage(error))
            addTrace("Mic start error: \(error.localizedDescription)")
        }
    }

    @MainActor
    private func finishRecordingAndSend() async {
        state = .waitingForServer
        addTrace("Stop requested. Finalizing audio buffer...")
        let wavData: Data
        do {
            wavData = try recorder.finishTake()
            recorder.stopContinuousCapture()
            recorder.deactivateSession()
            addTrace("Audio captured: \(wavData.count) bytes WAV.")
        } catch {
            recorder.discardTake()
            recorder.stopContinuousCapture()
            recorder.deactivateSession()
            state = .error("Mic stop failed: \(error.localizedDescription)")
            addTrace("Mic stop error: \(error.localizedDescription)")
            return
        }

        let baseURL = loadBaseURL()
        addTrace("Resolved server URL: \(baseURL.absoluteString)")

        do {
            let result = try await uploadSnippet(wavData: wavData, baseURL: baseURL)
            result.traces.forEach(addTrace)
            let revisedText = result.response.revised_text.trimmingCharacters(in: .whitespacesAndNewlines)
            if revisedText.isEmpty {
                state = .error("Server returned empty revised text.")
                addTrace("Server returned empty revised_text.")
                return
            }

            SharedConfig.saveLatestTranscript(revisedText)
            refreshLatestTranscript()
            addTrace("Transcript saved to app group (\(revisedText.count) chars).")
            state = .idle
        } catch {
            if let traced = error as? TracedRequestError {
                traced.traces.forEach(addTrace)
                state = .error(requestErrorMessage(traced.base))
            } else {
                addTrace("Request failed without trace wrapper: \(error.localizedDescription)")
                state = .error(requestErrorMessage(error))
            }
        }
    }

    // MARK: - Keyboard-triggered dictation flow

    private func startKeyboardDictation() {
        let now = Date()
        let launchSession = SharedConfig.currentKeyboardSessionIfFresh(now: now)
        let sessionID: String

        if let launchSession,
           launchSession.phase == .launchingHost {
            sessionID = launchSession.sessionID
            addTrace("[KeyboardFlow][\(sessionID)][\(launchSession.phase.rawValue)] Resuming launch-requested session.")
        } else if let current = SharedConfig.loadKeyboardSession(),
                  current.phase == .recording || current.phase == .hostReady || current.phase == .stopping || current.phase == .processing {
            sessionID = current.sessionID
            addTrace("[KeyboardFlow][\(sessionID)][\(current.phase.rawValue)] Deep link received for existing live session.")
        } else {
            let session = SharedConfig.beginKeyboardLaunchSession(now: now)
            sessionID = session.sessionID
            addTrace("[KeyboardFlow][\(sessionID)][launching_host] Deep link created fallback launch session.")
        }

        let previousSessionID = activeKeyboardSessionID

        if keyboardSessionActive, keyboardRecording, previousSessionID == sessionID {
            addTrace("[KeyboardFlow][\(sessionID)][recording] Repeat deep link while recording. Ignoring.")
            return
        }

        if keyboardSessionActive, !keyboardRecording, previousSessionID == sessionID {
            addTrace("[KeyboardFlow][\(sessionID)][host_ready] Repeat deep link. Resuming and auto-starting recording.")
            beginKeyboardRecording(sessionID: sessionID)
            return
        }

        if keyboardSessionActive, !keyboardRecording, previousSessionID != sessionID {
            cancelKeyboardSession(message: "Previous Dictator session replaced by a new dictation request.")
        }

        activeKeyboardSessionID = sessionID

        DarwinNotificationCenter.shared.removeObserver(SharedConfig.darwinDictationStart)
        DarwinNotificationCenter.shared.removeObserver(SharedConfig.darwinDictationStop)
        DarwinNotificationCenter.shared.removeObserver(SharedConfig.darwinDictationCancelTake)
        addTrace("[KeyboardFlow][\(sessionID)][launching_host] Starting keyboard session.")
        do {
            try recorder.activateSession()
            try recorder.startContinuousCapture()
            keyboardSessionActive = true
            keyboardRecording = false
            addTrace("[KeyboardFlow][\(sessionID)][launching_host] Continuous capture started and audio session activated.")
        } catch {
            addTrace("[KeyboardFlow][\(sessionID)][failed] Failed to activate session: \(error.localizedDescription)")
            _ = SharedConfig.markKeyboardSessionFailed(sessionID: sessionID, message: "Dictator could not activate the microphone session.")
            recorder.stopContinuousCapture()
            recorder.deactivateSession()
            keyboardSessionActive = false
            keyboardRecording = false
            activeKeyboardSessionID = nil
            return
        }

        DarwinNotificationCenter.shared.observe(SharedConfig.darwinDictationStart) { [self] in
            DispatchQueue.main.async { self.handleKeyboardDictationStart() }
        }
        DarwinNotificationCenter.shared.observe(SharedConfig.darwinDictationStop) { [self] in
            DispatchQueue.main.async { self.handleKeyboardDictationStop() }
        }
        DarwinNotificationCenter.shared.observe(SharedConfig.darwinDictationCancelTake) { [self] in
            DispatchQueue.main.async { self.handleKeyboardDictationCancelTake() }
        }

        beginKeyboardRecording(sessionID: sessionID)
    }

    private func beginKeyboardRecording(sessionID: String) {
        guard keyboardSessionActive else {
            addTrace("[KeyboardFlow][\(sessionID)][failed] Ignoring start because no host session is active.")
            return
        }

        if keyboardRecording {
            addTrace("[KeyboardFlow][\(sessionID)][recording] Duplicate start ignored while already recording.")
            return
        }

        do {
            try recorder.beginTake(sessionID: sessionID)
            keyboardRecording = true
            _ = SharedConfig.updateKeyboardSession(sessionID: sessionID, phase: .recording)
            addTrace("[KeyboardFlow][\(sessionID)][recording] Take armed; audio is now being buffered.")
        } catch {
            addTrace("[KeyboardFlow][\(sessionID)][failed] Failed to start recording: \(error.localizedDescription)")
            _ = SharedConfig.markKeyboardSessionFailed(sessionID: sessionID, message: "Dictator could not start recording.")
            endKeyboardSession(reason: "recording start failed")
        }
    }

    private func handleKeyboardDictationStart() {
        guard let session = SharedConfig.currentKeyboardSessionIfFresh(),
              let sessionID = activeKeyboardSessionID ?? SharedConfig.loadKeyboardSession()?.sessionID,
              session.sessionID == sessionID,
              keyboardSessionActive else {
            addTrace("[KeyboardFlow] Darwin start received but there is no matching live host session.")
            return
        }

        switch session.phase {
        case .hostReady:
            addTrace("[KeyboardFlow][\(sessionID)][host_ready] Start received for another recording.")
            beginKeyboardRecording(sessionID: sessionID)
        case .recording:
            addTrace("[KeyboardFlow][\(sessionID)][recording] Duplicate start ignored while recording.")
        case .stopping, .processing:
            addTrace("[KeyboardFlow][\(sessionID)][\(session.phase.rawValue)] Start ignored until current dictation finishes.")
        case .completed:
            addTrace("[KeyboardFlow][\(sessionID)][completed] Start ignored because completed is legacy-only.")
        case .idle, .launchingHost, .failed, .cancelled:
            addTrace("[KeyboardFlow][\(sessionID)][\(session.phase.rawValue)] Start ignored because Dictator is not ready.")
        }
    }

    private func handleKeyboardDictationStop() {
        guard let session = SharedConfig.currentKeyboardSessionIfFresh(),
              let sessionID = activeKeyboardSessionID ?? SharedConfig.loadKeyboardSession()?.sessionID,
              session.sessionID == sessionID,
              keyboardRecording,
              session.phase == .stopping || session.phase == .recording || session.phase == .hostReady else {
            addTrace("[KeyboardFlow] Darwin stop received but there is no matching live recording session.")
            return
        }

        addTrace("[KeyboardFlow][\(sessionID)][stopping] Stop received. Finalizing audio...")
        keyboardRecording = false
        _ = SharedConfig.updateKeyboardSession(sessionID: sessionID, phase: .stopping)
        let wavData: Data
        do {
            wavData = try recorder.finishTake()
            addTrace("[KeyboardFlow][\(sessionID)][stopping] Take finalized: \(wavData.count) bytes WAV.")
        } catch {
            addTrace("[KeyboardFlow][\(sessionID)][failed] Mic stop error: \(error.localizedDescription)")
            _ = SharedConfig.markKeyboardSessionFailed(sessionID: sessionID, message: "Dictator could not finalize the recording.")
            endKeyboardSession(reason: "mic stop failed")
            return
        }

        Task { @MainActor in
            let baseURL = loadBaseURL()
            _ = SharedConfig.updateKeyboardSession(sessionID: sessionID, phase: .processing)
            addTrace("[KeyboardFlow][\(sessionID)][processing] Uploading to \(baseURL.absoluteString)...")
            do {
                let result = try await uploadSnippet(wavData: wavData, baseURL: baseURL)
                result.traces.forEach(addTrace)
                let revisedText = result.response.revised_text.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !revisedText.isEmpty else {
                    addTrace("[KeyboardFlow][\(sessionID)][failed] Server returned empty revised_text.")
                    _ = SharedConfig.markKeyboardSessionFailed(sessionID: sessionID, message: "Dictator returned empty text.")
                    self.endKeyboardSession(reason: "server returned empty revised text", preserveSessionID: sessionID)
                    return
                }
                let transcriptUpdatedAt = Date()
                SharedConfig.saveLatestTranscript(revisedText, now: transcriptUpdatedAt)
                refreshLatestTranscript()
                _ = SharedConfig.updateKeyboardSession(
                    sessionID: sessionID,
                    phase: .hostReady,
                    latestTranscriptUpdatedAt: transcriptUpdatedAt,
                    now: transcriptUpdatedAt
                )
                addTrace("[KeyboardFlow][\(sessionID)][host_ready] Transcript saved (\(revisedText.count) chars).")
                self.keyboardSessionActive = true
                self.keyboardRecording = false
                self.activeKeyboardSessionID = sessionID
                addTrace("[KeyboardFlow][\(sessionID)][host_ready] Host session preserved; continuous capture is ready for another recording.")
            } catch {
                if let traced = error as? TracedRequestError {
                    traced.traces.forEach(addTrace)
                }
                addTrace("[KeyboardFlow][\(sessionID)][failed] Upload failed: \(error.localizedDescription)")
                _ = SharedConfig.markKeyboardSessionFailed(sessionID: sessionID, message: self.requestErrorMessage(error))
                self.endKeyboardSession(reason: "upload failed", preserveSessionID: sessionID)
            }
        }
    }

    private func handleKeyboardDictationCancelTake() {
        guard let session = SharedConfig.currentKeyboardSessionIfFresh(),
              let sessionID = activeKeyboardSessionID ?? SharedConfig.loadKeyboardSession()?.sessionID,
              session.sessionID == sessionID,
              keyboardSessionActive,
              keyboardRecording,
              session.phase == .recording else {
            addTrace("[KeyboardFlow] Cancel-take received but there is no matching live recording session.")
            return
        }

        recorder.discardTake()
        keyboardRecording = false
        _ = SharedConfig.updateKeyboardSession(sessionID: sessionID, phase: .hostReady)
        addTrace("[KeyboardFlow][\(sessionID)][host_ready] Current take discarded; session remains active for the next recording.")
    }

    private func endKeyboardSession(reason: String, preserveSessionID: String? = nil) {
        let sessionID = preserveSessionID ?? activeKeyboardSessionID
        if let sessionID {
            addTrace("[KeyboardFlow][\(sessionID)] Ending keyboard session: \(reason).")
        } else {
            addTrace("[KeyboardFlow] Ending keyboard session: \(reason).")
        }
        if keyboardRecording {
            recorder.discardTake()
            keyboardRecording = false
        }
        recorder.stopContinuousCapture()
        recorder.deactivateSession()
        DarwinNotificationCenter.shared.removeObserver(SharedConfig.darwinDictationStart)
        DarwinNotificationCenter.shared.removeObserver(SharedConfig.darwinDictationStop)
        DarwinNotificationCenter.shared.removeObserver(SharedConfig.darwinDictationCancelTake)
        keyboardSessionActive = false
        activeKeyboardSessionID = preserveSessionID
    }

    private func cancelKeyboardSession(message: String) {
        guard let session = SharedConfig.loadKeyboardSession(),
              session.sessionID == activeKeyboardSessionID else {
            endKeyboardSession(reason: "cancel requested with no active session")
            SharedConfig.resetKeyboardSessionState()
            return
        }

        addTrace("[KeyboardFlow][\(session.sessionID)][cancelled] \(message)")
        _ = SharedConfig.updateKeyboardSession(
            sessionID: session.sessionID,
            phase: .cancelled,
            errorMessage: message
        )
        endKeyboardSession(reason: "cancelled by user", preserveSessionID: session.sessionID)
    }

    private func reconcilePersistedKeyboardSession(reason: String) {
        guard let session = SharedConfig.currentKeyboardSessionIfFresh() else {
            keyboardSessionActive = false
            keyboardRecording = false
            activeKeyboardSessionID = nil
            return
        }

        activeKeyboardSessionID = session.sessionID
        switch session.phase {
        case .launchingHost:
            keyboardSessionActive = false
            keyboardRecording = false
        case .hostReady:
            if keyboardSessionActive {
                keyboardSessionActive = true
                keyboardRecording = false
            } else {
                _ = SharedConfig.markKeyboardSessionFailed(
                    sessionID: session.sessionID,
                    message: "Dictator session ended. Tap to restart."
                )
                addTrace("[KeyboardFlow][\(session.sessionID)][failed] Reconciled orphaned ready session during \(reason).")
                keyboardSessionActive = false
                keyboardRecording = false
            }
        case .recording:
            if activeKeyboardSessionID == session.sessionID, keyboardSessionActive || keyboardRecording {
                keyboardSessionActive = true
                keyboardRecording = true
                addTrace("[KeyboardFlow][\(session.sessionID)][recording] Preserved active recording session during \(reason).")
            } else {
                keyboardSessionActive = false
                keyboardRecording = false
                _ = SharedConfig.markKeyboardSessionFailed(
                    sessionID: session.sessionID,
                    message: "Dictator was relaunched. Open the app to continue or start again."
                )
                addTrace("[KeyboardFlow][\(session.sessionID)][failed] Reconciled orphaned recording session during \(reason).")
                keyboardSessionActive = false
                activeKeyboardSessionID = session.sessionID
            }
        case .stopping, .processing:
            keyboardSessionActive = true
            keyboardRecording = false
        case .completed:
            _ = SharedConfig.markKeyboardSessionFailed(
                sessionID: session.sessionID,
                message: "Dictator session ended. Tap to restart."
            )
            addTrace("[KeyboardFlow][\(session.sessionID)][failed] Reconciled legacy completed session during \(reason).")
            keyboardSessionActive = false
            keyboardRecording = false
        case .failed, .cancelled, .idle:
            keyboardSessionActive = false
            keyboardRecording = false
        }
    }

    // MARK: - Upload

    private func uploadSnippet(wavData: Data, baseURL: URL) async throws -> UploadResult
    {
        var traces: [String] = []
        let requestID = String(UUID().uuidString.prefix(8))
        guard var request = SharedConfig.makeDictateAudioRequest(
            wavData: wavData,
            serverURLString: baseURL.absoluteString,
            sessionID: sessionID,
            requestID: requestID
        )
        else
        {
            let err = NSError(domain: "DictatorKeyboard", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid server URL"])
            throw TracedRequestError(base: err, traces: traces)
        }

        traces.append("[\(requestID)] POST \(request.url?.absoluteString ?? baseURL.absoluteString)")
        traces.append("[\(requestID)] timeout=\(Int(request.timeoutInterval))s payload=\(wavData.count) bytes")

        var data: Data?
        var response: URLResponse?
        var lastError: Error?
        for attempt in 1 ... 2 {
            let delegate = UploadTaskDelegate()
            let session = URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: nil)
            let startedAt = Date()
            do {
                let result = try await session.data(for: request)
                data = result.0
                response = result.1
                let elapsed = Date().timeIntervalSince(startedAt)
                traces.append("[\(requestID)] attempt \(attempt) completed in \(String(format: "%.3f", elapsed))s, responseBytes=\(result.0.count)")
                if let metricsSummary = delegate.metricsSummary {
                    traces.append("[\(requestID)] attempt \(attempt) metrics: \(metricsSummary)")
                }
                lastError = nil
                break
            } catch {
                lastError = error
                traces.append("[\(requestID)] attempt \(attempt) URLSession error: \(traceString(for: error))")
                if let metricsSummary = delegate.metricsSummary {
                    traces.append("[\(requestID)] attempt \(attempt) metrics: \(metricsSummary)")
                }
                guard attempt == 1, shouldRetry(error: error) else {
                    throw TracedRequestError(base: error, traces: traces)
                }
                traces.append("[\(requestID)] retrying once after transient network error...")
            }
        }
        guard let data, let response else {
            throw TracedRequestError(base: lastError ?? URLError(.unknown), traces: traces)
        }

        guard let http = response as? HTTPURLResponse else {
            let err = NSError(domain: "DictatorKeyboard", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid HTTP response"])
            traces.append("[\(requestID)] invalid response object: \(type(of: response))")
            throw TracedRequestError(base: err, traces: traces)
        }
        traces.append("[\(requestID)] status=\(http.statusCode)")
        guard (200 ... 299).contains(http.statusCode) else {
            let text = String(data: data, encoding: .utf8) ?? "HTTP \(http.statusCode)"
            traces.append("[\(requestID)] non-2xx body: \(text.prefix(200))")
            let err = NSError(domain: "DictatorKeyboard", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: text])
            throw TracedRequestError(base: err, traces: traces)
        }
        do
        {
            let decoded = try SharedConfig.decodeDictateAudioResponse(from: data)
            return UploadResult(response: decoded, traces: traces)
        }
        catch
        {
            traces.append("[\(requestID)] decode error: \(error.localizedDescription)")
            throw TracedRequestError(base: error, traces: traces)
        }
    }

    private func loadBaseURL() -> URL {
        let resolved = SharedConfig.resolvedServerURLString(bundle: .main)
        return URL(string: resolved) ?? URL(string: SharedConfig.fallbackServerURL)!
    }

    private func microphoneErrorMessage(_ error: Error) -> String {
        let nsError = error as NSError
        return "Mic start failed: \(nsError.localizedDescription)"
    }

    private func requestErrorMessage(_ error: Error) -> String {
        guard let urlError = error as? URLError else {
            return "Request failed: \(error.localizedDescription)"
        }

        switch urlError.code {
        case .notConnectedToInternet:
            return "Cannot reach Dictator server. iOS reports Local Network access is blocked or offline. Enable Local Network for this app in Settings, then retry."
        case .cannotConnectToHost:
            return "Cannot connect to Dictator server at \(configuredServerURL). Check host/port and confirm the server is listening on your LAN interface."
        case .timedOut:
            return "Dictator server request timed out. Confirm the server is running and reachable at \(configuredServerURL)."
        default:
            return "Request failed: \(urlError.localizedDescription)"
        }
    }

    @MainActor
    private func runConnectivityProbe() async {
        guard !isRunningProbe else {
            addTrace("Connectivity probe skipped: already running.")
            return
        }
        isRunningProbe = true
        defer { isRunningProbe = false }

        addTrace("Connectivity probe started for \(configuredServerURL)")
        guard let baseURL = URL(string: configuredServerURL) else {
            addTrace("Connectivity probe failed: invalid URL.")
            return
        }

        let probePaths = ["health"]
        for path in probePaths {
            var url = baseURL
            if !path.isEmpty {
                url.appendPathComponent(path)
            }

            var request = URLRequest(url: url)
            request.httpMethod = "GET"
            request.timeoutInterval = 8
            do {
                let (_, response) = try await URLSession.shared.data(for: request)
                if let http = response as? HTTPURLResponse {
                    addTrace("Probe \(url.absoluteString) -> HTTP \(http.statusCode)")
                } else {
                    addTrace("Probe \(url.absoluteString) -> non-HTTP response")
                }
            } catch {
                addTrace("Probe \(url.absoluteString) failed: \(traceString(for: error))")
            }
        }
    }

    @MainActor
    private func addTrace(_ line: String) {
        let full = SharedConfig.appendDiagnosticsEvent(
            line,
            source: "host-app",
            sessionID: sessionID,
            requestID: requestID(from: line)
        )
        diagnostics.append(full)
    }

    private func refreshDiagnosticsFromDisk() {
        guard let persisted = SharedConfig.readDiagnosticsLog() else {
            return
        }
        let lines = persisted
            .split(separator: "\n", omittingEmptySubsequences: true)
            .map(String.init)
        diagnostics = Array(lines.suffix(100))
    }

    private func traceString(for error: Error) -> String {
        let nsError = error as NSError
        var parts = ["\(nsError.domain) \(nsError.code): \(nsError.localizedDescription)"]
        if let underlying = nsError.userInfo[NSUnderlyingErrorKey] as? NSError {
            parts.append("underlying=\(underlying.domain) \(underlying.code): \(underlying.localizedDescription)")
        }
        if let failingURL = nsError.userInfo[NSURLErrorFailingURLErrorKey] as? URL {
            parts.append("url=\(failingURL.absoluteString)")
        }
        if let nwPath = nsError.userInfo["_NSURLErrorNWPathKey"] {
            parts.append("nwPath=\(nwPath)")
        }
        return parts.joined(separator: " | ")
    }

    private func shouldRetry(error: Error) -> Bool {
        guard let urlError = error as? URLError else {
            return false
        }
        switch urlError.code {
        case .timedOut, .networkConnectionLost, .cannotConnectToHost:
            return true
        default:
            return false
        }
    }

    private func copyTraceToClipboard() {
        if let persisted = SharedConfig.readDiagnosticsLog(), !persisted.isEmpty {
            UIPasteboard.general.string = persisted
            addTrace("Copied persisted diagnostics log to clipboard.")
            return
        }

        let fallback = diagnostics.joined(separator: "\n")
        UIPasteboard.general.string = fallback
        addTrace("Copied in-memory diagnostics trace to clipboard.")
    }

    private func requestID(from line: String) -> String? {
        guard line.hasPrefix("["),
              let closingBracket = line.firstIndex(of: "]"),
              closingBracket != line.startIndex else {
            return nil
        }

        let start = line.index(after: line.startIndex)
        let candidate = String(line[start ..< closingBracket])
        guard candidate.count == 8,
              candidate.unicodeScalars.allSatisfy({ scalar in
                  CharacterSet(charactersIn: "0123456789ABCDEFabcdef").contains(scalar)
              }) else {
            return nil
        }
        return candidate
    }
}

private final class UploadTaskDelegate: NSObject, URLSessionTaskDelegate {
    private(set) var metricsSummary: String?

    func urlSession(_ session: URLSession, task: URLSessionTask, didFinishCollecting metrics: URLSessionTaskMetrics) {
        guard let metric = metrics.transactionMetrics.last else {
            return
        }

        func ms(_ start: Date?, _ end: Date?) -> String {
            guard let start, let end else {
                return "n/a"
            }
            return String(format: "%.1fms", end.timeIntervalSince(start) * 1000)
        }

        metricsSummary = [
            "fetch=\(metric.resourceFetchType.rawValue)",
            "reused=\(metric.isReusedConnection)",
            "protocol=\(metric.networkProtocolName ?? "n/a")",
            "dns=\(ms(metric.domainLookupStartDate, metric.domainLookupEndDate))",
            "connect=\(ms(metric.connectStartDate, metric.connectEndDate))",
            "tls=\(ms(metric.secureConnectionStartDate, metric.secureConnectionEndDate))",
            "request=\(ms(metric.requestStartDate, metric.requestEndDate))",
            "response=\(ms(metric.responseStartDate, metric.responseEndDate))"
        ].joined(separator: ", ")
    }
}

private final class AudioSnippetRecorder {
    private struct ActiveTake {
        let sessionID: String
        let startedAt: Date
    }

    private let engine = AVAudioEngine()
    private let targetSampleRate: Double = 16_000
    private let lock = NSLock()
    private var pcmData = Data()
    private var activeTake: ActiveTake?
    private var captureRunning = false

    func activateSession() throws {
        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(.playAndRecord, mode: .default, options: [.mixWithOthers, .allowBluetooth])
        try audioSession.setActive(true, options: [])
    }

    func deactivateSession() {
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    func startContinuousCapture() throws {
        guard !captureRunning else {
            return
        }

        let inputNode = engine.inputNode
        let sourceFormat = inputNode.outputFormat(forBus: 0)
        guard let destinationFormat = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: targetSampleRate,
            channels: 1,
            interleaved: true
        ) else {
            throw NSError(domain: "DictatorKeyboard", code: 100, userInfo: [NSLocalizedDescriptionKey: "Failed to initialize audio format"])
        }

        guard let persistentConverter = AVAudioConverter(from: sourceFormat, to: destinationFormat) else {
            throw NSError(domain: "DictatorKeyboard", code: 101, userInfo: [NSLocalizedDescriptionKey: "Failed to initialize audio converter"])
        }
        lock.lock()
        pcmData.removeAll(keepingCapacity: true)
        activeTake = nil
        lock.unlock()

        inputNode.removeTap(onBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 2048, format: sourceFormat) { [weak self] buffer, _ in
            self?.capture(buffer: buffer, converter: persistentConverter, destinationFormat: destinationFormat)
        }

        engine.prepare()
        try engine.start()
        captureRunning = true
    }

    func beginTake(sessionID: String, now: Date = Date()) throws {
        guard captureRunning else {
            throw NSError(domain: "DictatorKeyboard", code: 102, userInfo: [NSLocalizedDescriptionKey: "Continuous capture is not running"])
        }

        lock.lock()
        defer { lock.unlock() }
        guard activeTake == nil else {
            throw NSError(domain: "DictatorKeyboard", code: 104, userInfo: [NSLocalizedDescriptionKey: "A take is already active"])
        }
        activeTake = ActiveTake(sessionID: sessionID, startedAt: now)
        pcmData.removeAll(keepingCapacity: true)
    }

    func finishTake() throws -> Data {
        guard captureRunning else {
            throw NSError(domain: "DictatorKeyboard", code: 102, userInfo: [NSLocalizedDescriptionKey: "Continuous capture is not running"])
        }

        lock.lock()
        let take = activeTake
        let pcm = pcmData
        activeTake = nil
        pcmData.removeAll(keepingCapacity: true)
        lock.unlock()
        guard take != nil else {
            throw NSError(domain: "DictatorKeyboard", code: 105, userInfo: [NSLocalizedDescriptionKey: "No take is active"])
        }
        guard !pcm.isEmpty else {
            throw NSError(domain: "DictatorKeyboard", code: 103, userInfo: [NSLocalizedDescriptionKey: "No audio captured"])
        }
        return Self.makeWAV(pcm16MonoData: pcm, sampleRate: Int(targetSampleRate))
    }

    func discardTake() {
        lock.lock()
        activeTake = nil
        pcmData.removeAll(keepingCapacity: true)
        lock.unlock()
    }

    func stopContinuousCapture() {
        guard captureRunning else {
            discardTake()
            return
        }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        engine.reset()
        captureRunning = false
        discardTake()
    }

    private func capture(buffer: AVAudioPCMBuffer, converter: AVAudioConverter, destinationFormat: AVAudioFormat) {
        let expectedFrames = AVAudioFrameCount((Double(buffer.frameLength) * targetSampleRate / buffer.format.sampleRate).rounded(.up))
        guard let converted = AVAudioPCMBuffer(
            pcmFormat: destinationFormat,
            frameCapacity: max(expectedFrames, 1)
        ) else {
            return
        }

        var consumed = false
        var conversionError: NSError?
        let status = converter.convert(to: converted, error: &conversionError) { _, outStatus in
            if consumed {
                outStatus.pointee = .noDataNow
                return nil
            } else {
                consumed = true
                outStatus.pointee = .haveData
                return buffer
            }
        }

        guard conversionError == nil, status == .haveData else {
            return
        }
        guard let channelData = converted.int16ChannelData else {
            return
        }

        let frameLength = Int(converted.frameLength)
        let byteCount = frameLength * MemoryLayout<Int16>.size
        let pointer = UnsafeRawPointer(channelData.pointee)
        lock.lock()
        if activeTake != nil {
            pcmData.append(pointer.assumingMemoryBound(to: UInt8.self), count: byteCount)
        }
        lock.unlock()
    }

    private static func makeWAV(pcm16MonoData: Data, sampleRate: Int) -> Data {
        let channels: UInt16 = 1
        let bitsPerSample: UInt16 = 16
        let blockAlign = UInt16(channels * (bitsPerSample / 8))
        let byteRate = UInt32(sampleRate) * UInt32(blockAlign)
        let dataSize = UInt32(pcm16MonoData.count)
        let riffSize = UInt32(36) + dataSize

        var data = Data(capacity: Int(riffSize) + 8)
        data.append(contentsOf: [0x52, 0x49, 0x46, 0x46]) // RIFF
        data.append(contentsOf: riffSize.littleEndianBytes)
        data.append(contentsOf: [0x57, 0x41, 0x56, 0x45]) // WAVE
        data.append(contentsOf: [0x66, 0x6D, 0x74, 0x20]) // fmt
        data.append(contentsOf: UInt32(16).littleEndianBytes)
        data.append(contentsOf: UInt16(1).littleEndianBytes) // PCM
        data.append(contentsOf: channels.littleEndianBytes)
        data.append(contentsOf: UInt32(sampleRate).littleEndianBytes)
        data.append(contentsOf: byteRate.littleEndianBytes)
        data.append(contentsOf: blockAlign.littleEndianBytes)
        data.append(contentsOf: bitsPerSample.littleEndianBytes)
        data.append(contentsOf: [0x64, 0x61, 0x74, 0x61]) // data
        data.append(contentsOf: dataSize.littleEndianBytes)
        data.append(pcm16MonoData)
        return data
    }
}

private extension FixedWidthInteger {
    var littleEndianBytes: [UInt8] {
        withUnsafeBytes(of: self.littleEndian, Array.init)
    }
}
