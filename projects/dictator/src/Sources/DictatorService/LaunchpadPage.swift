import Foundation

protocol LaunchpadCellType: AnyObject {
    func onPress(velocity: UInt8)
    func onRelease()
    func getColor() -> PadColor
}

protocol LaunchpadControlLayer: AnyObject {
    func handle(_ event: PadEvent) -> Bool
    func getColor(at coordinate: PadCoordinate) -> PadColor?
    func allCoordinatesForRendering() -> [PadCoordinate]
}

final class LaunchpadCell: LaunchpadCellType {
    struct RepeatBehavior {
        let initialDelay: TimeInterval
        let repeatInterval: TimeInterval
    }

    let baseColor: PadColor
    private let invalidationBus: RenderInvalidationBus
    private let onPressCallback: (() -> Void)?
    private let onReleaseCallback: (() -> Void)?
    private let onRepeatCallback: (() -> Void)?
    private let repeatBehavior: RepeatBehavior?
    private let lock = NSLock()
    private var pressed = false
    private var repeatTimer: DispatchSourceTimer?
    private let repeatQueue = DispatchQueue(label: "dictator.launchpad.cell.repeat")

    init(
        baseColor: PadColor,
        invalidationBus: RenderInvalidationBus,
        onPress: (() -> Void)? = nil,
        onRelease: (() -> Void)? = nil,
        onRepeat: (() -> Void)? = nil,
        repeatBehavior: RepeatBehavior? = nil
    ) {
        self.baseColor = baseColor
        self.invalidationBus = invalidationBus
        self.onPressCallback = onPress
        self.onReleaseCallback = onRelease
        self.onRepeatCallback = onRepeat
        self.repeatBehavior = repeatBehavior
    }

    func onPress(velocity: UInt8) {
        let shouldInvoke: Bool
        lock.lock()
        shouldInvoke = !pressed
        pressed = true
        lock.unlock()

        invalidationBus.markDirty(reason: "pad_press")
        if shouldInvoke {
            onPressCallback?()
            startRepeatIfNeeded()
        }
        _ = velocity
    }

    func onRelease() {
        let shouldInvoke: Bool
        lock.lock()
        shouldInvoke = pressed
        pressed = false
        lock.unlock()

        invalidationBus.markDirty(reason: "pad_release")
        if shouldInvoke {
            stopRepeat()
            onReleaseCallback?()
        }
    }

    func getColor() -> PadColor {
        lock.lock()
        let isPressed = pressed
        lock.unlock()
        return isPressed ? baseColor : baseColor.dimmed()
    }

    private func startRepeatIfNeeded() {
        guard let repeatBehavior, let onRepeatCallback else {
            return
        }

        repeatQueue.async { [weak self] in
            guard let self else {
                return
            }
            self.stopRepeatInternal()

            let timer = DispatchSource.makeTimerSource(queue: self.repeatQueue)
            timer.schedule(
                deadline: .now() + repeatBehavior.initialDelay,
                repeating: repeatBehavior.repeatInterval
            )
            timer.setEventHandler { [weak self] in
                guard let self else {
                    return
                }
                self.lock.lock()
                let isPressed = self.pressed
                self.lock.unlock()
                guard isPressed else {
                    return
                }
                onRepeatCallback()
            }
            self.repeatTimer = timer
            timer.resume()
        }
    }

    private func stopRepeat() {
        repeatQueue.async { [weak self] in
            self?.stopRepeatInternal()
        }
    }

    private func stopRepeatInternal() {
        repeatTimer?.cancel()
        repeatTimer = nil
    }
}

final class LaunchpadStatusCell: LaunchpadCellType {
    private let invalidationBus: RenderInvalidationBus
    private let statusColorProvider: () -> PadColor
    private let onPressCallback: (() -> Void)?
    private let onReleaseCallback: (() -> Void)?
    private let lock = NSLock()
    private var pressed = false

    init(
        invalidationBus: RenderInvalidationBus,
        statusColorProvider: @escaping () -> PadColor,
        onPress: (() -> Void)? = nil,
        onRelease: (() -> Void)? = nil
    ) {
        self.invalidationBus = invalidationBus
        self.statusColorProvider = statusColorProvider
        self.onPressCallback = onPress
        self.onReleaseCallback = onRelease
    }

    func onPress(velocity: UInt8) {
        let shouldInvoke: Bool
        lock.lock()
        shouldInvoke = !pressed
        pressed = true
        lock.unlock()

        invalidationBus.markDirty(reason: "pad_press")
        if shouldInvoke {
            onPressCallback?()
        }
        _ = velocity
    }

    func onRelease() {
        let shouldInvoke: Bool
        lock.lock()
        shouldInvoke = pressed
        pressed = false
        lock.unlock()

        invalidationBus.markDirty(reason: "pad_release")
        if shouldInvoke {
            onReleaseCallback?()
        }
    }

    func getColor() -> PadColor {
        statusColorProvider()
    }
}

final class LaunchpadPage {
    let id: String
    private var cells = Grid8x8<LaunchpadCellType?>(repeating: nil)
    private var extraCells: [PadCoordinate: LaunchpadCellType] = [:]

    init(id: String) {
        self.id = id
    }

    func setCell(_ cell: LaunchpadCellType, at coordinate: PadCoordinate) {
        guard coordinate.isLaunchpadProMk3Addressable else {
            return
        }
        if coordinate.isValid {
            cells[coordinate] = cell
        } else {
            extraCells[coordinate] = cell
        }
    }

    func handle(_ event: PadEvent) {
        guard event.coordinate.isLaunchpadProMk3Addressable else {
            TraceLogger.log("launchpad page=\(id) ignored invalid coordinate x=\(event.coordinate.x) y=\(event.coordinate.y)")
            return
        }

        let cell: LaunchpadCellType?
        if event.coordinate.isValid {
            cell = cells[event.coordinate]
        } else {
            cell = extraCells[event.coordinate]
        }

        guard let cell else {
            TraceLogger.log("launchpad page=\(id) no cell at x=\(event.coordinate.x) y=\(event.coordinate.y) phase=\(event.phase)")
            return
        }

        TraceLogger.log("launchpad page=\(id) dispatch x=\(event.coordinate.x) y=\(event.coordinate.y) phase=\(event.phase)")
        switch event.phase {
        case .press:
            cell.onPress(velocity: event.velocity)
        case .release:
            cell.onRelease()
        }
    }

    func getColor(at coordinate: PadCoordinate) -> PadColor {
        if coordinate.isValid, let cell = cells[coordinate] {
            return cell.getColor()
        }
        if let cell = extraCells[coordinate] {
            return cell.getColor()
        }
        return .off
    }

    func allCoordinates() -> [PadCoordinate] {
        var coordinates: [PadCoordinate] = []
        coordinates.reserveCapacity(64 + extraCells.count)
        for y in 0...7 {
            for x in 0...7 {
                coordinates.append(PadCoordinate(x: x, y: y))
            }
        }
        for key in extraCells.keys {
            coordinates.append(key)
        }
        return coordinates
    }
}

final class LaunchpadPageController: ColorProvider {
    private let lock = NSLock()
    private let invalidationBus: RenderInvalidationBus
    private var pages: [String: LaunchpadPage] = [:]
    private var orderedIDs: [String] = []
    private var activePageID: String?
    private var controlLayersBySlot: [String: LaunchpadControlLayer] = [:]
    private var orderedControlLayerSlots: [String] = []

    init(invalidationBus: RenderInvalidationBus) {
        self.invalidationBus = invalidationBus
    }

    func setPages(_ pages: [LaunchpadPage], initialPageID: String?) {
        lock.lock()
        defer { lock.unlock() }

        self.pages = Dictionary(uniqueKeysWithValues: pages.map { ($0.id, $0) })
        orderedIDs = pages.map(\.id)
        activePageID = initialPageID ?? orderedIDs.first
        invalidationBus.markDirty(reason: "pages_set")
    }

    func setPage(id: String) {
        lock.lock()
        defer { lock.unlock() }
        guard pages[id] != nil else {
            return
        }
        activePageID = id
        invalidationBus.markDirty(reason: "page_set")
    }

    func setControlLayer(_ controlLayer: LaunchpadControlLayer, forSlot slotID: String) {
        lock.lock()
        if controlLayersBySlot[slotID] == nil {
            orderedControlLayerSlots.append(slotID)
        }
        controlLayersBySlot[slotID] = controlLayer
        lock.unlock()
        invalidationBus.markDirty(reason: "control_layer_set")
    }

    func removeControlLayer(forSlot slotID: String) {
        lock.lock()
        let removed = controlLayersBySlot.removeValue(forKey: slotID) != nil
        if removed {
            orderedControlLayerSlots.removeAll { $0 == slotID }
        }
        lock.unlock()
        guard removed else {
            return
        }
        invalidationBus.markDirty(reason: "control_layer_removed")
    }

    func clearControlLayers() {
        lock.lock()
        let hadLayers = !controlLayersBySlot.isEmpty
        if hadLayers {
            controlLayersBySlot.removeAll()
            orderedControlLayerSlots.removeAll()
        }
        lock.unlock()
        guard hadLayers else {
            return
        }
        invalidationBus.markDirty(reason: "control_layers_cleared")
    }

    func activeControlLayerSlotIDs() -> [String] {
        lock.lock()
        defer { lock.unlock() }
        return orderedControlLayerSlots.filter { controlLayersBySlot[$0] != nil }
    }

    func nextPage() {
        lock.lock()
        defer { lock.unlock() }
        guard let current = activePageID,
              let index = orderedIDs.firstIndex(of: current),
              !orderedIDs.isEmpty else {
            return
        }

        activePageID = orderedIDs[(index + 1) % orderedIDs.count]
        invalidationBus.markDirty(reason: "page_next")
    }

    func prevPage() {
        lock.lock()
        defer { lock.unlock() }
        guard let current = activePageID,
              let index = orderedIDs.firstIndex(of: current),
              !orderedIDs.isEmpty else {
            return
        }

        let newIndex = (index - 1 + orderedIDs.count) % orderedIDs.count
        activePageID = orderedIDs[newIndex]
        invalidationBus.markDirty(reason: "page_prev")
    }

    func handle(_ event: PadEvent) {
        lock.lock()
        let page = activePageID.flatMap { pages[$0] }
        let controlLayers = orderedControlLayerSlots.compactMap { controlLayersBySlot[$0] }
        lock.unlock()

        for layer in controlLayers {
            if layer.handle(event) {
                return
            }
        }
        page?.handle(event)
    }

    func getColor(at coordinate: PadCoordinate) -> PadColor {
        lock.lock()
        let page = activePageID.flatMap { pages[$0] }
        let controlLayers = orderedControlLayerSlots.compactMap { controlLayersBySlot[$0] }
        lock.unlock()

        for layer in controlLayers {
            if let color = layer.getColor(at: coordinate) {
                return color
            }
        }
        return page?.getColor(at: coordinate) ?? .off
    }

    func allCoordinatesForRendering() -> [PadCoordinate] {
        lock.lock()
        let page = activePageID.flatMap { pages[$0] }
        let controlLayers = orderedControlLayerSlots.compactMap { controlLayersBySlot[$0] }
        lock.unlock()

        var coordinates = page?.allCoordinates() ?? ColorProviderDefaultCoordinates.all
        var seen = Set(coordinates)
        for layer in controlLayers {
            for coordinate in layer.allCoordinatesForRendering() {
                if seen.insert(coordinate).inserted {
                    coordinates.append(coordinate)
                }
            }
        }
        return coordinates
    }
}

private enum ColorProviderDefaultCoordinates {
    static let all: [PadCoordinate] = {
        var coordinates: [PadCoordinate] = []
        coordinates.reserveCapacity(64)
        for y in 0...7 {
            for x in 0...7 {
                coordinates.append(PadCoordinate(x: x, y: y))
            }
        }
        return coordinates
    }()
}
