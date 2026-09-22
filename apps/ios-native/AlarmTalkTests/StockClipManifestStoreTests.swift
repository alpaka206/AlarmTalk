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
}
