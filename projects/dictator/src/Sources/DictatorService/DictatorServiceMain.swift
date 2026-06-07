import DictatorCore
import Foundation

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

        do
        {
            if try secretStore.getOpenAIKey() == nil
            {
                TraceLogger.log("warning: OpenAI API key is not configured in config/api_keys.json")
            }
        }
        catch
        {
            TraceLogger.log("warning: could not read API keys file: \(error)")
        }

        TraceLogger.log("loaded runtime config from \(configStore.fileURL.path)")

        let sttEngine = WhisperCPPBridgeSTTEngine(
            configuration: .init(
                modelPath: config.resolvedSTTModelPath(currentDirectoryPath: repoRoot.path),
                language: config.sttLanguage
            )
        )

        let refinementEngine = RuntimeConfigRefinementEngine(
            runtimeConfigProvider: runtimeConfigProvider,
            secretStore: secretStore,
            canUseOpenAI: { false }
        )

        let coreClient = PipelineOrchestrator(
            sttEngine: sttEngine,
            refinementEngine: refinementEngine
        )

        let server = DictationHTTPServer(
            host: endpoint.host,
            port: endpoint.port,
            coreClient: coreClient
        )

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
            signalSource.setEventHandler
            {
                Task
                {
                    TraceLogger.log("shutting down")
                    await server.stop()
                    continuation.resume()
                }
            }
            signal(SIGINT, SIG_IGN)
            signalSource.resume()
        }
    }
}
