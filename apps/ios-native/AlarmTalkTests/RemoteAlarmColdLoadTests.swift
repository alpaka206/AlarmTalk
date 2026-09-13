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

    #if canImport(AlarmKit)
    func test_timeoutPreservesPendingLiveAlarmUntilDiskRowCanBeCleared() async throws {
        try await assertCleanupWaitsForDisk(live: true, origin: .foreignCleanup)
    }

    func test_timeoutPreservesAlreadyGoneHandleAndItsDisableOriginUntilLoad() async throws {
        try await assertCleanupWaitsForDisk(live: false, origin: .accountLeave)
    }

    private func assertCleanupWaitsForDisk(
        live: Bool, origin: PendingAlarmCancellationStore.Origin
    ) async throws {
        let loader = DeferredAlarmLoad()
        let store = makeStore(loader)
        let model = AlarmKitViewModel()
        let handle = UUID()
        let raw = handle.uuidString
        let row = LocalAlarmRecord(id: "pending-\(raw)", label: "pending", hour: 8, minute: 0,
                                   fireAtMillis: 1, enabled: true, alarmKitID: raw)
        PendingAlarmCancellationStore.add(raw, origin: origin, alarmID: row.id)
        defer { PendingAlarmCancellationStore.remove(raw) }
        var reads = 0
        var cancellations: [UUID] = []
        let readIDs: () throws -> Set<UUID> = { reads += 1; return live ? [handle] : [] }
        let cancel: (UUID) throws -> Void = { cancellations.append($0) }

        do {
            try await RemoteAlarmPullSync.requireLoadedStore(store, timeout: 0)
            XCTFail("지연 중인 디스크 로드를 완료로 취급하면 안 된다")
        } catch {
            XCTAssertEqual(error as? RemoteAlarmPullSync.PullError, .storeNotReady)
            // runOnce의 catch가 호출하는 실제 후처리이며 OS 접점만 대체한다.
            let cleared = await model.retryPendingCancellations(
                store: store, readScheduledIDs: readIDs, cancelAlarm: cancel
            )
            XCTAssertEqual(cleared, 0)
        }
        XCTAssertEqual(reads, 0)
        XCTAssertTrue(cancellations.isEmpty)
        XCTAssertTrue(PendingAlarmCancellationStore.all.contains(raw))
        XCTAssertEqual(PendingAlarmCancellationStore.origin(of: raw), origin)
        XCTAssertEqual(PendingAlarmCancellationStore.owedHandles(forAlarmID: row.id), [raw])

        await loader.finish([row])
        try await RemoteAlarmPullSync.requireLoadedStore(store)
        XCTAssertEqual(store.record(id: row.id)?.alarmKitID, raw)
        _ = await model.retryPendingCancellations(
            store: store, readScheduledIDs: readIDs, cancelAlarm: cancel
        )
        XCTAssertEqual(reads, 1)
        XCTAssertEqual(cancellations, live ? [handle] : [])
        XCTAssertFalse(PendingAlarmCancellationStore.all.contains(raw))
        XCTAssertNil(store.record(id: row.id)?.alarmKitID)
        XCTAssertEqual(store.record(id: row.id)?.enabled, !origin.restoresDisabledRow)
    }
    #endif
}
