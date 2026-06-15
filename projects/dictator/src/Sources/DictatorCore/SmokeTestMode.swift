import Foundation

/// Repo-wide smoke-test mode contract.
///
/// When `SHEAF_SMOKE_TEST_MODE` is active, services resolve their git-ignored
/// assets (API keys, models) from the main-repo asset root given by
/// `SHEAF_SMOKE_ASSET_ROOT` rather than from their own repository root, while
/// continuing to read tracked files from the repository root.
public enum SmokeTestMode
{
    public static let modeEnvVar = "SHEAF_SMOKE_TEST_MODE"
    public static let assetRootEnvVar = "SHEAF_SMOKE_ASSET_ROOT"

    /// A value is "active" when it is non-empty and not `0`/`false`
    /// (case-insensitive).
    public static func isActive(environment: [String: String]) -> Bool
    {
        guard let raw = environment[modeEnvVar] else { return false }
        let normalized = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return !(normalized.isEmpty || normalized == "0" || normalized == "false")
    }

    public struct ResolvedAssetRoot: Equatable, Sendable
    {
        /// Directory from which git-ignored assets should be loaded.
        public let url: URL
        /// Whether smoke-test mode redirected the asset root away from the repo root.
        public let usedSmokeAssetRoot: Bool
        /// Human-readable warning when smoke mode is active but the asset root
        /// could not be used and resolution fell back to the repo root.
        public let warning: String?

        public init(url: URL, usedSmokeAssetRoot: Bool, warning: String?)
        {
            self.url = url
            self.usedSmokeAssetRoot = usedSmokeAssetRoot
            self.warning = warning
        }
    }

    /// Resolves the directory git-ignored assets should be loaded from.
    ///
    /// - When smoke mode is inactive, returns `repoRoot`.
    /// - When smoke mode is active and `SHEAF_SMOKE_ASSET_ROOT` names an
    ///   existing directory, returns that directory.
    /// - When smoke mode is active but the asset root is unset/empty/missing,
    ///   returns `repoRoot` with a warning describing the fallback.
    public static func resolveAssetRoot(
        repoRoot: URL,
        environment: [String: String],
        directoryExists: (String) -> Bool = { path in
            var isDirectory: ObjCBool = false
            let exists = FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory)
            return exists && isDirectory.boolValue
        }
    ) -> ResolvedAssetRoot
    {
        guard isActive(environment: environment) else
        {
            return ResolvedAssetRoot(url: repoRoot, usedSmokeAssetRoot: false, warning: nil)
        }

        let rawAssetRoot = environment[assetRootEnvVar]?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        guard !rawAssetRoot.isEmpty else
        {
            return ResolvedAssetRoot(
                url: repoRoot,
                usedSmokeAssetRoot: false,
                warning: "smoke-test mode active but \(assetRootEnvVar) is unset or empty; using repo root for assets"
            )
        }

        guard directoryExists(rawAssetRoot) else
        {
            return ResolvedAssetRoot(
                url: repoRoot,
                usedSmokeAssetRoot: false,
                warning: "smoke-test mode active but \(assetRootEnvVar) (\(rawAssetRoot)) is not an existing directory; using repo root for assets"
            )
        }

        return ResolvedAssetRoot(
            url: URL(fileURLWithPath: rawAssetRoot, isDirectory: true),
            usedSmokeAssetRoot: true,
            warning: nil
        )
    }

    /// Reads the smoke-test environment from the current process and resolves
    /// the asset root.
    ///
    /// This is the one place in active Dictator source that reads
    /// `ProcessInfo.processInfo.environment`: the smoke-test contract is an
    /// env-var signal set by Conductor, distinct from Dictator's file-based
    /// runtime configuration. MigrationExclusionTests sanctions this single file.
    public static func resolveAssetRootFromProcessEnvironment(
        repoRoot: URL
    ) -> ResolvedAssetRoot
    {
        resolveAssetRoot(
            repoRoot: repoRoot,
            environment: ProcessInfo.processInfo.environment
        )
    }
}
