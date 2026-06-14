import XCTest
@testable import DictatorService

final class LaunchpadTalonControlStateTests: XCTestCase
{
    func testStatusColorsCoverAwakeAsleepUnavailableAndError()
    {
        var state = LaunchpadTalonControlState()

        XCTAssertEqual(state.color, PadColor(r: 60, g: 60, b: 60))

        state.refresh(TalonControlStatus(state: .awake, speechEnabled: true, modes: ["command"]))
        XCTAssertEqual(state.color, PadColor(r: 0, g: 255, b: 0))

        state.refresh(TalonControlStatus(state: .asleep, speechEnabled: false, modes: ["sleep"]))
        XCTAssertEqual(state.color, PadColor(r: 90, g: 60, b: 0))

        state.refresh(TalonControlStatus(state: .error("boom"), speechEnabled: nil, modes: []))
        XCTAssertEqual(state.color, PadColor(r: 60, g: 60, b: 60))
    }

    func testWakeAttemptIsBlockedWhileDictationIsActive()
    {
        var state = LaunchpadTalonControlState()

        XCTAssertFalse(state.beginWakeAttempt(isDictationActive: true))
        XCTAssertEqual(state.color, PadColor(r: 255, g: 0, b: 0))

        state.clearBlockedWake()
        XCTAssertTrue(state.beginWakeAttempt(isDictationActive: false))
        state.recordWake(TalonControlStatus(state: .awake, speechEnabled: true, modes: ["command"]))
        XCTAssertEqual(state.color, PadColor(r: 0, g: 255, b: 0))
    }
}
