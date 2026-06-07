import Foundation

struct PadCoordinate: Hashable {
    let x: Int
    let y: Int

    var isValid: Bool {
        (0...7).contains(x) && (0...7).contains(y)
    }

    var isLaunchpadProMk3Addressable: Bool {
        (-1...8).contains(x) && (-1...9).contains(y)
    }
}

struct PadColor: Equatable {
    let r: UInt8
    let g: UInt8
    let b: UInt8

    static let off = PadColor(r: 0, g: 0, b: 0)

    func dimmed() -> PadColor {
        PadColor(r: r / 4, g: g / 4, b: b / 4)
    }
}

struct PadColorUpdate: Equatable {
    let coordinate: PadCoordinate
    let color: PadColor
}

enum PadPhase {
    case press
    case release
}

struct PadEvent {
    let coordinate: PadCoordinate
    let phase: PadPhase
    let velocity: UInt8
}

protocol ColorProvider: AnyObject {
    func getColor(at coordinate: PadCoordinate) -> PadColor
    func allCoordinatesForRendering() -> [PadCoordinate]
}

extension ColorProvider {
    func allCoordinatesForRendering() -> [PadCoordinate] {
        var coordinates: [PadCoordinate] = []
        coordinates.reserveCapacity(64)
        for y in 0...7 {
            for x in 0...7 {
                coordinates.append(PadCoordinate(x: x, y: y))
            }
        }
        return coordinates
    }
}

protocol LaunchpadTransport: AnyObject {
    var isConnected: Bool { get }
    func sendBatchPadColors(_ updates: [PadColorUpdate])
    func clear()
    func setProgrammerModeIfNeeded()
}

struct Grid8x8<Element> {
    private var storage: [Element]

    init(repeating value: Element) {
        storage = Array(repeating: value, count: 64)
    }

    subscript(_ coordinate: PadCoordinate) -> Element {
        get {
            storage[index(for: coordinate)]
        }
        set {
            storage[index(for: coordinate)] = newValue
        }
    }

    func allCoordinates() -> [PadCoordinate] {
        var coordinates: [PadCoordinate] = []
        coordinates.reserveCapacity(64)
        for y in 0...7 {
            for x in 0...7 {
                coordinates.append(PadCoordinate(x: x, y: y))
            }
        }
        return coordinates
    }

    private func index(for coordinate: PadCoordinate) -> Int {
        precondition(coordinate.isValid, "Pad coordinate out of range: \(coordinate)")
        return (coordinate.y * 8) + coordinate.x
    }
}
