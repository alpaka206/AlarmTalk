import XCTest
@testable import AlarmTalk

/// **알람을 켜면 화면 아래에 "N 후에 울려요." 를 잠깐 띄운다** — 스펙 `docs/spec/alarm-editor.md` §7.
///
/// 문장·계산은 홈 헤드라인과 같아야 하고(`NextAlarmHeadline.remainingLabel` + "%@ 후에 울려요."), 기준은 **방금 켠 그 알람의
/// 예약 시각**이다. AlarmKit 권한이 없거나, 켜지지 않았거나, 예약 시각이 지났으면 띄우지 않는다. 연타를 합치는 쪽(마지막 값이
/// 켜짐일 때 한 번)은 `AlarmToggleCoalescerTests` 가 본다.
@MainActor
final class RingInNoticeTests: XCTestCase {

    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func alarm(firingIn seconds: TimeInterval, enabled: Bool = true) -> LocalAlarmRecord {
        LocalAlarmRecord(
            label: "아침",
            hour: 7,
            minute: 0,
            fireAtMillis: Int64((now.timeIntervalSince1970 + seconds) * 1000),
            enabled: enabled,
            state: AlarmRuntimeState.armed.rawValue
        )
    }

    private func text(firingIn seconds: TimeInterval) -> String? {
        RingInNotice.text(for: alarm(firingIn: seconds), alarmAuthorized: true, now: now)
    }

    // MARK: - 문장

    func test_켠_알람은_그_알람까지_남은_시간을_헤드라인과_같은_문장으로_말한다() {
        let seconds: TimeInterval = 9 * 3600 + 21 * 60
        XCTAssertEqual(text(firingIn: seconds), "9시간 21분 후에 울려요.")
        // 남은 시간 조각을 새로 세지 않는다 — 헤드라인의 계산 그대로다.
        XCTAssertEqual(text(firingIn: seconds), "\(NextAlarmHeadline.remainingLabel(seconds: seconds)) 후에 울려요.")
    }

    func test_분은_올림이라_1분_미만도_1분이다() {
        XCTAssertEqual(text(firingIn: 20), "1분 후에 울려요.")
        XCTAssertEqual(text(firingIn: 5 * 60 + 1), "6분 후에 울려요.")
        XCTAssertEqual(text(firingIn: 3600), "1시간 후에 울려요.")
    }

    func test_날짜_지정_알람은_그_날짜까지의_남은_시간이다() throws {
        var record = LocalAlarmRecord(label: "한 번", hour: 7, minute: 30, fireAtMillis: 0, enabled: true)
        record.targetDate = "2026-11-12"
        record.targetTimezone = "Asia/Seoul"
        let fire = try XCTUnwrap(record.datedFireAtMillis)
        record.fireAtMillis = fire
        let threeHoursAndTwoDaysBefore = Date(timeIntervalSince1970: TimeInterval(fire) / 1000 - (2 * 86_400 + 3 * 3600))

        XCTAssertEqual(
            RingInNotice.text(for: record, alarmAuthorized: true, now: threeHoursAndTwoDaysBefore),
            "2일 3시간 후에 울려요."
        )
        // 그 날짜가 지났으면 켜지지 않은 알람이다 — 띄우지 않는다(지난 날짜 알럿이 따로 있다).
        let afterFire = Date(timeIntervalSince1970: TimeInterval(fire) / 1000 + 60)
        XCTAssertNil(RingInNotice.text(for: record, alarmAuthorized: true, now: afterFire))
    }

    // MARK: - 띄우지 않는 때

    func test_AlarmKit_권한이_없으면_띄우지_않는다() {
        // iOS 는 권한이 없으면 예약 자체가 안 돼 정말 안 울린다 — 남은 시간이 거짓말이 된다(헤드라인과 같은 판단).
        XCTAssertNil(RingInNotice.text(for: alarm(firingIn: 3600), alarmAuthorized: false, now: now))
    }

    func test_꺼진_알람은_띄우지_않는다() {
        // 켜기가 실패해 되돌아간 행(권한 거부·지난 날짜·예약 실패)이 이 갈래다.
        XCTAssertNil(RingInNotice.text(for: alarm(firingIn: 3600, enabled: false), alarmAuthorized: true, now: now))
    }

    func test_예약_시각이_지났거나_알람이_없으면_띄우지_않는다() {
        XCTAssertNil(text(firingIn: 0))
        XCTAssertNil(text(firingIn: -120))
        XCTAssertNil(RingInNotice.text(for: nil, alarmAuthorized: true, now: now))
    }

    // MARK: - 표시

    func test_띄운_안내는_스크린_리더에도_알리고_시간이_지나면_스스로_걷힌다() async {
        let gates = Gates()
        let spoken = Spoken()
        let presenter = RingInNoticePresenter(visibleDuration: { await gates.wait() }, announce: { spoken.texts.append($0) })

        presenter.present(for: alarm(firingIn: 3600), alarmAuthorized: true, now: now)
        XCTAssertEqual(presenter.current?.text, "1시간 후에 울려요.")
        XCTAssertEqual(spoken.texts, ["1시간 후에 울려요."], "스크린 리더에는 같은 문장을 알린다")

        await until { gates.count == 1 }
        XCTAssertNotNil(presenter.current, "시간이 다 되기 전에는 남아 있다")
        gates.releaseNext()
        await until { presenter.current == nil }
    }

    func test_새_안내는_앞_안내를_곧바로_바꾸고_앞_안내의_시계에_걷히지_않는다() async {
        let gates = Gates()
        let presenter = RingInNoticePresenter(visibleDuration: { await gates.wait() }, announce: { _ in })

        presenter.present(for: alarm(firingIn: 3600), alarmAuthorized: true, now: now)
        let first = presenter.current
        await until { gates.count == 1 }
        presenter.present(for: alarm(firingIn: 2 * 3600), alarmAuthorized: true, now: now)
        XCTAssertEqual(presenter.current?.text, "2시간 후에 울려요.")
        XCTAssertNotEqual(presenter.current?.id, first?.id, "새 안내는 새 캡슐이다")

        await until { gates.count == 2 }
        gates.releaseNext()  // 앞 안내의 시계가 끝난다.
        for _ in 0..<20 { await Task.yield() }
        XCTAssertEqual(presenter.current?.text, "2시간 후에 울려요.", "앞 안내의 시계가 새 안내를 걷지 않는다")

        gates.releaseNext()
        await until { presenter.current == nil }
    }

    func test_띄울_것이_없으면_아무것도_띄우지_않고_떠_있는_안내도_건드리지_않는다() async {
        let gates = Gates()
        let spoken = Spoken()
        let presenter = RingInNoticePresenter(visibleDuration: { await gates.wait() }, announce: { spoken.texts.append($0) })

        presenter.present(for: alarm(firingIn: 3600, enabled: false), alarmAuthorized: true, now: now)
        XCTAssertNil(presenter.current)
        XCTAssertEqual(spoken.texts, [], "띄우지 않은 것은 알리지도 않는다")

        presenter.present(for: alarm(firingIn: 3600), alarmAuthorized: true, now: now)
        let shown = presenter.current
        await until { gates.count == 1 }
        presenter.present(for: alarm(firingIn: 7200), alarmAuthorized: false, now: now)
        XCTAssertEqual(presenter.current, shown, "권한이 없는 알람은 떠 있는 안내를 바꾸지 않는다")
        XCTAssertEqual(gates.count, 1, "시계도 다시 걸지 않는다")
        XCTAssertEqual(spoken.texts, ["1시간 후에 울려요."])

        gates.releaseNext()
        await until { presenter.current == nil }
    }

    // MARK: - 도우미

    /// 손으로 푸는 기다림 — 부를 때마다 하나씩 쌓이고, 먼저 쌓인 것부터 푼다.
    private final class Gates: @unchecked Sendable {
        private var waiting: [CheckedContinuation<Void, Never>] = []
        private let lock = NSLock()

        func wait() async {
            await withCheckedContinuation { continuation in
                lock.lock(); waiting.append(continuation); lock.unlock()
            }
        }

        var count: Int { lock.lock(); defer { lock.unlock() }; return waiting.count }

        func releaseNext() {
            lock.lock()
            let next = waiting.isEmpty ? nil : waiting.removeFirst()
            lock.unlock()
            next?.resume()
        }
    }

    @MainActor
    private final class Spoken {
        var texts: [String] = []
    }

    private func until(_ condition: @MainActor () -> Bool, file: StaticString = #filePath, line: UInt = #line) async {
        for _ in 0..<200 {
            if condition() { return }
            await Task.yield()
        }
        XCTFail("기다린 상태가 오지 않았다", file: file, line: line)
    }
}
