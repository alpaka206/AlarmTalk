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

    func test_queuedPullRunsItsOwnCycleAfterFirstColdLoadTimeout() async throws {
        try await assertQueuedPullSurvivesFirstFailure(cancelFirst: false)
    }

    func test_queuedPullKeepsItsOwnCancellationAndReadsLatestSession() async throws {
        try await assertQueuedPullSurvivesFirstFailure(cancelFirst: true)
    }

    func test_familyPushThroughFullSyncSurvivesFirstColdLoadTimeout() async {
        await assertQueuedFullSync(cancelFirst: false)
    }

    func test_familyPushThroughFullSyncSurvivesFirstCancellation() async {
        await assertQueuedFullSync(cancelFirst: true)
    }

    func test_cancelledFamilyPushPassesTurnToNextFullSync() async {
        await assertQueuedFullSync(cancelFirst: false, cancelQueued: true)
    }

    private func assertQueuedFullSync(cancelFirst: Bool, cancelQueued: Bool = false) async {
        let loader = DeferredAlarmLoad()
        let store = makeStore(loader)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [QueuedPullURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let api = AlarmTalkAPI(baseURL: URL(string: "https://pull-queue.example.test/api/")!, session: session)
        let auth = AuthViewModel(api: api)
        auth._setSessionForTesting(AuthSession(token: "old-token", user: AuthUser(id: "old-owner", email: "old@example.test")))
        let firstWait = AsyncSerialGate()
        await firstWait.acquire()
        let firstEntered = expectation(description: "startup full sync waits for disk")
        let secondEntered = expectation(description: "family callback gets its own disk wait")
        let requested = expectation(description: "family push arrives during startup")
        let httpRequested = expectation(forNotification: QueuedPullURLProtocol.didListAlarms, object: nil)
        let model = RemoteAlarmSyncViewModel(api: api)
        var waits = 0
        model.configure(store: store, alarmKit: AlarmKitViewModel(), auth: auth, waitForStore: { store in
            waits += 1
            if waits == 1 {
                firstEntered.fulfill()
                await firstWait.acquire()
                defer { firstWait.release() }
                try await RemoteAlarmPullSync.requireLoadedStore(store, timeout: 0)
            } else {
                secondEntered.fulfill()
                try await RemoteAlarmPullSync.requireLoadedStore(store)
            }
        })
        let coordinator = PushNotificationCoordinator(api: api, requestAPNsToken: {})
        // AlarmTalkApp과 같은 콜백/래퍼를 실제 푸시 디스패처에서 호출한다.
        coordinator.onFamilyAlarm = { await model.runFullSync() }
        let startup = Task { @MainActor in await model.runFullSync() }
        await fulfillment(of: [firstEntered], timeout: 1)
        XCTAssertTrue(model.isBusy)
        var pushFinished = false
        let family = Task { @MainActor in
            requested.fulfill()
            await coordinator.handle(userInfo: ["type": "family_alarm"])
            pushFinished = true
        }
        await fulfillment(of: [requested], timeout: 1)
        XCTAssertFalse(pushFinished, "상위 busy 가드가 푸시를 버리면 안 된다")
        var nextFamily: Task<Void, Never>?
        if cancelQueued {
            family.cancel()
            nextFamily = Task { @MainActor in
                _ = await coordinator.handle(userInfo: ["type": "family_alarm"])
            }
        }
        auth._setSessionForTesting(AuthSession(token: "fresh-token", user: AuthUser(id: "fresh-owner", email: "fresh@example.test")))
        if cancelFirst { startup.cancel() }
        firstWait.release()
        await startup.value
        await fulfillment(of: [secondEntered], timeout: 1)
        XCTAssertTrue(model.isBusy)
        XCTAssertFalse(store.hasLoadedFromDisk)
        await loader.finish()
        await family.value
        await nextFamily?.value
        await fulfillment(of: [httpRequested], timeout: 1)
        XCTAssertEqual(waits, 2, "취소된 대기 호출은 pull을 시작하면 안 된다")
        XCTAssertFalse(model.isBusy)
        XCTAssertNil(model.statusMessage)
    }

    private func assertQueuedPullSurvivesFirstFailure(cancelFirst: Bool) async throws {
        let loader = DeferredAlarmLoad()
        let store = makeStore(loader)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [QueuedPullURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let api = AlarmTalkAPI(baseURL: URL(string: "https://pull-queue.example.test/api/")!, session: session)
        let auth = AuthViewModel(api: api)
        auth._setSessionForTesting(AuthSession(token: "old-token", user: AuthUser(id: "old-owner", email: "old@example.test")))
        let alarmKit = AlarmKitViewModel()
        let firstWait = AsyncSerialGate()
        await firstWait.acquire()
        let firstEntered = expectation(description: "first pull waiting on cold store")
        let secondRequested = expectation(description: "family push requested while first pull is waiting")
        let secondEntered = expectation(description: "queued pull starts its own readiness wait")
        let firstPull = RemoteAlarmPullSync(api: api, store: store, alarmKit: alarmKit, auth: auth,
                                           waitForStore: { store in
            firstEntered.fulfill()
            await firstWait.acquire()
            defer { firstWait.release() }
            // 실제 시간 경과 대신 준비 경계에서 시간 초과/취소를 일으킨다.
            try await RemoteAlarmPullSync.requireLoadedStore(store, timeout: 0)
        })
        let queuedPull = RemoteAlarmPullSync(api: api, store: store, alarmKit: alarmKit, auth: auth,
                                            waitForStore: { store in
            secondEntered.fulfill()
            try await RemoteAlarmPullSync.requireLoadedStore(store)
        })
        let first = Task { @MainActor in try await firstPull.runOnce() }
        await fulfillment(of: [firstEntered], timeout: 1)
        var queuedFinished = false
        let queued = Task { @MainActor in
            secondRequested.fulfill()
            defer { queuedFinished = true }
            return try await queuedPull.runOnce()
        }
        await fulfillment(of: [secondRequested], timeout: 1)
        XCTAssertFalse(queuedFinished, "실제 수신 전에 성공을 반환하면 안 된다")
        XCTAssertFalse(store.hasLoadedFromDisk)

        // 대기 전 계정이 아니라 자기 회차를 실행하는 시점의 세션을 사용한다.
        auth._setSessionForTesting(AuthSession(token: "fresh-token", user: AuthUser(id: "fresh-owner", email: "fresh@example.test")))
        if cancelFirst { first.cancel() }
        firstWait.release()
        switch await first.result {
        case .success: XCTFail("로드되지 않은 첫 회차는 성공하면 안 된다")
        case .failure(let error):
            if cancelFirst { XCTAssertTrue(error is CancellationError) }
            else { XCTAssertEqual(error as? RemoteAlarmPullSync.PullError, .storeNotReady) }
        }
        await fulfillment(of: [secondEntered], timeout: 1)
        XCTAssertFalse(queuedFinished)
        await loader.finish()
        let result = try await queued.value
        // 잘못된 시각의 수신 행으로 실제 HTTP/디코딩/회차 결과를 거쳤는지 구별한다.
        // 이 사례에서는 음원 조회·OS 예약·공유 API의 ACK를 호출하지 않는다.
        XCTAssertEqual(result, RemoteAlarmPullSync.PullResult(imported: 0, updated: 0, skipped: 1, failed: 0))
        XCTAssertTrue(queuedFinished)
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

/// 외부 통신 없이 실제 pull 회차를 실행한다. 다른 토큰에는 성공을 반환하지 않는다.
private final class QueuedPullURLProtocol: URLProtocol, @unchecked Sendable {
    static let didListAlarms = Notification.Name("QueuedPullDidListAlarms")
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url else { return }
        let body: String
        let status: Int
        if url.host != "pull-queue.example.test" || request.value(forHTTPHeaderField: "Authorization") != "Bearer fresh-token" {
            status = 500
            body = #"{"error":"unexpected request"}"#
        } else if url.path == "/api/alarm" {
            status = 200
            body = #"{"alarms":[{"id":"received","target_user_id":"fresh-owner","sender_user_id":"sender","time":"invalid"}],"has_more":false,"next_cursor":null}"#
            NotificationCenter.default.post(name: Self.didListAlarms, object: nil)
        } else if url.path == "/api/alarm/declined" {
            status = 200
            body = #"{"alarm_ids":[],"revoked_alarm_ids":[],"has_more":false}"#
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
