import Foundation

/// **알람 스위치는 손을 멈춘 뒤의 마지막 값만 적용한다**(2026-10-29 오너 지시).
///
/// 누르는 동안에는 화면만 바꾸고(`shown`), 잠시(`settleDelay`) 더 누르지 않으면 그때의 값 하나를 적용한다. 같은 알람의 적용은
/// **한 번에 하나**다 — 적용하는 사이 또 누르면, 그것이 끝나고 손을 멈춘 뒤 마지막 값을 다시 본다. 이미 그 값이면 아무것도
/// 보내지 않는다.
///
/// ⚠ 예전에는 누를 때마다 곧바로 AlarmKit 예약·취소를 보냈다. 켬·끔·켬이 첫 예약 호출 하나가 끝나기 전에 모두 들어오면 두 예약이
/// 같은 행에 차례로 핸들을 적었고(`markScheduled`), 먼저 적힌 예약은 어느 행도 가리키지 않는 채 남았다 — 목록에 없고 끌 수도 없는
/// 알람이 울린다. 적용을 알람마다 하나로 줄이면 그 겹침 자체가 생기지 않는다.
@MainActor
final class AlarmToggleCoalescer: ObservableObject {
    /// 목록 화면이 다시 만들어져도 같은 것을 쓴다 — 화면마다 따로 들면 앞 화면의 적용과 새 화면의 적용이 다시 겹친다.
    static let shared = AlarmToggleCoalescer()

    /// 아직 적용 전이라도 화면에 그릴 값 — 누른 대로 곧바로 바뀐다. 다 적용하면 지운다(그때부터는 저장소 값을 그린다).
    @Published private(set) var shown: [String: Bool] = [:]

    private var desired: [String: Bool] = [:]
    private var inFlight: Set<String> = []
    private var settleAgain: Set<String> = []
    private var pending: [String: Task<Void, Never>] = [:]
    /// 이번 연타에서 **마지막으로 적용한 값** — 다 합쳐 반영한 뒤 `settled` 로 한 번 알리고 지운다. 적용한 것이 없으면 비어 있다.
    private var lastApplied: [String: Bool] = [:]
    private let settleDelay: @Sendable () async -> Void

    init(settleDelay: @escaping @Sendable () async -> Void = { try? await Task.sleep(for: .milliseconds(450)) }) {
        self.settleDelay = settleDelay
    }

    /// - Parameters:
    ///   - current: 지금 저장소의 켜짐 값(행이 없으면 nil).
    ///   - apply: 그 값을 적용한다(예약·취소·서버 반영). 끝날 때까지 기다린다. 실패하면 행을 되돌리는 것은 그쪽 몫이다.
    ///   - settled: 연타를 **다 합쳐 반영한 뒤 한 번** — 그동안 마지막으로 적용한 값을 받는다. 더 누를 것이 남아 있으면(손을 멈추기
    ///     전·적용이 아직 돌 때) 부르지 않고, 적용한 것이 없으면(마지막 값이 이미 저장된 값이었다) 아예 부르지 않는다. 적용이
    ///     실패했어도 그 값을 받으니, 실제로 켜졌는지는 저장소를 보고 판단한다. 목록이 이걸로 "N 후에 울려요" 를 띄운다
    ///     (스펙 `docs/spec/alarm-editor.md` §7 — 연타를 합친 마지막 값이 켜짐일 때 한 번).
    func toggle(
        id: String,
        to enabled: Bool,
        current: @escaping @MainActor () -> Bool?,
        apply: @escaping @MainActor (Bool) async -> Void,
        settled: @escaping @MainActor (Bool) -> Void = { _ in }
    ) {
        shown[id] = enabled
        desired[id] = enabled
        pending[id]?.cancel()
        let delay = settleDelay
        pending[id] = Task { @MainActor in
            await delay()
            guard !Task.isCancelled else { return }
            await self.settle(id: id, current: current, apply: apply, settled: settled)
        }
    }

    private func settle(
        id: String,
        current: @MainActor () -> Bool?,
        apply: @MainActor (Bool) async -> Void,
        settled: @MainActor (Bool) -> Void
    ) async {
        pending[id] = nil
        // 앞 적용이 아직 돈다 — 그것이 끝나면 이어서 본다.
        guard !inFlight.contains(id) else {
            settleAgain.insert(id)
            return
        }
        inFlight.insert(id)
        repeat {
            settleAgain.remove(id)
            guard let want = desired[id] else { break }
            if current() != want {
                await apply(want)
                lastApplied[id] = want
            }
            // 적용하는 사이 또 누르지 않았으면 끝이다. 눌렀으면 그 값은 손을 멈춘 뒤에 본다(이미 멈췄으면 곧바로 — `settleAgain`).
            if desired[id] == want { desired[id] = nil }
        } while settleAgain.contains(id)
        inFlight.remove(id)
        // ⚠ **다 합쳐 반영했을 때만 알린다** — 손을 멈추기 전에 끝난 적용(그 뒤 또 눌렀다)은 마지막 값이 아니다. 그 값을 알리면
        //   곧 꺼질 알람에 "N 후에 울려요" 가 뜬다.
        if desired[id] == nil, pending[id] == nil {
            shown[id] = nil
            if let applied = lastApplied.removeValue(forKey: id) { settled(applied) }
        }
    }
}
