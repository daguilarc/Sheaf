import Foundation
import QuartzCore

final class LaunchpadColorRenderWorker {
    private static let frameInterval: TimeInterval = 1.0 / 20.0
    private static let wakeTimeout: TimeInterval = 1.0

    private let invalidationBus: RenderInvalidationBus
    private weak var colorProvider: ColorProvider?
    private weak var transport: LaunchpadTransport?

    private let queue = DispatchQueue(label: "dictator.launchpad.render")
    private let stateLock = NSLock()

    private var running = false
    private var forceFullRedraw = true
    private var lastGeneration: UInt64 = 0
    private var lastRenderTime: TimeInterval = 0
    private var lastFrame = Grid8x8<PadColor>(repeating: .off)
    private var lastExtendedFrame: [PadCoordinate: PadColor] = [:]

    init(invalidationBus: RenderInvalidationBus, colorProvider: ColorProvider, transport: LaunchpadTransport) {
        self.invalidationBus = invalidationBus
        self.colorProvider = colorProvider
        self.transport = transport
    }

    func start() {
        stateLock.lock()
        guard !running else {
            stateLock.unlock()
            return
        }
        running = true
        stateLock.unlock()

        queue.async { [weak self] in
            self?.runLoop()
        }

        invalidationBus.markDirty(reason: "renderer_start")
    }

    func stop() {
        stateLock.lock()
        running = false
        stateLock.unlock()
        invalidationBus.markDirty(reason: "renderer_stop")
    }

    func invalidateAll() {
        stateLock.lock()
        forceFullRedraw = true
        stateLock.unlock()
        invalidationBus.markDirty(reason: "renderer_invalidate_all")
    }

    private func runLoop() {
        while true {
            stateLock.lock()
            let isRunning = running
            stateLock.unlock()
            if !isRunning {
                return
            }

            let nextGeneration = invalidationBus.waitForDirty(
                since: lastGeneration,
                timeout: Self.wakeTimeout
            )

            stateLock.lock()
            let shouldForce = forceFullRedraw
            if shouldForce {
                forceFullRedraw = false
            }
            stateLock.unlock()

            if nextGeneration == lastGeneration && !shouldForce {
                continue
            }

            limitToFrameRate()
            renderFrame(forceAll: shouldForce)
            lastGeneration = nextGeneration
        }
    }

    private func limitToFrameRate() {
        let now = CACurrentMediaTime()
        let elapsed = now - lastRenderTime
        if elapsed < Self.frameInterval {
            Thread.sleep(forTimeInterval: Self.frameInterval - elapsed)
        }
        lastRenderTime = CACurrentMediaTime()
    }

    private func renderFrame(forceAll: Bool) {
        guard let colorProvider, let transport, transport.isConnected else {
            return
        }

        let coordinates = colorProvider.allCoordinatesForRendering()
        let coordinateSet = Set(coordinates)
        var changed: [PadColorUpdate] = []
        changed.reserveCapacity(coordinates.count)

        for coordinate in coordinates {
            let color = colorProvider.getColor(at: coordinate)
            let last = coordinate.isValid ? lastFrame[coordinate] : (lastExtendedFrame[coordinate] ?? .off)
            if forceAll || color != last {
                changed.append(PadColorUpdate(coordinate: coordinate, color: color))
                if coordinate.isValid {
                    lastFrame[coordinate] = color
                } else {
                    lastExtendedFrame[coordinate] = color
                }
            }
        }

        // Turn off any previously-rendered extended coordinates that no longer exist.
        let removedExtendedCoordinates = lastExtendedFrame.keys.filter { !coordinateSet.contains($0) }
        if !removedExtendedCoordinates.isEmpty {
            for coordinate in removedExtendedCoordinates {
                let last = lastExtendedFrame[coordinate] ?? .off
                if forceAll || last != .off {
                    changed.append(PadColorUpdate(coordinate: coordinate, color: .off))
                }
                lastExtendedFrame.removeValue(forKey: coordinate)
            }
        }

        if !changed.isEmpty {
            transport.sendBatchPadColors(changed)
        }
    }

    func renderNowForTesting(forceAll: Bool) {
        renderFrame(forceAll: forceAll)
    }
}
