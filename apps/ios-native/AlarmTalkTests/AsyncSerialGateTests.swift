import XCTest
@testable import AlarmTalk

@MainActor
final class AsyncSerialGateTests: XCTestCase {
    func test_waitingRequestRunsWithItsOwnContextAfterCurrentPass() async {
        let gate = AsyncSerialGate()
        await gate.acquire()
        var calls: [String] = []
        let entered = expectation(description: "new reconcile requested")
        let next = Task { @MainActor in
            let owner = "new-owner"
            let forceIDs: Set<String> = ["new-voice"]
            entered.fulfill()
            await gate.acquire()
            defer { gate.release() }
            calls.append(owner)
            calls.append(contentsOf: forceIDs.sorted())
        }
        await fulfillment(of: [entered], timeout: 1)
        XCTAssertTrue(calls.isEmpty)
        gate.release()
        await next.value
        XCTAssertEqual(calls, ["new-owner", "new-voice"])
    }

    func test_cancelledWaiterReleasesItsTurnAndDoesNotCancelNextCaller() async {
        let gate = AsyncSerialGate()
        await gate.acquire()
        let entered = expectation(description: "cancelled caller queued")
        var scheduled: [String] = []
        let cancelled = Task { @MainActor in
            entered.fulfill()
            await gate.acquire()
            defer { gate.release() }
            guard !Task.isCancelled else { return }
            scheduled.append("cancelled")
        }
        await fulfillment(of: [entered], timeout: 1)
        cancelled.cancel()
        let next = Task { @MainActor in
            await gate.acquire()
            defer { gate.release() }
            guard !Task.isCancelled else { return }
            scheduled.append("next")
        }
        gate.release()
        await cancelled.value
        await next.value
        XCTAssertEqual(scheduled, ["next"])
    }
}
