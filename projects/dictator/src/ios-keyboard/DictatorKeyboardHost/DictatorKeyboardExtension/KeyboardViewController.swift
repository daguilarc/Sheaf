import SwiftUI
import UIKit

enum KeyboardState {
    case idle
    case launching
    case readyToRecord
    case readyToStop
    case processing
    case failed(String)
}

final class KeyboardStateModel: ObservableObject {
    @Published var state: KeyboardState = .idle
    @Published var isShiftEnabled = false
}

final class KeyboardViewController: UIInputViewController {
    private let statusLabel = UILabel()
    private let stateModel = KeyboardStateModel()
    private var dictateHostingController: UIHostingController<DictatorKeyboardView>?
    private var currentSession: SharedKeyboardSession?
    private var sessionRefreshTask: Task<Void, Never>?

    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()

        DarwinNotificationCenter.shared.observe(SharedConfig.darwinSessionUpdated) { [weak self] in
            DispatchQueue.main.async {
                self?.reloadFromSharedSession()
            }
        }

        reloadFromSharedSession()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        reloadFromSharedSession()
    }

    deinit {
        DarwinNotificationCenter.shared.removeObserver(SharedConfig.darwinSessionUpdated)
        sessionRefreshTask?.cancel()
    }

    func handleCurrentActionTap() {
        switch stateModel.state {
        case .idle:
            openHostAppForDictation()
        case .launching, .processing:
            return
        case .readyToRecord:
            startRecording()
        case .readyToStop:
            stopRecording()
        case .failed:
            retryFromFailure()
        }
    }

    func toggleShift() {
        stateModel.isShiftEnabled.toggle()
    }

    func typeKey(_ key: String) {
        let text = stateModel.isShiftEnabled ? key.uppercased() : key.lowercased()
        textDocumentProxy.insertText(text)
        if stateModel.isShiftEnabled {
            stateModel.isShiftEnabled = false
        }
    }

    func insertSpace() {
        textDocumentProxy.insertText(" ")
    }

    func insertReturn() {
        textDocumentProxy.insertText("\n")
    }

    func deleteBackward() {
        textDocumentProxy.deleteBackward()
    }

    func startLaunchFlow() {
        let session = SharedConfig.beginKeyboardLaunchSession()
        currentSession = session
        transition(to: .launching)
        SharedConfig.appendDiagnosticsEvent(
            "[Keyboard][\(session.sessionID)][\(session.phase.rawValue)] Opening host app via Link.",
            source: "keyboard-extension",
            sessionID: session.sessionID
        )
    }

    func stopRecording() {
        guard let session = SharedConfig.currentKeyboardSessionIfFresh(),
              session.phase == .recording else {
            SharedConfig.appendDiagnosticsEvent(
                "[Keyboard] Stop ignored because there is no live recording session.",
                source: "keyboard-extension"
            )
            reloadFromSharedSession()
            return
        }

        _ = SharedConfig.updateKeyboardSession(sessionID: session.sessionID, phase: .stopping)
        SharedConfig.appendDiagnosticsEvent(
            "[Keyboard][\(session.sessionID)][stopping] Posting Darwin stop request.",
            source: "keyboard-extension",
            sessionID: session.sessionID
        )
        DarwinNotificationCenter.shared.post(SharedConfig.darwinDictationStop)
        transition(to: .processing)
    }

    func startRecording() {
        guard let session = SharedConfig.currentKeyboardSessionIfFresh(),
              session.phase == .hostReady else {
            SharedConfig.appendDiagnosticsEvent(
                "[Keyboard] Start ignored because Dictator is not ready.",
                source: "keyboard-extension"
            )
            reloadFromSharedSession()
            return
        }

        SharedConfig.appendDiagnosticsEvent(
            "[Keyboard][\(session.sessionID)][host_ready] Posting Darwin start request.",
            source: "keyboard-extension",
            sessionID: session.sessionID
        )
        DarwinNotificationCenter.shared.post(SharedConfig.darwinDictationStart)
    }

    func cancelCurrentTake() {
        guard let session = SharedConfig.currentKeyboardSessionIfFresh(),
              session.phase == .recording else {
            SharedConfig.appendDiagnosticsEvent(
                "[Keyboard] Cancel current take ignored because there is no live recording session.",
                source: "keyboard-extension"
            )
            reloadFromSharedSession()
            return
        }

        SharedConfig.appendDiagnosticsEvent(
            "[Keyboard][\(session.sessionID)][recording] Posting Darwin cancel-current-take request.",
            source: "keyboard-extension",
            sessionID: session.sessionID
        )
        DarwinNotificationCenter.shared.post(SharedConfig.darwinDictationCancelTake)
    }

    func retryFromFailure() {
        startLaunchFlow()
    }

    private func openHostAppForDictation() {
        startLaunchFlow()
    }

    private func reloadFromSharedSession() {
        let session = SharedConfig.currentKeyboardSessionIfFresh()
        currentSession = session

        guard let session else {
            transition(to: .idle)
            return
        }

        SharedConfig.appendDiagnosticsEvent(
            "[Keyboard][\(session.sessionID)][\(session.phase.rawValue)] Reloaded session state.",
            source: "keyboard-extension",
            sessionID: session.sessionID
        )

        switch session.phase {
        case .idle, .cancelled:
            SharedConfig.resetKeyboardSessionState()
            transition(to: .idle)

        case .launchingHost:
            transition(to: .launching)

        case .hostReady:
            insertLatestTranscriptIfNeeded(for: session)
            transition(to: .readyToRecord)

        case .recording:
            transition(to: .readyToStop)

        case .stopping, .processing:
            transition(to: .processing)

        case .failed:
            transition(to: .failed(session.errorMessage ?? "Continue in Dictator to finish."))

        case .completed:
            insertLatestTranscriptIfNeeded(for: session)
            transition(to: .readyToRecord)
        }
    }

    private func insertLatestTranscriptIfNeeded(for session: SharedKeyboardSession) {
        guard let transcriptUpdatedAt = session.latestTranscriptUpdatedAt,
              !SharedConfig.hasInsertedTranscript(sessionID: session.sessionID, updatedAt: transcriptUpdatedAt),
              let transcript = SharedConfig.loadLatestTranscript() else {
            return
        }

        let trimmed = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return
        }

        textDocumentProxy.insertText(trimmed)
        SharedConfig.markTranscriptInserted(sessionID: session.sessionID, updatedAt: transcriptUpdatedAt)
        SharedConfig.appendDiagnosticsEvent(
            "[Keyboard][\(session.sessionID)][completed] Inserted \(trimmed.count) chars.",
            source: "keyboard-extension",
            sessionID: session.sessionID
        )
    }

    private func transition(to state: KeyboardState) {
        configureSessionRefresh(for: state)
        stateModel.state = state
        switch state {
        case .idle:
            statusLabel.text = "Tap Dictate to start."
        case .launching:
            statusLabel.text = "Opening Dictator..."
        case .readyToRecord:
            statusLabel.text = "Dictator is ready. Tap Record."
        case .readyToStop:
            statusLabel.text = "Recording. Tap Stop or cancel the take."
        case .processing:
            statusLabel.text = "Processing..."
        case let .failed(message):
            statusLabel.text = message
        }
    }

    private func configureSessionRefresh(for state: KeyboardState) {
        sessionRefreshTask?.cancel()

        let shouldPoll: Bool
        switch state {
        case .launching, .readyToRecord, .readyToStop, .processing:
            shouldPoll = true
        case .idle, .failed:
            shouldPoll = false
        }

        guard shouldPoll else {
            return
        }

        sessionRefreshTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                guard !Task.isCancelled else {
                    return
                }
                await MainActor.run {
                    self?.reloadFromSharedSession()
                }
            }
        }
    }

    private func setupUI() {
        view.backgroundColor = .systemGray5

        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.font = .preferredFont(forTextStyle: .caption1)
        statusLabel.textAlignment = .center
        statusLabel.numberOfLines = 2
        statusLabel.textColor = .secondaryLabel

        let dictateView = DictatorKeyboardView(
            model: stateModel,
            onCurrentAction: { [weak self] in self?.handleCurrentActionTap() },
            onCancelTake: { [weak self] in self?.cancelCurrentTake() },
            onToggleShift: { [weak self] in self?.toggleShift() },
            onTypeKey: { [weak self] key in self?.typeKey(key) },
            onDeleteBackward: { [weak self] in self?.deleteBackward() },
            onInsertSpace: { [weak self] in self?.insertSpace() },
            onInsertReturn: { [weak self] in self?.insertReturn() }
        )
        let hosting = UIHostingController(rootView: dictateView)
        hosting.view.translatesAutoresizingMaskIntoConstraints = false
        hosting.view.backgroundColor = .clear
        addChild(hosting)
        dictateHostingController = hosting

        view.addSubview(statusLabel)
        view.addSubview(hosting.view)
        hosting.didMove(toParent: self)

        NSLayoutConstraint.activate([
            statusLabel.topAnchor.constraint(equalTo: view.topAnchor, constant: 8),
            statusLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
            statusLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),

            hosting.view.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 8),
            hosting.view.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 8),
            hosting.view.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -8),
            hosting.view.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -8),
            hosting.view.heightAnchor.constraint(greaterThanOrEqualToConstant: 250)
        ])
    }
}

private struct DictatorKeyboardView: View {
    @ObservedObject var model: KeyboardStateModel
    let onCurrentAction: () -> Void
    let onCancelTake: () -> Void
    let onToggleShift: () -> Void
    let onTypeKey: (String) -> Void
    let onDeleteBackward: () -> Void
    let onInsertSpace: () -> Void
    let onInsertReturn: () -> Void
    private let hostAppURL = URL(string: SharedConfig.hostAppDictationURLString)

    private let topRow = Array("qwertyuiop").map(String.init)
    private let middleRow = Array("asdfghjkl").map(String.init)
    private let bottomLetters = Array("zxcvbnm").map(String.init)

    var body: some View {
        VStack(spacing: 8) {
            controlRow
            keyRow(topRow)
            keyRow(middleRow, horizontalPadding: 18)
            bottomLetterRow
            bottomActionRow
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 6)
    }

    private var controlRow: some View {
        HStack(spacing: 8) {
            controlButton(
                title: "Cancel Current Take",
                background: isCancelEnabled ? Color.gray.opacity(0.28) : Color.gray.opacity(0.14),
                foreground: isCancelEnabled ? .primary : .secondary,
                border: isCancelEnabled ? Color.gray.opacity(0.55) : Color.clear,
                width: 132,
                enabled: isCancelEnabled
            ) {
                onCancelTake()
            }

            Spacer(minLength: 0)

            currentActionButton
        }
        .padding(.horizontal, 6)
    }

    @ViewBuilder
    private var currentActionButton: some View {
        if shouldUseLaunchLink, let hostAppURL {
            Link(destination: hostAppURL) {
                currentActionButtonLabel
            }
            .simultaneousGesture(TapGesture().onEnded {
                onCurrentAction()
            })
        } else {
            Button(action: onCurrentAction) {
                currentActionButtonLabel
            }
            .buttonStyle(.plain)
            .disabled(!isCurrentActionEnabled)
        }
    }

    private var currentActionButtonLabel: some View {
        controlButtonLabel(
            title: currentActionTitle,
            background: currentActionColor.opacity(isCurrentActionEnabled ? 0.22 : 0.14),
            foreground: isCurrentActionEnabled ? currentActionColor : .secondary,
            border: isCurrentActionEnabled ? currentActionColor.opacity(0.7) : Color.clear,
            width: 96
        )
    }

    private func keyRow(_ keys: [String], horizontalPadding: CGFloat = 0) -> some View {
        HStack(spacing: 6) {
            ForEach(keys, id: \.self) { key in
                letterKey(key)
            }
        }
        .padding(.horizontal, horizontalPadding)
    }

    private var bottomLetterRow: some View {
        HStack(spacing: 6) {
            functionKey(
                title: model.isShiftEnabled ? "SHIFT" : "shift",
                width: 56,
                foreground: model.isShiftEnabled ? .blue : .primary
            ) {
                onToggleShift()
            }

            ForEach(bottomLetters, id: \.self) { key in
                letterKey(key)
            }

            functionKey(title: "delete", width: 68, action: onDeleteBackward)
        }
        .padding(.horizontal, 6)
    }

    private var bottomActionRow: some View {
        HStack(spacing: 6) {
            functionKey(title: "space", width: nil, fillHorizontally: true, action: onInsertSpace)

            functionKey(title: "return", width: 84, action: onInsertReturn)
        }
        .padding(.horizontal, 6)
    }

    private func letterKey(_ key: String) -> some View {
        Button {
            onTypeKey(key)
        } label: {
            Text(model.isShiftEnabled ? key.uppercased() : key)
                .font(.system(size: 20, weight: .medium))
                .frame(maxWidth: .infinity, minHeight: 42)
                .background(Color.white)
                .foregroundStyle(Color.black)
                .clipShape(RoundedRectangle(cornerRadius: 7))
                .overlay(
                    RoundedRectangle(cornerRadius: 7)
                        .stroke(Color.black.opacity(0.08), lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    private func functionKey(
        title: String,
        width: CGFloat? = nil,
        fillHorizontally: Bool = false,
        foreground: Color = .primary,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .frame(maxWidth: fillHorizontally ? .infinity : nil)
                .frame(width: width)
                .frame(minHeight: 42)
                .background(Color.gray.opacity(0.22))
                .foregroundStyle(foreground)
                .clipShape(RoundedRectangle(cornerRadius: 7))
                .overlay(
                    RoundedRectangle(cornerRadius: 7)
                        .stroke(Color.black.opacity(0.08), lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    private func controlButton(
        title: String,
        background: Color,
        foreground: Color,
        border: Color,
        width: CGFloat,
        enabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            controlButtonLabel(
                title: title,
                background: background,
                foreground: foreground,
                border: border,
                width: width
            )
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    private func controlButtonLabel(
        title: String,
        background: Color,
        foreground: Color,
        border: Color,
        width: CGFloat
    ) -> some View {
        Text(title)
            .font(.system(size: 13, weight: .semibold))
            .multilineTextAlignment(.center)
            .frame(width: width)
            .frame(minHeight: 36)
            .background(background)
            .foregroundStyle(foreground)
            .clipShape(RoundedRectangle(cornerRadius: 9))
            .overlay(
                RoundedRectangle(cornerRadius: 9)
                    .stroke(border, lineWidth: 1.5)
            )
    }

    private var isCancelEnabled: Bool {
        if case .readyToStop = model.state {
            return true
        }
        return false
    }

    private var isCurrentActionEnabled: Bool {
        switch model.state {
        case .launching, .processing:
            return false
        case .idle, .readyToRecord, .readyToStop, .failed:
            return true
        }
    }

    private var currentActionTitle: String {
        switch model.state {
        case .idle:
            return "Dictate"
        case .launching:
            return "Opening"
        case .readyToRecord:
            return "Record"
        case .readyToStop:
            return "Stop"
        case .processing:
            return "Processing"
        case .failed:
            return "Continue"
        }
    }

    private var shouldUseLaunchLink: Bool {
        switch model.state {
        case .idle, .failed:
            return true
        case .launching, .readyToRecord, .readyToStop, .processing:
            return false
        }
    }

    private var currentActionColor: Color {
        switch model.state {
        case .idle, .readyToRecord:
            return .blue
        case .launching, .processing:
            return .gray
        case .readyToStop:
            return .red
        case .failed:
            return .orange
        }
    }
}
