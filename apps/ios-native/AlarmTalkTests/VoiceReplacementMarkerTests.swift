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

    /// 늦게 도착한 푸시가 그 사이 **새 목소리로** 만든 알람까지 지우지 않게 하는 판정.
    func test_hasApplied_는_이미_반영한_세대만_참이다() {
        let store = VoiceReplacementMarkerStore(defaults: defaults)
        // 처음 보는 프로필은 false — 푸시 자체가 '방금 교체됐다' 는 증거다. 적지도 않는다.
        XCTAssertFalse(store.hasApplied(userID: "u5", profileID: "vp1", invalidatedAt: "t1"))
        XCTAssertFalse(store.changed(userID: "u5", profileID: "vp1", invalidatedAt: "t1"),
                       "hasApplied 가 표식을 적어 버리면 changed 판정이 오염된다")

        store.commit(userID: "u5", profileID: "vp1", invalidatedAt: "t1")
        XCTAssertTrue(store.hasApplied(userID: "u5", profileID: "vp1", invalidatedAt: "t1"))
        XCTAssertFalse(store.hasApplied(userID: "u5", profileID: "vp1", invalidatedAt: "t2"))
        // 세대를 모르는 옛 서버 신호는 '반영했다' 로 볼 수 없다.
        XCTAssertFalse(store.hasApplied(userID: "u5", profileID: "vp1", invalidatedAt: nil))
    }

    /// ⚠ **`changed` 가 조용히 적어 둔 '봤다' 를 '반영했다' 로 읽으면 푸시가 무력해진다.**
    /// iOS 는 같은 푸시에서 목록 갱신이 교체 처리보다 **먼저** 끝나므로, 그 순간 표식이
    /// 새 세대로 앞서 있게 된다 — 그걸 반영으로 보면 아무것도 내리지 않고 끝난다.
    func test_봤다는_반영했다가_아니다() {
        let store = VoiceReplacementMarkerStore(defaults: defaults)
        _ = store.changed(userID: "u6", profileID: "vp1", invalidatedAt: nil)   // 첫 조회 시드
        XCTAssertTrue(store.changed(userID: "u6", profileID: "vp1", invalidatedAt: "t1"))

        // 목록 갱신이 먼저 돌아 시드를 새 세대로 올려 놓은 상태를 흉내 낸다.
        let seeded = VoiceReplacementMarkerStore(defaults: defaults)
        _ = seeded.changed(userID: "u7", profileID: "vp1", invalidatedAt: "t1")
        XCTAssertFalse(
            seeded.hasApplied(userID: "u7", profileID: "vp1", invalidatedAt: "t1"),
            "첫 조회 시드를 반영으로 읽으면 뒤이은 푸시가 아무것도 내리지 않는다"
        )
    }

    /// 늦게 도착한 **앞선** 세대의 푸시는 이미 처리한 것으로 본다(뒤 세대 알람을 지우면 안 된다).
    func test_앞선_세대의_푸시는_이미_처리한_것으로_본다() {
        let store = VoiceReplacementMarkerStore(defaults: defaults)
        store.commit(userID: "u10", profileID: "vp1", invalidatedAt: "2026-08-25 02:00:00")

        XCTAssertTrue(store.hasApplied(userID: "u10", profileID: "vp1", invalidatedAt: "2026-08-25 01:00:00"))
        XCTAssertTrue(store.hasApplied(userID: "u10", profileID: "vp1", invalidatedAt: "2026-08-25 02:00:00"))
        XCTAssertFalse(store.hasApplied(userID: "u10", profileID: "vp1", invalidatedAt: "2026-08-25 03:00:00"))

        // 옛 신호를 확정해도 표식이 과거로 되돌아가지 않는다.
        store.commit(userID: "u10", profileID: "vp1", invalidatedAt: "2026-08-25 01:00:00")
        XCTAssertFalse(store.changed(userID: "u10", profileID: "vp1", invalidatedAt: "2026-08-25 02:00:00"))
    }

    /// ⚠ **표식은 뒤로 가지 않는다.** 공유 목소리 목록은 갱신 경로가 따로라 낡은 값이
    /// 판정에 들어올 수 있는데, 되돌아가면 이미 처리한 교체를 다시 처리한다.
    func test_앞선_세대는_변화로_보지_않는다() {
        let store = VoiceReplacementMarkerStore(defaults: defaults)
        _ = store.changed(userID: "u8", profileID: "vp1", invalidatedAt: nil)
        XCTAssertTrue(store.changed(userID: "u8", profileID: "vp1", invalidatedAt: "2026-08-25 01:00:00"))
        store.commit(userID: "u8", profileID: "vp1", invalidatedAt: "2026-08-25 01:00:00")

        XCTAssertFalse(
            store.changed(userID: "u8", profileID: "vp1", invalidatedAt: "2026-08-24 23:00:00"),
            "낡은 목록이 표식을 과거로 되돌리면 그 사이 만든 알람이 지워진다"
        )
        XCTAssertFalse(store.changed(userID: "u8", profileID: "vp1", invalidatedAt: nil))
        XCTAssertTrue(store.changed(userID: "u8", profileID: "vp1", invalidatedAt: "2026-08-25 02:00:00"))
    }

    func test_계정별로_갈린다() {
        let store = VoiceReplacementMarkerStore(defaults: defaults)
        _ = store.changed(userID: "u3", profileID: "vp1", invalidatedAt: nil)
        XCTAssertTrue(store.changed(userID: "u3", profileID: "vp1", invalidatedAt: "t1"))
        // 다른 계정은 아직 처음 보는 프로필이다.
        XCTAssertFalse(store.changed(userID: "u4", profileID: "vp1", invalidatedAt: "t1"))
    }

    /// ⚠ **로그아웃에서 지우면 안 된다.** 로그아웃은 로컬 알람을 끄기만 하고 지우지 않는다 —
    /// 그 사이 다른 기기에서 교체가 일어나고 같은 계정이 돌아오면, 표식이 없는 기기는 첫
    /// 조회를 '처음 봤다' 로 읽어 영영 강등하지 않는다(그 알람을 다시 켜면 지운 목소리가 운다).
    func test_로그아웃_뒤에도_기준이_남는다() {
        let store = VoiceReplacementMarkerStore(defaults: defaults)
        _ = store.changed(userID: "u9", profileID: "vp1", invalidatedAt: "2026-08-25 01:00:00")

        // (로그아웃 — 이 저장소는 아무것도 지우지 않는다)
        let afterRelogin = VoiceReplacementMarkerStore(defaults: defaults)
        XCTAssertTrue(
            afterRelogin.changed(userID: "u9", profileID: "vp1", invalidatedAt: "2026-08-25 03:00:00"),
            "로그아웃 사이에 일어난 교체를 재로그인 후에도 알아채야 한다"
        )
    }
}
