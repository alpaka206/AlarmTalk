import XCTest
@testable import AlarmTalk

/// **교체 표식은 푸시를 놓친 기기가 스스로 수렴하는 유일한 근거다** — 그래서 두 규칙을 고정한다.
///
/// 안드로이드 짝은 `VoiceReplacementMarkerStoreTest.kt`.
final class VoiceReplacementMarkerTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suiteName: String!

    override func setUp() {
        super.setUp()
        suiteName = "voice-replacement-marker-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    func test_처음_본_프로필은_조용히_적기만_한다() {
        let store = VoiceReplacementMarkerStore(defaults: defaults)
        XCTAssertFalse(store.changed(userID: "u1", profileID: "vp1", invalidatedAt: "2026-08-25T00:00:00Z"))
        XCTAssertFalse(store.changed(userID: "u1", profileID: "vp1", invalidatedAt: "2026-08-25T00:00:00Z"))
    }

    func test_commit_전까지는_계속_바뀐_것으로_본다() {
        let store = VoiceReplacementMarkerStore(defaults: defaults)
        _ = store.changed(userID: "u2", profileID: "vp1", invalidatedAt: nil)

        XCTAssertTrue(store.changed(userID: "u2", profileID: "vp1", invalidatedAt: "t1"))
        // ⚠ 강등이 실패했으면 다음 회차가 다시 집어야 한다.
        XCTAssertTrue(store.changed(userID: "u2", profileID: "vp1", invalidatedAt: "t1"))

        store.commit(userID: "u2", profileID: "vp1", invalidatedAt: "t1")
        XCTAssertFalse(store.changed(userID: "u2", profileID: "vp1", invalidatedAt: "t1"))
    }

    func test_계정별로_갈리고_로그아웃에서_지워진다() {
        let store = VoiceReplacementMarkerStore(defaults: defaults)
        _ = store.changed(userID: "u3", profileID: "vp1", invalidatedAt: nil)
        XCTAssertTrue(store.changed(userID: "u3", profileID: "vp1", invalidatedAt: "t1"))
        XCTAssertFalse(store.changed(userID: "u4", profileID: "vp1", invalidatedAt: "t1"))

        store.commit(userID: "u3", profileID: "vp1", invalidatedAt: "t1")
        store.clear(userID: "u3")
        XCTAssertFalse(store.changed(userID: "u3", profileID: "vp1", invalidatedAt: "t2"))
        XCTAssertFalse(store.changed(userID: "u4", profileID: "vp1", invalidatedAt: "t1"))
    }
}
