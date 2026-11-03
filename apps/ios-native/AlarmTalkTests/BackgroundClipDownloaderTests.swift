import Foundation
import XCTest
@testable import AlarmTalk

/// **앱을 닫아도 받는다** — 스톡 클립 백그라운드 다운로드(`BackgroundClipDownloader`, 스펙 voice-and-message
/// 「앱을 닫아도 받는다」)의 회귀 방지.
///
/// 진짜 background `URLSession` 은 쓰지 않는다 — 시뮬레이터 유닛 테스트에서는 배달 시점을 다룰 수 없고 네트워크를 탄다.
/// 세션 공장을 바꿔 **ephemeral 세션 + `URLProtocol` 스텁**을 꽂는다. 델리게이트 콜백(`didFinishDownloadingTo`)은 그 세션도
/// 똑같이 부르므로, 받은 파일 → 해석 → 캐시 쓰기 경로가 앱과 같다.
///
/// 저장 위치는 테스트 전용이다 — 묶음 표지는 이 테스트의 UserDefaults 스위트, 캐시·매니페스트는 `TestIsolation.storageSuffix`.
final class BackgroundClipDownloaderTests: XCTestCase {
    private static let host = "background-clip.example.test"
    private let ownerID = "owner-background"

    private var session: AuthSession {
        AuthSession(token: "token-background-\(name.hashValue)", user: AuthUser(id: ownerID, email: "bg@example.test"))
    }

    private var downloaders: [BackgroundClipDownloader] = []
    private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        defaults = UserDefaults(suiteName: "BackgroundClipDownloaderTests")
        defaults.removePersistentDomain(forName: "BackgroundClipDownloaderTests")
        BackgroundClipURLProtocol.reset()
    }

    override func tearDown() async throws {
        for downloader in downloaders {
            await downloader.cancelAll(forgetBatch: true)
            await downloader.waitForProcessing()
            downloader.invalidateForTesting()
        }
        downloaders.removeAll()
        BackgroundClipURLProtocol.reset()
        defaults.removePersistentDomain(forName: "BackgroundClipDownloaderTests")
        try await super.tearDown()
    }

    // MARK: - 재료

    private func makeDownloader(
        currentUserID: @escaping @Sendable () -> String? = { "owner-background" },
        cacheClip: BackgroundClipDownloader.CacheClip? = nil
    ) -> (BackgroundClipDownloader, CacheRecorder) {
        let recorder = CacheRecorder()
        let api = AlarmTalkAPI(baseURL: URL(string: "https://\(Self.host)/api/")!)
        let downloader = BackgroundClipDownloader(
            api: api,
            defaults: defaults,
            batchKey: "batch",
            currentUserID: currentUserID,
            cacheClip: cacheClip ?? { audio, messageId, cacheKey in
                await recorder.record(messageId: messageId, cacheKey: cacheKey, audio: audio)
            },
            makeSession: { delegate in
                let configuration = URLSessionConfiguration.ephemeral
                configuration.protocolClasses = [BackgroundClipURLProtocol.self]
                return URLSession(
                    configuration: configuration,
                    delegate: delegate,
                    delegateQueue: BackgroundClipDownloader.makeDelegateQueue()
                )
            }
        )
        downloaders.append(downloader)
        return (downloader, recorder)
    }

    private func clip(_ messageID: String, voice: String = systemVoiceIDPrefix + "000000000001") -> StockClip {
        StockClip(
            messageId: messageID,
            voiceProfileId: voice,
            voiceName: nil,
            category: "weather",
            language: "ko",
            text: "오늘은 맑아요",
            audioUrl: "https://r2.example/\(messageID).wav",
            variant: nil,
            renderedForCurrentVoice: nil
        )
    }

    private func descriptor(_ messageID: String, batch: String) -> BackgroundClipTask {
        BackgroundClipTask(
            messageId: messageID,
            cacheKey: AudioCacheStore.stockCacheKey(messageId: messageID),
            userId: ownerID,
            batchId: batch
        )
    }

    private func waitUntil(timeout: TimeInterval = 10, _ condition: () async -> Bool) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if await condition() { return true }
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
        return await condition()
    }

    // MARK: - taskDescription

    func test_taskDescription_은_왕복하고_우리_모양이_아니면_버린다() {
        let task = descriptor("m-1", batch: "b-1")
        XCTAssertEqual(BackgroundClipTask.decode(task.encoded), task)

        XCTAssertNil(BackgroundClipTask.decode(nil))
        XCTAssertNil(BackgroundClipTask.decode("not json"))
        // 캐시 자리가 그 클립의 스톡 키가 아니면 쓰지 않는다 — 다른 자리를 덮지 못하게.
        let wrongKey = BackgroundClipTask(messageId: "m-1", cacheKey: "remote-message-m-1", userId: ownerID, batchId: "b-1")
        XCTAssertNil(BackgroundClipTask.decode(wrongKey.encoded))
        var futureVersion = task
        futureVersion.version = BackgroundClipTask.currentVersion + 1
        XCTAssertNil(BackgroundClipTask.decode(futureVersion.encoded))
        let blankUser = BackgroundClipTask(messageId: "m-1", cacheKey: AudioCacheStore.stockCacheKey(messageId: "m-1"), userId: " ", batchId: "b-1")
        XCTAssertNil(BackgroundClipTask.decode(blankUser.encoded))
    }

    // MARK: - 세션 설정

    func test_백그라운드_설정은_앱을_다시_띄우고_미루지_않고_포그라운드와_같은_병렬수다() {
        let configuration = BackgroundClipDownloader.makeBackgroundConfiguration(identifier: "probe.background-clip")
        XCTAssertEqual(configuration.identifier, "probe.background-clip")
        XCTAssertTrue(configuration.sessionSendsLaunchEvents)
        XCTAssertFalse(configuration.isDiscretionary)
        XCTAssertEqual(configuration.httpMaximumConnectionsPerHost, StockClipPrefetcher.parallelism)
        XCTAssertTrue(BackgroundClipDownloader.sessionIdentifier.hasSuffix(".stock-clip-downloads"))
    }

    func test_앞_차례일수록_우선순위가_높다() {
        let priorities = (0..<5).map { BackgroundClipDownloader.priority(index: $0, count: 5) }
        XCTAssertEqual(priorities.first, URLSessionTask.highPriority)
        XCTAssertEqual(priorities.last, URLSessionTask.lowPriority)
        XCTAssertEqual(priorities, priorities.sorted(by: >))
        XCTAssertEqual(BackgroundClipDownloader.priority(index: 0, count: 1), URLSessionTask.highPriority)
    }

    // MARK: - 넘기기 → 델리게이트 → 캐시

    func test_넘긴_클립을_받으면_같은_요청으로_받고_캐시_쓰기에_넘긴다() async throws {
        let (downloader, recorder) = makeDownloader()
        let clips = [clip("a-1"), clip("a-2"), clip("a-3")]

        let count = await downloader.enqueue(clips, session: session)
        XCTAssertEqual(count, 3)
        let done = await waitUntil { await recorder.messageIDs.count == 3 }
        XCTAssertTrue(done, "델리게이트가 받은 파일을 캐시 쓰기로 넘겨야 한다")
        await downloader.waitForProcessing()

        let writtenIDs = await recorder.messageIDs
        let writtenKeys = await recorder.cacheKeys
        XCTAssertEqual(Set(writtenIDs), ["a-1", "a-2", "a-3"])
        XCTAssertEqual(Set(writtenKeys), Set(clips.map { AudioCacheStore.stockCacheKey(messageId: $0.messageId) }))
        // 요청은 포그라운드와 같은 빌더 — 경로·Bearer·앱 메타 헤더.
        let requests = BackgroundClipURLProtocol.requests
        XCTAssertEqual(requests.count, 3)
        for request in requests {
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer \(session.token)")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-App-Platform"), "ios")
            XCTAssertNotNil(request.value(forHTTPHeaderField: "X-App-Version"))
            XCTAssertEqual(request.url?.pathComponents.last, "audio")
        }
        // 받은 응답은 서버 JSON 을 그대로 해석한 것이다.
        let audio = await recorder.audios.first
        XCTAssertEqual(audio?.audioFormat, "wav")
        XCTAssertFalse(audio?.audioBase64.isEmpty ?? true)
    }

    /// 캐시 쓰기는 포그라운드와 **같은 함수**(`AudioCacheStore.cacheStockClipOffMain`)다 — 기본값 그대로 두면 받은 클립이
    /// 포그라운드 프리페처가 세는 캐시에 보인다(빠진 것에서 빠진다).
    func test_기본_캐시_쓰기는_포그라운드가_세는_캐시에_들어간다() async throws {
        let directory = try AudioCacheStore.audioDirectory()
        let target = clip("cache-1")
        for name in (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? [] where name.contains("cache-1") {
            try? FileManager.default.removeItem(at: directory.appendingPathComponent(name))
        }
        let missingBefore = await MainActor.run { StockClipPrefetcher.missingClips([target]) }
        XCTAssertEqual(missingBefore.count, 1)

        let api = AlarmTalkAPI(baseURL: URL(string: "https://\(Self.host)/api/")!)
        let downloader = BackgroundClipDownloader(
            api: api,
            defaults: defaults,
            batchKey: "batch",
            currentUserID: { "owner-background" },
            makeSession: { delegate in
                let configuration = URLSessionConfiguration.ephemeral
                configuration.protocolClasses = [BackgroundClipURLProtocol.self]
                return URLSession(configuration: configuration, delegate: delegate, delegateQueue: BackgroundClipDownloader.makeDelegateQueue())
            }
        )
        downloaders.append(downloader)
        await downloader.enqueue([target], session: session)

        let cached = await waitUntil {
            await MainActor.run { StockClipPrefetcher.missingClips([target]).isEmpty }
        }
        XCTAssertTrue(cached, "받은 클립은 포그라운드 프리페처가 보는 캐시에 있어야 한다")
    }

    // MARK: - 버리는 경우

    func test_다른_계정이_로그인해_있으면_받은_것을_버린다() async throws {
        let (downloader, recorder) = makeDownloader(currentUserID: { "someone-else" })
        await downloader.enqueue([clip("x-1")], session: session)
        _ = await waitUntil { BackgroundClipURLProtocol.requests.count == 1 }
        try? await Task.sleep(nanoseconds: 200_000_000)
        await downloader.waitForProcessing()
        let written = await recorder.messageIDs
        XCTAssertTrue(written.isEmpty, "계정이 바뀌었으면 앞 계정의 클립(내 목소리 포함)을 쓰지 않는다")
    }

    func test_로그아웃하면_늦게_온_완료를_버리고_같은_계정으로_다시_와도_앞_묶음은_버린다() async throws {
        let (downloader, recorder) = makeDownloader()
        BackgroundClipURLProtocol.hangAudio = true
        await downloader.enqueue([clip("late-1")], session: session)
        let batch = try XCTUnwrap(downloader.loadBatch())

        // 로그아웃 — 표지를 곧바로 지운다(기다리지 않는다).
        downloader.accountChanged(to: nil)
        XCTAssertNil(downloader.loadBatch())

        // 같은 계정으로 다시 로그인한 뒤 앞 묶음의 완료가 늦게 닿았다.
        let outcome = await downloader.handleDownloaded(
            descriptor: descriptor("late-1", batch: batch.id),
            data: BackgroundClipURLProtocol.audioBody(messageID: "late-1"),
            response: okResponse(),
            token: session.token
        )
        XCTAssertEqual(outcome, .discarded)
        let written = await recorder.messageIDs
        XCTAssertTrue(written.isEmpty)
        // 떠 있던 task 도 거뒀다.
        let stopped = await waitUntil { BackgroundClipURLProtocol.stoppedCount >= 1 }
        XCTAssertTrue(stopped)
    }

    private func okResponse(status: Int = 200) -> HTTPURLResponse {
        HTTPURLResponse(url: URL(string: "https://\(Self.host)/")!, statusCode: status, httpVersion: nil, headerFields: nil)!
    }

    func test_같은_계정의_콜드_스타트는_묶음을_버리지_않는다() async {
        let (downloader, _) = makeDownloader()
        BackgroundClipURLProtocol.hangAudio = true
        await downloader.enqueue([clip("keep-1")], session: session)
        let batch = downloader.loadBatch()
        downloader.accountChanged(to: ownerID)
        XCTAssertEqual(downloader.loadBatch(), batch)
    }

    // MARK: - 401 · 403

    func test_401_이면_기존_세션_만료_알림을_타고_남은_task_를_거둔다() async throws {
        let (downloader, recorder) = makeDownloader()
        BackgroundClipURLProtocol.statusByMessageID = ["expired-1": 401]
        BackgroundClipURLProtocol.hangOthers = true
        let token = session.token
        let posted = expectation(forNotification: AlarmTalkAPI.unauthorizedNotification, object: nil) { note in
            note.userInfo?[AlarmTalkAPI.unauthorizedTokenKey] as? String == token
        }

        await downloader.enqueue([clip("expired-1"), clip("pending-1")], session: session)
        await fulfillment(of: [posted], timeout: 10)

        // 끝난 요청도 `stopLoading` 을 받으므로 둘 다 멈춰야 남은 하나까지 거둔 것이다.
        let cancelled = await waitUntil { BackgroundClipURLProtocol.stoppedCount >= 2 }
        XCTAssertTrue(cancelled, "같은 토큰의 나머지는 같은 답을 받는다 — 남은 task 를 취소한다")
        await downloader.waitForProcessing()
        let written = await recorder.messageIDs
        XCTAssertTrue(written.isEmpty)
    }

    func test_403_도_거절로_보고_우리_모양이_아니면_버린다() async throws {
        let (downloader, recorder) = makeDownloader()
        BackgroundClipURLProtocol.hangAudio = true
        await downloader.enqueue([clip("consent-1")], session: session)
        let batch = try XCTUnwrap(downloader.loadBatch())

        let rejected = await downloader.handleDownloaded(
            descriptor: descriptor("consent-1", batch: batch.id),
            data: Data(#"{"error":"consent","error_code":"CONSENT_REQUIRED"}"#.utf8),
            response: okResponse(status: 403),
            token: session.token
        )
        XCTAssertEqual(rejected, .rejected)

        let foreign = await downloader.handleDownloaded(
            descriptor: BackgroundClipTask.decode("someone else's task"),
            data: BackgroundClipURLProtocol.audioBody(messageID: "consent-1"),
            response: okResponse(),
            token: session.token
        )
        XCTAssertEqual(foreign, .discarded, "우리 모양이 아닌 task 는 아무것도 쓰지 않는다")

        let empty = await downloader.handleDownloaded(
            descriptor: descriptor("consent-1", batch: batch.id),
            data: Data(),
            response: okResponse(),
            token: session.token
        )
        XCTAssertEqual(empty, .failed)
        let written = await recorder.messageIDs
        XCTAssertTrue(written.isEmpty)
    }

    // MARK: - 거두기 (앞으로 올 때)

    func test_앞으로_오면_남은_task_를_취소하고_도는_넘기기도_멈춘다() async {
        let (downloader, _) = makeDownloader()
        BackgroundClipURLProtocol.hangAudio = true
        await downloader.enqueue([clip("h-1"), clip("h-2")], session: session)
        _ = await waitUntil { BackgroundClipURLProtocol.requests.count == 2 }

        let epochBefore = downloader.handOffEpoch
        await downloader.cancelAll(forgetBatch: false)
        XCTAssertGreaterThan(downloader.handOffEpoch, epochBefore)
        let stopped = await waitUntil { BackgroundClipURLProtocol.stoppedCount >= 2 }
        XCTAssertTrue(stopped, "포그라운드가 받으므로 백그라운드 task 는 거둔다 — 같은 클립을 두 곳이 받지 않는다")
        XCTAssertNotNil(downloader.loadBatch(), "앞으로 올 때는 묶음을 버리지 않는다 — 이미 받은 늦은 완료는 써도 된다")

        // 거두기 전에 시작한 넘기기는 아무것도 넘기지 않는다.
        let stale = await downloader.enqueue([clip("h-3")], session: session, epoch: epochBefore)
        XCTAssertEqual(stale, 0)
    }

    func test_넘긴_적이_없으면_거두기가_세션을_만들지_않는다() async {
        let made = SessionCounter()
        let downloader = BackgroundClipDownloader(
            api: AlarmTalkAPI(baseURL: URL(string: "https://\(Self.host)/api/")!),
            defaults: defaults,
            batchKey: "batch-none",
            currentUserID: { "owner-background" },
            makeSession: { delegate in
                made.increment()
                return URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: nil)
            }
        )
        downloaders.append(downloader)
        await downloader.cancelAll(forgetBatch: false)
        downloader.accountChanged(to: nil)
        XCTAssertEqual(made.value, 0, "넘긴 적이 없는 실행에서 백그라운드 세션을 띄우지 않는다")
    }

    // MARK: - 시스템이 다시 띄웠을 때

    func test_우리_세션이_아니면_핸들러를_맡지_않는다() {
        let (downloader, _) = makeDownloader()
        XCTAssertFalse(downloader.handleEvents(forSessionIdentifier: "someone.else") {})
    }

    func test_이벤트가_끝나면_넣은_뒤에_예약_훅을_부르고_완료_핸들러를_메인에서_부른다() async {
        // 캐시 쓰기가 **아직 도는 중에** 시스템이 '이벤트 끝' 을 알린다 — 그래도 쓰기가 끝난 뒤에 세어 훅을 불러야 한다.
        let writing = CacheRecorder()
        let (downloader, _) = makeDownloader(cacheClip: { audio, messageId, cacheKey in
            await writing.markStarted()
            try? await Task.sleep(nanoseconds: 300_000_000)
            await writing.record(messageId: messageId, cacheKey: cacheKey, audio: audio)
        })
        let hookCalled = expectation(description: "예약 훅")
        let handlerCalled = expectation(description: "완료 핸들러")
        downloader.onClipsCached = {
            let written = await writing.messageIDs
            XCTAssertEqual(written, ["e-1"], "훅은 받은 것을 다 넣은 뒤에 분다")
            hookCalled.fulfill()
        }
        XCTAssertTrue(downloader.handleEvents(forSessionIdentifier: BackgroundClipDownloader.sessionIdentifier) {
            XCTAssertTrue(Thread.isMainThread, "완료 핸들러는 메인에서 부른다")
            handlerCalled.fulfill()
        })

        await downloader.enqueue([clip("e-1")], session: session)
        _ = await waitUntil { await writing.started }
        // 시스템이 쌓인 이벤트를 다 배달했다.
        downloader.urlSessionDidFinishEvents(forBackgroundURLSession: URLSession(configuration: .ephemeral))
        await fulfillment(of: [hookCalled, handlerCalled], timeout: 10, enforceOrder: true)
    }

    func test_넣은_것이_없으면_예약_훅을_부르지_않는다() async {
        let (downloader, _) = makeDownloader()
        let handlerCalled = expectation(description: "완료 핸들러")
        let hookCalled = expectation(description: "예약 훅")
        hookCalled.isInverted = true
        downloader.onClipsCached = { hookCalled.fulfill() }
        _ = downloader.handleEvents(forSessionIdentifier: BackgroundClipDownloader.sessionIdentifier) { handlerCalled.fulfill() }
        downloader.urlSessionDidFinishEvents(forBackgroundURLSession: URLSession(configuration: .ephemeral))
        await fulfillment(of: [handlerCalled, hookCalled], timeout: 1)
    }
}

// MARK: - 프리페처의 넘기기

/// 앱이 백그라운드로 갈 때 **포그라운드와 같은 대상**을 **같은 순서**로 넘기는가(`StockClipPrefetcher.handOffToBackground`).
@MainActor
final class StockClipBackgroundHandOffTests: XCTestCase {
    private static let host = "background-clip.example.test"
    private let ownerID = "owner-handoff"
    private var downloader: BackgroundClipDownloader!
    private var defaults: UserDefaults!

    private var session: AuthSession {
        AuthSession(token: "token-handoff", user: AuthUser(id: ownerID, email: "handoff@example.test"))
    }

    override func setUpWithError() throws {
        StockClipManifestStore.clear()
        let directory = try AudioCacheStore.audioDirectory()
        for name in (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? [] {
            try? FileManager.default.removeItem(at: directory.appendingPathComponent(name))
        }
        BackgroundClipURLProtocol.reset()
        BackgroundClipURLProtocol.hangAudio = true
        defaults = UserDefaults(suiteName: "StockClipBackgroundHandOffTests")
        defaults.removePersistentDomain(forName: "StockClipBackgroundHandOffTests")
        downloader = BackgroundClipDownloader(
            api: AlarmTalkAPI(baseURL: URL(string: "https://\(Self.host)/api/")!),
            defaults: defaults,
            batchKey: "batch",
            currentUserID: { "owner-handoff" },
            cacheClip: { _, _, _ in },
            makeSession: { delegate in
                let configuration = URLSessionConfiguration.ephemeral
                configuration.protocolClasses = [BackgroundClipURLProtocol.self]
                return URLSession(configuration: configuration, delegate: delegate, delegateQueue: BackgroundClipDownloader.makeDelegateQueue())
            }
        )
    }

    override func tearDown() async throws {
        await downloader.cancelAll(forgetBatch: true)
        downloader.invalidateForTesting()
        BackgroundClipURLProtocol.reset()
        StockClipManifestStore.clear()
        defaults.removePersistentDomain(forName: "StockClipBackgroundHandOffTests")
        try await super.tearDown()
    }

    private func clip(_ messageID: String, voice: String, category: String = "weather") -> StockClip {
        StockClip(
            messageId: messageID,
            voiceProfileId: voice,
            voiceName: nil,
            category: category,
            language: "ko",
            text: "문구",
            audioUrl: "https://r2.example/\(messageID).wav",
            variant: nil,
            renderedForCurrentVoice: nil
        )
    }

    private func publish(_ clips: [StockClip]) {
        let ticket = StockClipManifestStore.beginFetch(session: session)
        let result = StockClipManifestStore.save(
            StockClipListResponse(clips: clips, expectedVariants: nil, legacyBucketHints: nil),
            ticket: ticket
        )
        XCTAssertEqual(result, .published)
    }

    func test_빠진_것만_받을_순서대로_넘기고_남의_목소리는_넘기지_않는다() async {
        let mina = systemVoiceIDPrefix + "000000000001"
        let siwoo = systemVoiceIDPrefix + "000000000002"
        let myClone = "clone-mine"
        let otherClone = "clone-other"
        publish([
            clip("mina-weather", voice: mina),
            clip("siwoo-weather", voice: siwoo),
            clip("siwoo-fortune", voice: siwoo, category: "fortune"),
            clip("mine-1", voice: myClone, category: "greeting"),
            clip("other-1", voice: otherClone),
        ])

        let prefetcher = StockClipPrefetcher()
        // 저장된 다음 알람이 시우 × 운세 — 그게 맨 앞이다(받는 순서 1번).
        prefetcher.savedTargets = { [StockClipPrefetcher.PrefetchTarget(voiceID: siwoo, category: "fortune")] }
        let handed = await prefetcher.handOffToBackground(
            session: session,
            language: "ko",
            ownedVoiceProfileIDs: [myClone],
            currentUserID: { "owner-handoff" },
            downloader: downloader
        )
        XCTAssertEqual(handed, 4, "남의 클론은 대상이 아니다(포그라운드와 같은 대상)")
        _ = await waitUntil { BackgroundClipURLProtocol.requests.count == 4 }
        let requested = BackgroundClipURLProtocol.requests.compactMap { $0.url?.pathComponents.dropLast().last }
        XCTAssertEqual(Set(requested), ["mina-weather", "siwoo-weather", "siwoo-fortune", "mine-1"])
        XCTAssertFalse(requested.contains("other-1"))
        XCTAssertNotNil(downloader.loadBatch())
        // 넘긴 차례는 포그라운드의 받는 순서(`prioritized`) 그대로다 — 저장된 다음 알람(시우 × 운세)이 맨 앞, 같은 칸은 매니페스트 순서.
        let order = await downloader.pendingTasksInOrder().map(\.messageId)
        XCTAssertEqual(order, ["siwoo-fortune", "siwoo-weather", "mina-weather", "mine-1"])
    }

    func test_무료_계정이면_내_목소리_클립을_넘기지_않는다() async {
        let mina = systemVoiceIDPrefix + "000000000001"
        publish([clip("mina-weather", voice: mina), clip("mine-1", voice: "clone-mine")])
        let prefetcher = StockClipPrefetcher()
        // 무료면 앱이 내 목소리 id 를 비워 부른다(포그라운드 `start` 와 같은 입력).
        let handed = await prefetcher.handOffToBackground(
            session: session,
            language: "ko",
            ownedVoiceProfileIDs: [],
            currentUserID: { "owner-handoff" },
            downloader: downloader
        )
        XCTAssertEqual(handed, 1)
    }

    func test_매니페스트가_없거나_다_받았으면_아무것도_넘기지_않는다() async {
        let prefetcher = StockClipPrefetcher()
        let none = await prefetcher.handOffToBackground(
            session: session, language: "ko", currentUserID: { "owner-handoff" }, downloader: downloader
        )
        XCTAssertEqual(none, 0)
        XCTAssertNil(downloader.loadBatch())
    }

    func test_계정이_바뀌었으면_넘기지_않는다() async {
        publish([clip("mina-weather", voice: systemVoiceIDPrefix + "000000000001")])
        let prefetcher = StockClipPrefetcher()
        let handed = await prefetcher.handOffToBackground(
            session: session, language: "ko", currentUserID: { "someone-else" }, downloader: downloader
        )
        XCTAssertEqual(handed, 0)
    }

    private func waitUntil(timeout: TimeInterval = 10, _ condition: () -> Bool) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
        return condition()
    }
}

// MARK: - 더블

private actor CacheRecorder {
    private(set) var messageIDs: [String] = []
    private(set) var cacheKeys: [String] = []
    private(set) var audios: [TtsMessageAudioResponse] = []

    private(set) var started = false
    func markStarted() { started = true }

    func record(messageId: String, cacheKey: String, audio: TtsMessageAudioResponse) {
        messageIDs.append(messageId)
        cacheKeys.append(cacheKey)
        audios.append(audio)
    }
}

private final class SessionCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    func increment() { lock.withLock { count += 1 } }
    var value: Int { lock.withLock { count } }
}

/// `tts/messages/:id/audio` 만 흉내 낸다. 응답을 늦추거나(`hangAudio`) 상태 코드를 바꿀 수 있다.
private final class BackgroundClipURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private nonisolated(unsafe) static var _requests: [URLRequest] = []
    private nonisolated(unsafe) static var _stopped = 0
    private nonisolated(unsafe) static var _hangAudio = false
    private nonisolated(unsafe) static var _hangOthers = false
    private nonisolated(unsafe) static var _status: [String: Int] = [:]

    static var requests: [URLRequest] { lock.withLock { _requests } }
    static var stoppedCount: Int { lock.withLock { _stopped } }
    /// 모든 오디오 요청을 붙들어 둔다(취소 시험).
    static var hangAudio: Bool {
        get { lock.withLock { _hangAudio } }
        set { lock.withLock { _hangAudio = newValue } }
    }
    /// `statusByMessageID` 에 없는 요청만 붙들어 둔다.
    static var hangOthers: Bool {
        get { lock.withLock { _hangOthers } }
        set { lock.withLock { _hangOthers = newValue } }
    }
    static var statusByMessageID: [String: Int] {
        get { lock.withLock { _status } }
        set { lock.withLock { _status = newValue } }
    }

    static func reset() {
        lock.withLock {
            _requests = []
            _stopped = 0
            _hangAudio = false
            _hangOthers = false
            _status = [:]
        }
    }

    /// 8kHz 모노 PCM 50ms — `StockClipPrefetcherSupersededTests` 와 같은 이유(가짜 MP3 는 길이 조회가 매달린다).
    private static let audioFixture: Data = {
        let pcm = Data(repeating: 0, count: 800)
        var data = Data("RIFF".utf8)
        func append<T: FixedWidthInteger>(_ value: T) {
            var littleEndian = value.littleEndian
            withUnsafeBytes(of: &littleEndian) { data.append(contentsOf: $0) }
        }
        append(UInt32(36 + pcm.count))
        data.append(Data("WAVEfmt ".utf8))
        append(UInt32(16))
        append(UInt16(1))
        append(UInt16(1))
        append(UInt32(8_000))
        append(UInt32(16_000))
        append(UInt16(2))
        append(UInt16(16))
        data.append(Data("data".utf8))
        append(UInt32(pcm.count))
        data.append(pcm)
        return data
    }()

    static func audioBody(messageID: String) -> Data {
        Data("""
        {"message_id":"\(messageID)","audio_base64":"\(audioFixture.base64EncodedString())","audio_format":"wav",\
        "audio_url":"https://r2.example/\(messageID).wav"}
        """.utf8)
    }

    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "background-clip.example.test"
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let components = request.url?.pathComponents ?? []
        guard let index = components.firstIndex(of: "messages"),
              components.indices.contains(index + 1),
              components.last == "audio" else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }
        let messageID = components[index + 1]
        let (status, hang) = Self.lock.withLock { () -> (Int?, Bool) in
            Self._requests.append(request)
            let status = Self._status[messageID]
            return (status, Self._hangAudio || (Self._hangOthers && status == nil))
        }
        if hang { return }
        let code = status ?? 200
        let body = code == 200
            ? Self.audioBody(messageID: messageID)
            : Data(#"{"error":"expired","error_code":"TOKEN_EXPIRED"}"#.utf8)
        client?.urlProtocol(
            self,
            didReceive: HTTPURLResponse(
                url: request.url!, statusCode: code, httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!,
            cacheStoragePolicy: .notAllowed
        )
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {
        Self.lock.withLock { Self._stopped += 1 }
    }
}
