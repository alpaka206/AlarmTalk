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

/// **콜드 스타트에 알람 저장소가 아직 디스크를 다 읽지 못했을 때.** 그 사이에 도는 일은 빈 목록을
/// '할 일 없음' 으로 읽으면 안 된다 — 올릴 행·끊어야 할 예약이 디스크에 있는데 빈손으로 끝났다고 세게 된다.
@MainActor
final class AlarmStoreColdLoadTests: XCTestCase {
    private func makeStore(_ loader: DeferredAlarmLoad) -> LocalAlarmStore {
        LocalAlarmStore(
            storageURL: FileManager.default.temporaryDirectory.appendingPathComponent("cold-load-\(UUID()).json"),
            loadRecords: { await loader.load() }
        )
    }

    #if canImport(AlarmKit)
    func test_timeoutPreservesPendingLiveAlarmUntilDiskRowCanBeCleared() async throws {
        try await assertCleanupWaitsForDisk(live: true, origin: .foreignCleanup)
    }

    func test_timeoutPreservesAlreadyGoneHandleAndItsDisableOriginUntilLoad() async throws {
        try await assertCleanupWaitsForDisk(live: false, origin: .accountLeave)
    }

    /// 못 끊은 예약 회수(`retryPendingCancellations`)는 저장소 로드 전에는 **아무것도 하지 않는다** —
    /// 빈 목록에서 OS 예약만 끊고 기록을 지우면 디스크 행에 죽은 핸들이 남는다.
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

        await store.waitUntilLoadedFromDisk(timeout: 0)
        XCTAssertFalse(store.hasLoadedFromDisk, "지연 중인 디스크 로드를 완료로 취급하면 안 된다")
        let cleared = await model.retryPendingCancellations(
            store: store, readScheduledIDs: readIDs, cancelAlarm: cancel
        )
        XCTAssertEqual(cleared, 0)
        XCTAssertEqual(reads, 0)
        XCTAssertTrue(cancellations.isEmpty)
        XCTAssertTrue(PendingAlarmCancellationStore.all.contains(raw))
        XCTAssertEqual(PendingAlarmCancellationStore.origin(of: raw), origin)
        XCTAssertEqual(PendingAlarmCancellationStore.owedHandles(forAlarmID: row.id), [raw])

        await loader.finish([row])
        await store.waitUntilLoadedFromDisk()
        XCTAssertTrue(store.hasLoadedFromDisk)
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
