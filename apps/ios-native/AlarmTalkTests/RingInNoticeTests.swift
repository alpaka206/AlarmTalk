import XCTest
@testable import AlarmTalk

/// **알람을 켜면 화면 아래에 "N 후에 울려요." 를 잠깐 띄운다** — 스펙 `docs/spec/alarm-editor.md` §7.
///
/// 문장·계산은 홈 헤드라인과 같아야 하고(`NextAlarmHeadline.remainingLabel` + "%@ 후에 울려요."), 기준은 **방금 켠 그 알람의
/// 예약 시각**이다. AlarmKit 권한이 없거나, 켜지지 않았거나, 예약 시각이 지났으면 띄우지 않는다. 그 알람을 끄거나 지우면 그
/// 알람의 안내만 거두고, 하단 탭이 가려지면(편집기·설정·이용권) 걷는다. 편집기는 저장이 끝까지 성공했을 때만 띄운다.
/// 연타를 합치는 쪽(마지막 값이 켜짐일 때 한 번)은 `AlarmToggleCoalescerTests` 가 본다.
@MainActor
final class RingInNoticeTests: XCTestCase {

    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func alarm(id: String = UUID().uuidString, firingIn seconds: TimeInterval, enabled: Bool = true) -> LocalAlarmRecord {
        LocalAlarmRecord(
            id: id,
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

    func test_며칠_뒤_알람은_일과_시간으로_말하고_지난_시각이면_띄우지_않는다() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let fire = Int64((now.timeIntervalSince1970 + 2 * 86_400 + 3 * 3600) * 1000)
        let record = LocalAlarmRecord(label: "주말", hour: 7, minute: 30, fireAtMillis: fire, enabled: true)
        XCTAssertEqual(RingInNotice.text(for: record, alarmAuthorized: true, now: now), "2일 3시간 후에 울려요.")
        // 그 시각이 지났으면 띄우지 않는다.
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

    // MARK: - 거두기(끄기·삭제)

    func test_끄거나_지우면_그_알람의_안내만_거두고_다른_알람의_안내는_남긴다() {
        let presenter = RingInNoticePresenter(visibleDuration: {}, announce: { _ in })

        presenter.present(for: alarm(id: "a", firingIn: 3600), alarmAuthorized: true, now: now)
        presenter.withdraw(alarmID: "b")
        XCTAssertEqual(presenter.current?.alarmID, "a", "다른 알람을 끄거나 지워도 이 안내는 남는다")

        presenter.withdraw(alarmID: "a")
        XCTAssertNil(presenter.current, "그 알람을 끄거나 지우면 곧바로 거둔다 — 꺼진 알람의 남은 시간을 말하지 않는다")

        presenter.present(for: alarm(id: "b", firingIn: 7200), alarmAuthorized: true, now: now)
        presenter.withdraw(alarmID: "a")
        XCTAssertEqual(presenter.current?.text, "2시간 후에 울려요.", "이미 거둔 알람을 다시 거둬도 지금 안내는 그대로다")
    }

    // MARK: - 목록 스위치(연타를 다 반영한 뒤)

    func test_목록_연타가_켬으로_끝나면_띄우고_그_알람이_꺼졌으면_거둔다() {
        let spoken = Spoken()
        let presenter = RingInNoticePresenter(visibleDuration: {}, announce: { spoken.texts.append($0) })
        let on = alarm(id: "a", firingIn: 3600)
        var off = on
        off.enabled = false

        presenter.listToggleSettled(alarmID: "a", enabled: true, row: on, alarmAuthorized: true, now: now)
        XCTAssertEqual(presenter.current?.text, "1시간 후에 울려요.", "켬이 반영됐으면 그 알람의 안내를 띄운다")

        // 끄기가 반영됐다(행이 꺼졌다) — 떠 있던 그 알람의 안내를 거둔다.
        presenter.listToggleSettled(alarmID: "a", enabled: false, row: off, alarmAuthorized: true, now: now)
        XCTAssertNil(presenter.current)

        // 켜기가 실패해 행이 꺼진 채다(권한·지난 날짜·예약 실패) — 띄우지 않는다.
        presenter.listToggleSettled(alarmID: "a", enabled: true, row: off, alarmAuthorized: true, now: now)
        XCTAssertNil(presenter.current)
        XCTAssertEqual(spoken.texts, ["1시간 후에 울려요."], "띄운 것만 알린다")
    }

    func test_목록_끄기가_실패해_켜진_채면_안내를_두고_그_사이_지웠으면_거둔다() {
        let presenter = RingInNoticePresenter(visibleDuration: {}, announce: { _ in })
        let on = alarm(id: "a", firingIn: 3600)

        presenter.present(for: on, alarmAuthorized: true, now: now)
        let shown = presenter.current
        // 끔으로 끝났는데 행이 여전히 켜져 있다 — 끄기(예약 취소)가 실패했다. 그 알람은 그대로 우니 안내도 둔다.
        presenter.listToggleSettled(alarmID: "a", enabled: false, row: on, alarmAuthorized: true, now: now)
        XCTAssertEqual(presenter.current, shown)

        // 다른 알람의 끄기는 이 안내를 건드리지 않는다.
        presenter.listToggleSettled(alarmID: "b", enabled: false, row: nil, alarmAuthorized: true, now: now)
        XCTAssertEqual(presenter.current, shown)

        // 반영하는 사이 그 알람을 지웠다(행이 없다) — 켬으로 끝났어도 거둔다.
        presenter.listToggleSettled(alarmID: "a", enabled: true, row: nil, alarmAuthorized: true, now: now)
        XCTAssertNil(presenter.current)
    }

    // MARK: - 하단 탭이 가려질 때(편집기·설정·이용권)

    func test_하단_탭이_가려지면_떠_있던_안내를_걷고_돌아와도_되살리지_않는다() {
        let presenter = RingInNoticePresenter(visibleDuration: {}, announce: { _ in })

        presenter.present(for: alarm(id: "a", firingIn: 3600), alarmAuthorized: true, now: now)
        XCTAssertNotNil(presenter.current)
        presenter.hostHidden()
        XCTAssertNil(presenter.current, "하위 화면 위에 남으면 지금 고치는 알람의 시각처럼 읽힌다")

        presenter.hostShown(currentRecord: { _ in self.alarm(id: "a", firingIn: 3600) }, alarmAuthorized: true, now: now)
        XCTAssertNil(presenter.current, "걷은 안내는 버린다 — 탭으로 돌아와도 다시 뜨지 않는다")
    }

    func test_가려진_동안_켠_것은_탭이_돌아오면_그때의_남은_시간으로_띄운다() {
        let spoken = Spoken()
        let presenter = RingInNoticePresenter(visibleDuration: {}, announce: { spoken.texts.append($0) })
        let saved = alarm(id: "a", firingIn: 3 * 3600)

        presenter.hostHidden()
        presenter.present(for: saved, alarmAuthorized: true, now: now)
        XCTAssertNil(presenter.current, "가려진 동안에는 띄우지 않는다")
        XCTAssertEqual(spoken.texts, [], "보이지 않는 안내를 스크린 리더에 알리지 않는다")

        // 한 시간 뒤에 탭으로 돌아왔다 — 남은 시간은 그때 다시 센다.
        presenter.hostShown(currentRecord: { $0 == "a" ? saved : nil }, alarmAuthorized: true, now: now.addingTimeInterval(3600))
        XCTAssertEqual(presenter.current?.text, "2시간 후에 울려요.")
        XCTAssertEqual(presenter.current?.alarmID, "a")
        XCTAssertEqual(spoken.texts, ["2시간 후에 울려요."])
    }

    func test_가려진_동안_켠_알람이_그사이_꺼졌거나_지워졌거나_거뒀으면_띄우지_않는다() {
        let presenter = RingInNoticePresenter(visibleDuration: {}, announce: { _ in })
        var off = alarm(id: "a", firingIn: 3600)
        off.enabled = false

        let rowsWhenBack: [(String, LocalAlarmRecord?)] = [("꺼짐", off), ("지워짐", nil)]
        for (label, record) in rowsWhenBack {
            presenter.hostHidden()
            presenter.present(for: alarm(id: "a", firingIn: 3600), alarmAuthorized: true, now: now)
            presenter.hostShown(currentRecord: { _ in record }, alarmAuthorized: true, now: now)
            XCTAssertNil(presenter.current, label)
        }

        presenter.hostHidden()
        presenter.present(for: alarm(id: "a", firingIn: 3600), alarmAuthorized: true, now: now)
        presenter.withdraw(alarmID: "a")
        presenter.hostShown(currentRecord: { _ in self.alarm(id: "a", firingIn: 3600) }, alarmAuthorized: true, now: now)
        XCTAssertNil(presenter.current, "기다리던 안내도 그 알람을 끄거나 지우면 거둔다")

        // 탭 화면이 통째로 사라졌다(로그아웃·차단 화면) — 기다리던 것도 버린다.
        presenter.hostHidden()
        presenter.present(for: alarm(id: "a", firingIn: 3600), alarmAuthorized: true, now: now)
        presenter.reset()
        XCTAssertNil(presenter.waitingAlarmID)
        // 가림 상태는 reset 이 바꾸지 않는다 — 탭 화면이 나타나며 다시 알린다. 편집기가 떠 있는 채 불려도 그 위에 띄우지 않는다.
        presenter.present(for: alarm(id: "b", firingIn: 3600), alarmAuthorized: true, now: now)
        XCTAssertNil(presenter.current)
        presenter.hostShown(currentRecord: { self.alarm(id: $0, firingIn: 3600) }, alarmAuthorized: true, now: now)
        XCTAssertEqual(presenter.current?.alarmID, "b", "버린 것(a)은 뜨지 않고, reset 뒤에 켠 것(b)만 탭이 돌아오면 뜬다")
    }

    // MARK: - 편집기 저장(끝까지 성공했을 때만)

    func test_편집기는_예약과_교체_정리가_끝까지_성공했을_때만_띄운다() async {
        let saved = alarm(id: "a", firingIn: 3600)
        let cases: [(label: String, schedules: Bool, conflicts: Bool?, outcome: AlarmSaveOutcome)] = [
            ("예약 실패", false, nil, .scheduleFailed),
            ("교체 — 예약 실패", false, true, .scheduleFailed),
            ("교체 — 충돌 정리 실패(롤백)", true, false, .replacementFailed),
            ("교체 — 끝까지 성공", true, true, .completed),
            ("충돌 없음 — 성공", true, nil, .completed),
        ]
        for item in cases {
            let presenter = RingInNoticePresenter(visibleDuration: {}, announce: { _ in })
            var clearConflicts: (@MainActor () async -> Bool)?
            if let result = item.conflicts { clearConflicts = { result } }
            let outcome = await runAlarmSaveSteps(schedule: { item.schedules }, clearConflicts: clearConflicts)
            XCTAssertEqual(outcome, item.outcome, item.label)

            presenter.present(after: outcome, for: saved, alarmAuthorized: true, now: now)
            if outcome == .completed {
                XCTAssertEqual(presenter.current?.text, "1시간 후에 울려요.", item.label)
            } else {
                XCTAssertNil(presenter.current, "\(item.label) — 남지 않은 알람의 남은 시간을 말하지 않는다")
            }
        }
    }

    func test_편집기_저장은_편집기가_닫혀_하단_탭이_돌아오면_뜬다() {
        let presenter = RingInNoticePresenter(visibleDuration: {}, announce: { _ in })
        let saved = alarm(id: "a", firingIn: 3600)

        // 저장하는 순간에는 편집기가 하단 탭을 가리고 있다.
        presenter.hostHidden()
        presenter.present(after: .completed, for: saved, alarmAuthorized: true, now: now)
        XCTAssertNil(presenter.current)
        // 같은 턴에 편집기가 닫혀 탭이 돌아온다.
        presenter.hostShown(currentRecord: { $0 == "a" ? saved : nil }, alarmAuthorized: true, now: now)
        XCTAssertEqual(presenter.current?.text, "1시간 후에 울려요.")
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
