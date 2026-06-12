import AppKit
import DictatorCore
import Foundation

@MainActor
final class LaunchpadServiceController
{
    private enum DictationState
    {
        case idle
        case recording
        case thinking
    }

    private enum InteractionMode
    {
        case standard
        case talonLite

        var logName: String
        {
            switch self
            {
            case .standard:
                return "standard"
            case .talonLite:
                return "talon_lite"
            }
        }
    }

    private enum ShiftLatchState
    {
        case unpressed
        case pressedWillLatchOnRelease
        case pressedNoLatchOnRelease
        case latched
    }

    private let repoRoot: URL
    private let runtimeConfigProvider: RuntimeConfigProvider
    private let secretStore: APIKeysStore
    private let sttEngine: any STTEngine
    private let apiClient: APIClient
    private let interactionStore: InteractionHistoryStore
    private let activityTracker: DictationActivityTracker
    private let vsCodeHunkRegistry: VSCodeHunkRegistry
    private let sessionID = UUID().uuidString

    private let audioRecorder = AudioRecorder()
    private let recordingController = RecordingController()
    private let activeTargetContextProvider = ActiveTargetContextProvider()
    private lazy var keyboardInjector = KeyboardInjector { [weak self] result in
        DispatchQueue.main.async
        {
            self?.handleKeyboardDispatchResult(result)
        }
    }
    private lazy var talonLiteCorrectionEngine = RuntimeConfigTalonLiteLLMCorrectionEngine(
        runtimeConfigProvider: runtimeConfigProvider,
        secretStore: secretStore,
        canUseOpenAI: { [secretStore] in
            (try? secretStore.getOpenAIKey()) != nil
        }
    )
    private lazy var talonLiteOrchestrator = TalonLitePipelineOrchestrator(
        sttEngine: sttEngine,
        correctionEngine: talonLiteCorrectionEngine,
        trace: { message in
            TraceLogger.log(message)
        }
    )

    private var recordingContext: [String: String]?
    private var activeInteractionMode: InteractionMode = .standard
    private var activeSystemPromptPathOverride: String?
    private var activeDictationTask: Task<DictateCallResult, Error>?
    private var dictationState: DictationState = .idle
    private var shiftLatchState: ShiftLatchState = .unpressed

    private var launchpadMIDIManager: LaunchpadMIDIManager?
    private var launchpadPageController: LaunchpadPageController?
    private var launchpadRenderWorker: LaunchpadColorRenderWorker?
    private var launchpadInvalidationBus: RenderInvalidationBus?

    init(
        repoRoot: URL,
        runtimeConfigProvider: RuntimeConfigProvider,
        secretStore: APIKeysStore,
        sttEngine: any STTEngine,
        coreClient: any DictatorCoreClient,
        interactionStore: InteractionHistoryStore,
        activityTracker: DictationActivityTracker,
        vsCodeHunkRegistry: VSCodeHunkRegistry
    )
    {
        self.repoRoot = repoRoot
        self.runtimeConfigProvider = runtimeConfigProvider
        self.secretStore = secretStore
        self.sttEngine = sttEngine
        self.apiClient = APIClient(coreClient: coreClient)
        self.interactionStore = interactionStore
        self.activityTracker = activityTracker
        self.vsCodeHunkRegistry = vsCodeHunkRegistry
    }

    func start()
    {
        if !KeyboardInjector.hasAccessibilityPermission()
        {
            _ = KeyboardInjector.requestAccessibilityPermissionPrompt()
            TraceLogger.log("launchpad keystrokes need Accessibility permission")
        }

        let invalidationBus = RenderInvalidationBus()
        let pageController = LaunchpadPageController(invalidationBus: invalidationBus)
        vsCodeHunkRegistry.setOnChange {
            invalidationBus.markDirty(reason: "vscode_hunk_state")
        }
        pageController.setControlLayer(
            VSCodeHunkLaunchpadControlLayer(registry: vsCodeHunkRegistry, invalidationBus: invalidationBus),
            forSlot: "vscode.hunks"
        )
        let pageFactory = LaunchpadPageFactory(
            invalidationBus: invalidationBus,
            onKeystroke: { [weak self] key, baseModifiers in
                Task { @MainActor in
                    self?.dispatchLaunchpadKeystroke(key, baseModifiers: baseModifiers)
                }
            },
            onDictationCommand: { [weak self] command in
                Task { @MainActor in
                    await self?.handleLaunchpadDictationCommand(command, mode: .standard)
                }
            },
            onAuxiliaryDictationCommand: { [weak self] promptSlot, command in
                Task { @MainActor in
                    await self?.handleLaunchpadAuxiliaryDictationCommand(command, promptSlot: promptSlot)
                }
            },
            onTalonLiteDictationCommand: { [weak self] command in
                Task { @MainActor in
                    await self?.handleLaunchpadDictationCommand(command, mode: .talonLite)
                }
            },
            onContextualBackspace: { [weak self] in
                Task { @MainActor in
                    await self?.handleLaunchpadContextualBackspace()
                }
            },
            onNextWindowSwitchPress: {
                TraceLogger.log("launchpad next_window ignored: AppKit UI navigation is not active in DictatorService")
            },
            onNextWindowSwitchRelease: nil,
            onAppReload: {
                TraceLogger.log("launchpad app_reload ignored: service restart is owned by Sheaf service management")
            },
            onLoadSafeRuntimeConfig: { [weak self] in
                Task { @MainActor in
                    await self?.handleLaunchpadLoadSafeRuntimeConfig()
                }
            },
            onToggleFullscreenOverlay: {
                TraceLogger.log("launchpad fullscreen overlay ignored: native overlay was not migrated")
            },
            recordStatusColorProvider: { [weak self] in
                self?.recordStatusColor() ?? .off
            },
            shiftLatchColorProvider: { [weak self] in
                self?.shiftLatchColor() ?? PadColor(r: 50, g: 50, b: 0)
            },
            onModifierPress: { [weak self] modifier in
                Task { @MainActor in
                    self?.handleModifierPress(modifier)
                }
            },
            onModifierRelease: { [weak self] modifier in
                Task { @MainActor in
                    self?.handleModifierRelease(modifier)
                }
            }
        )

        do
        {
            let config = try LaunchpadLayoutLoader.loadDefault(repoRoot: repoRoot)
            TraceLogger.log(
                "launchpad layout loaded pages=\(config.pages.count) initial=\(config.initialPageID ?? "<none>")"
            )
            let pages = pageFactory.makePages(from: config)
            pageController.setPages(pages, initialPageID: config.initialPageID)
        }
        catch
        {
            TraceLogger.log("launchpad layout load failed: \(error)")
            return
        }

        let midiManager = LaunchpadMIDIManager()
        let renderWorker = LaunchpadColorRenderWorker(
            invalidationBus: invalidationBus,
            colorProvider: pageController,
            transport: midiManager
        )

        midiManager.onPadEvent = { [weak pageController] event in
            pageController?.handle(event)
        }
        midiManager.onConnectionStateChanged = { [weak renderWorker] state in
            switch state
            {
            case .searching:
                TraceLogger.log("launchpad state: searching")
            case let .connected(name):
                TraceLogger.log("launchpad state: connected (\(name))")
                renderWorker?.invalidateAll()
            }
        }
        midiManager.onSleepStateChanged = { [weak renderWorker] sleeping in
            TraceLogger.log("launchpad state: \(sleeping ? "sleeping" : "awake")")
            if !sleeping
            {
                renderWorker?.invalidateAll()
            }
        }

        launchpadInvalidationBus = invalidationBus
        launchpadPageController = pageController
        launchpadMIDIManager = midiManager
        launchpadRenderWorker = renderWorker

        renderWorker.start()
        midiManager.start()
        TraceLogger.log("launchpad service controller started")
    }

    func stop()
    {
        cancelActiveDictationTask()
        if recordingController.isRecording
        {
            _ = recordingController.toggle()
            _ = audioRecorder.stop()
        }
        launchpadRenderWorker?.stop()
        launchpadMIDIManager?.stop()
        vsCodeHunkRegistry.setOnChange(nil)
        launchpadRenderWorker = nil
        launchpadMIDIManager = nil
        launchpadPageController = nil
        launchpadInvalidationBus = nil
        TraceLogger.log("launchpad service controller stopped")
    }

    private func handleLaunchpadDictationCommand(
        _ command: LaunchpadActionConfig.DictationCommand,
        mode: InteractionMode,
        systemPromptPathOverride: String? = nil
    ) async
    {
        switch command
        {
        case .start:
            if dictationState == .idle && !recordingController.isRecording
            {
                await startRecording(mode: mode, systemPromptPathOverride: systemPromptPathOverride)
            }
        case .stop:
            if dictationState == .recording && recordingController.isRecording
            {
                await stopRecordingAndProcess()
            }
        case .cancel:
            cancelRecording()
        case .toggle:
            if dictationState == .thinking
            {
                cancelThinking()
            }
            else if recordingController.isRecording
            {
                await stopRecordingAndProcess()
            }
            else
            {
                await startRecording(mode: mode, systemPromptPathOverride: systemPromptPathOverride)
            }
        }
    }

    private func handleLaunchpadAuxiliaryDictationCommand(
        _ command: LaunchpadActionConfig.DictationCommand,
        promptSlot: Int
    ) async
    {
        let promptPath = await resolvedAuxiliarySystemPromptPath(for: promptSlot)
        TraceLogger.log("launchpad auxiliary dictation slot=\(promptSlot) prompt=\(promptPath)")
        await handleLaunchpadDictationCommand(
            command,
            mode: .standard,
            systemPromptPathOverride: promptPath
        )
    }

    private func startRecording(
        mode: InteractionMode,
        systemPromptPathOverride: String?
    ) async
    {
        switch await audioRecorder.start()
        {
        case .success:
            var context = activeTargetContextProvider.captureContext() ?? [:]
            switch ClipboardInserter.captureSelectedText()
            {
            case let .success(selectedText):
                if let selectedText
                {
                    context["selected_text"] = selectedText
                    TraceLogger.log("launchpad captured selected text chars=\(selectedText.count)")
                }
            case let .failure(error):
                TraceLogger.log("launchpad selected text capture failed: \(error)")
            }

            recordingContext = context.isEmpty ? nil : context
            activeInteractionMode = mode
            activeSystemPromptPathOverride = systemPromptPathOverride
            _ = recordingController.toggle()
            setDictationState(.recording)
            TraceLogger.log("launchpad recording started mode=\(mode.logName)")
        case let .failure(error):
            recordingContext = nil
            activeInteractionMode = .standard
            activeSystemPromptPathOverride = nil
            setDictationState(.idle)
            TraceLogger.log("launchpad recording start failed: \(error)")
        }
    }

    private func stopRecordingAndProcess() async
    {
        _ = recordingController.toggle()
        let stopResult = audioRecorder.stop()
        switch stopResult
        {
        case let .failure(error):
            setDictationState(.idle)
            TraceLogger.log("launchpad recording stop failed: \(error)")
        case let .success(capturedAudio):
            let interactionMode = activeInteractionMode
            let requestContext = recordingContext
            let systemPromptPathOverride = activeSystemPromptPathOverride
            recordingContext = nil
            activeInteractionMode = .standard
            activeSystemPromptPathOverride = nil

            let locale = Locale.current.identifier.replacingOccurrences(of: "_", with: "-")
            let runtimeConfiguration = await runtimeConfigProvider.currentConfiguration()
            let runtimeConfig = await runtimeConfigProvider.currentRuntimeConfig()
            let effectiveSystemPromptPath = systemPromptPathOverride ?? runtimeConfig.systemPrompt
            let effectiveSystemPromptBody = resolvedSystemPromptBody(
                runtimeConfig: runtimeConfig,
                promptPath: effectiveSystemPromptPath
            )

            setDictationState(.thinking)
            await activityTracker.beginProcessing()
            defer
            {
                Task { await activityTracker.endProcessing() }
            }

            let pipelineStart = Date()
            do
            {
                let overrideRefinementEngine = systemPromptPathOverride == nil
                    ? nil
                    : makeRefinementEngine(
                        systemPromptBodyOverride: effectiveSystemPromptBody,
                        configurationOverride: runtimeConfiguration
                    )
                let task = Task { [apiClient, sttEngine, talonLiteOrchestrator] in
                    switch interactionMode
                    {
                    case .standard:
                        let request = DictateRequest(
                            audio_b64: capturedAudio.data.base64EncodedString(),
                            sample_rate: capturedAudio.sampleRate,
                            locale: locale,
                            session_id: sessionID,
                            optional_context: requestContext
                        )
                        if let overrideRefinementEngine
                        {
                            let orchestrator = PipelineOrchestrator(
                                sttEngine: sttEngine,
                                refinementEngine: overrideRefinementEngine
                            )
                            return try await orchestrator.dictate(request)
                        }
                        return try await apiClient.dictate(request)
                    case .talonLite:
                        let request = TranscribeRequest(
                            audio_b64: capturedAudio.data.base64EncodedString(),
                            sample_rate: capturedAudio.sampleRate,
                            locale: locale,
                            session_id: sessionID,
                            decode_mode: .talonLite
                        )
                        let processed = try await talonLiteOrchestrator.process(request)
                        return DictateCallResult(
                            response: DictateResponse(
                                raw_transcript: processed.rawTranscript,
                                revised_text: processed.outputText,
                                edit_summary: processed.wasLLMCorrected
                                    ? "Talon-lite pipeline rendered after LLM correction."
                                    : "Talon-lite pipeline rendered without LLM correction.",
                                uncertainty_flags: processed.wasLLMCorrected ? ["talon_lite_llm_corrected"] : []
                            ),
                            transcribeMs: processed.transcribeMs,
                            refineMs: max(0, processed.pipelineMs - processed.transcribeMs)
                        )
                    }
                }
                activeDictationTask = task
                let dictatedCall = try await task.value
                activeDictationTask = nil
                let dictated = dictatedCall.response
                let totalPipelineMs = elapsedMs(since: pipelineStart)

                let insertStart = Date()
                let insertResult: Result<Void, ClipboardInserter.InsertError>
                if dictated.revised_text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                {
                    insertResult = .success(())
                    TraceLogger.log("launchpad dictation produced empty revised text; skipping insertion")
                }
                else
                {
                    insertResult = ClipboardInserter.insert(dictated.revised_text)
                }
                let insertMs = elapsedMs(since: insertStart)

                await appendInteraction(
                    dictatedCall: dictatedCall,
                    optionalContext: requestContext,
                    runtimeConfiguration: runtimeConfiguration,
                    systemPromptPath: effectiveSystemPromptPath,
                    systemPromptBody: effectiveSystemPromptBody,
                    insertMs: insertMs,
                    totalPipelineMs: totalPipelineMs,
                    interactionMode: interactionMode
                )

                switch insertResult
                {
                case .success:
                    TraceLogger.log("launchpad dictation inserted mode=\(interactionMode.logName)")
                case let .failure(error):
                    TraceLogger.log("launchpad dictation insert failed: \(error)")
                }
                setDictationState(.idle)
            }
            catch
            {
                activeDictationTask = nil
                setDictationState(.idle)
                if error is CancellationError
                {
                    TraceLogger.log("launchpad dictation canceled")
                    return
                }
                TraceLogger.log("launchpad dictation failed: \(error)")
                await appendFailedInteraction(
                    error: error,
                    mode: interactionMode,
                    optionalContext: requestContext,
                    systemPromptPath: effectiveSystemPromptPath,
                    systemPromptBody: effectiveSystemPromptBody,
                    audioData: capturedAudio.data,
                    sampleRate: capturedAudio.sampleRate,
                    locale: locale
                )
            }
        }
    }

    private func cancelRecording()
    {
        guard recordingController.isRecording else
        {
            return
        }
        _ = recordingController.toggle()
        recordingContext = nil
        activeInteractionMode = .standard
        activeSystemPromptPathOverride = nil
        _ = audioRecorder.stop()
        cancelActiveDictationTask()
        setDictationState(.idle)
        TraceLogger.log("launchpad recording canceled")
    }

    private func cancelThinking()
    {
        guard dictationState == .thinking else
        {
            return
        }
        cancelActiveDictationTask()
        setDictationState(.idle)
        TraceLogger.log("launchpad thinking canceled")
    }

    private func handleLaunchpadContextualBackspace() async
    {
        switch dictationState
        {
        case .recording:
            cancelRecording()
        case .thinking:
            cancelThinking()
        case .idle:
            var modifiers = modifiersForKeyPress(.backspace)
            _ = keyboardInjector.send(.backspace, modifiers: modifiers)
            modifiers.removeAll()
        }
    }

    private func dispatchLaunchpadKeystroke(_ key: KeyboardKey, baseModifiers: Set<KeyboardModifier>)
    {
        var modifiers = baseModifiers
        modifiers.formUnion(modifiersForKeyPress(key))
        _ = keyboardInjector.send(key, modifiers: modifiers)
    }

    private func handleLaunchpadLoadSafeRuntimeConfig() async
    {
        guard dictationState == .idle, !recordingController.isRecording else
        {
            TraceLogger.log("launchpad safe runtime restore skipped: busy")
            return
        }

        do
        {
            let restored = try await runtimeConfigProvider.restoreDefaultsToDisk()
            await interactionStore.setMaxBytes(restored.interactionsBufferBytes)
            TraceLogger.log("launchpad safe runtime defaults restored model=\(restored.model) use_cloud=\(restored.useCloud)")
        }
        catch
        {
            TraceLogger.log("launchpad safe runtime restore failed: \(error)")
        }
    }

    private func handleModifierPress(_ modifier: LaunchpadActionConfig.ModifierType)
    {
        guard modifier == .shift else
        {
            return
        }

        switch shiftLatchState
        {
        case .latched:
            shiftLatchState = .pressedNoLatchOnRelease
        case .unpressed, .pressedWillLatchOnRelease, .pressedNoLatchOnRelease:
            shiftLatchState = .pressedWillLatchOnRelease
        }
        launchpadInvalidationBus?.markDirty(reason: "shift_state")
    }

    private func handleModifierRelease(_ modifier: LaunchpadActionConfig.ModifierType)
    {
        guard modifier == .shift else
        {
            return
        }

        switch shiftLatchState
        {
        case .pressedWillLatchOnRelease:
            shiftLatchState = .latched
        case .pressedNoLatchOnRelease:
            shiftLatchState = .unpressed
        case .latched, .unpressed:
            break
        }
        launchpadInvalidationBus?.markDirty(reason: "shift_state")
    }

    private func modifiersForKeyPress(_ key: KeyboardKey) -> Set<KeyboardModifier>
    {
        let isArrow = key == .up || key == .down || key == .left || key == .right

        switch shiftLatchState
        {
        case .unpressed:
            return []
        case .pressedWillLatchOnRelease:
            if !isArrow
            {
                shiftLatchState = .pressedNoLatchOnRelease
                launchpadInvalidationBus?.markDirty(reason: "shift_state")
            }
            return [.shift]
        case .pressedNoLatchOnRelease:
            return [.shift]
        case .latched:
            if isArrow
            {
                return [.shift]
            }
            shiftLatchState = .unpressed
            launchpadInvalidationBus?.markDirty(reason: "shift_state")
            return []
        }
    }

    private func handleKeyboardDispatchResult(_ result: KeyboardInjector.DispatchResult)
    {
        if result.success
        {
            TraceLogger.log("launchpad sent key=\(result.key.rawValue)")
            return
        }

        if result.failureReason == .accessibilityPermissionMissing
        {
            _ = KeyboardInjector.requestAccessibilityPermissionPrompt()
        }
        TraceLogger.log("launchpad key dispatch failed key=\(result.key.rawValue) reason=\(String(describing: result.failureReason))")
    }

    private func setDictationState(_ newState: DictationState)
    {
        dictationState = newState
        launchpadInvalidationBus?.markDirty(reason: "dictation_state")
    }

    private func cancelActiveDictationTask()
    {
        activeDictationTask?.cancel()
        activeDictationTask = nil
        Task
        {
            await activityTracker.endProcessing()
        }
    }

    private func recordStatusColor() -> PadColor
    {
        switch dictationState
        {
        case .idle:
            return PadColor(r: 255, g: 255, b: 255)
        case .recording:
            return PadColor(r: 255, g: 0, b: 0)
        case .thinking:
            return PadColor(r: 0, g: 0, b: 255)
        }
    }

    private func shiftLatchColor() -> PadColor
    {
        switch shiftLatchState
        {
        case .unpressed:
            return PadColor(r: 50, g: 50, b: 0)
        case .pressedWillLatchOnRelease, .pressedNoLatchOnRelease, .latched:
            return PadColor(r: 255, g: 220, b: 0)
        }
    }

    private func makeRefinementEngine(
        systemPromptBodyOverride: String,
        configurationOverride: LLMRuntimeConfiguration
    ) -> any RefinementEngine
    {
        ProviderRoutingRefinementEngine(
            configuration: configurationOverride,
            ollamaEngine: OllamaRefinementEngine(
                host: configurationOverride.ollamaHost,
                model: configurationOverride.ollamaModel,
                systemPrompt: systemPromptBodyOverride
            ),
            openAIEngine: OpenAIRefinementEngine(
                model: configurationOverride.openAIModel,
                systemPrompt: systemPromptBodyOverride,
                secretStore: secretStore
            ),
            canUseOpenAI: { [secretStore] in
                (try? secretStore.getOpenAIKey()) != nil
            }
        )
    }

    private func resolvedSystemPromptBody(runtimeConfig: RuntimeConfigFile, promptPath: String) -> String
    {
        SystemPromptCatalog(
            directoryURL: runtimeConfig.resolvedSystemPromptsDirectoryURL(currentDirectoryPath: repoRoot.path)
        ).resolvePrompt(named: promptPath)
    }

    private func resolvedAuxiliarySystemPromptPath(for slot: Int) async -> String
    {
        let runtimeConfig = await runtimeConfigProvider.currentRuntimeConfig()
        switch slot
        {
        case 1:
            return runtimeConfig.auxiliarySystemPrompt1
        case 2:
            return runtimeConfig.auxiliarySystemPrompt2
        default:
            return runtimeConfig.systemPrompt
        }
    }

    private func appendInteraction(
        dictatedCall: DictateCallResult,
        optionalContext: [String: String]?,
        runtimeConfiguration: LLMRuntimeConfiguration,
        systemPromptPath: String,
        systemPromptBody: String,
        insertMs: Int,
        totalPipelineMs: Int,
        interactionMode: InteractionMode
    ) async
    {
        let response = dictatedCall.response
        var context = optionalContext ?? [:]
        context["request_source"] = "launchpad"
        context["session_id"] = sessionID

        let effectiveProvider = dictatedCall.providerMetadata?.provider
            ?? runtimeConfiguration.provider.rawValue
        let effectiveModel = dictatedCall.providerMetadata?.model
            ?? model(forProvider: effectiveProvider, runtimeConfiguration: runtimeConfiguration)

        let interaction = DictationInteraction(
            whisperOutput: response.raw_transcript,
            finalOutput: response.revised_text,
            mode: interactionHistoryMode(
                interactionMode: interactionMode,
                rawTranscript: response.raw_transcript,
                revisedText: response.revised_text,
                optionalContext: optionalContext
            ),
            systemPromptPath: systemPromptPath,
            systemPromptBody: systemPromptBody,
            model: effectiveModel,
            provider: effectiveProvider,
            optionalContext: context,
            editSummary: response.edit_summary,
            uncertaintyFlags: response.uncertainty_flags,
            fallbackUsed: dictatedCall.providerMetadata?.fallbackUsed,
            timings: DictationInteractionTimings(
                transcribeMs: dictatedCall.transcribeMs,
                refineMs: dictatedCall.refineMs,
                insertMs: insertMs,
                totalPipelineMs: totalPipelineMs
            )
        )
        await interactionStore.append(interaction)
    }

    private func appendFailedInteraction(
        error: Error,
        mode: InteractionMode,
        optionalContext: [String: String]?,
        systemPromptPath: String,
        systemPromptBody: String,
        audioData: Data,
        sampleRate: Int,
        locale: String
    ) async
    {
        let runtimeConfiguration = await runtimeConfigProvider.currentConfiguration()
        let provider = runtimeConfiguration.provider.rawValue
        let interaction = DictationInteraction(
            whisperOutput: "",
            finalOutput: String(describing: error),
            mode: mode == .talonLite ? .talonLite : .revision,
            systemPromptPath: systemPromptPath,
            systemPromptBody: systemPromptBody,
            model: model(forProvider: provider, runtimeConfiguration: runtimeConfiguration),
            provider: provider,
            optionalContext: optionalContext ?? [:],
            editSummary: mode == .talonLite ? "Talon-lite pipeline failed." : "Dictation pipeline failed.",
            uncertaintyFlags: ["pipeline_error"],
            errorMessage: String(describing: error),
            timings: DictationInteractionTimings(
                transcribeMs: 0,
                refineMs: 0,
                insertMs: 0,
                totalPipelineMs: 0
            )
        )
        _ = audioData
        _ = sampleRate
        _ = locale
        await interactionStore.append(interaction)
    }

    private func interactionHistoryMode(
        interactionMode: InteractionMode,
        rawTranscript: String,
        revisedText: String,
        optionalContext: [String: String]?
    ) -> DictationInteractionMode
    {
        if interactionMode == .talonLite
        {
            return .talonLite
        }
        let selectedText = optionalContext?["selected_text"]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !selectedText.isEmpty
        {
            return .textReplacement
        }
        if rawTranscript.trimmingCharacters(in: .whitespacesAndNewlines)
            == revisedText.trimmingCharacters(in: .whitespacesAndNewlines)
        {
            return .rawDictation
        }
        return .revision
    }

    private func model(
        forProvider provider: String,
        runtimeConfiguration: LLMRuntimeConfiguration
    ) -> String
    {
        provider == LLMRuntimeConfiguration.Provider.openai.rawValue
            ? runtimeConfiguration.openAIModel
            : runtimeConfiguration.ollamaModel
    }

    private func elapsedMs(since start: Date) -> Int
    {
        max(0, Int(Date().timeIntervalSince(start) * 1000))
    }
}
