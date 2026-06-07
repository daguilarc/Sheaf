import DictatorCore
import Foundation

private final class ShutdownCoordinator: @unchecked Sendable
{
    private let lock = NSLock()
    private var didShutdown = false
    private var server: DictationHTTPServer?
    private var continuation: CheckedContinuation<Void, Never>?

    func SetServer(_ server: DictationHTTPServer)
    {
        lock.lock()
        self.server = server
        lock.unlock()
    }

    func SetContinuation(_ continuation: CheckedContinuation<Void, Never>)
    {
        lock.lock()
        self.continuation = continuation
        lock.unlock()
    }

    func RequestShutdown(via: String) async
    {
        let snapshot = ClaimShutdown()
        guard snapshot.shouldProceed else
        {
            return
        }

        TraceLogger.log("shutting down (\(via))")
        await snapshot.server?.stop()
        snapshot.continuation?.resume()
    }

    private func ClaimShutdown() -> (
        shouldProceed: Bool,
        server: DictationHTTPServer?,
        continuation: CheckedContinuation<Void, Never>?
    )
    {
        lock.lock()
        defer { lock.unlock() }
        guard !didShutdown else
        {
            return (false, nil, nil)
        }
        didShutdown = true
        return (true, server, continuation)
    }
}

@main
struct DictatorServiceMain
{
    static func main() async
    {
        let repoRoot: URL
        do
        {
            repoRoot = try SheafRootDiscovery.requireRepoRoot()
        }
        catch
        {
            fputs("DictatorService failed to locate Sheaf repo root: \(error)\n", stderr)
            exit(1)
        }

        TraceLogger.configureForRepoRoot(repoRoot)
        TraceLogger.reset()
        TraceLogger.log("DictatorService starting")

        let cliOverrides = CLIServiceOverridesParser.parse(arguments: Array(CommandLine.arguments.dropFirst()))

        let registryEntry: ServiceRegistryEntry
        do
        {
            registryEntry = try ServiceRegistry.load(repoRoot: repoRoot, serviceName: "dictator")
        }
        catch
        {
            TraceLogger.log("service registry error: \(error)")
            exit(1)
        }

        let configStore = RuntimeConfigStore(
            fileURL: repoRoot.appendingPathComponent("config/dictator.json", isDirectory: false)
        )
        let safeStore = RuntimeConfigStore(
            fileURL: repoRoot.appendingPathComponent("config/dictator.safe", isDirectory: false)
        )
        let runtimeConfigProvider = RuntimeConfigProvider(store: configStore, defaultStore: safeStore)
        let config = await runtimeConfigProvider.currentRuntimeConfig()

        if !config.dictatorServerEnabled
        {
            TraceLogger.log(
                "warning: dictator_server_enabled is false in config/dictator.json; continuing with registered Sheaf service endpoint"
            )
        }

        let endpoint = ServiceEndpointResolver.resolve(
            registryEntry: registryEntry,
            cliHost: cliOverrides.host,
            cliPort: cliOverrides.port
        )

        if endpoint.usedCLIOverride
        {
            TraceLogger.log("using CLI endpoint override: \(endpoint.host):\(endpoint.port)")
        }
        else
        {
            TraceLogger.log("using registered service endpoint: \(endpoint.host):\(endpoint.port)")
        }

        let secretStore = APIKeysStore(
            fileURL: repoRoot.appendingPathComponent("config/api_keys.json", isDirectory: false)
        )

        let hasOpenAIKey: Bool
        do
        {
            hasOpenAIKey = try secretStore.getOpenAIKey() != nil
            if !hasOpenAIKey
            {
                TraceLogger.log("warning: OpenAI API key is not configured in config/api_keys.json")
            }
        }
        catch
        {
            hasOpenAIKey = false
            TraceLogger.log("warning: could not read API keys file: \(error)")
        }

        TraceLogger.log("loaded runtime config from \(configStore.fileURL.path)")

        let sttModelPath = config.resolvedSTTModelPath(currentDirectoryPath: repoRoot.path)
        if !FileManager.default.fileExists(atPath: sttModelPath)
        {
            TraceLogger.log("warning: STT model not found at \(sttModelPath)")
        }

        let healthWarning = BuildHealthWarning(
            hasOpenAIKey: hasOpenAIKey,
            sttModelPath: sttModelPath
        )

        let interactionBuffer = DictationInteractionBuffer(maxBytes: config.interactionsBufferBytes)
        let dataDirectoryURL = InteractionDataPathResolver.defaultDataDirectory(
            runtimeConfig: config,
            currentDirectoryPath: repoRoot.path
        )
        let interactionStore = InteractionHistoryStore(
            buffer: interactionBuffer,
            dataDirectoryURL: dataDirectoryURL,
            initialLoadBytes: config.interactionsBufferBytes
        )
        await interactionStore.startInitialLoadIfNeeded()

        let sttEngine = WhisperCPPBridgeSTTEngine(
            configuration: .init(
                modelPath: sttModelPath,
                language: config.sttLanguage
            )
        )

        let refinementEngine = RuntimeConfigRefinementEngine(
            runtimeConfigProvider: runtimeConfigProvider,
            secretStore: secretStore,
            canUseOpenAI: { hasOpenAIKey }
        )

        let coreClient = PipelineOrchestrator(
            sttEngine: sttEngine,
            refinementEngine: refinementEngine
        )

        let onSuccessRecord = HTTPInteractionRecorder.MakeSuccessHandler(
            interactionStore: interactionStore,
            runtimeConfigProvider: runtimeConfigProvider
        )
        let onFailureRecord = HTTPInteractionRecorder.MakeFailureHandler(
            interactionStore: interactionStore,
            runtimeConfigProvider: runtimeConfigProvider
        )

        let shutdown = ShutdownCoordinator()
        let lifecycle = ServiceLifecycle(
            healthWarning: healthWarning,
            onShutdown:
            {
                await shutdown.RequestShutdown(via: "POST /exit")
            }
        )

        let activityTracker = DictationActivityTracker()
        let endpointDescription = "http://127.0.0.1:\(endpoint.port)"
        let webContext = WebServiceContext(
            repoRoot: repoRoot,
            runtimeConfigProvider: runtimeConfigProvider,
            secretStore: secretStore,
            interactionStore: interactionStore,
            lifecycle: lifecycle,
            activityTracker: activityTracker,
            endpointDescription: endpointDescription,
            logPath: repoRoot.appendingPathComponent("logs/dictator", isDirectory: true).path,
            dataPath: dataDirectoryURL.path
        )
        let webAPIService = WebAPIService(context: webContext)
        await webAPIService.prepare()

        let server = DictationHTTPServer(
            host: endpoint.host,
            port: endpoint.port,
            lifecycle: lifecycle,
            coreClient: coreClient,
            onSuccessRecord: onSuccessRecord,
            onFailureRecord: onFailureRecord,
            webAPIService: webAPIService,
            activityTracker: activityTracker
        )
        shutdown.SetServer(server)

        do
        {
            try await server.start()
            TraceLogger.log("listening on \(server.bindDescription)")
        }
        catch
        {
            TraceLogger.log("server failed: \(error)")
            exit(1)
        }

        let signalSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
        await withCheckedContinuation
        { (continuation: CheckedContinuation<Void, Never>) in
            shutdown.SetContinuation(continuation)
            signalSource.setEventHandler
            {
                Task
                {
                    await shutdown.RequestShutdown(via: "SIGINT")
                }
            }
            signal(SIGINT, SIG_IGN)
            signalSource.resume()
        }
    }

    private static func BuildHealthWarning(hasOpenAIKey: Bool, sttModelPath: String) -> String?
    {
        var warnings: [String] = []
        if !hasOpenAIKey
        {
            warnings.append("OpenAI API key is not configured")
        }
        if !FileManager.default.fileExists(atPath: sttModelPath)
        {
            warnings.append("STT model not found")
        }
        guard !warnings.isEmpty else
        {
            return nil
        }
        return warnings.joined(separator: "; ")
    }
}
