import AppKit
import Foundation

final class ActiveTargetContextProvider {
    struct ActiveTarget {
        let appName: String
        let bundleID: String
        let siteHost: String?
        let isCodingAgent: Bool
        let dictationContext: String
    }

    private let frontmostAppProvider: () -> NSRunningApplication?
    private let browserURLProvider: (String) -> String?

    init(
        frontmostAppProvider: @escaping () -> NSRunningApplication? = { NSWorkspace.shared.frontmostApplication },
        browserURLProvider: @escaping (String) -> String? = ActiveTargetContextProvider.frontBrowserURL
    ) {
        self.frontmostAppProvider = frontmostAppProvider
        self.browserURLProvider = browserURLProvider
    }

    func captureContext() -> [String: String]? {
        guard let target = captureTarget() else {
            return nil
        }

        var context: [String: String] = [
            "active_app": target.appName,
            "active_bundle_id": target.bundleID,
            "is_coding_agent_target": target.isCodingAgent ? "true" : "false",
            "dictation_context": target.dictationContext,
        ]
        if let siteHost = target.siteHost {
            context["active_site"] = siteHost
        }
        return context
    }

    func captureTarget() -> ActiveTarget? {
        guard let frontmost = frontmostAppProvider() else {
            return nil
        }

        let appName = normalizedAppName(frontmost.localizedName)
        let bundleID = frontmost.bundleIdentifier ?? ""
        let isCodingAgent = Self.isCodingAgent(appName: appName, bundleID: bundleID)

        var siteHost: String?
        if Self.isBrowserApp(appName: appName, bundleID: bundleID),
           let rawURL = browserURLProvider(appName),
           let host = Self.host(from: rawURL) {
            siteHost = host
        }

        let fullContext = Self.dictationContextSentence(
            appName: appName,
            siteHost: siteHost,
            isCodingAgent: isCodingAgent
        )

        return ActiveTarget(
            appName: appName,
            bundleID: bundleID,
            siteHost: siteHost,
            isCodingAgent: isCodingAgent,
            dictationContext: fullContext
        )
    }

    static func host(from rawURL: String) -> String? {
        let trimmed = rawURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return nil
        }
        guard let url = URL(string: trimmed), let host = url.host?.lowercased(), !host.isEmpty else {
            return nil
        }
        if host.hasPrefix("www.") {
            return String(host.dropFirst(4))
        }
        return host
    }

    static func isCodingAgent(appName: String, bundleID: String) -> Bool {
        let lowerName = appName.lowercased()
        let lowerBundle = bundleID.lowercased()
        return lowerName.contains("codex")
            || lowerName.contains("cursor")
            || lowerBundle.contains("codex")
            || lowerBundle.contains("cursor")
    }

    static func dictationContextSentence(appName: String, siteHost: String?, isCodingAgent: Bool) -> String {
        let base: String
        if let siteHost, !siteHost.isEmpty {
            base = "You are currently dictating into \(appName), website \(siteHost)."
        } else {
            base = "You are currently dictating into \(appName)."
        }
        if isCodingAgent {
            return base + " You are talking to a coding agent."
        }
        return base
    }

    private static func isBrowserApp(appName: String, bundleID: String) -> Bool {
        let lowerName = appName.lowercased()
        let lowerBundle = bundleID.lowercased()
        return lowerName.contains("chrome")
            || lowerName.contains("safari")
            || lowerBundle.contains("com.google.chrome")
            || lowerBundle.contains("com.apple.safari")
    }

    private func normalizedAppName(_ value: String?) -> String {
        guard let value else {
            return "Unknown App"
        }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "Unknown App" : trimmed
    }

    private static func frontBrowserURL(for appName: String) -> String? {
        let lowerName = appName.lowercased()
        if lowerName.contains("chrome") {
            return runAppleScript(
                """
                tell application "Google Chrome"
                    if (count of windows) is 0 then return ""
                    return URL of active tab of front window
                end tell
                """
            )
        }

        if lowerName.contains("safari") {
            return runAppleScript(
                """
                tell application "Safari"
                    if (count of windows) is 0 then return ""
                    return URL of front document
                end tell
                """
            )
        }

        return nil
    }

    private static func runAppleScript(_ source: String) -> String? {
        guard let script = NSAppleScript(source: source) else {
            return nil
        }
        var errorDict: NSDictionary?
        let descriptor = script.executeAndReturnError(&errorDict)
        if errorDict != nil {
            return nil
        }
        let value = descriptor.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let value, !value.isEmpty else {
            return nil
        }
        return value
    }
}
