import DictatorCore
import Foundation

@main
struct DictatorServiceMain
{
    static func main() async
    {
        TraceLogger.reset()
        TraceLogger.log("DictatorService starting")

        let runtimeConfigProvider = RuntimeConfigProvider()
        let secretStore = InMemorySecretStore()
        let config = await runtimeConfigProvider.currentRuntimeConfig()

        let sttEngine = WhisperCPPBridgeSTTEngine(
            configuration: .init(
                modelPath: config.resolvedSTTModelPath(),
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
            host: config.dictatorServerHost,
            port: config.dictatorServerPort,
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
