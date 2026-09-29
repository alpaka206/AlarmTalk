import XCTest
@testable import AlarmTalk

final class StockClipManifestStoreTests: XCTestCase {
    private func makeStorage() -> StockClipManifestStorage {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return StockClipManifestStorage(fileURL: directory.appendingPathComponent("manifest.json"))
    }

    private func session(_ owner: String) -> AuthSession {
        AuthSession(token: "token-\(owner)", user: AuthUser(id: owner, email: "test@example.test"))
    }

    private func manifest(_ messageID: String) -> StockClipListResponse {
        StockClipListResponse(clips: [StockClip(
            messageId: messageID, voiceProfileId: "clone", voiceName: nil,
            category: "morning", language: "ko", text: "test", audioUrl: "https://example.test/\(messageID)",
            variant: nil, renderedForCurrentVoice: nil
        )], expectedVariants: nil, legacyBucketHints: nil)
    }

    func testLaterResponseWinsAcrossWriters() {
        let storage = makeStorage()
        let old = storage.beginFetch(session: session("owner"))
        let new = storage.beginFetch(session: session("owner"))
        XCTAssertEqual(storage.save(manifest("new"), ticket: new), .published)
        XCTAssertEqual(storage.save(manifest("old"), ticket: old), .superseded)
        XCTAssertEqual(storage.load(ownerUserID: "owner")?.clips.first?.messageId, "new")
    }

    func testClearInvalidatesOutstandingResponsesAndOwner() {
        let storage = makeStorage()
        let pending = storage.beginFetch(session: session("old-owner"))
        storage.clear()
        XCTAssertEqual(storage.save(manifest("old"), ticket: pending), .superseded)
        XCTAssertNil(storage.load(ownerUserID: "new-owner"))
        let next = storage.beginFetch(session: session("new-owner"))
        XCTAssertEqual(storage.save(manifest("new"), ticket: next), .published)
        XCTAssertNil(storage.load(ownerUserID: "old-owner"))
        XCTAssertNil(storage.load(ownerUserID: nil))
    }

    func testSameAccountStartupPreservesOfflineManifestButInvalidatesOldFetches() {
        let storage = makeStorage()
        let saved = storage.beginFetch(session: session("owner"))
        XCTAssertEqual(storage.save(manifest("cached"), ticket: saved), .published)
        let pending = storage.beginFetch(session: session("owner"))
        storage.clear(preservingOwnerUserID: "owner")
        XCTAssertEqual(storage.load(ownerUserID: "owner")?.clips.first?.messageId, "cached")
        XCTAssertEqual(storage.save(manifest("late"), ticket: pending), .superseded)
        storage.clear(preservingOwnerUserID: "other")
        XCTAssertNil(storage.load(ownerUserID: "owner"))
    }

    func testFailedPublicationStillRejectsOlderResponse() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try Data("not a directory".utf8).write(to: directory)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let storage = StockClipManifestStorage(fileURL: directory.appendingPathComponent("manifest.json"))
        let old = storage.beginFetch(session: session("owner"))
        let new = storage.beginFetch(session: session("owner"))
        XCTAssertEqual(storage.save(manifest("new"), ticket: new), .failed)
        XCTAssertEqual(storage.save(manifest("old"), ticket: old), .superseded)
    }

    func testNetworkFailureBeforeSaveKeepsOlderValidResponse() {
        // 나중에 출발한 B 가 `save` 에 닿기 전에(네트워크에서) 실패하면, 먼저 출발한 A 의 응답은
        // 그대로 공개된다 — 수위선은 시작이 아니라 **응답을 본 순간** 오른다(안드로이드와 같다).
        // 여기서 A 를 버리면 아무도 공개하지 못해 '모른다' 상태가 되살아난다(파일 머리 주석).
        let storage = makeStorage()
        let old = storage.beginFetch(session: session("owner"))
        _ = storage.beginFetch(session: session("owner")) // B: 표만 뽑고 응답 없이 실패
        XCTAssertEqual(storage.save(manifest("old"), ticket: old), .published)
        XCTAssertEqual(storage.load(ownerUserID: "owner")?.clips.first?.messageId, "old")
        // B 의 재시도(더 새 표)가 성공하면 그것이 이긴다.
        let retry = storage.beginFetch(session: session("owner"))
        XCTAssertEqual(storage.save(manifest("retry"), ticket: retry), .published)
        XCTAssertEqual(storage.save(manifest("old-again"), ticket: old), .superseded)
        XCTAssertEqual(storage.load(ownerUserID: "owner")?.clips.first?.messageId, "retry")
    }

    func testPublishedNewerResponseDistinguishesPublishFromClear() {
        // `.superseded` 의 두 얼굴 — 더 새 응답이 공개됐는가(신선), 표가 무효화됐는가(모름).
        let storage = makeStorage()
        let old = storage.beginFetch(session: session("owner"))
        let new = storage.beginFetch(session: session("owner"))
        XCTAssertFalse(storage.publishedNewerResponse(than: old), "아직 아무것도 공개되지 않았다")
        XCTAssertEqual(storage.save(manifest("new"), ticket: new), .published)
        XCTAssertEqual(storage.save(manifest("old"), ticket: old), .superseded)
        XCTAssertTrue(storage.publishedNewerResponse(than: old), "더 새 표의 응답이 공개됐다 — 이긴 매니페스트는 신선하다")
        XCTAssertFalse(storage.publishedNewerResponse(than: new), "자기 자신보다 새 응답은 없다")

        // `clear` 로 밀린 표: 수위선은 올랐지만 새로 공개된 것은 없다.
        let pending = storage.beginFetch(session: session("owner"))
        storage.clear(preservingOwnerUserID: "owner")
        XCTAssertEqual(storage.save(manifest("late"), ticket: pending), .superseded)
        XCTAssertFalse(storage.publishedNewerResponse(than: pending), "무효화로 밀린 것은 신선함의 근거가 아니다")
    }

    func testPublishedNewerResponseRequiresTheNewestSeenTicketToBePublished() throws {
        // N 요청 중 → N+1 공개 → N+2 의 쓰기 실패(수위선은 N+2). 디스크(N+1)는 최신이 아니다 —
        // N 의 `.superseded` 를 신선하다고 치면 N+2 의 재시도가 오기 전에 교체 세대를 확정한다.
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let fileURL = directory.appendingPathComponent("manifest.json")
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let storage = StockClipManifestStorage(fileURL: fileURL)
        let n = storage.beginFetch(session: session("owner"))
        let n1 = storage.beginFetch(session: session("owner"))
        let n2 = storage.beginFetch(session: session("owner"))
        XCTAssertEqual(storage.save(manifest("n1"), ticket: n1), .published)
        XCTAssertTrue(storage.publishedNewerResponse(than: n), "N+1 이 가장 최근이고 공개됐다")
        // N+2 의 쓰기를 실패시킨다 — 파일 자리를 디렉터리로 막는다.
        try FileManager.default.removeItem(at: fileURL)
        try FileManager.default.createDirectory(at: fileURL, withIntermediateDirectories: true)
        XCTAssertEqual(storage.save(manifest("n2"), ticket: n2), .failed)
        XCTAssertEqual(storage.save(manifest("n"), ticket: n), .superseded)
        XCTAssertFalse(storage.publishedNewerResponse(than: n), "가장 최근 응답(N+2)의 공개가 실패했으면 신선하지 않다")
        XCTAssertFalse(storage.publishedNewerResponse(than: n1))
    }

    func testDiskReloadChecksOwnerAndRejectsUnownedLegacyManifest() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let fileURL = directory.appendingPathComponent("manifest.json")
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let writer = StockClipManifestStorage(fileURL: fileURL)
        XCTAssertEqual(writer.save(manifest("saved"), ticket: writer.beginFetch(session: session("owner"))), .published)
        let reader = StockClipManifestStorage(fileURL: fileURL)
        XCTAssertNil(reader.load(ownerUserID: "other"))
        XCTAssertEqual(reader.load(ownerUserID: "owner")?.clips.first?.messageId, "saved")
        try JSONEncoder().encode(manifest("unowned")).write(to: fileURL)
        XCTAssertNil(StockClipManifestStorage(fileURL: fileURL).load(ownerUserID: "owner"))
    }

    /// **롤링 갱신은 공개를 거절할 이유가 아니다**(2026-09-22 정정).
    ///
    /// 예전에는 표에 토큰을 실어 키체인과 대조했고, 그래서 `/auth/me` 가 토큰을 굴리는 순간
    /// 같은 계정의 멀쩡한 응답이 전부 `.superseded` 가 됐다 — 프리페처는 `start(session:)` 이
    /// 잡아 둔 세션으로 재시도하므로 한 번 굴러간 뒤에는 회차마다 거절돼 아무도 매니페스트를
    /// 공개하지 못했다. 계정 경계는 파일 임자 + `clear` 의 표 무효화가 지킨다(아래 두 테스트).
    /// 키체인을 실제로 굴려 재현한다 — 대조를 되살리면 여기서 깨진다.
    func testRollingTokenRefreshDoesNotRejectPublication() throws {
        let original = session("owner")
        let previous = KeychainStore.readSession()
        StockClipManifestStore.clear()
        try KeychainStore.saveSession(original)
        defer {
            StockClipManifestStore.clear()
            if let previous { try? KeychainStore.saveSession(previous) }
            else { KeychainStore.deleteSession() }
        }
        let ticket = StockClipManifestStore.beginFetch(session: original)
        // 응답을 기다리는 사이 롤링 갱신 — 같은 계정, 새 토큰.
        try KeychainStore.saveSession(AuthSession(token: "rolled-token", user: original.user))
        XCTAssertEqual(
            StockClipManifestStore.save(manifest("rolled"), ticket: ticket), .published,
            "같은 계정의 토큰이 굴러갔을 뿐인데 거절하면 프리페처가 회차마다 물러나 아무도 공개하지 못한다"
        )
        XCTAssertEqual(StockClipManifestStore.load(ownerUserID: "owner")?.clips.first?.messageId, "rolled")
    }

    /// 계정 경계 — **다른 계정으로 바뀌는 창은 토큰 없이도 막힌다.**
    /// A 의 조회가 떠 있는 채로 B 가 로그인하면(`clear(preservingOwnerUserID: B)`) A 의 늦은
    /// 응답은 표 무효화로 거절되고, 그 전에 공개됐더라도 B 는 임자 대조로 읽지 못한다.
    func testAccountSwitchIsFencedByOwnerAndTicketInvalidationWithoutToken() {
        let storage = makeStorage()
        let pendingA = storage.beginFetch(session: session("a"))
        // B 로 바뀌기 **전에** A 가 공개된 경우 — 파일은 A 임자다.
        XCTAssertEqual(storage.save(manifest("a-early"), ticket: pendingA), .published)
        XCTAssertNil(storage.load(ownerUserID: "b"), "임자가 다른 파일은 읽지 못한다")
        // B 로그인 — 떠 있던 표를 무효화하고 A 의 파일을 지운다.
        let lateA = storage.beginFetch(session: session("a"))
        storage.clear(preservingOwnerUserID: "b")
        XCTAssertEqual(storage.save(manifest("a-late"), ticket: lateA), .superseded)
        XCTAssertNil(storage.load(ownerUserID: "a"))
        XCTAssertNil(storage.load(ownerUserID: "b"))
        // B 의 조회는 정상적으로 공개된다.
        let ticketB = storage.beginFetch(session: session("b"))
        XCTAssertEqual(storage.save(manifest("b"), ticket: ticketB), .published)
        XCTAssertEqual(storage.load(ownerUserID: "b")?.clips.first?.messageId, "b")
        XCTAssertNil(storage.load(ownerUserID: "a"))
    }

    // MARK: - 신선도 창(2026-09-29 효율 감사 M1 — iOS)

    /// 테스트가 움직이는 시계.
    private final class TestClock: @unchecked Sendable {
        private let lock = NSLock()
        private var stored: Date
        init(_ start: Date) { stored = start }
        var now: Date {
            get { lock.lock(); defer { lock.unlock() }; return stored }
            set { lock.lock(); stored = newValue; lock.unlock() }
        }
    }

    private func makeClockedStorage(_ clock: TestClock, fileURL: URL? = nil) -> StockClipManifestStorage {
        let url: URL
        if let fileURL {
            url = fileURL
        } else {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
            url = directory.appendingPathComponent("manifest.json")
        }
        return StockClipManifestStorage(fileURL: url, now: { clock.now })
    }

    /// 창은 **공개된** 응답의 **출발 시각**부터 잰다 — 같은 계정·45초 안만 신선하다.
    func testRecentlyPublishedCountsFromDepartureOfThePublishedResponse() {
        let t0 = Date(timeIntervalSince1970: 1_800_000_000)
        let clock = TestClock(t0)
        let storage = makeClockedStorage(clock)
        XCTAssertNil(storage.recentlyPublished(ownerUserID: "owner", within: 45), "공개된 적이 없으면 받는다")

        let ticket = storage.beginFetch(session: session("owner"))
        XCTAssertNil(storage.recentlyPublished(ownerUserID: "owner", within: 45), "떠 있는 요청은 아직 권위가 아니다")
        clock.now = t0.addingTimeInterval(10)
        XCTAssertEqual(storage.save(manifest("fresh"), ticket: ticket), .published)

        clock.now = t0.addingTimeInterval(44)
        XCTAssertEqual(storage.recentlyPublished(ownerUserID: "owner", within: 45)?.clips.first?.messageId, "fresh")
        XCTAssertNil(storage.recentlyPublished(ownerUserID: "other", within: 45), "다른 계정의 공개본이 아니다")
        clock.now = t0.addingTimeInterval(45)
        XCTAssertNil(
            storage.recentlyPublished(ownerUserID: "owner", within: 45),
            "공개(10초)가 아니라 출발(0초)부터 잰다 — 응답은 출발 뒤의 서버 상태다"
        )
        clock.now = t0.addingTimeInterval(-1)
        XCTAssertNil(storage.recentlyPublished(ownerUserID: "owner", within: 45), "시계가 뒤로 가면 모른다")
    }

    /// '신호 뒤' — 서버가 바뀐 것을 아는 자리는 그 뒤에 출발한 응답만 쓴다.
    func testRecentlyPublishedHonorsDepartedAfter() {
        let t0 = Date(timeIntervalSince1970: 1_800_000_000)
        let clock = TestClock(t0)
        let storage = makeClockedStorage(clock)
        XCTAssertEqual(storage.save(manifest("before"), ticket: storage.beginFetch(session: session("owner"))), .published)
        clock.now = t0.addingTimeInterval(5)
        let signal = clock.now
        XCTAssertNil(
            storage.recentlyPublished(ownerUserID: "owner", within: 45, departedAfter: signal),
            "신호 전에 출발한 공개본은 새 클립을 모른다"
        )
        XCTAssertNotNil(storage.recentlyPublished(ownerUserID: "owner", within: 45), "신호가 없으면 창을 그대로 쓴다")
        XCTAssertEqual(storage.save(manifest("after"), ticket: storage.beginFetch(session: session("owner"))), .published)
        clock.now = t0.addingTimeInterval(6)
        XCTAssertEqual(
            storage.recentlyPublished(ownerUserID: "owner", within: 45, departedAfter: signal)?.clips.first?.messageId,
            "after"
        )
    }

    /// 창은 표·수위선 가드를 건너뛰지 않는다 — 로그아웃·계정 전환(`clear`)과 더 새 표의 쓰기 실패 뒤에는
    /// 닫힌다. 네트워크 실패(표만 뽑고 응답 없음)는 닫지 않는다 — 마지막 공개본이 여전히 최신이다.
    func testRecentlyPublishedClosesOnClearAndOnNewerFailedWriteButNotOnNetworkFailure() throws {
        let t0 = Date(timeIntervalSince1970: 1_800_000_000)
        let clock = TestClock(t0)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let fileURL = directory.appendingPathComponent("manifest.json")
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let storage = makeClockedStorage(clock, fileURL: fileURL)

        XCTAssertEqual(storage.save(manifest("a"), ticket: storage.beginFetch(session: session("owner"))), .published)
        _ = storage.beginFetch(session: session("owner")) // 네트워크에서 실패한 뒤 요청
        XCTAssertNotNil(storage.recentlyPublished(ownerUserID: "owner", within: 45), "네트워크 실패는 창을 닫지 않는다")

        // 더 새 표의 쓰기 실패 — 디스크가 최신이 아니다.
        let newer = storage.beginFetch(session: session("owner"))
        try FileManager.default.removeItem(at: fileURL)
        try FileManager.default.createDirectory(at: fileURL, withIntermediateDirectories: true)
        XCTAssertEqual(storage.save(manifest("b"), ticket: newer), .failed)
        XCTAssertNil(storage.recentlyPublished(ownerUserID: "owner", within: 45), "더 새 응답의 공개가 실패했으면 다시 받는다")

        // 쓰기가 되살아나 다시 공개된 뒤 같은 계정으로 재로그인(`clear(preserving:)`) — 창은 닫힌다.
        try FileManager.default.removeItem(at: fileURL)
        XCTAssertEqual(storage.save(manifest("c"), ticket: storage.beginFetch(session: session("owner"))), .published)
        XCTAssertNotNil(storage.recentlyPublished(ownerUserID: "owner", within: 45))
        storage.clear(preservingOwnerUserID: "owner")
        XCTAssertNotNil(storage.load(ownerUserID: "owner"), "디스크 시드는 남는다")
        XCTAssertNil(storage.recentlyPublished(ownerUserID: "owner", within: 45), "로그인이 바뀌면 이 세션에 받은 것이 아니다")
    }
}
