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

    /// 강등 개수를 흉내 내는 id 목록(내용은 판정에 쓰이지 않는다).
    private func ids(_ count: Int) -> [String] { (0..<count).map { "a\($0)" } }

    /// 확정까지 끝난 회차의 강등 개수. 실제 호출부는 예약 정리 뒤에 `confirm()` 한다.
    @discardableResult
    private func applyChanged(_ user: String, _ generation: String?, degraded: Int?) -> Int {
        let pending = store().applyIfChanged(
            userID: user, profileID: "vp1", invalidatedAt: generation
        ) { degraded.map(ids) }
        pending.confirm()
        return pending.degraded.count
    }

    @discardableResult
    private func applyNotApplied(_ user: String, _ generation: String?, degraded: Int?) -> Int {
        let pending = store().applyIfNotApplied(
            userID: user, profileID: "vp1", invalidatedAt: generation
        ) { degraded.map(ids) }
        pending.confirm()
        return pending.degraded.count
    }

    func test_처음_본_프로필은_조용히_적기만_한다() {
        var degrades = 0
        let pending = store().applyIfChanged(
            userID: "u1", profileID: "vp1", invalidatedAt: "2026-08-25 01:00:00"
        ) { degrades += 1; return self.ids(3) }
        pending.confirm()

        XCTAssertEqual(pending.degraded.count, 0)
        XCTAssertEqual(degrades, 0, "첫 조회를 '바뀌었다' 로 읽으면 업데이트 직후 모든 설치가 알람을 날린다")
        // 같은 값은 변화가 아니다.
        XCTAssertEqual(
            applyChanged("u1", "2026-08-25 01:00:00", degraded: 3),
            0
        )
    }

    func test_새_세대는_강등하고_확정한다() {
        _ = applyChanged("u2", nil, degraded: 0)

        XCTAssertEqual(
            applyChanged("u2", "2026-08-25 01:00:00", degraded: 2),
            2
        )
        // 확정됐으니 같은 세대로는 두 번 돌지 않는다.
        XCTAssertEqual(
            applyChanged("u2", "2026-08-25 01:00:00", degraded: 2),
            0
        )
    }

    /// ⚠ 강등이 실패했거나 계정이 바뀌었으면(=nil) **확정하지 않는다** — 다음 회차가 다시 집는다.
    func test_강등이_확정을_거부하면_다음_회차가_다시_집는다() {
        _ = applyChanged("u3", nil, degraded: 0)
        XCTAssertEqual(
            applyChanged("u3", "2026-08-25 01:00:00", degraded: nil),
            0
        )
        XCTAssertEqual(
            applyChanged("u3", "2026-08-25 01:00:00", degraded: 1),
            1
        )
    }

    /// ⚠ **'봤다' 를 '반영했다' 로 읽으면 푸시가 무력해진다** — iOS 는 같은 푸시에서 목록
    /// 갱신이 교체 처리보다 먼저 끝나므로, 그 시점에 표식이 새 세대로 앞서 있다.
    func test_목록이_먼저_시드해도_푸시는_반영한다() {
        // 첫 조회가 새 세대를 그대로 시드한다(강등은 하지 않는다).
        _ = applyChanged("u4", "2026-08-25 01:00:00", degraded: 9)

        XCTAssertEqual(
            applyNotApplied("u4", "2026-08-25 01:00:00", degraded: 2),
            2,
            "시드를 반영으로 읽으면 뒤이은 푸시가 아무것도 내리지 않는다"
        )
        // 이제는 반영됐으므로 같은 푸시가 또 와도 지나간다.
        XCTAssertEqual(
            applyNotApplied("u4", "2026-08-25 01:00:00", degraded: 2),
            0
        )
    }

    /// ⚠ **반영하지 못한 세대는 끝날 때까지 매 회차 다시 집힌다**(Codex #703 P1).
    /// 예전에는 `seen` 이 확정할 때 함께 올라가, 강등이 **실패한** 세대도 다음 회차부터
    /// '바뀐 것 없음' 이 되어 영영 재시도되지 않았다 — 재시작하면 메모리 표시도 사라져
    /// 회수된 목소리를 문 알람이 그대로 남는다.
    func test_반영하지_못한_세대는_계속_다시_집힌다() {
        let store = store()
        // 첫 조회는 기준선만 적는다(강등하지 않는다).
        _ = store.applyIfChanged(userID: "u-retry", profileID: "vp", invalidatedAt: "2026-08-25 01:00:00") { [] }

        // 새 세대가 왔는데 **강등이 실패**한다(nil) — 확정되지 않는다.
        let failed = store.applyIfChanged(
            userID: "u-retry",
            profileID: "vp",
            invalidatedAt: "2026-08-25 02:00:00"
        ) { nil }
        XCTAssertTrue(failed.failed, "실패는 프로필 id 와 함께 돌아와야 한다")

        // 같은 세대가 다음 회차에 **다시 집혀야** 한다.
        var retried = false
        let second = store.applyIfChanged(
            userID: "u-retry",
            profileID: "vp",
            invalidatedAt: "2026-08-25 02:00:00"
        ) { retried = true; return ["a1"] }
        XCTAssertTrue(retried, "확정하지 못한 세대가 '이미 본 것' 으로 묻히면 영영 회수되지 않는다")
        XCTAssertEqual(second.degraded, ["a1"])

        // 확정한 뒤에는 지나간다.
        _ = second.confirm()
        var thirdRan = false
        _ = store.applyIfChanged(
            userID: "u-retry",
            profileID: "vp",
            invalidatedAt: "2026-08-25 02:00:00"
        ) { thirdRan = true; return [] }
        XCTAssertFalse(thirdRan, "확정한 세대를 또 내리면 새 목소리로 만든 알람이 벗겨진다")
    }

    /// ⚠ 늦게 도착한 **앞선** 세대의 푸시는 이미 처리한 것으로 본다 — 뒤 세대로 만든 알람을
    /// 지우면 안 된다.
    func test_앞선_세대의_푸시는_이미_처리한_것으로_본다() {
        _ = applyNotApplied("u5", "2026-08-25 02:00:00", degraded: 1)

        XCTAssertEqual(
            applyNotApplied("u5", "2026-08-25 01:00:00", degraded: 5),
            0
        )
        XCTAssertEqual(
            applyNotApplied("u5", "2026-08-25 03:00:00", degraded: 5),
            5
        )
    }

    /// 세대를 모르는 옛 신호는 반영하되 **확정하지 않는다**(무엇을 봤는지 모른다).
    func test_세대_없는_신호는_확정하지_않는다() {
        XCTAssertEqual(
            applyNotApplied("u6", nil, degraded: 1),
            1
        )
        XCTAssertEqual(
            applyNotApplied("u6", nil, degraded: 1),
            1,
            "무엇을 봤는지 모르면 확정하지 않는다 — 다음 신호도 그대로 반영한다"
        )
    }

    /// ⚠ **낡은 목록이 표식을 과거로 되돌리면** 이미 처리한 교체를 다시 처리한다.
    func test_앞선_세대는_변화로_보지_않는다() {
        _ = applyChanged("u7", nil, degraded: 0)
        _ = applyChanged("u7", "2026-08-25 02:00:00", degraded: 1)

        XCTAssertEqual(
            applyChanged("u7", "2026-08-25 01:00:00", degraded: 1),
            0,
            "낡은 목록이 표식을 되돌리면 그 사이 만든 알람이 지워진다"
        )
    }

    /// ⚠ **판정과 강등 사이에 더 새 세대가 끼어들 수 없어야 한다.** 예전에는 판정을 먼저 해
    /// 두고 나중에 강등해서, 그 사이 반영된 새 세대의 알람을 옛 회차가 지웠다.
    func test_강등_중에는_다른_회차가_끼어들지_못한다() {
        let older = "2026-08-25 01:00:00"
        let newer = "2026-08-25 02:00:00"
        _ = applyChanged("u8", nil, degraded: 0)

        var newerRan = 0
        let done = DispatchSemaphore(value: 0)
        // 옛 회차가 강등 중일 때 새 회차가 들어오려 하면, 락이 풀린 뒤에 실행된다.
        let pending = store().applyIfChanged(userID: "u8", profileID: "vp1", invalidatedAt: older) {
            DispatchQueue.global().async {
                newerRan = self.applyChanged("u8", newer, degraded: 7)
                done.signal()
            }
            // 새 회차는 락에 막혀 이 강등이 끝나기 전에는 시작조차 못 한다.
            XCTAssertEqual(done.wait(timeout: .now() + 0.2), .timedOut, "판정·강등·확정이 직렬화되지 않았다")
            return self.ids(1)
        }
        pending.confirm()

        XCTAssertEqual(pending.degraded.count, 1)
        // 락이 풀린 뒤에야 새 회차가 돈다 — 그때는 이미 옛 세대가 확정돼 있으므로 그대로 반영된다.
        XCTAssertEqual(done.wait(timeout: .now() + 2), .success)
        XCTAssertEqual(newerRan, 7, "새 세대는 옛 회차가 끝난 뒤 그대로 반영돼야 한다")
    }

    /// ⚠ **강등이 디스크에 남은 뒤에만 확정한다.** 백그라운드 푸시로 깨어난 실행은 비동기
    /// 쓰기 전에 끝날 수 있는데, 그때 표식만 앞서 나가면 다음 실행이 옛 목소리 알람을 다시
    /// 읽어 오고도 **영영 다시 내리지 않는다.**
    @MainActor
    func test_저장이_확인돼야_확정한다() {
        let store = LocalAlarmStore(
            storageURL: FileManager.default.temporaryDirectory
                .appendingPathComponent("marker-save-\(UUID().uuidString).json"),
            loadFromDisk: false
        )
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        var record = LocalAlarmRecord(
            id: "a1", label: "아침", hour: 7, minute: 0,
            fireAtMillis: now + 60_000, origin: AlarmOrigin.localOwned.rawValue,
            createdAtMillis: now, updatedAtMillis: now
        )
        record.voiceProfileId = "clone-1"
        _ = store.upsert(record)

        XCTAssertTrue(store.saveNow(), "동기 저장이 성공을 보고해야 확정 여부를 판단할 수 있다")
    }

    /// ⚠ **예약 확인이 끝날 때까지 내린 행들을 들고 간다.**
    ///
    /// 강등은 성공했는데 예약 정리가 실패해 확정을 미루면, 그 행들은 **이미 톤이라** 다음
    /// 회차의 강등 대상이 되지 않는다(빈 결과). 빈 결과를 '확인할 것 없음' 으로 읽으면 그
    /// 회차가 그냥 확정해 버려, 실패한 예약이 회수된 목소리를 그대로 물고 남는다.
    func test_확인_전까지_내린_행들을_들고_간다() {
        applyChanged("u12", nil, degraded: 0)

        // 1회차: 강등은 됐지만 예약 확인이 안 돼 확정하지 않는다.
        let first = store().applyIfChanged(
            userID: "u12", profileID: "vp1", invalidatedAt: "2026-08-25 01:00:00"
        ) { ["a1", "a2"] }
        XCTAssertEqual(first.degraded, ["a1", "a2"])
        XCTAssertEqual(first.unverified, ["a1", "a2"])

        // 2회차: 새로 내릴 것은 없지만 확인할 것은 남아 있다.
        let second = store().applyIfChanged(
            userID: "u12", profileID: "vp1", invalidatedAt: "2026-08-25 01:00:00"
        ) { [] }
        XCTAssertTrue(second.degraded.isEmpty, "안내 개수는 이번에 내린 것만 센다")
        XCTAssertEqual(
            second.unverified, ["a1", "a2"],
            "빈 회차를 '확인할 것 없음' 으로 읽으면 실패한 예약이 그대로 남는다"
        )
        second.confirm()

        // 확정했으면 들고 있던 목록도 비운다.
        let third = store().applyIfChanged(
            userID: "u12", profileID: "vp1", invalidatedAt: "2026-08-25 02:00:00"
        ) { [] }
        XCTAssertTrue(third.unverified.isEmpty)
    }

    /// ⚠ **재시작 뒤에도 '정리 중' 을 다시 세울 수 있어야 한다**(Codex #703 P1).
    ///
    /// 그 표시는 뷰모델의 메모리 집합이라 프로세스가 끝나면 비는데, 저장소에는 미확인 칸·
    /// 재시도 표식이 그대로 남는다. 되살리지 않으면 다음 정리가 돌기 **전에** 그 목소리를
    /// 고를 수 있게 되고, 캐시에 남은 TTS 로 알람까지 저장된다 — 그 알람을 재시도가 벗긴다.
    func test_확인이_남은_프로필은_재시작_뒤에도_집힌다() {
        applyChanged("u-unsettled", nil, degraded: 0)

        // 강등은 됐지만 예약 확인이 안 돼 확정하지 않는다 = 미확인 칸이 남는다.
        let first = store().applyIfChanged(
            userID: "u-unsettled", profileID: "vp1", invalidatedAt: "2026-08-25 01:00:00"
        ) { ["a1"] }
        XCTAssertEqual(first.unverified, ["a1"])

        // 재시작을 흉내 낸다 — 새 인스턴스로 저장소만 보고 답해야 한다.
        XCTAssertEqual(
            store().unsettledProfileIDs(userID: "u-unsettled", candidateProfileIDs: ["vp1", "vp2"]),
            ["vp1"],
            "저장소에 미완 작업이 남았는데 비어 돌아오면 그 틈에 만든 알람을 다음 회차가 벗긴다"
        )

        first.confirm()
        XCTAssertTrue(
            store().unsettledProfileIDs(userID: "u-unsettled", candidateProfileIDs: ["vp1"]).isEmpty,
            "확정한 프로필까지 계속 가리면 멀쩡한 목소리를 영영 못 고른다"
        )
    }

    /// 강등 자체가 실패해 **재시도 표식만** 남은 경우도 같다 — 미확인 칸은 없다.
    func test_재시도_표식만_남아도_집힌다() {
        let store = store()
        _ = store.applyIfChanged(userID: "u-retry2", profileID: "vp", invalidatedAt: "2026-08-25 01:00:00") { [] }
        let failed = store.applyIfChanged(
            userID: "u-retry2", profileID: "vp", invalidatedAt: "2026-08-25 02:00:00"
        ) { nil }
        XCTAssertTrue(failed.failed)

        XCTAssertEqual(
            store.unsettledProfileIDs(userID: "u-retry2", candidateProfileIDs: ["vp"]),
            ["vp"],
            "강등이 실패한 목소리를 고를 수 있게 두면 다음 재시도가 그 알람을 되돌릴 수 없이 벗긴다"
        )
    }

    /// 목록에 없는 프로필까지 답하지는 않는다 — 후보로 준 것만 본다.
    func test_후보에_없는_프로필은_답하지_않는다() {
        applyChanged("u-scope", nil, degraded: 0)
        _ = store().applyIfChanged(
            userID: "u-scope", profileID: "vp1", invalidatedAt: "2026-08-25 01:00:00"
        ) { ["a1"] }

        XCTAssertTrue(
            store().unsettledProfileIDs(userID: "u-scope", candidateProfileIDs: ["vp9"]).isEmpty
        )
        XCTAssertTrue(
            store().unsettledProfileIDs(userID: nil, candidateProfileIDs: ["vp1"]).isEmpty,
            "계정이 없으면 판단할 근거도 없다"
        )
    }

    func test_계정별로_갈린다() {
        _ = applyChanged("u9", nil, degraded: 0)
        XCTAssertEqual(
            applyChanged("u9", "2026-08-25 01:00:00", degraded: 1),
            1
        )
        // 다른 계정은 아직 처음 보는 프로필이다.
        XCTAssertEqual(
            applyChanged("u10", "2026-08-25 01:00:00", degraded: 1),
            0
        )
    }

    /// ⚠ **로그아웃에서 지우면 안 된다.** 로그아웃은 로컬 알람을 끄기만 하고 지우지 않는다 —
    /// 표식이 사라지면 그 사이의 교체를 재로그인한 기기가 '처음 봤다' 로 읽어 영영 강등하지
    /// 않는다(그 알람을 다시 켜면 지운 목소리가 운다).
    func test_로그아웃_뒤에도_기준이_남는다() {
        _ = applyChanged("u11", "2026-08-25 01:00:00", degraded: 0)

        // (로그아웃 — 이 저장소는 아무것도 지우지 않는다)
        XCTAssertEqual(
            applyChanged("u11", "2026-08-25 03:00:00", degraded: 4),
            4,
            "로그아웃 사이에 일어난 교체를 재로그인 후에도 알아채야 한다"
        )
    }
}
