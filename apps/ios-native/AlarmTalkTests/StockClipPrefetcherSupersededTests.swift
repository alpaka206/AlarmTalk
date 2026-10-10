import Foundation
import XCTest
@testable import AlarmTalk

/// **공개 경합에서 물러난 회차는 실패가 아니다**(2026-09-22, R1 후속 회귀 방지).
///
/// `StockClipPrefetcher.run` 은 매니페스트를 받은 뒤 `StockClipManifestStore.save` 로 공개한다.
/// 그 사이 더 새 표가 먼저 공개되면 `.superseded` 가 오는데, 예전에는 이걸 `.failed` 로 뭉쳐
/// 30초 재시도 루프에 들어갔다 — `VoiceSetupView` 는 「목소리를 받지 못했어요」+'다시 시도' 를
/// 띄우고, 등록 진행률(`ClonePrerenderDrive`)은 50% 에 30초 멈췄다. 실제로 늘 일어나는
/// 순서다: 로그인·콜드스타트에서 `AlarmTalkApp` 의 `.task(id: auth.session?.user.id)` 가 부르는
/// `start`(표 N)와 `.task(id: stockClipLanguageKey)` → `loadStockClips(force: true)`(표 N+1)가
/// 같은 엔드포인트를 거의 동시에 부른다. 안드로이드 `StockClipPrefetchWorker` 는 SUPERSEDED 를
/// 「물러난다 = 성공」으로 끝낸다.
///
/// 여기서는 그 경합을 **스텁 안에서** 재현한다: 프리페처의 표(N)가 요청 중일 때 스텁이 표
/// N+1 을 뽑아 먼저 공개하고 나서야 응답을 돌려준다. 그러면 프리페처의 `save` 는 반드시
/// `.superseded` 다. 단언 둘: state 가 `.failed` 가 **아니고**, 받는 목록이 **이긴 매니페스트**
/// (디스크 권위)의 것이다.
///
/// 네트워크는 타지 않는다 — `URLProtocol` 스텁(`AlarmCreationReplayTests` 와 같은 방식).
/// 저장 위치는 전부 테스트 전용이다(`TestIsolation.storageSuffix` — 매니페스트 파일도 캐시
/// 디렉터리도 사용자 것과 갈라져 있다. `StockClipProgressScanTests` 의 근거와 같다).
@MainActor
final class StockClipPrefetcherSupersededTests: XCTestCase {
    private static let host = "stock-superseded.example.test"
    private let ownerID = "owner-superseded"

    private var session: AuthSession {
        AuthSession(token: "token-superseded", user: AuthUser(id: ownerID, email: "test@example.test"))
    }

    private var prefetchers: [StockClipPrefetcher] = []
    private var sessions: [URLSession] = []

    override func setUpWithError() throws {
        // 전역 저장소는 프로세스에 하나다 — 앞 테스트가 남긴 표·격리 표시를 지운다.
        StockClipManifestStore.clear()
        // 캐시가 비어 있어야 '받을 것' 이 생긴다.
        let directory = try AudioCacheStore.audioDirectory()
        for name in (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? [] {
            try? FileManager.default.removeItem(at: directory.appendingPathComponent(name))
        }
        SupersededManifestURLProtocol.reset()
    }

    override func tearDown() async throws {
        // 한 테스트가 여러 회차를 만든다. 마지막 것만 취소하면 앞 회차가 유출된다.
        // 취소 신호만 보낸 뒤 기록을 비우지 않고 파일 처리·요청이 끝날 때까지 기다린다.
        for prefetcher in prefetchers {
            await prefetcher.cancelAndWait()
        }
        prefetchers.removeAll()
        sessions.forEach { $0.invalidateAndCancel() }
        sessions.removeAll()
        SupersededManifestURLProtocol.reset()
        StockClipManifestStore.clear()
        try await super.tearDown()
    }

    // MARK: - 재료

    /// 기본(시스템) 목소리 × ko × 무료 테마(weather) — `isDefaultVoiceTarget` 을 통과하는 모양.
    private func systemClip(_ messageID: String) -> StockClip {
        StockClip(
            messageId: messageID,
            voiceProfileId: systemVoiceIDPrefix + "000000000001",
            voiceName: nil,
            category: "weather",
            language: "ko",
            text: "오늘은 맑아요",
            audioUrl: "https://r2.example/\(messageID).wav",
            variant: nil,
            renderedForCurrentVoice: nil
        )
    }

    private func manifest(_ messageIDs: [String]) -> StockClipListResponse {
        StockClipListResponse(clips: messageIDs.map(systemClip), expectedVariants: nil, legacyBucketHints: nil)
    }

    private func makePrefetcher() -> StockClipPrefetcher {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [SupersededManifestURLProtocol.self]
        let urlSession = URLSession(configuration: configuration)
        sessions.append(urlSession)
        let api = AlarmTalkAPI(
            baseURL: URL(string: "https://\(Self.host)/api/")!,
            session: urlSession
        )
        let prefetcher = StockClipPrefetcher(api: api)
        prefetchers.append(prefetcher)
        return prefetcher
    }

    /// `.idle`·`.running` 을 벗어날 때까지 기다린다. 실패 회차는 30초를 자므로 그 전에 끊는다.
    private func waitForTerminalState(
        _ prefetcher: StockClipPrefetcher,
        timeout: TimeInterval = 15
    ) async -> StockClipPrefetcher.State {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            switch prefetcher.state {
            case .finished, .failed:
                return prefetcher.state
            case .idle, .running:
                try? await Task.sleep(nanoseconds: 50_000_000)
            }
        }
        return prefetcher.state
    }

    // MARK: - 테스트

    /// 앞 표(프리페처)가 요청 중일 때 뒤 표가 먼저 공개된다 → 앞 표의 `save` 는 `.superseded`.
    /// 실패로 읽으면 안 되고, **이긴 매니페스트**의 클립을 이어서 받아야 한다.
    func test_뒤_표가_먼저_공개되면_실패가_아니라_이긴_매니페스트로_이어_받는다() async throws {
        let loser = manifest(["loser-1", "loser-2"])
        let winner = manifest(["winner-1", "winner-2", "winner-3"])
        let session = self.session
        SupersededManifestURLProtocol.configure(manifestResponse: loser) {
            // 프리페처의 표(N)는 이미 뽑혀 요청 중이다 — 그 사이 표 N+1 을 뽑아 **먼저** 공개한다.
            let later = StockClipManifestStore.beginFetch(session: session)
            SupersededManifestURLProtocol.recordRacePublish(StockClipManifestStore.save(winner, ticket: later))
        }

        let prefetcher = makePrefetcher()
        prefetcher.start(session: session, language: "ko")
        let state = await waitForTerminalState(prefetcher)

        XCTAssertEqual(SupersededManifestURLProtocol.racePublishResult, .published, "경합 상대가 먼저 공개돼야 이 테스트가 성립한다")
        XCTAssertNotEqual(state, .failed, "공개 경합에서 물러난 것은 실패가 아니다 — 30초 재시도 루프에 들어가면 안 된다")
        XCTAssertEqual(state, .finished)
        // 받은 것은 이긴 매니페스트의 클립이다 — 진 목록(loser)은 하나도 요청하지 않는다.
        XCTAssertEqual(
            Set(SupersededManifestURLProtocol.requestedAudioMessageIDs),
            Set(winner.clips.map(\.messageId))
        )
        // 디스크 권위는 그대로 이긴 매니페스트다 — 물러난 회차가 옛 목록으로 덮지 않았다.
        XCTAssertEqual(
            StockClipManifestStore.load(ownerUserID: ownerID)?.clips.map(\.messageId),
            winner.clips.map(\.messageId)
        )
        // 이긴 목록이 전부 캐시에 있다 — 진행률·관문(`defaultVoiceProgress`)도 같은 권위를 본다.
        XCTAssertTrue(StockClipPrefetcher.missingClips(winner.clips).isEmpty)
        XCTAssertEqual(StockClipPrefetcher.missingClips(loser.clips).count, loser.clips.count)
    }

    /// 대조군 — 경합이 없으면 방금 받은 매니페스트를 공개하고 그 목록을 받는다.
    func test_공개에_이기면_받은_매니페스트로_받는다() async throws {
        let fetched = manifest(["fetched-1", "fetched-2"])
        SupersededManifestURLProtocol.configure(manifestResponse: fetched, beforeManifestResponse: nil)

        let prefetcher = makePrefetcher()
        prefetcher.start(session: session, language: "ko")
        let state = await waitForTerminalState(prefetcher)

        XCTAssertEqual(state, .finished)
        XCTAssertEqual(
            Set(SupersededManifestURLProtocol.requestedAudioMessageIDs),
            Set(fetched.clips.map(\.messageId))
        )
        XCTAssertEqual(
            StockClipManifestStore.load(ownerUserID: ownerID)?.clips.map(\.messageId),
            fetched.clips.map(\.messageId)
        )
    }

    /// 물러났는데 디스크에 아무것도 없으면(로그아웃으로 `clear` 된 경우) 받을 근거가 없다 —
    /// **실패가 아니라 물러난다.** 30초 재시도 루프에 들어가지 않고, 아무것도 요청하지 않는다.
    func test_물러났는데_디스크에_권위가_없으면_실패가_아니라_물러난다() async throws {
        let loser = manifest(["loser-1"])
        SupersededManifestURLProtocol.configure(manifestResponse: loser) {
            // 요청 중에 계정이 끝났다 — 표 무효화 + 파일 격리.
            StockClipManifestStore.clear()
        }

        let prefetcher = makePrefetcher()
        prefetcher.start(session: session, language: "ko")
        let state = await waitForTerminalState(prefetcher)

        XCTAssertNotEqual(state, .failed)
        XCTAssertEqual(state, .finished)
        XCTAssertTrue(SupersededManifestURLProtocol.requestedAudioMessageIDs.isEmpty, "권위가 없는데 옛 목록으로 받으면 안 된다")
        XCTAssertNil(StockClipManifestStore.load(ownerUserID: ownerID), "물러난 회차가 옛 매니페스트를 공개하면 안 된다")
    }
}

extension StockClipPrefetcherSupersededTests {
    // MARK: - 신선도 창(2026-09-29 효율 감사 M1 — iOS)

    /// 캐시 디렉터리를 비운다 — 두 번째 회차에도 '받을 것' 이 있어야 그 회차가 실제로 돌았는지 보인다.
    private func emptyAudioCache() throws {
        let directory = try AudioCacheStore.audioDirectory()
        for name in (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? [] {
            try? FileManager.default.removeItem(at: directory.appendingPathComponent(name))
        }
    }

    /// 창 안에 공개된 매니페스트가 있으면 **다시 받지 않고** 그 공개본으로 받는다. 예전에는 `start`
    /// 마다 약 168KB 를 새로 받았다(콜드 스타트 3~5번, 전경 복귀마다 재바인딩과 겹쳐 2번).
    func test_창_안에_공개된_매니페스트가_있으면_다시_받지_않고_그걸로_받는다() async throws {
        let fetched = manifest(["fresh-1", "fresh-2"])
        SupersededManifestURLProtocol.configure(manifestResponse: fetched, beforeManifestResponse: nil)

        let first = makePrefetcher()
        first.start(session: session, language: "ko")
        let firstState = await waitForTerminalState(first)
        XCTAssertEqual(firstState, .finished)
        XCTAssertEqual(SupersededManifestURLProtocol.manifestRequestCount, 1)

        // 받아 둔 것이 사라졌다(캐시 정리) — 다음 회차가 실제로 도는지 보려고 받을 것을 만든다.
        try emptyAudioCache()
        let second = makePrefetcher()
        second.start(session: session, language: "ko")
        let secondState = await waitForTerminalState(second)

        XCTAssertEqual(secondState, .finished)
        XCTAssertEqual(SupersededManifestURLProtocol.manifestRequestCount, 1, "창 안이면 매니페스트를 다시 받지 않는다")
        XCTAssertEqual(
            SupersededManifestURLProtocol.requestedAudioMessageIDs.sorted(),
            (fetched.clips.map(\.messageId) + fetched.clips.map(\.messageId)).sorted(),
            "빠진 클립은 창 안의 공개본으로 다시 받는다 — 창은 목록 조회만 줄인다"
        )
        XCTAssertTrue(StockClipPrefetcher.missingClips(fetched.clips).isEmpty)
    }

    /// '신호 뒤'(클론 생성이 끝난 뒤·준비 화면의 부족분) — 창 안이라도 그 **뒤에 출발한** 매니페스트만 쓴다.
    func test_신호_뒤_시작은_창_안이라도_다시_받는다() async throws {
        let fetched = manifest(["signal-1"])
        SupersededManifestURLProtocol.configure(manifestResponse: fetched, beforeManifestResponse: nil)

        let first = makePrefetcher()
        first.start(session: session, language: "ko")
        let firstState = await waitForTerminalState(first)
        XCTAssertEqual(firstState, .finished)
        XCTAssertEqual(SupersededManifestURLProtocol.manifestRequestCount, 1)

        let second = makePrefetcher()
        second.start(session: session, language: "ko", manifestDepartedAfter: Date())
        let state = await waitForTerminalState(second)

        XCTAssertEqual(state, .finished)
        XCTAssertEqual(SupersededManifestURLProtocol.manifestRequestCount, 2, "서버가 바뀐 것을 아는 자리는 창을 쓰지 않는다")
    }

    /// 클론 등록 진행률(`ClonePrerenderDrive`)은 **신호 뒤의 공개본으로만** 센다(코덱스 #827). 디스크에는
    /// 생성이 끝나기 전에 출발한 부분 목록이 있을 수 있다 — 그걸로 세면 그 부분만 받은 채 '다 받았다' 가 된다.
    func test_신호_뒤_진행률은_신호_전에_출발한_부분_목록으로_세지_않는다() async throws {
        let previous = KeychainStore.readSession()
        try KeychainStore.saveSession(session)
        defer {
            if let previous { try? KeychainStore.saveSession(previous) } else { KeychainStore.deleteSession() }
        }
        let clone = "clone-progress-signal"
        func cloneClip(_ id: String) -> StockClip {
            StockClip(
                messageId: id, voiceProfileId: clone, voiceName: nil, category: "weather", language: "ko",
                text: "오늘은 맑아요", audioUrl: "https://r2.example/\(id).mp3", variant: nil, renderedForCurrentVoice: nil
            )
        }
        let partial = StockClipManifestStore.beginFetch(session: session)
        XCTAssertEqual(
            StockClipManifestStore.save(
                StockClipListResponse(clips: [cloneClip("partial-1")], expectedVariants: nil, legacyBucketHints: nil),
                ticket: partial
            ),
            .published
        )
        let signal = partial.departedAt.addingTimeInterval(0.001)

        let fromDisk = await StockClipPrefetcher.progressOffMain(voiceProfileID: clone)
        XCTAssertEqual(fromDisk?.total, 1, "신호 없이 세면 디스크의 부분 목록으로 센다")
        let beforeSignal = await StockClipPrefetcher.progressOffMain(voiceProfileID: clone, manifestDepartedAfter: signal)
        XCTAssertNil(beforeSignal, "신호 뒤의 공개본이 아직 없으면 모른다 — 끝났다고 하지 않는다")

        try await Task.sleep(nanoseconds: 5_000_000)
        let full = StockClipManifestStore.beginFetch(session: session)
        XCTAssertGreaterThanOrEqual(full.departedAt, signal)
        XCTAssertEqual(
            StockClipManifestStore.save(
                StockClipListResponse(clips: [cloneClip("partial-1"), cloneClip("late-2")], expectedVariants: nil, legacyBucketHints: nil),
                ticket: full
            ),
            .published
        )
        let afterSignal = await StockClipPrefetcher.progressOffMain(voiceProfileID: clone, manifestDepartedAfter: signal)
        XCTAssertEqual(afterSignal?.total, 2, "뒤늦게 만들어진 클립까지 센다")
    }

    /// 로그아웃·계정 전환(`clear`) 뒤에는 창이 닫힌다 — 같은 계정으로 다시 들어와도 다시 받는다.
    func test_clear_뒤에는_창이_닫혀_다시_받는다() async throws {
        let fetched = manifest(["cleared-1"])
        SupersededManifestURLProtocol.configure(manifestResponse: fetched, beforeManifestResponse: nil)

        let first = makePrefetcher()
        first.start(session: session, language: "ko")
        let firstState = await waitForTerminalState(first)
        XCTAssertEqual(firstState, .finished)
        StockClipManifestStore.clear(preservingOwnerUserID: ownerID)

        let second = makePrefetcher()
        second.start(session: session, language: "ko")
        let secondState = await waitForTerminalState(second)
        XCTAssertEqual(secondState, .finished)
        XCTAssertEqual(SupersededManifestURLProtocol.manifestRequestCount, 2)
    }
}

/// `tts/stock-clips` 와 `tts/messages/:id/audio` 만 흉내 낸다.
///
/// 매니페스트 응답을 돌려주기 **직전에** `beforeManifestResponse` 를 돌린다 — 그 자리에서
/// 경합 상대가 더 새 표로 먼저 공개하면, 요청 중이던 프리페처의 표는 반드시 밀린다.
private final class SupersededManifestURLProtocol: URLProtocol, @unchecked Sendable {
    /// 8kHz 모노 PCM 50ms. 가짜 문자열을 MP3라고 보내면 AVFoundation의 길이 조회가
    /// 손상 파일 파싱에 매달려 CI에서 정상 다운로드 회차도 15초 상한을 넘길 수 있다.
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
        append(UInt16(1)) // PCM
        append(UInt16(1)) // mono
        append(UInt32(8_000))
        append(UInt32(16_000))
        append(UInt16(2))
        append(UInt16(16))
        data.append(Data("data".utf8))
        append(UInt32(pcm.count))
        data.append(pcm)
        return data
    }()

    private static let lock = NSLock()
    private nonisolated(unsafe) static var manifestJSON = Data()
    private nonisolated(unsafe) static var beforeManifestResponse: (@Sendable () -> Void)?
    private nonisolated(unsafe) static var audioRequests: [String] = []
    private nonisolated(unsafe) static var racePublish: StockClipManifestStorage.PublishResult?
    private nonisolated(unsafe) static var manifestRequests = 0

    /// 매니페스트(`tts/stock-clips`)를 몇 번 받았는가 — 신선도 창 회귀가 센다.
    static var manifestRequestCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return manifestRequests
    }

    static var requestedAudioMessageIDs: [String] {
        lock.lock()
        defer { lock.unlock() }
        return audioRequests
    }

    static var racePublishResult: StockClipManifestStorage.PublishResult? {
        lock.lock()
        defer { lock.unlock() }
        return racePublish
    }

    static func configure(
        manifestResponse: StockClipListResponse,
        beforeManifestResponse: (@Sendable () -> Void)?
    ) {
        // 서버와 같은 표기(snake_case) — `AlarmTalkAPI` 의 디코더가 `convertFromSnakeCase` 다.
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        let json = (try? encoder.encode(manifestResponse)) ?? Data()
        lock.lock()
        defer { lock.unlock() }
        manifestJSON = json
        self.beforeManifestResponse = beforeManifestResponse
        audioRequests = []
        racePublish = nil
        manifestRequests = 0
    }

    static func recordRacePublish(_ result: StockClipManifestStorage.PublishResult) {
        lock.lock()
        defer { lock.unlock() }
        racePublish = result
    }

    static func reset() {
        lock.lock()
        defer { lock.unlock() }
        manifestJSON = Data()
        beforeManifestResponse = nil
        audioRequests = []
        racePublish = nil
        manifestRequests = 0
    }

    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "stock-superseded.example.test"
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let components = request.url?.pathComponents ?? []
        let body: Data
        if components.last == "stock-clips" {
            Self.lock.lock()
            let hook = Self.beforeManifestResponse
            let json = Self.manifestJSON
            Self.manifestRequests += 1
            Self.lock.unlock()
            // 응답을 돌려주기 전에 경합 상대를 먼저 보낸다(같은 스레드에서 끝난다).
            hook?()
            body = json
        } else if let index = components.firstIndex(of: "messages"),
                  components.indices.contains(index + 1),
                  components.last == "audio" {
            let messageID = components[index + 1]
            Self.lock.lock()
            Self.audioRequests.append(messageID)
            Self.lock.unlock()
            // 매니페스트가 가리키는 주소와 **같은** 주소를 싣는다 — 다르면 캐시가 '지나간
            // 응답' 으로 보고 쓰지 않는다(`AudioCacheStore.incomingIsSupersededByManifest`).
            let audio = Self.audioFixture.base64EncodedString()
            body = Data("""
            {"message_id":"\(messageID)","audio_base64":"\(audio)","audio_format":"wav",\
            "audio_url":"https://r2.example/\(messageID).wav"}
            """.utf8)
        } else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }
        client?.urlProtocol(
            self,
            didReceive: HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!,
            cacheStoragePolicy: .notAllowed
        )
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
