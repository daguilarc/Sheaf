import XCTest
@testable import DictatorService

final class DictationActivityTrackerTests: XCTestCase
{
    func testRecordingAndProcessingAreActiveButPreserveAPIValue() async
    {
        let tracker = DictationActivityTracker()

        var state = await tracker.currentState()
        var isActive = await tracker.isActive()
        XCTAssertEqual(state, .idle)
        XCTAssertFalse(isActive)
        XCTAssertEqual(state.apiValue, "idle")

        await tracker.beginRecording()
        state = await tracker.currentState()
        isActive = await tracker.isActive()
        XCTAssertEqual(state, .recording)
        XCTAssertTrue(isActive)
        XCTAssertEqual(state.apiValue, "processing")

        await tracker.beginProcessing()
        state = await tracker.currentState()
        isActive = await tracker.isActive()
        XCTAssertEqual(state, .processing)
        XCTAssertTrue(isActive)
        XCTAssertEqual(state.apiValue, "processing")

        await tracker.endActivity()
        state = await tracker.currentState()
        isActive = await tracker.isActive()
        XCTAssertEqual(state, .idle)
        XCTAssertFalse(isActive)
    }
}
