import Foundation

struct LaunchpadAudioInputAvailability: Equatable {
    let resolvedInput: ResolvedAudioInput
    let recordActionEnabled: Bool

    static func evaluate(configuredAudioInput: String?, resolver: AudioInputResolving) -> LaunchpadAudioInputAvailability {
        let resolved = resolver.resolve(configuredAudioInput: configuredAudioInput)
        let configured = configuredAudioInput?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let enabled = configured.isEmpty || resolved.isAvailable
        return LaunchpadAudioInputAvailability(
            resolvedInput: resolved,
            recordActionEnabled: enabled
        )
    }
}

extension ResolvedAudioInput.Mode {
    var logName: String {
        switch self {
        case .systemDefault:
            return "default"
        case .selected:
            return "selected"
        }
    }
}
