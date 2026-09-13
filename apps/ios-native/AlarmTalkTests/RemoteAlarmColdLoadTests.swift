import XCTest
@testable import AlarmTalk

private actor DeferredAlarmLoad {
    private var result: [LocalAlarmRecord]?
    private var continuation: CheckedContinuation<[LocalAlarmRecord], Never>?

    func load() async -> [LocalAlarmRecord] {
        if let result { return result }
        return await withCheckedContinuation { continuation = $0 }
    }

    func finish(_ records: [LocalAlarmRecord] = []) {
        result = records
        continuation?.resume(returning: records)
        continuation = nil
    }
}

@MainActor
final class RemoteAlarmColdLoadTests: XCTestCase {
    private func makeStore(_ loader: DeferredAlarmLoad) -> LocalAlarmStore {
        LocalAlarmStore(
            storageURL: FileManager.default.temporaryDirectory.appendingPathComponent("cold-load-\(UUID()).json"),
            loadRecords: { await loader.load() }
        )
    }

    func test_pullBoundaryWaitsForDiskSnapshotBeforeAllowingImport() async throws {
        let loader = DeferredAlarmLoad()
        let store = makeStore(loader)
        let entered = expectation(description: "pull waiting for disk")
        var passedBoundary = false
        let pull = Task { @MainActor in
            entered.fulfill()
            try await RemoteAlarmPullSync.requireLoadedStore(store)
            passedBoundary = true
        }
        await fulfillment(of: [entered], timeout: 1)
        XCTAssertFalse(passedBoundary)
        XCTAssertFalse(store.hasLoadedFromDisk)
        await loader.finish([LocalAlarmRecord(id: "from-disk", label: "old", hour: 8, minute: 0, fireAtMillis: 1)])
        try await pull.value
        XCTAssertTrue(passedBoundary)
        XCTAssertEqual(store.alarms.map(\.id), ["from-disk"])
    }

    func test_timeoutDoesNotTreatEmptyUnloadedStoreAsReady() async {
        let loader = DeferredAlarmLoad()
        let store = makeStore(loader)
        do {
            try await RemoteAlarmPullSync.requireLoadedStore(store, timeout: 0)
            XCTFail("로드가 끝나지 않은 저장소에서 수신을 시작하면 안 된다")
        } catch {
            XCTAssertEqual(error as? RemoteAlarmPullSync.PullError, .storeNotReady)
        }
        XCTAssertFalse(store.hasLoadedFromDisk)
        await loader.finish()
    }

    func test_cancelledWaitDoesNotPassPullBoundary() async {
        let loader = DeferredAlarmLoad()
        let store = makeStore(loader)
        let entered = expectation(description: "pull started")
        let pull = Task { @MainActor in
            entered.fulfill()
            try await RemoteAlarmPullSync.requireLoadedStore(store)
        }
        await fulfillment(of: [entered], timeout: 1)
        pull.cancel()
        do { try await pull.value; XCTFail("취소된 pull은 진행하면 안 된다") }
        catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertFalse(store.hasLoadedFromDisk)
        await loader.finish()
    }
}
