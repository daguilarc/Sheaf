import DictatorCore
import Foundation
import NIO
import NIOHTTP1

struct DictationHTTPSuccessRecord: Sendable
{
    let response: DictateResponse
    let transcribeMs: Int
    let refineMs: Int
    let providerMetadata: RefinementProviderMetadata?
    let totalPipelineMs: Int
    let optionalContext: [String: String]?
    let sessionID: String
    let requestID: String
    let sampleRate: Int
    let locale: String
}

struct DictationHTTPFailureRecord: Sendable
{
    let errorMessage: String
    let optionalContext: [String: String]?
    let audioData: Data
    let sampleRate: Int
    let locale: String
    let sessionID: String
    let requestID: String
}

final class DictationHTTPServer
{
    private let host: String
    private let port: Int
    private let maxBodyBytes: Int
    private let lifecycle: ServiceLifecycle
    private let coreClient: any DictatorCoreClient
    private let onSuccessRecord: (@Sendable (DictationHTTPSuccessRecord) async -> Void)?
    private let onFailureRecord: (@Sendable (DictationHTTPFailureRecord) async -> Void)?
    private let group: MultiThreadedEventLoopGroup
    private var channel: Channel?

    init(
        host: String,
        port: Int,
        maxBodyBytes: Int = 25 * 1024 * 1024,
        lifecycle: ServiceLifecycle,
        coreClient: any DictatorCoreClient,
        onSuccessRecord: (@Sendable (DictationHTTPSuccessRecord) async -> Void)? = nil,
        onFailureRecord: (@Sendable (DictationHTTPFailureRecord) async -> Void)? = nil
    )
    {
        self.host = host
        self.port = port
        self.maxBodyBytes = maxBodyBytes
        self.lifecycle = lifecycle
        self.coreClient = coreClient
        self.onSuccessRecord = onSuccessRecord
        self.onFailureRecord = onFailureRecord
        self.group = MultiThreadedEventLoopGroup(numberOfThreads: 1)
    }

    func start() async throws
    {
        guard channel == nil else
        {
            return
        }

        let bootstrap = ServerBootstrap(group: group)
            .serverChannelOption(ChannelOptions.backlog, value: 256)
            .serverChannelOption(ChannelOptions.socketOption(.so_reuseaddr), value: 1)
            .childChannelInitializer
            { [lifecycle, coreClient, maxBodyBytes, onSuccessRecord, onFailureRecord] channel in
                channel.pipeline.configureHTTPServerPipeline().flatMap
                {
                    channel.pipeline.addHandler(
                        DictationHTTPHandler(
                            lifecycle: lifecycle,
                            coreClient: coreClient,
                            maxBodyBytes: maxBodyBytes,
                            onSuccessRecord: onSuccessRecord,
                            onFailureRecord: onFailureRecord
                        )
                    )
                }
            }
            .childChannelOption(ChannelOptions.socketOption(.so_reuseaddr), value: 1)
            .childChannelOption(ChannelOptions.maxMessagesPerRead, value: 16)
            .childChannelOption(ChannelOptions.recvAllocator, value: AdaptiveRecvByteBufferAllocator())

        channel = try await bootstrap.bind(host: host, port: port).get()
    }

    func stop() async
    {
        if let channel
        {
            do
            {
                try await channel.close().get()
            }
            catch
            {
                TraceLogger.log("dictation server close failed: \(error)")
            }
            self.channel = nil
        }

        do
        {
            try await group.shutdownGracefully()
        }
        catch
        {
            TraceLogger.log("dictation server shutdown failed: \(error)")
        }
    }

    var bindDescription: String
    {
        if let boundPort
        {
            return "\(host):\(boundPort)"
        }
        return "\(host):\(port)"
    }

    var boundPort: Int?
    {
        if let bound = channel?.localAddress?.port
        {
            return bound
        }
        return port
    }
}

private enum DictationHTTPRoute
{
    case health
    case exit
    case dictateAudio
}

private struct DictationHTTPRouter
{
    private static let knownMethods: [String: HTTPMethod] = [
        "/health": .GET,
        "/exit": .POST,
        "/v1/dictate-audio": .POST
    ]

    static func route(for head: HTTPRequestHead) throws -> DictationHTTPRoute
    {
        if let expectedMethod = knownMethods[head.uri]
        {
            guard head.method == expectedMethod else
            {
                throw DictationHTTPRequestError.methodNotAllowed
            }
        }

        switch (head.method, head.uri)
        {
        case (.GET, "/health"):
            return .health
        case (.POST, "/exit"):
            return .exit
        case (.POST, "/v1/dictate-audio"):
            return .dictateAudio
        default:
            throw DictationHTTPRequestError.notFound
        }
    }
}

private enum DictationHTTPRequestError: Error
{
    case notFound
    case methodNotAllowed
    case badRequest(String)
    case payloadTooLarge
    case unprocessableEntity(String)
    case internalServerError(String)

    var status: HTTPResponseStatus
    {
        switch self
        {
        case .notFound:
            return .notFound
        case .methodNotAllowed:
            return .methodNotAllowed
        case .badRequest:
            return .badRequest
        case .payloadTooLarge:
            return .payloadTooLarge
        case .unprocessableEntity:
            return .unprocessableEntity
        case .internalServerError:
            return .internalServerError
        }
    }

    var message: String
    {
        switch self
        {
        case .notFound:
            return "Not found."
        case .methodNotAllowed:
            return "Method not allowed."
        case let .badRequest(message):
            return message
        case .payloadTooLarge:
            return "Audio payload exceeds configured size limit."
        case let .unprocessableEntity(message):
            return message
        case let .internalServerError(message):
            return message
        }
    }
}

private struct DictationHTTPJSON
{
    struct HealthResponse: Codable
    {
        let healthy: Bool
        let uptime: Double
        let warning: String?
    }

    struct ExitResponse: Codable
    {
        let exiting: Bool
    }

    struct DictateAudioResponse: Codable
    {
        let raw_transcript: String
        let revised_text: String
        let edit_summary: String
        let uncertainty_flags: [String]
        let transcribe_ms: Int
        let refine_ms: Int
    }

    struct ErrorResponse: Codable
    {
        let error: String
    }
}

enum DictationHTTPValidation
{
    static let supportedSampleRates: Set<Int> = [8000, 16000, 22050, 24000, 32000, 44100, 48000]

    static func isValidLocale(_ locale: String) -> Bool
    {
        guard !locale.isEmpty else
        {
            return false
        }
        if locale.trimmingCharacters(in: .whitespacesAndNewlines) != locale
        {
            return false
        }
        if locale.unicodeScalars.contains(where: { $0.value < 32 })
        {
            return false
        }
        let pattern = #"^[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*$"#
        return locale.range(of: pattern, options: .regularExpression) != nil
    }

    static func looksLikeWAV(_ data: Data) -> Bool
    {
        guard data.count >= 44 else
        {
            return false
        }
        return data.starts(with: [0x52, 0x49, 0x46, 0x46])
            && data[8 ... 11].elementsEqual([0x57, 0x41, 0x56, 0x45])
    }

    static func wavSampleRate(from data: Data) -> Int?
    {
        guard data.count >= 28, looksLikeWAV(data) else
        {
            return nil
        }
        let raw = data.subdata(in: 24 ..< 28).withUnsafeBytes
        { rawBuffer in
            rawBuffer.load(as: UInt32.self)
        }
        return Int(UInt32(littleEndian: raw))
    }

    static func validateSampleRate(headerValue: Int, wavData: Data) throws
    {
        guard supportedSampleRates.contains(headerValue) else
        {
            throw DictationHTTPRequestError.unprocessableEntity("Unsupported sample rate \(headerValue).")
        }

        if let wavRate = wavSampleRate(from: wavData), wavRate != headerValue
        {
            throw DictationHTTPRequestError.unprocessableEntity(
                "X-Sample-Rate (\(headerValue)) does not match WAV header sample rate (\(wavRate))."
            )
        }
    }
}

private final class DictationHTTPHandler: ChannelInboundHandler
{
    typealias InboundIn = HTTPServerRequestPart
    typealias OutboundOut = HTTPServerResponsePart

    private struct PendingRequest
    {
        let head: HTTPRequestHead
        var body = ByteBuffer()
        var responseSent = false
    }

    private let lifecycle: ServiceLifecycle
    private let coreClient: any DictatorCoreClient
    private let maxBodyBytes: Int
    private let onSuccessRecord: (@Sendable (DictationHTTPSuccessRecord) async -> Void)?
    private let onFailureRecord: (@Sendable (DictationHTTPFailureRecord) async -> Void)?
    private let encoder = JSONEncoder()
    private var pendingRequest: PendingRequest?
    private var activeTask: Task<Void, Never>?

    init(
        lifecycle: ServiceLifecycle,
        coreClient: any DictatorCoreClient,
        maxBodyBytes: Int,
        onSuccessRecord: (@Sendable (DictationHTTPSuccessRecord) async -> Void)?,
        onFailureRecord: (@Sendable (DictationHTTPFailureRecord) async -> Void)?
    )
    {
        self.lifecycle = lifecycle
        self.coreClient = coreClient
        self.maxBodyBytes = maxBodyBytes
        self.onSuccessRecord = onSuccessRecord
        self.onFailureRecord = onFailureRecord
    }

    func channelRead(context: ChannelHandlerContext, data: NIOAny)
    {
        let part = unwrapInboundIn(data)
        switch part
        {
        case let .head(head):
            let remote = context.remoteAddress?.description ?? "unknown"
            let contentLength = head.headers.first(name: "Content-Length") ?? "n/a"
            let transferEncoding = head.headers.first(name: "Transfer-Encoding") ?? "n/a"
            let requestID = head.headers.first(name: "X-Request-Id") ?? "missing"
            TraceLogger.log("dictation HTTP request head: id=\(requestID) \(head.method.rawValue) \(head.uri) remote=\(remote) contentLength=\(contentLength) transferEncoding=\(transferEncoding)")
            pendingRequest = PendingRequest(head: head)
        case var .body(buffer):
            guard var pending = pendingRequest, !pending.responseSent else
            {
                return
            }
            pending.body.writeBuffer(&buffer)
            if pending.body.readableBytes > maxBodyBytes
            {
                pending.responseSent = true
                pendingRequest = pending
                writeErrorResponse(.payloadTooLarge, context: context, closeAfterResponse: true)
                return
            }
            pendingRequest = pending
        case .end:
            guard let pending = pendingRequest, !pending.responseSent else
            {
                pendingRequest = nil
                return
            }
            pendingRequest = nil
            process(pending: pending, context: context)
        }
    }

    func channelInactive(context: ChannelHandlerContext)
    {
        activeTask?.cancel()
        activeTask = nil
        TraceLogger.log("dictation server channel inactive")
        context.fireChannelInactive()
    }

    func errorCaught(context: ChannelHandlerContext, error: Error)
    {
        TraceLogger.log("dictation server channel error: \(error)")
        context.close(promise: nil)
    }

    private func process(pending: PendingRequest, context: ChannelHandlerContext)
    {
        let requestID = pending.head.headers.first(name: "X-Request-Id") ?? String(UUID().uuidString.prefix(8))
        let requestStart = Date()
        do
        {
            let route = try DictationHTTPRouter.route(for: pending.head)
            switch route
            {
            case .health:
                handleHealth(pending: pending, context: context)
            case .exit:
                handleExit(pending: pending, context: context)
            case .dictateAudio:
                try handleDictateAudio(
                    pending: pending,
                    context: context,
                    requestID: requestID,
                    requestStart: requestStart
                )
            }
        }
        catch let requestError as DictationHTTPRequestError
        {
            TraceLogger.log("[\(requestID)] request rejected: \(requestError.status.code) \(requestError.message)")
            writeErrorResponse(
                requestError,
                context: context,
                closeAfterResponse: !pending.head.isKeepAlive
            )
        }
        catch
        {
            TraceLogger.log("[\(requestID)] request parsing failed: \(error)")
            writeErrorResponse(
                .badRequest("Invalid request: \(error.localizedDescription)"),
                context: context,
                closeAfterResponse: !pending.head.isKeepAlive
            )
        }
    }

    private func handleHealth(pending: PendingRequest, context: ChannelHandlerContext)
    {
        TraceLogger.log("health check request")
        let response = DictationHTTPJSON.HealthResponse(
            healthy: true,
            uptime: lifecycle.UptimeSeconds(),
            warning: lifecycle.healthWarning
        )
        writeJSONResponse(
            response,
            status: .ok,
            context: context,
            closeAfterResponse: !pending.head.isKeepAlive
        )
    }

    private func handleExit(pending: PendingRequest, context: ChannelHandlerContext)
    {
        TraceLogger.log("exit request received")
        writeJSONResponse(
            DictationHTTPJSON.ExitResponse(exiting: true),
            status: .ok,
            context: context,
            closeAfterResponse: true,
            onComplete:
            {
                Task
                {
                    await self.lifecycle.RequestShutdown()
                }
            }
        )
    }

    private func handleDictateAudio(
        pending: PendingRequest,
        context: ChannelHandlerContext,
        requestID: String,
        requestStart: Date
    ) throws
    {
        TraceLogger.log("[\(requestID)] /v1/dictate-audio accepted (bytes=\(pending.body.readableBytes))")

        let contentType = pending.head.headers.first(name: "Content-Type")?.lowercased() ?? ""
        guard contentType.hasPrefix("audio/wav") || contentType.hasPrefix("audio/x-wav") else
        {
            throw DictationHTTPRequestError.badRequest("Content-Type must be audio/wav.")
        }

        guard let sampleRateHeader = pending.head.headers.first(name: "X-Sample-Rate"),
              let sampleRate = Int(sampleRateHeader), sampleRate > 0 else
        {
            throw DictationHTTPRequestError.badRequest("X-Sample-Rate must be a positive integer.")
        }

        guard let locale = pending.head.headers.first(name: "X-Locale"),
              DictationHTTPValidation.isValidLocale(locale) else
        {
            throw DictationHTTPRequestError.badRequest("X-Locale must be a non-empty BCP-47 locale.")
        }

        guard let sessionID = pending.head.headers.first(name: "X-Session-Id"),
              !sessionID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else
        {
            throw DictationHTTPRequestError.badRequest("X-Session-Id is required.")
        }

        var body = pending.body
        let wavBytes = body.readBytes(length: body.readableBytes) ?? []
        let wavData = Data(wavBytes)
        guard DictationHTTPValidation.looksLikeWAV(wavData) else
        {
            throw DictationHTTPRequestError.unprocessableEntity("Payload must be a valid WAV stream.")
        }

        try DictationHTTPValidation.validateSampleRate(headerValue: sampleRate, wavData: wavData)

        let optionalContext = try parseStringMapHeader(
            pending.head.headers.first(name: "X-Context-Json"),
            headerName: "X-Context-Json"
        )
        let stylePrefs = try parseStringMapHeader(
            pending.head.headers.first(name: "X-Style-Prefs-Json"),
            headerName: "X-Style-Prefs-Json"
        )

        let request = DictateRequest(
            audio_b64: wavData.base64EncodedString(),
            sample_rate: sampleRate,
            locale: locale,
            session_id: sessionID,
            optional_context: optionalContext,
            style_prefs: stylePrefs
        )

        activeTask = Task
        { [weak self, weak context] in
            guard let self, let context else
            {
                return
            }
            do
            {
                TraceLogger.log("[\(requestID)] coreClient.dictate started")
                let result = try await self.coreClient.dictate(request)
                if Task.isCancelled
                {
                    TraceLogger.log("[\(requestID)] coreClient.dictate cancelled")
                    return
                }
                let response = DictationHTTPJSON.DictateAudioResponse(
                    raw_transcript: result.response.raw_transcript,
                    revised_text: result.response.revised_text,
                    edit_summary: result.response.edit_summary,
                    uncertainty_flags: result.response.uncertainty_flags,
                    transcribe_ms: result.transcribeMs,
                    refine_ms: result.refineMs
                )
                let elapsed = Date().timeIntervalSince(requestStart)
                TraceLogger.log("[\(requestID)] coreClient.dictate succeeded in \(String(format: "%.3f", elapsed))s (transcribe_ms=\(result.transcribeMs), refine_ms=\(result.refineMs))")
                if let onSuccessRecord
                {
                    let persisted = DictationHTTPSuccessRecord(
                        response: result.response,
                        transcribeMs: result.transcribeMs,
                        refineMs: result.refineMs,
                        providerMetadata: result.providerMetadata,
                        totalPipelineMs: Int(elapsed * 1000),
                        optionalContext: optionalContext,
                        sessionID: sessionID,
                        requestID: requestID,
                        sampleRate: sampleRate,
                        locale: locale
                    )
                    Task
                    {
                        await onSuccessRecord(persisted)
                    }
                }
                context.eventLoop.execute
                {
                    self.writeJSONResponse(
                        response,
                        status: .ok,
                        context: context,
                        closeAfterResponse: !pending.head.isKeepAlive
                    )
                }
            }
            catch
            {
                let elapsed = Date().timeIntervalSince(requestStart)
                TraceLogger.log("[\(requestID)] coreClient.dictate failed after \(String(format: "%.3f", elapsed))s: \(error)")
                if let onFailureRecord
                {
                    let persisted = DictationHTTPFailureRecord(
                        errorMessage: error.localizedDescription,
                        optionalContext: optionalContext,
                        audioData: wavData,
                        sampleRate: sampleRate,
                        locale: locale,
                        sessionID: sessionID,
                        requestID: requestID
                    )
                    Task
                    {
                        await onFailureRecord(persisted)
                    }
                }
                context.eventLoop.execute
                {
                    self.writeErrorResponse(
                        .internalServerError("Dictation failed: \(error.localizedDescription)"),
                        context: context,
                        closeAfterResponse: !pending.head.isKeepAlive
                    )
                }
            }
        }
    }

    private func parseStringMapHeader(_ value: String?, headerName: String) throws -> [String: String]?
    {
        guard let value else
        {
            return nil
        }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else
        {
            return nil
        }

        let data = Data(trimmed.utf8)
        let decoded: Any
        do
        {
            decoded = try JSONSerialization.jsonObject(with: data)
        }
        catch
        {
            throw DictationHTTPRequestError.badRequest("\(headerName) must be valid JSON.")
        }
        guard let object = decoded as? [String: Any] else
        {
            throw DictationHTTPRequestError.badRequest("\(headerName) must be a JSON object.")
        }

        var mapped: [String: String] = [:]
        for (key, raw) in object
        {
            mapped[key] = String(describing: raw)
        }
        return mapped
    }

    private func writeErrorResponse(
        _ error: DictationHTTPRequestError,
        context: ChannelHandlerContext,
        closeAfterResponse: Bool
    )
    {
        writeJSONResponse(
            DictationHTTPJSON.ErrorResponse(error: error.message),
            status: error.status,
            context: context,
            closeAfterResponse: closeAfterResponse
        )
    }

    private func writeJSONResponse<T: Encodable>(
        _ payload: T,
        status: HTTPResponseStatus,
        context: ChannelHandlerContext,
        closeAfterResponse: Bool,
        onComplete: (() -> Void)? = nil
    )
    {
        do
        {
            let data = try encoder.encode(payload)
            var buffer = context.channel.allocator.buffer(capacity: data.count)
            buffer.writeBytes(data)

            var headers = HTTPHeaders()
            headers.add(name: "Content-Type", value: "application/json")
            headers.add(name: "Content-Length", value: "\(data.count)")
            headers.add(name: "Connection", value: closeAfterResponse ? "close" : "keep-alive")

            let head = HTTPResponseHead(version: .http1_1, status: status, headers: headers)
            context.write(wrapOutboundOut(.head(head)), promise: nil)
            context.write(wrapOutboundOut(.body(.byteBuffer(buffer))), promise: nil)
            context.writeAndFlush(wrapOutboundOut(.end(nil))).whenComplete
            { _ in
                TraceLogger.log(
                    "dictation HTTP response sent status=\(status.code) bytes=\(data.count) connection=\(closeAfterResponse ? "close" : "keep-alive")"
                )
                onComplete?()
                if closeAfterResponse
                {
                    context.close(promise: nil)
                }
            }
        }
        catch
        {
            let fallback = """
            {"error":"Failed to encode response."}
            """
            var buffer = context.channel.allocator.buffer(capacity: fallback.utf8.count)
            buffer.writeString(fallback)
            var headers = HTTPHeaders()
            headers.add(name: "Content-Type", value: "application/json")
            headers.add(name: "Content-Length", value: "\(fallback.utf8.count)")
            headers.add(name: "Connection", value: closeAfterResponse ? "close" : "keep-alive")
            let head = HTTPResponseHead(version: .http1_1, status: .internalServerError, headers: headers)
            context.write(wrapOutboundOut(.head(head)), promise: nil)
            context.write(wrapOutboundOut(.body(.byteBuffer(buffer))), promise: nil)
            context.writeAndFlush(wrapOutboundOut(.end(nil))).whenComplete
            { _ in
                onComplete?()
                if closeAfterResponse
                {
                    context.close(promise: nil)
                }
            }
        }
    }
}
