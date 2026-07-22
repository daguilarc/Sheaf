import XCTest
import DictatorCore
@testable import DictatorService


private func loadFixtureLayout() throws -> LaunchpadLayoutConfig {
    let fixtureURL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .appendingPathComponent("fixtures/launchpad-layout.json")
    let data = try Data(contentsOf: fixtureURL)
    return try LaunchpadLayoutLoader.decode(data)
}

private func loadProductLayout() throws -> LaunchpadLayoutConfig {
    let repoRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
    return try LaunchpadLayoutLoader.loadDefault(repoRoot: repoRoot)
}

final class LaunchpadTests: XCTestCase {
    func testLaunchpadNoteCoordinateMappingRoundTrip() {
        let samples = [
            PadCoordinate(x: 0, y: 0),
            PadCoordinate(x: 7, y: 0),
            PadCoordinate(x: 0, y: 7),
            PadCoordinate(x: 7, y: 7),
            PadCoordinate(x: 3, y: 4),
            PadCoordinate(x: -1, y: 7)
        ]

        for coordinate in samples {
            let note = LaunchpadMIDIManager.coordinateToNote(coordinate)
            XCTAssertNotNil(note)
            XCTAssertEqual(LaunchpadMIDIManager.noteToCoordinate(note!), coordinate)
        }
    }

    func testLaunchpadCellUsesDimWhenIdleAndBrightWhenPressed() {
        let bus = RenderInvalidationBus()
        let cell = LaunchpadCell(baseColor: PadColor(r: 200, g: 100, b: 40), invalidationBus: bus)
        let page = LaunchpadPage(id: "test")
        let coordinate = PadCoordinate(x: 1, y: 2)

        page.setCell(cell, at: coordinate)

        XCTAssertEqual(page.getColor(at: coordinate), PadColor(r: 50, g: 25, b: 10))
        page.handle(PadEvent(coordinate: coordinate, phase: .press, velocity: 127))
        XCTAssertEqual(page.getColor(at: coordinate), PadColor(r: 200, g: 100, b: 40))
        page.handle(PadEvent(coordinate: coordinate, phase: .release, velocity: 0))
        XCTAssertEqual(page.getColor(at: coordinate), PadColor(r: 50, g: 25, b: 10))
    }

    func testRenderInvalidationBusWakesOnDirtySignal() {
        let bus = RenderInvalidationBus()
        let exp = expectation(description: "dirty")

        DispatchQueue.global().asyncAfter(deadline: .now() + 0.05) {
            bus.markDirty(reason: "test")
            exp.fulfill()
        }

        let generation = bus.waitForDirty(since: 0, timeout: 0.5)
        wait(for: [exp], timeout: 1)
        XCTAssertGreaterThan(generation, 0)
    }

    func testAudioInputAvailabilityAllowsDefaultInput() {
        let resolver = StaticAudioInputResolver(
            devices: [
                AudioInputDevice(id: "built-in", name: "Built-in Microphone", channelCount: 1)
            ],
            defaultDeviceID: "built-in"
        )

        let availability = LaunchpadAudioInputAvailability.evaluate(
            configuredAudioInput: nil,
            resolver: resolver
        )

        XCTAssertTrue(availability.recordActionEnabled)
        XCTAssertEqual(availability.resolvedInput.mode, .systemDefault)
        XCTAssertEqual(availability.resolvedInput.device?.id, "built-in")
    }

    func testAudioInputAvailabilityDisablesRecordActionForUnavailableSelectedInput() {
        let availability = LaunchpadAudioInputAvailability.evaluate(
            configuredAudioInput: "Missing Interface",
            resolver: StaticAudioInputResolver(devices: [])
        )

        XCTAssertFalse(availability.recordActionEnabled)
        XCTAssertEqual(availability.resolvedInput.mode, .selected)
        XCTAssertFalse(availability.resolvedInput.isAvailable)
    }

    func testAudioInputAvailabilityReenablesRecordActionWhenSelectedInputReturns() {
        let resolver = StaticAudioInputResolver(
            devices: [
                AudioInputDevice(id: "scarlett-id", name: "Scarlett 2i2", channelCount: 2)
            ],
            defaultDeviceID: "scarlett-id"
        )

        let availability = LaunchpadAudioInputAvailability.evaluate(
            configuredAudioInput: "Scarlett 2i2",
            resolver: resolver
        )

        XCTAssertTrue(availability.recordActionEnabled)
        XCTAssertEqual(availability.resolvedInput.mode, .selected)
        XCTAssertEqual(availability.resolvedInput.device?.id, "scarlett-id")
    }

    @MainActor
    func testLaunchpadControllerPassesSelectedRuntimeAudioInputToRecorder() async throws {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("launchpad-controller-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let provider = try await makeLaunchpadRuntimeConfigProvider(tempDir: tempDir, audioInput: "Scarlett 2i2")
        let resolver = StaticAudioInputResolver(
            devices: [
                AudioInputDevice(id: "scarlett-id", name: "Scarlett 2i2", channelCount: 2)
            ],
            defaultDeviceID: "scarlett-id"
        )
        var appliedSelection: AudioRecorder.AudioInputSelection?
        var recordingStarterCalled = false
        let recorder = AudioRecorder(
            inputSelectionApplier: { selection in
                appliedSelection = selection
                return {}
            },
            recordingStarter: {
                recordingStarterCalled = true
                return { .success(CapturedAudio(data: Data([1, 2, 3]), sampleRate: 16_000)) }
            },
            microphonePermissionProvider: { true }
        )
        let controller = makeLaunchpadController(
            tempDir: tempDir,
            provider: provider,
            resolver: resolver,
            recorder: recorder
        )

        await controller.handleStandardDictationCommandForTesting(.start)

        XCTAssertTrue(recordingStarterCalled)
        XCTAssertTrue(controller.isRecordingForTesting)
        XCTAssertEqual(appliedSelection?.device.id, "scarlett-id")
    }

    @MainActor
    func testLaunchpadControllerStartsDefaultRuntimeAudioInputWithoutSelectedInputApply() async throws {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("launchpad-controller-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let provider = try await makeLaunchpadRuntimeConfigProvider(tempDir: tempDir, audioInput: nil)
        let resolver = StaticAudioInputResolver(
            devices: [
                AudioInputDevice(id: "built-in", name: "Built-in Microphone", channelCount: 1)
            ],
            defaultDeviceID: "built-in"
        )
        var appliedSelection: AudioRecorder.AudioInputSelection?
        var recordingStarterCalled = false
        let recorder = AudioRecorder(
            inputSelectionApplier: { selection in
                appliedSelection = selection
                return {}
            },
            recordingStarter: {
                recordingStarterCalled = true
                return { .success(CapturedAudio(data: Data([1, 2, 3]), sampleRate: 16_000)) }
            },
            microphonePermissionProvider: { true }
        )
        let controller = makeLaunchpadController(
            tempDir: tempDir,
            provider: provider,
            resolver: resolver,
            recorder: recorder
        )

        await controller.handleStandardDictationCommandForTesting(.start)

        XCTAssertTrue(recordingStarterCalled)
        XCTAssertTrue(controller.isRecordingForTesting)
        XCTAssertNil(appliedSelection)
    }

    @MainActor
    func testLaunchpadControllerIgnoresUnavailableSelectedRuntimeAudioInputBeforeRecorderSetup() async throws {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("launchpad-controller-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let provider = try await makeLaunchpadRuntimeConfigProvider(tempDir: tempDir, audioInput: "Missing Interface")
        var recordingStarterCalled = false
        let recorder = AudioRecorder(
            recordingStarter: {
                recordingStarterCalled = true
                return { .success(CapturedAudio(data: Data([1, 2, 3]), sampleRate: 16_000)) }
            },
            microphonePermissionProvider: { true }
        )
        let controller = makeLaunchpadController(
            tempDir: tempDir,
            provider: provider,
            resolver: StaticAudioInputResolver(devices: []),
            recorder: recorder
        )

        await controller.handleStandardDictationCommandForTesting(.start)

        XCTAssertFalse(recordingStarterCalled)
        XCTAssertFalse(controller.isRecordingForTesting)
    }

    func testLayoutDecodeValidatesKeystrokeAction() throws {
        let json = """
        {
          "initial_page_id": "arrows",
          "pages": [
            {
              "id": "arrows",
              "pads": [
                {
                  "x": 1,
                  "y": 1,
                  "color": { "r": 1, "g": 2, "b": 3 },
                  "action": { "type": "keystroke", "key": "up" }
                }
              ]
            }
          ]
        }
        """.data(using: .utf8)!

        XCTAssertNoThrow(try LaunchpadLayoutLoader.decode(json))
    }

    func testLayoutDecodeAcceptsAppReloadAction() throws {
        let json = """
        {
          "pages": [
            {
              "id": "control",
              "pads": [
                {
                  "x": -1,
                  "y": 7,
                  "color": { "r": 255, "g": 0, "b": 255 },
                  "action": { "type": "app_reload" }
                }
              ]
            }
          ]
        }
        """.data(using: .utf8)!

        XCTAssertNoThrow(try LaunchpadLayoutLoader.decode(json))
    }

    func testLayoutDecodeAcceptsNextWindowAction() throws {
        let json = """
        {
          "pages": [
            {
              "id": "control",
              "pads": [
                {
                  "x": 0,
                  "y": 4,
                  "color": { "r": 40, "g": 140, "b": 255 },
                  "action": { "type": "next_window" }
                }
              ]
            }
          ]
        }
        """.data(using: .utf8)!

        XCTAssertNoThrow(try LaunchpadLayoutLoader.decode(json))
    }

    func testLayoutDecodeAcceptsShiftModifierLatchAction() throws {
        let json = """
        {
          "pages": [
            {
              "id": "control",
              "pads": [
                {
                  "x": 5,
                  "y": 6,
                  "role": "shift_latch",
                  "color": { "r": 255, "g": 220, "b": 0 },
                  "action": { "type": "modifier_latch", "modifier": "shift" }
                }
              ]
            }
          ]
        }
        """.data(using: .utf8)!

        XCTAssertNoThrow(try LaunchpadLayoutLoader.decode(json))
    }

    func testLayoutDecodeAcceptsToggleFullscreenOverlayAction() throws {
        let json = """
        {
          "pages": [
            {
              "id": "control",
              "pads": [
                {
                  "x": 7,
                  "y": 8,
                  "color": { "r": 40, "g": 140, "b": 255 },
                  "action": { "type": "toggle_fullscreen_overlay" }
                }
              ]
            }
          ]
        }
        """.data(using: .utf8)!

        XCTAssertNoThrow(try LaunchpadLayoutLoader.decode(json))
    }

    func testLayoutDecodeAcceptsTalonControlAction() throws {
        let json = """
        {
          "pages": [
            {
              "id": "control",
              "pads": [
                {
                  "x": 1,
                  "y": 7,
                  "role": "talon_status",
                  "color": { "r": 255, "g": 170, "b": 0 },
                  "action": { "type": "talon_control", "command": "toggle" }
                }
              ]
            }
          ]
        }
        """.data(using: .utf8)!

        XCTAssertNoThrow(try LaunchpadLayoutLoader.decode(json))
    }

    func testLayoutDecodeAcceptsAuxiliaryDictationAction() throws {
        let json = """
        {
          "pages": [
            {
              "id": "control",
              "pads": [
                {
                  "x": 0,
                  "y": 6,
                  "color": { "r": 90, "g": 90, "b": 255 },
                  "action": { "type": "auxiliary_dictation", "command": "toggle", "prompt_slot": 1 }
                }
              ]
            }
          ]
        }
        """.data(using: .utf8)!

        XCTAssertNoThrow(try LaunchpadLayoutLoader.decode(json))
    }

    func testLayoutDecodeRejectsMissingKeystrokeKey() {
        let json = """
        {
          "pages": [
            {
              "id": "arrows",
              "pads": [
                {
                  "x": 1,
                  "y": 1,
                  "color": { "r": 1, "g": 2, "b": 3 },
                  "action": { "type": "keystroke" }
                }
              ]
            }
          ]
        }
        """.data(using: .utf8)!

        XCTAssertThrowsError(try LaunchpadLayoutLoader.decode(json))
    }

    func testRenderWorkerSendsOnlyDiffsAfterInitialFrame() {
        let bus = RenderInvalidationBus()
        let provider = FakeColorProvider()
        let transport = FakeTransport()

        let coordinate = PadCoordinate(x: 2, y: 3)
        provider.colors[coordinate] = PadColor(r: 10, g: 20, b: 30)

        let worker = LaunchpadColorRenderWorker(invalidationBus: bus, colorProvider: provider, transport: transport)
        worker.renderNowForTesting(forceAll: true)
        XCTAssertEqual(transport.batches.count, 1)
        XCTAssertEqual(transport.batches[0].count, 64)

        worker.renderNowForTesting(forceAll: false)
        XCTAssertEqual(transport.batches.count, 1)

        let newCoordinate = PadCoordinate(x: 5, y: 5)
        provider.colors[newCoordinate] = PadColor(r: 1, g: 2, b: 3)
        worker.renderNowForTesting(forceAll: false)

        XCTAssertEqual(transport.batches.count, 2)
        XCTAssertEqual(transport.batches[1].count, 1)
        XCTAssertEqual(transport.batches[1][0].coordinate, newCoordinate)
    }

    func testRenderWorkerSendsOffWhenExtendedCoordinateRemoved() {
        let bus = RenderInvalidationBus()
        let provider = VariableCoordinateColorProvider()
        let transport = FakeTransport()
        let worker = LaunchpadColorRenderWorker(invalidationBus: bus, colorProvider: provider, transport: transport)

        let coordinate = PadCoordinate(x: 1, y: 9)
        provider.coordinates = [coordinate]
        provider.colors[coordinate] = PadColor(r: 5, g: 15, b: 25)
        worker.renderNowForTesting(forceAll: false)
        XCTAssertEqual(transport.batches.count, 1)
        XCTAssertEqual(transport.batches[0], [PadColorUpdate(coordinate: coordinate, color: PadColor(r: 5, g: 15, b: 25))])

        provider.coordinates = []
        provider.colors.removeValue(forKey: coordinate)
        worker.renderNowForTesting(forceAll: false)
        XCTAssertEqual(transport.batches.count, 2)
        XCTAssertEqual(transport.batches[1], [PadColorUpdate(coordinate: coordinate, color: .off)])
    }

    func testKeyboardKeyDecodesSpace() throws {
        let json = "\"space\"".data(using: .utf8)!
        let decoded = try JSONDecoder().decode(KeyboardKey.self, from: json)
        XCTAssertEqual(decoded, .space)
    }

    func testKeyboardKeyDecodesFunctionKeys() throws {
        let json = "\"f20\"".data(using: .utf8)!
        let decoded = try JSONDecoder().decode(KeyboardKey.self, from: json)
        XCTAssertEqual(decoded, .f20)
        XCTAssertEqual(KeyboardKey.f13.keyCode, 105)
        XCTAssertEqual(KeyboardKey.f20.keyCode, 90)
    }

    func testDefaultLayoutMapsZeroFourToNextWindowWithBlueColor() throws {
        let config = try loadFixtureLayout()
        guard let arrowsPage = config.pages.first(where: { $0.id == "arrows" }) else {
            XCTFail("Expected arrows page in default layout")
            return
        }

        guard let target = arrowsPage.pads.first(where: { $0.x == 0 && $0.y == 4 }) else {
            XCTFail("Expected pad at (0,4) in arrows page")
            return
        }

        XCTAssertEqual(target.action.type, .nextWindow)
        XCTAssertEqual(target.color.color, PadColor(r: 40, g: 140, b: 255))

        guard let unchangedNeighbor = arrowsPage.pads.first(where: { $0.x == 4 && $0.y == 4 }) else {
            XCTFail("Expected neighbor pad at (4,4) in arrows page")
            return
        }

        XCTAssertEqual(unchangedNeighbor.action.type, .keystroke)
        XCTAssertEqual(unchangedNeighbor.action.key, .c)
        XCTAssertEqual(unchangedNeighbor.action.modifiers, [.command])
        XCTAssertEqual(unchangedNeighbor.color.color, PadColor(r: 50, g: 160, b: 80))
    }

    func testDefaultLayoutMapsZeroFiveAndZeroSixToAuxiliaryDictationPads() throws {
        let config = try loadFixtureLayout()
        guard let arrowsPage = config.pages.first(where: { $0.id == "arrows" }) else {
            XCTFail("Expected arrows page in default layout")
            return
        }

        guard let auxOne = arrowsPage.pads.first(where: { $0.x == 0 && $0.y == 6 }) else {
            XCTFail("Expected pad at (0,6) in arrows page")
            return
        }
        XCTAssertEqual(auxOne.action.type, .auxiliaryDictation)
        XCTAssertEqual(auxOne.action.command, .toggle)
        XCTAssertEqual(auxOne.action.promptSlot, 1)

        guard let auxTwo = arrowsPage.pads.first(where: { $0.x == 0 && $0.y == 5 }) else {
            XCTFail("Expected pad at (0,5) in arrows page")
            return
        }
        XCTAssertEqual(auxTwo.action.type, .auxiliaryDictation)
        XCTAssertEqual(auxTwo.action.command, .toggle)
        XCTAssertEqual(auxTwo.action.promptSlot, 2)
    }

    func testProductLayoutKeepsServiceActionsAndOmitsNativeUIActions() throws {
        let config = try loadProductLayout()
        guard let arrowsPage = config.pages.first(where: { $0.id == "arrows" }) else {
            XCTFail("Expected arrows page in product layout")
            return
        }

        let actionTypes = arrowsPage.pads.map(\.action.type)
        XCTAssertTrue(actionTypes.contains(.dictation))
        XCTAssertTrue(actionTypes.contains(.auxiliaryDictation))
        XCTAssertTrue(actionTypes.contains(.talonControl))
        XCTAssertTrue(actionTypes.contains(.keystroke))
        XCTAssertTrue(actionTypes.contains(.contextualBackspace))
        XCTAssertTrue(actionTypes.contains(.loadSafeRuntimeConfig))
        XCTAssertFalse(actionTypes.contains(.toggleFullscreenOverlay))
        XCTAssertFalse(actionTypes.contains(.nextWindow))
        XCTAssertFalse(actionTypes.contains(.appReload))
    }

    func testSingleColorSysExUpdateExpandsToAllAddressableCoordinates() {
        var cached: [PadCoordinate: PadColor] = [:]
        let target = PadCoordinate(x: 2, y: 3)
        let targetColor = PadColor(r: 17, g: 33, b: 49)
        let incoming = [PadColorUpdate(coordinate: target, color: targetColor)]

        let expanded = LaunchpadMIDIManager.makeSysExUpdates(from: incoming, cachedColors: &cached)

        XCTAssertEqual(expanded.count, LaunchpadMIDIManager.allAddressableCoordinates.count)
        XCTAssertTrue(expanded.contains(PadColorUpdate(coordinate: target, color: targetColor)))
        XCTAssertTrue(expanded.contains(PadColorUpdate(coordinate: PadCoordinate(x: 0, y: 0), color: .off)))
    }

    func testMultiColorSysExUpdateStaysDelta() {
        var cached: [PadCoordinate: PadColor] = [:]
        let incoming = [
            PadColorUpdate(coordinate: PadCoordinate(x: 0, y: 0), color: PadColor(r: 1, g: 2, b: 3)),
            PadColorUpdate(coordinate: PadCoordinate(x: 1, y: 1), color: PadColor(r: 4, g: 5, b: 6))
        ]

        let result = LaunchpadMIDIManager.makeSysExUpdates(from: incoming, cachedColors: &cached)
        XCTAssertEqual(result, incoming)
    }

    func testLaunchpadProfileSelectionPrefersProThenFallsBackToMini() {
        let profiles = LaunchpadTransportProfile.profiles(for: [.proMk3, .miniMk3])

        var selection = LaunchpadTransportProfile.selectPreferredEndpointNames(
            from: profiles,
            sourceNames: [
                "Launchpad Mini MK3 LPMiniMK3 MIDI",
                "Launchpad Pro MK3 LPProMK3 MIDI"
            ],
            destinationNames: [
                "Launchpad Mini MK3 LPMiniMK3 MIDI",
                "Launchpad Pro MK3 LPProMK3 MIDI"
            ]
        )
        XCTAssertEqual(selection?.profile.model, .proMk3)
        XCTAssertEqual(selection?.sourceName, "Launchpad Pro MK3 LPProMK3 MIDI")
        XCTAssertEqual(selection?.destinationName, "Launchpad Pro MK3 LPProMK3 MIDI")

        selection = LaunchpadTransportProfile.selectPreferredEndpointNames(
            from: profiles,
            sourceNames: [
                "Launchpad Mini MK3 LPMiniMK3 MIDI"
            ],
            destinationNames: [
                "Launchpad Mini MK3 LPMiniMK3 MIDI"
            ]
        )
        XCTAssertEqual(selection?.profile.model, .miniMk3)
    }

    func testLaunchpadProfileSelectionRequiresMidiEndpointsAndRejectsDawEndpoints() {
        let profiles = LaunchpadTransportProfile.profiles(for: [.miniMk3])

        let dawOnlySelection = LaunchpadTransportProfile.selectPreferredEndpointNames(
            from: profiles,
            sourceNames: [
                "Launchpad Mini MK3 LPMiniMK3 DAW Out"
            ],
            destinationNames: [
                "Launchpad Mini MK3 LPMiniMK3 DAW In"
            ]
        )
        XCTAssertNil(dawOnlySelection)

        let midiSelection = LaunchpadTransportProfile.selectPreferredEndpointNames(
            from: profiles,
            sourceNames: [
                "Launchpad Mini MK3 LPMiniMK3 DAW",
                "Launchpad Mini MK3 LPMiniMK3 MIDI"
            ],
            destinationNames: [
                "Launchpad Mini MK3 LPMiniMK3 DAW",
                "Launchpad Mini MK3 LPMiniMK3 MIDI"
            ]
        )
        XCTAssertEqual(midiSelection?.sourceName, "Launchpad Mini MK3 LPMiniMK3 MIDI")
        XCTAssertEqual(midiSelection?.destinationName, "Launchpad Mini MK3 LPMiniMK3 MIDI")
    }

    func testLaunchpadProfileSelectionIgnoresOfflinePreferredEndpoints() {
        let profiles = LaunchpadTransportProfile.profiles(for: [.proMk3, .miniMk3])

        let selection = LaunchpadTransportProfile.selectPreferredEndpointCandidates(
            from: profiles,
            sources: [
                LaunchpadTransportProfile.EndpointCandidate(
                    name: "Launchpad Pro MK3 LPProMK3 MIDI",
                    isOnline: false
                ),
                LaunchpadTransportProfile.EndpointCandidate(
                    name: "Launchpad Mini MK3 LPMiniMK3 MIDI Out",
                    isOnline: true
                )
            ],
            destinations: [
                LaunchpadTransportProfile.EndpointCandidate(
                    name: "Launchpad Pro MK3 LPProMK3 MIDI",
                    isOnline: false
                ),
                LaunchpadTransportProfile.EndpointCandidate(
                    name: "Launchpad Mini MK3 LPMiniMK3 MIDI In",
                    isOnline: true
                )
            ]
        )

        XCTAssertEqual(selection?.profile.model, .miniMk3)
        XCTAssertEqual(selection?.sourceName, "Launchpad Mini MK3 LPMiniMK3 MIDI Out")
        XCTAssertEqual(selection?.destinationName, "Launchpad Mini MK3 LPMiniMK3 MIDI In")
    }

    func testLaunchpadProfileSelectionAcceptsCoreMIDIShortNames() {
        let profiles = LaunchpadTransportProfile.profiles(for: [.proMk3, .miniMk3])

        var selection = LaunchpadTransportProfile.selectPreferredEndpointNames(
            from: profiles,
            sourceNames: [
                "LPMiniMK3 MIDI Out",
                "LPProMK3 MIDI"
            ],
            destinationNames: [
                "LPMiniMK3 MIDI In",
                "LPProMK3 MIDI"
            ]
        )

        XCTAssertEqual(selection?.profile.model, .proMk3)
        XCTAssertEqual(selection?.sourceName, "LPProMK3 MIDI")
        XCTAssertEqual(selection?.destinationName, "LPProMK3 MIDI")

        selection = LaunchpadTransportProfile.selectPreferredEndpointNames(
            from: profiles,
            sourceNames: [
                "LPMiniMK3 MIDI Out"
            ],
            destinationNames: [
                "LPMiniMK3 MIDI In"
            ]
        )

        XCTAssertEqual(selection?.profile.model, .miniMk3)
    }

    func testLaunchpadEndpointNameFallsBackToNameWhenDisplayNameMissing() {
        XCTAssertEqual(
            LaunchpadMIDIManager.preferredEndpointName(displayName: nil, name: "Launchpad Pro MK3 LPProMK3 MIDI"),
            "Launchpad Pro MK3 LPProMK3 MIDI"
        )
    }

    func testLaunchpadSysExUsesSelectedProfileModelByte() {
        XCTAssertEqual(
            LaunchpadMIDIManager.makeProgrammerModeSysEx(profile: .proMk3),
            [0xF0, 0x00, 0x20, 0x29, 0x02, 0x0E, 0x0E, 0x01, 0xF7]
        )
        XCTAssertEqual(
            LaunchpadMIDIManager.makeProgrammerModeSysEx(profile: .miniMk3),
            [0xF0, 0x00, 0x20, 0x29, 0x02, 0x0D, 0x0E, 0x01, 0xF7]
        )
        XCTAssertEqual(
            LaunchpadMIDIManager.makeSleepModeSysEx(profile: .proMk3, isAwake: false),
            [0xF0, 0x00, 0x20, 0x29, 0x02, 0x0E, 0x09, 0x00, 0xF7]
        )
        XCTAssertEqual(
            LaunchpadMIDIManager.makeSleepModeSysEx(profile: .miniMk3, isAwake: true),
            [0xF0, 0x00, 0x20, 0x29, 0x02, 0x0D, 0x09, 0x01, 0xF7]
        )
    }

    func testPageFactoryDispatchesToggleFullscreenOverlayAction() throws {
        let bus = RenderInvalidationBus()
        let json = """
        {
          "initial_page_id": "control",
          "pages": [
            {
              "id": "control",
              "pads": [
                {
                  "x": 7,
                  "y": 8,
                  "color": { "r": 40, "g": 140, "b": 255 },
                  "action": { "type": "toggle_fullscreen_overlay" }
                }
              ]
            }
          ]
        }
        """.data(using: .utf8)!
        let config = try LaunchpadLayoutLoader.decode(json)

        var toggleCount = 0
        let factory = LaunchpadPageFactory(
            invalidationBus: bus,
            onKeystroke: nil,
            onDictationCommand: nil,
            onAuxiliaryDictationCommand: nil,
            onTalonControlCommand: nil,
            onContextualBackspace: nil,
            onNextWindowSwitchPress: nil,
            onNextWindowSwitchRelease: nil,
            onAppReload: nil,
            onLoadSafeRuntimeConfig: nil,
            onToggleFullscreenOverlay: {
                toggleCount += 1
            },
            recordStatusColorProvider: { .off },
            talonStatusColorProvider: { .off },
            shiftLatchColorProvider: { .off },
            onModifierPress: nil,
            onModifierRelease: nil
        )
        let pages = factory.makePages(from: config)
        let pageController = LaunchpadPageController(invalidationBus: bus)
        pageController.setPages(pages, initialPageID: config.initialPageID)

        pageController.handle(PadEvent(coordinate: PadCoordinate(x: 7, y: 8), phase: .press, velocity: 100))
        XCTAssertEqual(toggleCount, 1)
    }

    func testPageFactoryDispatchesTalonControlAction() throws {
        let bus = RenderInvalidationBus()
        let json = """
        {
          "initial_page_id": "control",
          "pages": [
            {
              "id": "control",
              "pads": [
                {
                  "x": 1,
                  "y": 7,
                  "role": "talon_status",
                  "color": { "r": 255, "g": 170, "b": 0 },
                  "action": { "type": "talon_control", "command": "toggle" }
                }
              ]
            }
          ]
        }
        """.data(using: .utf8)!
        let config = try LaunchpadLayoutLoader.decode(json)

        var commands: [LaunchpadActionConfig.DictationCommand] = []
        let factory = LaunchpadPageFactory(
            invalidationBus: bus,
            onKeystroke: nil,
            onDictationCommand: nil,
            onAuxiliaryDictationCommand: nil,
            onTalonControlCommand: { commands.append($0) },
            onContextualBackspace: nil,
            onNextWindowSwitchPress: nil,
            onNextWindowSwitchRelease: nil,
            onAppReload: nil,
            onLoadSafeRuntimeConfig: nil,
            onToggleFullscreenOverlay: nil,
            recordStatusColorProvider: { .off },
            talonStatusColorProvider: { PadColor(r: 0, g: 255, b: 0) },
            shiftLatchColorProvider: { .off },
            onModifierPress: nil,
            onModifierRelease: nil
        )
        let pages = factory.makePages(from: config)
        let pageController = LaunchpadPageController(invalidationBus: bus)
        pageController.setPages(pages, initialPageID: config.initialPageID)

        pageController.handle(PadEvent(coordinate: PadCoordinate(x: 1, y: 7), phase: .press, velocity: 100))
        XCTAssertEqual(commands, [.toggle])
        XCTAssertEqual(pageController.getColor(at: PadCoordinate(x: 1, y: 7)), PadColor(r: 0, g: 255, b: 0))
    }

    func testPageFactoryDispatchesAuxiliaryDictationAction() throws {
        let bus = RenderInvalidationBus()
        let json = """
        {
          "initial_page_id": "control",
          "pages": [
            {
              "id": "control",
              "pads": [
                {
                  "x": 0,
                  "y": 5,
                  "color": { "r": 90, "g": 90, "b": 255 },
                  "action": { "type": "auxiliary_dictation", "command": "toggle", "prompt_slot": 2 }
                }
              ]
            }
          ]
        }
        """.data(using: .utf8)!
        let config = try LaunchpadLayoutLoader.decode(json)

        var dispatched: [(Int, LaunchpadActionConfig.DictationCommand)] = []
        let factory = LaunchpadPageFactory(
            invalidationBus: bus,
            onKeystroke: nil,
            onDictationCommand: nil,
            onAuxiliaryDictationCommand: { dispatched.append(($0, $1)) },
            onTalonControlCommand: nil,
            onContextualBackspace: nil,
            onNextWindowSwitchPress: nil,
            onNextWindowSwitchRelease: nil,
            onAppReload: nil,
            onLoadSafeRuntimeConfig: nil,
            onToggleFullscreenOverlay: nil,
            recordStatusColorProvider: { .off },
            talonStatusColorProvider: { .off },
            shiftLatchColorProvider: { .off },
            onModifierPress: nil,
            onModifierRelease: nil
        )
        let pages = factory.makePages(from: config)
        let pageController = LaunchpadPageController(invalidationBus: bus)
        pageController.setPages(pages, initialPageID: config.initialPageID)

        pageController.handle(PadEvent(coordinate: PadCoordinate(x: 0, y: 5), phase: .press, velocity: 100))
        XCTAssertEqual(dispatched.count, 1)
        XCTAssertEqual(dispatched.first?.0, 2)
        XCTAssertEqual(dispatched.first?.1, .toggle)
    }

    func testPageFactoryRendersRecordStatusOffWhenRecordActionUnavailable() throws {
        let bus = RenderInvalidationBus()
        let json = """
        {
          "initial_page_id": "control",
          "pages": [
            {
              "id": "control",
              "pads": [
                {
                  "x": 0,
                  "y": 7,
                  "role": "record_status",
                  "color": { "r": 255, "g": 255, "b": 255 },
                  "action": { "type": "dictation", "command": "toggle" }
                }
              ]
            }
          ]
        }
        """.data(using: .utf8)!
        let config = try LaunchpadLayoutLoader.decode(json)

        var commands: [LaunchpadActionConfig.DictationCommand] = []
        let factory = LaunchpadPageFactory(
            invalidationBus: bus,
            onKeystroke: nil,
            onDictationCommand: { commands.append($0) },
            onAuxiliaryDictationCommand: nil,
            onTalonControlCommand: nil,
            onContextualBackspace: nil,
            onNextWindowSwitchPress: nil,
            onNextWindowSwitchRelease: nil,
            onAppReload: nil,
            onLoadSafeRuntimeConfig: nil,
            onToggleFullscreenOverlay: nil,
            recordStatusColorProvider: { PadColor(r: 255, g: 255, b: 255) },
            recordActionEnabledProvider: { false },
            talonStatusColorProvider: { .off },
            shiftLatchColorProvider: { .off },
            onModifierPress: nil,
            onModifierRelease: nil
        )
        let pages = factory.makePages(from: config)
        let pageController = LaunchpadPageController(invalidationBus: bus)
        pageController.setPages(pages, initialPageID: config.initialPageID)

        let recordPad = PadCoordinate(x: 0, y: 7)
        XCTAssertEqual(pageController.getColor(at: recordPad), .off)

        pageController.handle(PadEvent(coordinate: recordPad, phase: .press, velocity: 100))
        XCTAssertEqual(commands, [.toggle])
    }

    func testPageFactoryRestoresRecordStatusColorAndDispatchWhenRecordActionBecomesAvailable() throws {
        let bus = RenderInvalidationBus()
        let json = """
        {
          "initial_page_id": "control",
          "pages": [
            {
              "id": "control",
              "pads": [
                {
                  "x": 0,
                  "y": 7,
                  "role": "record_status",
                  "color": { "r": 255, "g": 255, "b": 255 },
                  "action": { "type": "dictation", "command": "toggle" }
                }
              ]
            }
          ]
        }
        """.data(using: .utf8)!
        let config = try LaunchpadLayoutLoader.decode(json)

        var isAvailable = false
        var commands: [LaunchpadActionConfig.DictationCommand] = []
        let factory = LaunchpadPageFactory(
            invalidationBus: bus,
            onKeystroke: nil,
            onDictationCommand: { commands.append($0) },
            onAuxiliaryDictationCommand: nil,
            onTalonControlCommand: nil,
            onContextualBackspace: nil,
            onNextWindowSwitchPress: nil,
            onNextWindowSwitchRelease: nil,
            onAppReload: nil,
            onLoadSafeRuntimeConfig: nil,
            onToggleFullscreenOverlay: nil,
            recordStatusColorProvider: { PadColor(r: 255, g: 255, b: 255) },
            recordActionEnabledProvider: { isAvailable },
            talonStatusColorProvider: { .off },
            shiftLatchColorProvider: { .off },
            onModifierPress: nil,
            onModifierRelease: nil
        )
        let pages = factory.makePages(from: config)
        let pageController = LaunchpadPageController(invalidationBus: bus)
        pageController.setPages(pages, initialPageID: config.initialPageID)

        let recordPad = PadCoordinate(x: 0, y: 7)
        XCTAssertEqual(pageController.getColor(at: recordPad), .off)

        isAvailable = true
        XCTAssertEqual(pageController.getColor(at: recordPad), PadColor(r: 255, g: 255, b: 255))

        pageController.handle(PadEvent(coordinate: recordPad, phase: .press, velocity: 100))
        XCTAssertEqual(commands, [.toggle])
    }

    func testPageFactoryDispatchesNextWindowPressAndReleaseActions() throws {
        let bus = RenderInvalidationBus()
        let json = """
        {
          "initial_page_id": "control",
          "pages": [
            {
              "id": "control",
              "pads": [
                {
                  "x": 0,
                  "y": 4,
                  "color": { "r": 40, "g": 140, "b": 255 },
                  "action": { "type": "next_window" }
                }
              ]
            }
          ]
        }
        """.data(using: .utf8)!
        let config = try LaunchpadLayoutLoader.decode(json)

        var switchPressCount = 0
        var switchReleaseCount = 0
        let factory = LaunchpadPageFactory(
            invalidationBus: bus,
            onKeystroke: nil,
            onDictationCommand: nil,
            onAuxiliaryDictationCommand: nil,
            onTalonControlCommand: nil,
            onContextualBackspace: nil,
            onNextWindowSwitchPress: {
                switchPressCount += 1
            },
            onNextWindowSwitchRelease: {
                switchReleaseCount += 1
            },
            onAppReload: nil,
            onLoadSafeRuntimeConfig: nil,
            onToggleFullscreenOverlay: nil,
            recordStatusColorProvider: { .off },
            talonStatusColorProvider: { .off },
            shiftLatchColorProvider: { .off },
            onModifierPress: nil,
            onModifierRelease: nil
        )
        let pages = factory.makePages(from: config)
        let pageController = LaunchpadPageController(invalidationBus: bus)
        pageController.setPages(pages, initialPageID: config.initialPageID)

        pageController.handle(PadEvent(coordinate: PadCoordinate(x: 0, y: 4), phase: .press, velocity: 100))
        pageController.handle(PadEvent(coordinate: PadCoordinate(x: 0, y: 4), phase: .release, velocity: 0))
        XCTAssertEqual(switchPressCount, 1)
        XCTAssertEqual(switchReleaseCount, 1)
    }

    func testAppCycleStateUsesFrozenOrderForSession() {
        var candidates: [pid_t] = [11, 22, 33]
        var state = LaunchpadAppCycleState()

        XCTAssertTrue(state.start(with: candidates, currentPID: 22))
        candidates.append(44)

        XCTAssertEqual(state.step(.forward), 33)
        XCTAssertEqual(state.step(.forward), 11)
        XCTAssertEqual(state.step(.forward), 22)
    }

    func testAppCycleStateSupportsBackwardWraparound() {
        var state = LaunchpadAppCycleState()
        XCTAssertTrue(state.start(with: [11, 22, 33], currentPID: 22))

        XCTAssertEqual(state.step(.backward), 11)
        XCTAssertEqual(state.step(.backward), 33)
        XCTAssertEqual(state.step(.forward), 11)
    }

    func testAppCycleStateStopsAndIgnoresFurtherSteps() {
        var state = LaunchpadAppCycleState()
        XCTAssertTrue(state.start(with: [11, 22], currentPID: 11))
        XCTAssertNotNil(state.step(.forward))

        state.stop()

        XCTAssertFalse(state.isActive)
        XCTAssertEqual(state.candidateCount, 0)
        XCTAssertNil(state.step(.forward))
    }

    func testPageControllerControlLayerSlotAddRemove() {
        let bus = RenderInvalidationBus()
        let pageController = LaunchpadPageController(invalidationBus: bus)
        let layer = FakeControlLayer()

        pageController.setControlLayer(layer, forSlot: "overlay.tabs")
        XCTAssertEqual(pageController.activeControlLayerSlotIDs(), ["overlay.tabs"])
        XCTAssertEqual(pageController.getColor(at: PadCoordinate(x: 1, y: 9)), layer.color)

        pageController.handle(PadEvent(coordinate: PadCoordinate(x: 1, y: 9), phase: .press, velocity: 100))
        XCTAssertEqual(layer.handleCount, 1)

        pageController.removeControlLayer(forSlot: "overlay.tabs")
        XCTAssertTrue(pageController.activeControlLayerSlotIDs().isEmpty)
        XCTAssertEqual(pageController.getColor(at: PadCoordinate(x: 1, y: 9)), .off)

        pageController.handle(PadEvent(coordinate: PadCoordinate(x: 1, y: 9), phase: .press, velocity: 100))
        XCTAssertEqual(layer.handleCount, 1)
    }

    func testExternalLaunchpadLayerRendersOwnedCellAndConsumesPressRelease() throws {
        let service = DictatorRPCService()
        var sent: [DictatorRPCEnvelope] = []
        let sessionID = service.registerClient(clientID: "sheaf-chat:test") { text in
            if let data = text.data(using: .utf8),
               let envelope = try? JSONDecoder().decode(DictatorRPCEnvelope.self, from: data) {
                sent.append(envelope)
            }
        }
        sent.removeAll()

        let request = """
        {"id":"set","method":"launchpad.setCells","params":{"cells":[{"x":3,"y":3,"r":12,"g":34,"b":56}]}}
        """
        let response = try XCTUnwrap(service.handleTextFrame(request, sessionID: sessionID))
        let envelope = try JSONDecoder().decode(DictatorRPCEnvelope.self, from: Data(response.utf8))
        XCTAssertEqual(envelope.id, "set")
        XCTAssertEqual(envelope.result, .object(["ok": .bool(true)]))

        let layer = ExternalLaunchpadControlLayer(rpcService: service)
        let coordinate = PadCoordinate(x: 3, y: 3)
        XCTAssertEqual(layer.getColor(at: coordinate), PadColor(r: 12, g: 34, b: 56))
        XCTAssertEqual(layer.allCoordinatesForRendering(), [coordinate])

        XCTAssertTrue(layer.handle(PadEvent(coordinate: coordinate, phase: .press, velocity: 100)))
        XCTAssertTrue(layer.handle(PadEvent(coordinate: coordinate, phase: .release, velocity: 0)))
        XCTAssertEqual(sent.map(\.method), ["launchpad.cellPressed", "launchpad.cellReleased"])
        XCTAssertEqual(sent.first?.params?.objectValue?["x"], .number(3))
        XCTAssertEqual(sent.first?.params?.objectValue?["y"], .number(3))
        XCTAssertEqual(sent.first?.id, nil)
    }

    func testExternalLaunchpadOwnershipCleanupReturnsCellToNormalBehavior() throws {
        let service = DictatorRPCService()
        let sessionID = service.registerClient(clientID: "sheaf-chat:test") { _ in }
        _ = service.handleTextFrame(
            #"{"id":"set","method":"launchpad.setCells","params":{"cells":[{"x":3,"y":3,"off":true}]}}"#,
            sessionID: sessionID
        )

        let layer = ExternalLaunchpadControlLayer(rpcService: service)
        let coordinate = PadCoordinate(x: 3, y: 3)
        XCTAssertEqual(layer.getColor(at: coordinate), .off)
        XCTAssertTrue(layer.handle(PadEvent(coordinate: coordinate, phase: .press, velocity: 100)))

        service.unregisterClient(sessionID: sessionID)
        XCTAssertNil(layer.getColor(at: coordinate))
        XCTAssertFalse(layer.handle(PadEvent(coordinate: coordinate, phase: .press, velocity: 100)))
    }

    func testInteractionBufferEvictsOldestWhenTrackedBytesExceedLimit() {
        let buffer = DictationInteractionBuffer(maxBytes: 20)
        let first = makeInteraction(whisperOutput: "aaaaaa", finalOutput: "bbbbbb")
        let second = makeInteraction(whisperOutput: "cccccc", finalOutput: "dddddd")

        buffer.append(first)
        buffer.append(second)

        let kept = buffer.snapshot()
        XCTAssertEqual(kept.map(\.id), [second.id])
        XCTAssertEqual(buffer.currentTrackedBytes(), second.trackedSizeBytes)
    }

    func testLaunchpadCellRepeatsWhileHeld() {
        let bus = RenderInvalidationBus()
        let exp = expectation(description: "repeats")
        exp.expectedFulfillmentCount = 2

        let lock = NSLock()
        var repeatCount = 0

        let cell = LaunchpadCell(
            baseColor: PadColor(r: 100, g: 100, b: 100),
            invalidationBus: bus,
            onRepeat: {
                lock.lock()
                repeatCount += 1
                let current = repeatCount
                lock.unlock()
                if current <= 2 {
                    exp.fulfill()
                }
            },
            repeatBehavior: LaunchpadCell.RepeatBehavior(initialDelay: 0.02, repeatInterval: 0.02)
        )

        cell.onPress(velocity: 127)
        wait(for: [exp], timeout: 0.3)
        cell.onRelease()

        let countAfterRelease: Int = {
            lock.lock()
            defer { lock.unlock() }
            return repeatCount
        }()

        usleep(80_000)

        let finalCount: Int = {
            lock.lock()
            defer { lock.unlock() }
            return repeatCount
        }()
        XCTAssertEqual(finalCount, countAfterRelease)
    }
}

private func makeLaunchpadRuntimeConfigProvider(
    tempDir: URL,
    audioInput: String?
) async throws -> RuntimeConfigProvider {
    let configURL = tempDir.appendingPathComponent("dictator.json")
    let safeConfigURL = tempDir.appendingPathComponent("dictator.safe.json")
    let defaults = RuntimeConfigFile.bootstrap()
    try RuntimeConfigStore(fileURL: safeConfigURL).save(defaults)
    try RuntimeConfigStore(fileURL: configURL).save(defaults)
    let provider = RuntimeConfigProvider(
        store: RuntimeConfigStore(fileURL: configURL),
        defaultStore: RuntimeConfigStore(fileURL: safeConfigURL)
    )
    _ = try await provider.applyInMemoryPatch(RuntimeConfigPatch(audioInput: audioInput))
    return provider
}

@MainActor
private func makeLaunchpadController(
    tempDir: URL,
    provider: RuntimeConfigProvider,
    resolver: AudioInputResolving,
    recorder: AudioRecorder
) -> LaunchpadServiceController {
    let interactionStore = InteractionHistoryStore(
        buffer: DictationInteractionBuffer(maxBytes: 1024 * 1024),
        dataDirectoryURL: tempDir.appendingPathComponent("interactions", isDirectory: true),
        initialLoadBytes: 1024 * 1024
    )
    return LaunchpadServiceController(
        repoRoot: tempDir,
        runtimeConfigProvider: provider,
        secretStore: APIKeysStore(fileURL: tempDir.appendingPathComponent("api_keys.json")),
        sttEngine: LaunchpadTestSTTEngine(),
        coreClient: LaunchpadTestCoreClient(),
        interactionStore: interactionStore,
        activityTracker: DictationActivityTracker(),
        talonControl: LaunchpadTestTalonControl(),
        rpcService: DictatorRPCService(),
        audioInputResolver: resolver,
        audioRecorder: recorder
    )
}

private struct LaunchpadTestSTTEngine: STTEngine {
    func transcribe(_ request: TranscribeRequest) async throws -> TranscribeResponse {
        TranscribeResponse(raw_transcript: "", segments: [], confidence: 0, duration_ms: 0)
    }
}

private actor LaunchpadTestCoreClient: DictatorCoreClient {
    func transcribe(_ request: TranscribeRequest) async throws -> TranscribeResponse {
        TranscribeResponse(raw_transcript: "", segments: [], confidence: 0, duration_ms: 0)
    }

    func refine(_ request: RefineRequest) async throws -> RefineResponse {
        RefineResponse(revised_text: "", edit_summary: "", uncertainty_flags: [])
    }

    func dictate(_ request: DictateRequest) async throws -> DictateCallResult {
        DictateCallResult(
            response: DictateResponse(
                raw_transcript: "",
                revised_text: "",
                edit_summary: "",
                uncertainty_flags: []
            ),
            transcribeMs: 0,
            refineMs: 0
        )
    }

    func interactForRuntimeConfig(_ request: VoiceConfigInteractionRequest) async throws -> VoiceConfigInteractionResult {
        throw DictatorError.configInteractionUnavailable
    }
}

private actor LaunchpadTestTalonControl: TalonControlProviding {
    func status() async -> TalonControlStatus {
        TalonControlStatus(state: .asleep, speechEnabled: false, modes: [])
    }

    @discardableResult func sleep() async -> TalonControlStatus {
        TalonControlStatus(state: .asleep, speechEnabled: false, modes: [])
    }

    @discardableResult func wake() async -> TalonControlStatus {
        TalonControlStatus(state: .awake, speechEnabled: true, modes: [])
    }
}

private final class FakeColorProvider: ColorProvider {
    var colors: [PadCoordinate: PadColor] = [:]

    func getColor(at coordinate: PadCoordinate) -> PadColor {
        colors[coordinate] ?? .off
    }
}

private final class FakeTransport: LaunchpadTransport {
    var isConnected: Bool = true
    var batches: [[PadColorUpdate]] = []

    func sendBatchPadColors(_ updates: [PadColorUpdate]) {
        batches.append(updates)
    }

    func clear() {}

    func setProgrammerModeIfNeeded() {}
}

private final class VariableCoordinateColorProvider: ColorProvider {
    var coordinates: [PadCoordinate] = []
    var colors: [PadCoordinate: PadColor] = [:]

    func getColor(at coordinate: PadCoordinate) -> PadColor {
        colors[coordinate] ?? .off
    }

    func allCoordinatesForRendering() -> [PadCoordinate] {
        coordinates
    }
}

private final class FakeControlLayer: LaunchpadControlLayer {
    let color = PadColor(r: 10, g: 20, b: 30)
    var handleCount = 0

    func handle(_ event: PadEvent) -> Bool {
        if event.coordinate == PadCoordinate(x: 1, y: 9) {
            handleCount += 1
            return true
        }
        return false
    }

    func getColor(at coordinate: PadCoordinate) -> PadColor? {
        coordinate == PadCoordinate(x: 1, y: 9) ? color : nil
    }

    func allCoordinatesForRendering() -> [PadCoordinate] {
        [PadCoordinate(x: 1, y: 9)]
    }
}

private func makeInteraction(
    whisperOutput: String = "raw",
    finalOutput: String = "final"
) -> DictationInteraction {
    DictationInteraction(
        whisperOutput: whisperOutput,
        finalOutput: finalOutput,
        mode: .revision,
        systemPromptPath: "intent_refiner_v1.md",
        systemPromptBody: "prompt-body",
        model: "qwen2.5:7b-instruct",
        provider: "ollama",
        optionalContext: [:],
        editSummary: "summary",
        uncertaintyFlags: [],
        timings: DictationInteractionTimings(
            transcribeMs: 1,
            refineMs: 2,
            insertMs: 3,
            totalPipelineMs: 6
        )
    )
}
