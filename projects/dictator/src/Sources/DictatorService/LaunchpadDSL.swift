import Foundation

struct LaunchpadLayoutConfig: Decodable {
    let initialPageID: String?
    let pages: [LaunchpadPageConfig]

    enum CodingKeys: String, CodingKey {
        case initialPageID = "initial_page_id"
        case pages
    }
}

struct LaunchpadPageConfig: Decodable {
    let id: String
    let pads: [LaunchpadPadConfig]
}

struct LaunchpadPadConfig: Decodable {
    enum Role: String, Decodable {
        case recordStatus = "record_status"
        case shiftLatch = "shift_latch"
    }

    let x: Int
    let y: Int
    let color: LaunchpadColorConfig
    let action: LaunchpadActionConfig
    let role: Role?
}

struct LaunchpadColorConfig: Decodable {
    let r: UInt8
    let g: UInt8
    let b: UInt8

    var color: PadColor {
        PadColor(r: r, g: g, b: b)
    }
}

struct LaunchpadActionConfig: Decodable {
    enum ActionType: String, Decodable {
        case keystroke
        case dictation
        case auxiliaryDictation = "auxiliary_dictation"
        case talonLiteDictation = "talon_lite_dictation"
        case contextualBackspace = "contextual_backspace"
        case nextWindow = "next_window"
        case appReload = "app_reload"
        case modifierLatch = "modifier_latch"
        case loadSafeRuntimeConfig = "load_safe_runtime_config"
        case toggleFullscreenOverlay = "toggle_fullscreen_overlay"
    }

    enum DictationCommand: String, Decodable {
        case start
        case stop
        case cancel
        case toggle
    }

    enum ModifierType: String, Decodable {
        case shift
    }

    let type: ActionType
    let key: KeyboardKey?
    let command: DictationCommand?
    let promptSlot: Int?
    let modifier: ModifierType?
    let modifiers: [KeyboardModifier]?

    enum CodingKeys: String, CodingKey {
        case type
        case key
        case command
        case promptSlot = "prompt_slot"
        case modifier
        case modifiers
    }
}

enum LaunchpadLayoutLoader {
    static let defaultSearchPaths: [String] = {
        let current = FileManager.default.currentDirectoryPath
        let sourceDirectory = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .path

        return [
            "\(current)/Config/launchpad-layout.json",
            "\(current)/apps/dictator-main/Config/launchpad-layout.json",
            "\(sourceDirectory)/Config/launchpad-layout.json"
        ]
    }()

    static func loadDefault() throws -> LaunchpadLayoutConfig {
        for path in defaultSearchPaths {
            if FileManager.default.fileExists(atPath: path) {
                let data = try Data(contentsOf: URL(fileURLWithPath: path))
                return try decode(data)
            }
        }

        throw NSError(
            domain: "LaunchpadLayoutLoader",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "launchpad-layout.json not found in expected locations"]
        )
    }

    static func decode(_ data: Data) throws -> LaunchpadLayoutConfig {
        let decoder = JSONDecoder()
        let config = try decoder.decode(LaunchpadLayoutConfig.self, from: data)
        try validate(config)
        return config
    }

    static func validate(_ config: LaunchpadLayoutConfig) throws {
        guard !config.pages.isEmpty else {
            throw NSError(domain: "LaunchpadLayoutLoader", code: 2, userInfo: [NSLocalizedDescriptionKey: "At least one page is required"])
        }

        for page in config.pages {
            guard !page.id.isEmpty else {
                throw NSError(domain: "LaunchpadLayoutLoader", code: 3, userInfo: [NSLocalizedDescriptionKey: "Page id cannot be empty"])
            }

            for pad in page.pads {
                let coordinate = PadCoordinate(x: pad.x, y: pad.y)
                guard coordinate.isLaunchpadProMk3Addressable else {
                    throw NSError(
                        domain: "LaunchpadLayoutLoader",
                        code: 4,
                        userInfo: [NSLocalizedDescriptionKey: "Invalid pad coordinate (\(pad.x),\(pad.y)) on page \(page.id)"]
                    )
                }

                switch pad.action.type {
                case .keystroke:
                    guard pad.action.key != nil else {
                        throw NSError(
                            domain: "LaunchpadLayoutLoader",
                            code: 5,
                            userInfo: [NSLocalizedDescriptionKey: "Keystroke action missing key at (\(pad.x),\(pad.y)) page \(page.id)"]
                        )
                    }
                case .dictation:
                    guard pad.action.command != nil else {
                        throw NSError(
                            domain: "LaunchpadLayoutLoader",
                            code: 6,
                            userInfo: [NSLocalizedDescriptionKey: "Dictation action missing command at (\(pad.x),\(pad.y)) page \(page.id)"]
                        )
                    }
                case .auxiliaryDictation:
                    guard pad.action.command != nil else {
                        throw NSError(
                            domain: "LaunchpadLayoutLoader",
                            code: 9,
                            userInfo: [NSLocalizedDescriptionKey: "Auxiliary dictation action missing command at (\(pad.x),\(pad.y)) page \(page.id)"]
                        )
                    }
                    guard let promptSlot = pad.action.promptSlot, [1, 2].contains(promptSlot) else {
                        throw NSError(
                            domain: "LaunchpadLayoutLoader",
                            code: 10,
                            userInfo: [NSLocalizedDescriptionKey: "Auxiliary dictation action missing valid prompt_slot at (\(pad.x),\(pad.y)) page \(page.id)"]
                        )
                    }
                case .talonLiteDictation:
                    guard pad.action.command != nil else {
                        throw NSError(
                            domain: "LaunchpadLayoutLoader",
                            code: 8,
                            userInfo: [NSLocalizedDescriptionKey: "Talon-lite dictation action missing command at (\(pad.x),\(pad.y)) page \(page.id)"]
                        )
                    }
                case .contextualBackspace:
                    break
                case .nextWindow:
                    break
                case .appReload:
                    break
                case .loadSafeRuntimeConfig:
                    break
                case .toggleFullscreenOverlay:
                    break
                case .modifierLatch:
                    guard pad.action.modifier != nil else {
                        throw NSError(
                            domain: "LaunchpadLayoutLoader",
                            code: 7,
                            userInfo: [NSLocalizedDescriptionKey: "Modifier latch missing modifier at (\(pad.x),\(pad.y)) page \(page.id)"]
                        )
                    }
                }
            }
        }
    }
}

final class LaunchpadPageFactory {
    static let defaultKeyRepeatInitialDelay: TimeInterval = 0.30
    static let defaultKeyRepeatInterval: TimeInterval = 0.05

    private let invalidationBus: RenderInvalidationBus
    private let onKeystroke: ((KeyboardKey, Set<KeyboardModifier>) -> Void)?
    private let onDictationCommand: ((LaunchpadActionConfig.DictationCommand) -> Void)?
    private let onAuxiliaryDictationCommand: ((Int, LaunchpadActionConfig.DictationCommand) -> Void)?
    private let onTalonLiteDictationCommand: ((LaunchpadActionConfig.DictationCommand) -> Void)?
    private let onContextualBackspace: (() -> Void)?
    private let onNextWindowSwitchPress: (() -> Void)?
    private let onNextWindowSwitchRelease: (() -> Void)?
    private let onAppReload: (() -> Void)?
    private let onLoadSafeRuntimeConfig: (() -> Void)?
    private let onToggleFullscreenOverlay: (() -> Void)?
    private let recordStatusColorProvider: () -> PadColor
    private let shiftLatchColorProvider: () -> PadColor
    private let onModifierPress: ((LaunchpadActionConfig.ModifierType) -> Void)?
    private let onModifierRelease: ((LaunchpadActionConfig.ModifierType) -> Void)?

    init(
        invalidationBus: RenderInvalidationBus,
        onKeystroke: ((KeyboardKey, Set<KeyboardModifier>) -> Void)?,
        onDictationCommand: ((LaunchpadActionConfig.DictationCommand) -> Void)?,
        onAuxiliaryDictationCommand: ((Int, LaunchpadActionConfig.DictationCommand) -> Void)?,
        onTalonLiteDictationCommand: ((LaunchpadActionConfig.DictationCommand) -> Void)?,
        onContextualBackspace: (() -> Void)?,
        onNextWindowSwitchPress: (() -> Void)?,
        onNextWindowSwitchRelease: (() -> Void)?,
        onAppReload: (() -> Void)?,
        onLoadSafeRuntimeConfig: (() -> Void)?,
        onToggleFullscreenOverlay: (() -> Void)?,
        recordStatusColorProvider: @escaping () -> PadColor,
        shiftLatchColorProvider: @escaping () -> PadColor,
        onModifierPress: ((LaunchpadActionConfig.ModifierType) -> Void)?,
        onModifierRelease: ((LaunchpadActionConfig.ModifierType) -> Void)?
    ) {
        self.invalidationBus = invalidationBus
        self.onKeystroke = onKeystroke
        self.onDictationCommand = onDictationCommand
        self.onAuxiliaryDictationCommand = onAuxiliaryDictationCommand
        self.onTalonLiteDictationCommand = onTalonLiteDictationCommand
        self.onContextualBackspace = onContextualBackspace
        self.onNextWindowSwitchPress = onNextWindowSwitchPress
        self.onNextWindowSwitchRelease = onNextWindowSwitchRelease
        self.onAppReload = onAppReload
        self.onLoadSafeRuntimeConfig = onLoadSafeRuntimeConfig
        self.onToggleFullscreenOverlay = onToggleFullscreenOverlay
        self.recordStatusColorProvider = recordStatusColorProvider
        self.shiftLatchColorProvider = shiftLatchColorProvider
        self.onModifierPress = onModifierPress
        self.onModifierRelease = onModifierRelease
    }

    func makePages(from config: LaunchpadLayoutConfig) -> [LaunchpadPage] {
        let onKeystroke = self.onKeystroke
        let onDictationCommand = self.onDictationCommand
        let onAuxiliaryDictationCommand = self.onAuxiliaryDictationCommand
        let onTalonLiteDictationCommand = self.onTalonLiteDictationCommand
        let onContextualBackspace = self.onContextualBackspace
        let onNextWindowSwitchPress = self.onNextWindowSwitchPress
        let onNextWindowSwitchRelease = self.onNextWindowSwitchRelease
        let onAppReload = self.onAppReload
        let onLoadSafeRuntimeConfig = self.onLoadSafeRuntimeConfig
        let onToggleFullscreenOverlay = self.onToggleFullscreenOverlay
        let recordStatusColorProvider = self.recordStatusColorProvider
        let shiftLatchColorProvider = self.shiftLatchColorProvider
        let onModifierPress = self.onModifierPress
        let onModifierRelease = self.onModifierRelease

        func runAction(_ padConfig: LaunchpadPadConfig, pageID: String) {
            switch padConfig.action.type {
            case .keystroke:
                if let key = padConfig.action.key {
                    TraceLogger.log(
                        "launchpad action keystroke page=\(pageID) x=\(padConfig.x) y=\(padConfig.y) key=\(key.rawValue) modifiers=\(padConfig.action.modifiers ?? [])"
                    )
                    onKeystroke?(key, Set(padConfig.action.modifiers ?? []))
                } else {
                    TraceLogger.log(
                        "launchpad action missing keystroke key page=\(pageID) x=\(padConfig.x) y=\(padConfig.y)"
                    )
                }
            case .dictation:
                if let command = padConfig.action.command {
                    TraceLogger.log(
                        "launchpad action dictation page=\(pageID) x=\(padConfig.x) y=\(padConfig.y) command=\(command.rawValue)"
                    )
                    onDictationCommand?(command)
                } else {
                    TraceLogger.log(
                        "launchpad action missing dictation command page=\(pageID) x=\(padConfig.x) y=\(padConfig.y)"
                    )
                }
            case .auxiliaryDictation:
                if let command = padConfig.action.command, let promptSlot = padConfig.action.promptSlot {
                    TraceLogger.log(
                        "launchpad action auxiliary_dictation page=\(pageID) x=\(padConfig.x) y=\(padConfig.y) command=\(command.rawValue) prompt_slot=\(promptSlot)"
                    )
                    onAuxiliaryDictationCommand?(promptSlot, command)
                } else {
                    TraceLogger.log(
                        "launchpad action missing auxiliary_dictation fields page=\(pageID) x=\(padConfig.x) y=\(padConfig.y)"
                    )
                }
            case .talonLiteDictation:
                if let command = padConfig.action.command {
                    TraceLogger.log(
                        "launchpad action talon_lite_dictation page=\(pageID) x=\(padConfig.x) y=\(padConfig.y) command=\(command.rawValue)"
                    )
                    onTalonLiteDictationCommand?(command)
                } else {
                    TraceLogger.log(
                        "launchpad action missing talon_lite_dictation command page=\(pageID) x=\(padConfig.x) y=\(padConfig.y)"
                    )
                }
            case .contextualBackspace:
                TraceLogger.log(
                    "launchpad action contextual_backspace page=\(pageID) x=\(padConfig.x) y=\(padConfig.y)"
                )
                onContextualBackspace?()
            case .nextWindow:
                TraceLogger.log(
                    "launchpad action next_window_press page=\(pageID) x=\(padConfig.x) y=\(padConfig.y)"
                )
                onNextWindowSwitchPress?()
            case .appReload:
                TraceLogger.log(
                    "launchpad action app_reload page=\(pageID) x=\(padConfig.x) y=\(padConfig.y)"
                )
                onAppReload?()
            case .loadSafeRuntimeConfig:
                TraceLogger.log(
                    "launchpad action load_safe_runtime_config page=\(pageID) x=\(padConfig.x) y=\(padConfig.y)"
                )
                onLoadSafeRuntimeConfig?()
            case .toggleFullscreenOverlay:
                TraceLogger.log(
                    "launchpad action toggle_fullscreen_overlay page=\(pageID) x=\(padConfig.x) y=\(padConfig.y)"
                )
                onToggleFullscreenOverlay?()
            case .modifierLatch:
                break
            }
        }

        return config.pages.map { pageConfig in
            let page = LaunchpadPage(id: pageConfig.id)
            for padConfig in pageConfig.pads {
                let coordinate = PadCoordinate(x: padConfig.x, y: padConfig.y)
                let shouldRepeat: Bool
                switch padConfig.action.type {
                case .keystroke, .contextualBackspace:
                    shouldRepeat = true
                case .dictation, .auxiliaryDictation, .talonLiteDictation, .nextWindow, .appReload, .modifierLatch, .loadSafeRuntimeConfig, .toggleFullscreenOverlay:
                    shouldRepeat = false
                }
                let cell: LaunchpadCellType
                if padConfig.role == .recordStatus {
                    cell = LaunchpadStatusCell(
                        invalidationBus: invalidationBus,
                        statusColorProvider: recordStatusColorProvider,
                        onPress: {
                            runAction(padConfig, pageID: pageConfig.id)
                        }
                    )
                } else if padConfig.role == .shiftLatch {
                    cell = LaunchpadStatusCell(
                        invalidationBus: invalidationBus,
                        statusColorProvider: shiftLatchColorProvider,
                        onPress: {
                            if let modifier = padConfig.action.modifier {
                                TraceLogger.log(
                                    "launchpad action modifier_press page=\(pageConfig.id) x=\(padConfig.x) y=\(padConfig.y) modifier=\(modifier.rawValue)"
                                )
                                onModifierPress?(modifier)
                            }
                        },
                        onRelease: {
                            if let modifier = padConfig.action.modifier {
                                TraceLogger.log(
                                    "launchpad action modifier_release page=\(pageConfig.id) x=\(padConfig.x) y=\(padConfig.y) modifier=\(modifier.rawValue)"
                                )
                                onModifierRelease?(modifier)
                            }
                        }
                    )
                } else {
                    cell = LaunchpadCell(
                        baseColor: padConfig.color.color,
                        invalidationBus: invalidationBus,
                        onPress: {
                            runAction(padConfig, pageID: pageConfig.id)
                        },
                        onRelease: {
                            if padConfig.action.type == .nextWindow {
                                TraceLogger.log(
                                    "launchpad action next_window_release page=\(pageConfig.id) x=\(padConfig.x) y=\(padConfig.y)"
                                )
                                onNextWindowSwitchRelease?()
                            }
                        },
                        onRepeat: shouldRepeat ? {
                            runAction(padConfig, pageID: pageConfig.id)
                        } : nil,
                        repeatBehavior: shouldRepeat ? LaunchpadCell.RepeatBehavior(
                            initialDelay: Self.defaultKeyRepeatInitialDelay,
                            repeatInterval: Self.defaultKeyRepeatInterval
                        ) : nil
                    )
                }
                page.setCell(cell, at: coordinate)
            }
            return page
        }
    }
}
