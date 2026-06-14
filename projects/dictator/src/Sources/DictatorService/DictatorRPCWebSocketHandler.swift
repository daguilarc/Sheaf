import Foundation
import NIO
import NIOWebSocket

final class DictatorRPCWebSocketHandler: ChannelInboundHandler {
    typealias InboundIn = WebSocketFrame
    typealias OutboundOut = WebSocketFrame

    private let rpcService: DictatorRPCService
    private let clientID: String
    private var sessionID: String?
    private var bufferedText = ""

    init(rpcService: DictatorRPCService, clientID: String) {
        self.rpcService = rpcService
        self.clientID = clientID
    }

    func handlerAdded(context: ChannelHandlerContext) {
        sessionID = rpcService.registerClient(clientID: clientID) { [weak context] text in
            guard let context else {
                return
            }
            context.eventLoop.execute {
                var buffer = context.channel.allocator.buffer(capacity: text.utf8.count)
                buffer.writeString(text)
                context.writeAndFlush(
                    self.wrapOutboundOut(WebSocketFrame(fin: true, opcode: .text, data: buffer)),
                    promise: nil
                )
            }
        }
        TraceLogger.log("rpc websocket connected client=\(clientID)")
    }

    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        let frame = unwrapInboundIn(data)
        switch frame.opcode {
        case .text:
            var data = frame.unmaskedData
            bufferedText += data.readString(length: data.readableBytes) ?? ""
            if frame.fin {
                flushTextFrame(context: context)
            }
        case .continuation:
            var data = frame.unmaskedData
            bufferedText += data.readString(length: data.readableBytes) ?? ""
            if frame.fin {
                flushTextFrame(context: context)
            }
        case .ping:
            var data = frame.unmaskedData
            context.writeAndFlush(
                wrapOutboundOut(WebSocketFrame(fin: true, opcode: .pong, data: data)),
                promise: nil
            )
        case .connectionClose:
            context.close(promise: nil)
        default:
            break
        }
    }

    func handlerRemoved(context: ChannelHandlerContext) {
        if let sessionID {
            rpcService.unregisterClient(sessionID: sessionID)
        }
        TraceLogger.log("rpc websocket disconnected client=\(clientID)")
    }

    func errorCaught(context: ChannelHandlerContext, error: Error) {
        TraceLogger.log("rpc websocket error client=\(clientID): \(error)")
        context.close(promise: nil)
    }

    private func flushTextFrame(context: ChannelHandlerContext) {
        let text = bufferedText
        bufferedText = ""
        guard let sessionID, let response = rpcService.handleTextFrame(text, sessionID: sessionID) else {
            return
        }
        var buffer = context.channel.allocator.buffer(capacity: response.utf8.count)
        buffer.writeString(response)
        context.writeAndFlush(
            wrapOutboundOut(WebSocketFrame(fin: true, opcode: .text, data: buffer)),
            promise: nil
        )
    }
}
