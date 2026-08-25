import XCTest
@testable import AlarmTalk

/// **교체 표식은 푸시를 놓친 기기가 스스로 수렴하는 유일한 근거다** — 규칙을 고정한다.
///
/// ⚠ 이 저장소가 노출하는 것은 **판정→강등→확정을 한 임계구역에서 도는** 두 메서드뿐이다.
/// 판정만 따로 해 두면, 그 값을 들고 기다리는 사이 더 새 세대가 반영되고 사용자가 **새
/// 목소리로** 만든 알람을 뒤늦게 깨어난 옛 회차가 되돌릴 수 없이 지운다.
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

    private func store() -> VoiceReplacementMarkerStore {
        VoiceReplacementMarkerStore(defaults: defaults)
    }

    func test_처음_본_프로필은_조용히_적기만_한다() {
        var degrades = 0
        let applied = store().applyIfChanged(
            userID: "u1", profileID: "vp1", invalidatedAt: "2026-08-25 01:00:00"
        ) { degrades += 1; return 3 }

        XCTAssertEqual(applied, 0)
        XCTAssertEqual(degrades, 0, "첫 조회를 '바뀌었다' 로 읽으면 업데이트 직후 모든 설치가 알람을 날린다")
        // 같은 값은 변화가 아니다.
        XCTAssertEqual(
            store().applyIfChanged(userID: "u1", profileID: "vp1", invalidatedAt: "2026-08-25 01:00:00") { 3 },
            0
        )
    }

    func test_새_세대는_강등하고_확정한다() {
        _ = store().applyIfChanged(userID: "u2", profileID: "vp1", invalidatedAt: nil) { 0 }

        XCTAssertEqual(
            store().applyIfChanged(userID: "u2", profileID: "vp1", invalidatedAt: "2026-08-25 01:00:00") { 2 },
            2
        )
        // 확정됐으니 같은 세대로는 두 번 돌지 않는다.
        XCTAssertEqual(
            store().applyIfChanged(userID: "u2", profileID: "vp1", invalidatedAt: "2026-08-25 01:00:00") { 2 },
            0
        )
    }

    /// ⚠ 강등이 실패했거나 계정이 바뀌었으면(=nil) **확정하지 않는다** — 다음 회차가 다시 집는다.
    func test_강등이_확정을_거부하면_다음_회차가_다시_집는다() {
        _ = store().applyIfChanged(userID: "u3", profileID: "vp1", invalidatedAt: nil) { 0 }
        XCTAssertEqual(
            store().applyIfChanged(userID: "u3", profileID: "vp1", invalidatedAt: "2026-08-25 01:00:00") { nil },
            0
        )
        XCTAssertEqual(
            store().applyIfChanged(userID: "u3", profileID: "vp1", invalidatedAt: "2026-08-25 01:00:00") { 1 },
            1
        )
    }

    /// ⚠ **'봤다' 를 '반영했다' 로 읽으면 푸시가 무력해진다** — iOS 는 같은 푸시에서 목록
    /// 갱신이 교체 처리보다 먼저 끝나므로, 그 시점에 표식이 새 세대로 앞서 있다.
    func test_목록이_먼저_시드해도_푸시는_반영한다() {
        // 첫 조회가 새 세대를 그대로 시드한다(강등은 하지 않는다).
        _ = store().applyIfChanged(userID: "u4", profileID: "vp1", invalidatedAt: "2026-08-25 01:00:00") { 9 }

        XCTAssertEqual(
            store().applyIfNotApplied(userID: "u4", profileID: "vp1", invalidatedAt: "2026-08-25 01:00:00") { 2 },
            2,
            "시드를 반영으로 읽으면 뒤이은 푸시가 아무것도 내리지 않는다"
        )
        // 이제는 반영됐으므로 같은 푸시가 또 와도 지나간다.
        XCTAssertEqual(
            store().applyIfNotApplied(userID: "u4", profileID: "vp1", invalidatedAt: "2026-08-25 01:00:00") { 2 },
            0
        )
    }

    /// ⚠ 늦게 도착한 **앞선** 세대의 푸시는 이미 처리한 것으로 본다 — 뒤 세대로 만든 알람을
    /// 지우면 안 된다.
    func test_앞선_세대의_푸시는_이미_처리한_것으로_본다() {
        _ = store().applyIfNotApplied(userID: "u5", profileID: "vp1", invalidatedAt: "2026-08-25 02:00:00") { 1 }

        XCTAssertEqual(
            store().applyIfNotApplied(userID: "u5", profileID: "vp1", invalidatedAt: "2026-08-25 01:00:00") { 5 },
            0
        )
        XCTAssertEqual(
            store().applyIfNotApplied(userID: "u5", profileID: "vp1", invalidatedAt: "2026-08-25 03:00:00") { 5 },
            5
        )
    }

    /// 세대를 모르는 옛 신호는 반영하되 **확정하지 않는다**(무엇을 봤는지 모른다).
    func test_세대_없는_신호는_확정하지_않는다() {
        XCTAssertEqual(
            store().applyIfNotApplied(userID: "u6", profileID: "vp1", invalidatedAt: nil) { 1 },
            1
        )
        XCTAssertEqual(
            store().applyIfNotApplied(userID: "u6", profileID: "vp1", invalidatedAt: nil) { 1 },
            1,
            "무엇을 봤는지 모르면 확정하지 않는다 — 다음 신호도 그대로 반영한다"
        )
    }

    /// ⚠ **낡은 목록이 표식을 과거로 되돌리면** 이미 처리한 교체를 다시 처리한다.
    func test_앞선_세대는_변화로_보지_않는다() {
        _ = store().applyIfChanged(userID: "u7", profileID: "vp1", invalidatedAt: nil) { 0 }
        _ = store().applyIfChanged(userID: "u7", profileID: "vp1", invalidatedAt: "2026-08-25 02:00:00") { 1 }

        XCTAssertEqual(
            store().applyIfChanged(userID: "u7", profileID: "vp1", invalidatedAt: "2026-08-25 01:00:00") { 1 },
            0,
            "낡은 목록이 표식을 되돌리면 그 사이 만든 알람이 지워진다"
        )
    }

    /// ⚠ **판정과 강등 사이에 더 새 세대가 끼어들 수 없어야 한다.** 예전에는 판정을 먼저 해
    /// 두고 나중에 강등해서, 그 사이 반영된 새 세대의 알람을 옛 회차가 지웠다.
    func test_강등_중에는_다른_회차가_끼어들지_못한다() {
        let older = "2026-08-25 01:00:00"
        let newer = "2026-08-25 02:00:00"
        _ = store().applyIfChanged(userID: "u8", profileID: "vp1", invalidatedAt: nil) { 0 }

        var newerRan = 0
        let done = DispatchSemaphore(value: 0)
        // 옛 회차가 강등 중일 때 새 회차가 들어오려 하면, 락이 풀린 뒤에 실행된다.
        let applied = store().applyIfChanged(userID: "u8", profileID: "vp1", invalidatedAt: older) {
            DispatchQueue.global().async {
                newerRan = self.store().applyIfChanged(
                    userID: "u8", profileID: "vp1", invalidatedAt: newer
                ) { 7 }
                done.signal()
            }
            // 새 회차는 락에 막혀 이 강등이 끝나기 전에는 시작조차 못 한다.
            XCTAssertEqual(done.wait(timeout: .now() + 0.2), .timedOut, "판정·강등·확정이 직렬화되지 않았다")
            return 1
        }

        XCTAssertEqual(applied, 1)
        // 락이 풀린 뒤에야 새 회차가 돈다 — 그때는 이미 옛 세대가 확정돼 있으므로 그대로 반영된다.
        XCTAssertEqual(done.wait(timeout: .now() + 2), .success)
        XCTAssertEqual(newerRan, 7, "새 세대는 옛 회차가 끝난 뒤 그대로 반영돼야 한다")
    }

    func test_계정별로_갈린다() {
        _ = store().applyIfChanged(userID: "u9", profileID: "vp1", invalidatedAt: nil) { 0 }
        XCTAssertEqual(
            store().applyIfChanged(userID: "u9", profileID: "vp1", invalidatedAt: "2026-08-25 01:00:00") { 1 },
            1
        )
        // 다른 계정은 아직 처음 보는 프로필이다.
        XCTAssertEqual(
            store().applyIfChanged(userID: "u10", profileID: "vp1", invalidatedAt: "2026-08-25 01:00:00") { 1 },
            0
        )
    }

    /// ⚠ **로그아웃에서 지우면 안 된다.** 로그아웃은 로컬 알람을 끄기만 하고 지우지 않는다 —
    /// 표식이 사라지면 그 사이의 교체를 재로그인한 기기가 '처음 봤다' 로 읽어 영영 강등하지
    /// 않는다(그 알람을 다시 켜면 지운 목소리가 운다).
    func test_로그아웃_뒤에도_기준이_남는다() {
        _ = store().applyIfChanged(userID: "u11", profileID: "vp1", invalidatedAt: "2026-08-25 01:00:00") { 0 }

        // (로그아웃 — 이 저장소는 아무것도 지우지 않는다)
        XCTAssertEqual(
            store().applyIfChanged(userID: "u11", profileID: "vp1", invalidatedAt: "2026-08-25 03:00:00") { 4 },
            4,
            "로그아웃 사이에 일어난 교체를 재로그인 후에도 알아채야 한다"
        )
    }
}
