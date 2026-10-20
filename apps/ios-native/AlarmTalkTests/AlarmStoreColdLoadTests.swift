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

    private func makeSync(host: String) -> (RemoteAlarmSyncViewModel, AuthViewModel, URLSession) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ColdLoadPushURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let api = AlarmTalkAPI(baseURL: URL(string: "https://\(host)/api/")!, session: session)
        let auth = AuthViewModel(api: api)
        auth._setSessionForTesting(AuthSession(token: "fresh-token", user: AuthUser(id: "owner", email: "owner@example.test")))
        return (RemoteAlarmSyncViewModel(api: api), auth, session)
    }

    /// 회차가 저장소 대기에 들어갈 때까지 메인 액터를 양보한다.
    private func waitUntilBusy(_ model: RemoteAlarmSyncViewModel) async {
        for _ in 0..<1_000 {
            if model.isBusy { return }
            await Task.yield()
        }
        XCTFail("동기화 회차가 시작되지 않았다")
    }

    private func unsyncedRow(_ id: String) -> LocalAlarmRecord {
        var row = LocalAlarmRecord(id: id, label: "alarm", hour: 8, minute: 0, fireAtMillis: 1)
        row.ownerUserId = "owner"
        return row
    }

    /// 회귀(코덱스 #823 7차): 알람 탭의 60초 스로틀은 **완결된 회차만** 칸을 남긴다
    /// (`AlarmTabSyncThrottle`). 그 판정이 `runFullSync` 의 반환값이다 — 의존성 전·사이클 실패는
    /// false, 끝까지 간 회차는 true.
    func test_fullSyncReportsWhetherTheCycleCompleted() async throws {
        let loader = DeferredAlarmLoad()
        let store = makeStore(loader)
        await loader.finish()
        await store.waitUntilLoadedFromDisk()
        XCTAssertTrue(store.hasLoadedFromDisk)
        let (model, auth, session) = makeSync(host: "cold-load-push.example.test")
        defer { session.invalidateAndCancel() }

        let beforeConfigure = await model.runFullSync()
        XCTAssertFalse(beforeConfigure, "의존성을 꽂기 전의 호출은 아무것도 올리지 않았다")

        model.configure(store: store, auth: auth)
        store.upsert(unsyncedRow("first"))
        let completed = await model.runFullSync()
        XCTAssertTrue(completed, "push 가 끝까지 가고 행 단위 실패가 없으면 완결이다")
        XCTAssertEqual(store.record(id: "first")?.syncStateEnum, .synced)

        // 스텁은 다른 토큰에 500 을 준다 — 그 행은 못 올렸다(부분 실패).
        auth._setSessionForTesting(AuthSession(token: "old-token", user: AuthUser(id: "owner", email: "owner@example.test")))
        store.upsert(unsyncedRow("second"))
        let failed = await model.runFullSync()
        XCTAssertFalse(failed, "못 올린 행이 있으면 완결이 아니다 — 다음 알람 탭 진입이 다시 돈다")
        XCTAssertEqual(store.record(id: "second")?.syncStateEnum, .syncFailed)
        XCTAssertFalse(model.isBusy)

        // 세션이 없으면 회차가 던진다(오프라인과 같은 갈래).
        auth._setSessionForTesting(nil)
        let noSession = await model.runFullSync()
        XCTAssertFalse(noSession)
        XCTAssertFalse(model.isBusy)
    }

    /// 저장소가 늦게 올라와도 **디스크의 행을 올린다** — 로드 전 빈 목록으로 회차를 끝내지 않는다.
    func test_fullSyncWaitsForDiskSnapshotBeforePushing() async throws {
        let loader = DeferredAlarmLoad()
        let store = makeStore(loader)
        let (model, auth, session) = makeSync(host: "cold-load-push.example.test")
        defer { session.invalidateAndCancel() }
        model.configure(store: store, auth: auth)

        var finished = false
        let sync = Task { @MainActor in
            defer { finished = true }
            return await model.runFullSync()
        }
        await waitUntilBusy(model)
        XCTAssertFalse(finished, "디스크를 읽기 전에 회차를 끝내면 안 된다")
        XCTAssertFalse(store.hasLoadedFromDisk)

        await loader.finish([unsyncedRow("from-disk")])
        let completed = await sync.value
        XCTAssertTrue(completed)
        XCTAssertEqual(store.record(id: "from-disk")?.syncStateEnum, .synced, "디스크에서 올라온 행을 올렸다")
    }

    /// 상한까지 못 읽었으면 **완결이 아니다** — 빈손으로 끝난 회차가 스로틀 칸을 남기면 60초 동안
    /// 알람 탭에 다시 들어와도 못 올린 변경을 다시 올리지 않는다.
    func test_fullSyncBeforeDiskLoadIsNotComplete() async {
        let loader = DeferredAlarmLoad()
        let store = makeStore(loader)
        let (model, auth, session) = makeSync(host: "cold-load-push.example.test")
        defer { session.invalidateAndCancel() }
        model.configure(store: store, auth: auth)

        let completed = await model.runFullSync(storeLoadTimeout: 0)
        XCTAssertFalse(completed)
        XCTAssertFalse(store.hasLoadedFromDisk)
        XCTAssertFalse(model.isBusy)
        await loader.finish()
    }

    /// 겹친 호출을 버리지 않는다 — 앞 회차가 저장소를 기다리는 사이 들어온 호출(알람 탭 진입·동의 직후)은 표시용
    /// busy 에 막혀 곧바로 돌아가지 않고, 차례를 기다렸다가 자기 회차를 돈다.
    func test_overlappingFullSyncWaitsForItsOwnTurn() async {
        let loader = DeferredAlarmLoad()
        let store = makeStore(loader)
        let (model, auth, session) = makeSync(host: "cold-load-push.example.test")
        defer { session.invalidateAndCancel() }
        model.configure(store: store, auth: auth)

        let first = Task { @MainActor in await model.runFullSync() }
        await waitUntilBusy(model)
        var secondFinished = false
        let second = Task { @MainActor in
            defer { secondFinished = true }
            return await model.runFullSync()
        }
        for _ in 0..<50 { await Task.yield() }
        XCTAssertFalse(secondFinished, "앞 회차가 도는 동안 뒤 호출을 끝난 것으로 돌려보내면 안 된다")

        await loader.finish([unsyncedRow("from-disk")])
        let firstCompleted = await first.value
        let secondCompleted = await second.value
        XCTAssertTrue(firstCompleted)
        XCTAssertTrue(secondCompleted)
        XCTAssertEqual(store.record(id: "from-disk")?.syncStateEnum, .synced)
        XCTAssertFalse(model.isBusy)
    }

    /// 탭을 떠나 취소된 회차도 완결이 아니다.
    func test_cancelledFullSyncWhileWaitingForDiskIsNotComplete() async {
        let loader = DeferredAlarmLoad()
        let store = makeStore(loader)
        let (model, auth, session) = makeSync(host: "cold-load-push.example.test")
        defer { session.invalidateAndCancel() }
        model.configure(store: store, auth: auth)

        let sync = Task { @MainActor in await model.runFullSync() }
        await waitUntilBusy(model)
        sync.cancel()
        let completed = await sync.value
        XCTAssertFalse(completed)
        XCTAssertFalse(model.isBusy)
        await loader.finish()
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

/// 외부 통신 없이 알람 올리기에 답한다. `fresh-token` 이 아니면 500 이다.
private final class ColdLoadPushURLProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "cold-load-push.example.test"
    }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url else { return }
        let status: Int
        let body: String
        if request.value(forHTTPHeaderField: "Authorization") != "Bearer fresh-token" {
            status = 500
            body = #"{"error":"unexpected token"}"#
        } else if url.path == "/api/alarm", request.httpMethod == "POST" {
            status = 200
            body = #"{"alarm":{"id":"remote-\#(UUID().uuidString)"}}"#
        } else if url.path.hasPrefix("/api/alarm/"), request.httpMethod == "PATCH" {
            status = 200
            body = #"{"alarm":{"id":"\#(url.lastPathComponent)"}}"#
        } else {
            status = 500
            body = #"{"error":"unexpected path"}"#
        }
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil,
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
