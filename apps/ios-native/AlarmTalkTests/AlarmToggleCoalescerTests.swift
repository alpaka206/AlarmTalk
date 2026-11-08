import XCTest
@testable import AlarmTalk

/// 알람 스위치는 **손을 멈춘 뒤의 마지막 값만** 적용하고, 같은 알람의 적용은 한 번에 하나다(`AlarmToggleCoalescer`).
///
/// 켬·끔·켬이 첫 AlarmKit 예약 하나가 끝나기 전에 모두 들어오면 두 예약이 같은 행에 핸들을 차례로 적어, 먼저 적힌 예약이 끌 수 없는
/// 채 남았다. 여기서는 기다림(`settleDelay`)과 적용을 테스트가 손으로 풀어 순서를 정한다.
@MainActor
final class AlarmToggleCoalescerTests: XCTestCase {

    /// 손으로 푸는 기다림 — 부를 때마다 하나씩 쌓이고, 테스트가 차례로 푼다.
    private final class Gates: @unchecked Sendable {
        private var waiting: [CheckedContinuation<Void, Never>] = []
        private let lock = NSLock()

        func wait() async {
            await withCheckedContinuation { continuation in
                lock.lock(); waiting.append(continuation); lock.unlock()
            }
        }

        var count: Int { lock.lock(); defer { lock.unlock() }; return waiting.count }

        func releaseAll() {
            lock.lock(); let all = waiting; waiting = []; lock.unlock()
            all.forEach { $0.resume() }
        }
    }

    /// 저장소 흉내 — 적용하면 그 값이 된다. `hold` 가 있으면 적용이 그 기다림이 풀릴 때까지 머문다.
    @MainActor
    private final class FakeAlarm {
        var enabled: Bool
        var applied: [Bool] = []
        var hold: Gates?
        /// 적용이 실패해 행이 되돌아간다(권한 거부 등) — 저장소 값이 바뀌지 않는다.
        var fails = false
        init(enabled: Bool) { self.enabled = enabled }

        func apply(_ value: Bool) async {
            applied.append(value)
            if let hold { await hold.wait() }
            if !fails { enabled = value }
        }
    }

    private func until(_ condition: @MainActor () -> Bool, file: StaticString = #filePath, line: UInt = #line) async {
        for _ in 0..<200 {
            if condition() { return }
            await Task.yield()
        }
        XCTFail("기다린 상태가 오지 않았다", file: file, line: line)
    }

    private func toggle(
        _ coalescer: AlarmToggleCoalescer,
        _ alarm: FakeAlarm,
        _ value: Bool,
        settled: @escaping @MainActor (Bool) -> Void = { _ in }
    ) {
        coalescer.toggle(id: "a1", to: value, current: { alarm.enabled }, apply: { await alarm.apply($0) }, settled: settled)
    }

    /// `settled` 로 받은 값 — 목록은 이걸로 "N 후에 울려요" 를 띄운다(스펙 alarm-editor.md §7).
    @MainActor
    private final class SettledLog {
        var values: [Bool] = []
        func record(_ value: Bool) { values.append(value) }
    }

    func test_빠르게_여러_번_누르면_멈춘_뒤_마지막_값_하나만_적용한다() async {
        let gates = Gates()
        let coalescer = AlarmToggleCoalescer(settleDelay: { await gates.wait() })
        let alarm = FakeAlarm(enabled: false)

        toggle(coalescer, alarm, true)
        toggle(coalescer, alarm, false)
        toggle(coalescer, alarm, true)
        XCTAssertEqual(coalescer.shown["a1"], true, "누르는 동안 화면은 곧바로 바뀐다")
        XCTAssertEqual(alarm.applied, [], "누르는 동안에는 보내지 않는다")

        await until { gates.count == 3 }
        gates.releaseAll()
        await until { coalescer.shown["a1"] == nil }

        XCTAssertEqual(alarm.applied, [true], "중간 값(끔)은 보내지 않고 마지막 값만 적용한다")
        XCTAssertTrue(alarm.enabled)
    }

    func test_마지막_값이_이미_저장된_값이면_아무것도_보내지_않는다() async {
        let gates = Gates()
        let coalescer = AlarmToggleCoalescer(settleDelay: { await gates.wait() })
        let alarm = FakeAlarm(enabled: false)

        toggle(coalescer, alarm, true)
        toggle(coalescer, alarm, false)
        await until { gates.count == 2 }
        gates.releaseAll()
        await until { coalescer.shown["a1"] == nil }

        XCTAssertEqual(alarm.applied, [])
    }

    func test_적용하는_사이_또_누르면_끝난_뒤_마지막_값을_적용한다_겹쳐_보내지_않는다() async {
        let gates = Gates()
        let hold = Gates()
        let coalescer = AlarmToggleCoalescer(settleDelay: { await gates.wait() })
        let alarm = FakeAlarm(enabled: false)
        alarm.hold = hold

        toggle(coalescer, alarm, true)
        await until { gates.count == 1 }
        gates.releaseAll()
        await until { hold.count == 1 }
        XCTAssertEqual(alarm.applied, [true], "첫 적용(켬)이 돈다")

        // 적용이 끝나기 전에 끄고, 손도 멈췄다(기다림을 푼다) — 두 번째 적용은 첫 적용이 끝난 뒤에야 나간다.
        toggle(coalescer, alarm, false)
        XCTAssertEqual(coalescer.shown["a1"], false)
        await until { gates.count == 1 }
        gates.releaseAll()
        for _ in 0..<20 { await Task.yield() }
        XCTAssertEqual(alarm.applied, [true], "앞 적용이 도는 동안 겹쳐 보내지 않는다")

        hold.releaseAll()
        await until { hold.count == 1 }
        XCTAssertEqual(alarm.applied, [true, false], "끝난 뒤 마지막 값(끔)을 적용한다")
        hold.releaseAll()
        await until { coalescer.shown["a1"] == nil }
        XCTAssertFalse(alarm.enabled)
    }

    func test_적용이_실패해_행이_되돌아가면_화면도_저장소_값으로_돌아간다() async {
        let gates = Gates()
        let coalescer = AlarmToggleCoalescer(settleDelay: { await gates.wait() })
        let alarm = FakeAlarm(enabled: false)
        alarm.fails = true

        toggle(coalescer, alarm, true)
        await until { gates.count == 1 }
        gates.releaseAll()
        await until { coalescer.shown["a1"] == nil }

        XCTAssertEqual(alarm.applied, [true], "실패해도 다시 보내지 않는다 — 다시 누르면 그때 보낸다")
        XCTAssertFalse(alarm.enabled)
    }

    // MARK: - 다 합쳐 반영한 뒤 한 번 알린다(settled — "N 후에 울려요")

    func test_연타를_합친_마지막_값을_반영한_뒤_그_값을_한_번_알린다() async {
        let gates = Gates()
        let coalescer = AlarmToggleCoalescer(settleDelay: { await gates.wait() })
        let alarm = FakeAlarm(enabled: false)
        let log = SettledLog()

        toggle(coalescer, alarm, true, settled: log.record)
        toggle(coalescer, alarm, false, settled: log.record)
        toggle(coalescer, alarm, true, settled: log.record)
        await until { gates.count == 3 }
        gates.releaseAll()
        await until { coalescer.shown["a1"] == nil }

        XCTAssertEqual(alarm.applied, [true])
        XCTAssertEqual(log.values, [true], "중간 값은 알리지 않고, 마지막 값(켬)을 한 번 알린다")
    }

    func test_마지막_값이_이미_저장된_값이라_보낸_것이_없으면_알리지_않는다() async {
        let gates = Gates()
        let coalescer = AlarmToggleCoalescer(settleDelay: { await gates.wait() })
        let alarm = FakeAlarm(enabled: false)
        let log = SettledLog()

        toggle(coalescer, alarm, true, settled: log.record)
        toggle(coalescer, alarm, false, settled: log.record)
        await until { gates.count == 2 }
        gates.releaseAll()
        await until { coalescer.shown["a1"] == nil }

        XCTAssertEqual(alarm.applied, [])
        XCTAssertEqual(log.values, [], "켠 적이 없다 — 알릴 것이 없다")
    }

    func test_켜져_있던_알람을_껐다_도로_켜면_보낸_것이_없어도_켬을_한_번_알린다() async {
        let gates = Gates()
        let coalescer = AlarmToggleCoalescer(settleDelay: { await gates.wait() })
        let alarm = FakeAlarm(enabled: true)
        let log = SettledLog()

        toggle(coalescer, alarm, false, settled: log.record)
        toggle(coalescer, alarm, true, settled: log.record)
        await until { gates.count == 2 }
        gates.releaseAll()
        await until { coalescer.shown["a1"] == nil }

        XCTAssertEqual(alarm.applied, [], "마지막 값이 이미 저장된 값이라 보내지 않는다")
        XCTAssertEqual(log.values, [true], "그래도 켬으로 끝났다 — 연타를 합친 마지막 값이 켜짐이면 한 번 알린다(스펙 §7)")
    }

    func test_켜는_사이_끄면_켬을_알리지_않고_마지막에_반영한_끔을_알린다() async {
        let gates = Gates()
        let hold = Gates()
        let coalescer = AlarmToggleCoalescer(settleDelay: { await gates.wait() })
        let alarm = FakeAlarm(enabled: false)
        alarm.hold = hold
        let log = SettledLog()

        toggle(coalescer, alarm, true, settled: log.record)
        await until { gates.count == 1 }
        gates.releaseAll()
        await until { hold.count == 1 }

        // 켬이 도는 사이 끄고 손을 멈췄다 — 켬이 끝나도 그 값은 마지막 값이 아니다.
        toggle(coalescer, alarm, false, settled: log.record)
        await until { gates.count == 1 }
        gates.releaseAll()
        hold.releaseAll()
        await until { hold.count == 1 }
        XCTAssertEqual(log.values, [], "켬이 끝났어도 아직 반영할 끔이 남았다 — 곧 꺼질 알람에 띄우지 않는다")

        hold.releaseAll()
        await until { coalescer.shown["a1"] == nil }
        XCTAssertEqual(alarm.applied, [true, false])
        XCTAssertEqual(log.values, [false], "다 합친 뒤 마지막에 반영한 값(끔) 하나만 알린다")
    }

    func test_켜는_사이_껐다_다시_켜면_손을_멈춘_뒤_켬을_한_번_알린다() async {
        let gates = Gates()
        let hold = Gates()
        let coalescer = AlarmToggleCoalescer(settleDelay: { await gates.wait() })
        let alarm = FakeAlarm(enabled: false)
        alarm.hold = hold
        let log = SettledLog()

        toggle(coalescer, alarm, true, settled: log.record)
        await until { gates.count == 1 }
        gates.releaseAll()
        await until { hold.count == 1 }

        // 켬이 도는 사이 껐다 다시 켰다. 아직 손을 멈추지 않았다(기다림을 풀지 않는다).
        toggle(coalescer, alarm, false, settled: log.record)
        toggle(coalescer, alarm, true, settled: log.record)
        await until { gates.count == 2 }
        hold.releaseAll()
        for _ in 0..<20 { await Task.yield() }
        XCTAssertEqual(log.values, [], "손을 멈추기 전에는 알리지 않는다 — 더 누를 수 있다")

        gates.releaseAll()
        await until { coalescer.shown["a1"] == nil }
        XCTAssertEqual(alarm.applied, [true], "마지막 값이 이미 반영한 값이라 더 보내지 않는다")
        XCTAssertEqual(log.values, [true], "손을 멈춘 뒤 켬을 한 번 알린다")
    }
}
