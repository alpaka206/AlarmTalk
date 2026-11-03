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
    private let settleDelay: @Sendable () async -> Void

    init(settleDelay: @escaping @Sendable () async -> Void = { try? await Task.sleep(for: .milliseconds(450)) }) {
        self.settleDelay = settleDelay
    }

    /// - Parameters:
    ///   - current: 지금 저장소의 켜짐 값(행이 없으면 nil).
    ///   - apply: 그 값을 적용한다(예약·취소·서버 반영). 끝날 때까지 기다린다. 실패하면 행을 되돌리는 것은 그쪽 몫이다.
    func toggle(
        id: String,
        to enabled: Bool,
        current: @escaping @MainActor () -> Bool?,
        apply: @escaping @MainActor (Bool) async -> Void
    ) {
        shown[id] = enabled
        desired[id] = enabled
        pending[id]?.cancel()
        let delay = settleDelay
        pending[id] = Task { @MainActor in
            await delay()
            guard !Task.isCancelled else { return }
            await self.settle(id: id, current: current, apply: apply)
        }
    }

    private func settle(
        id: String,
        current: @MainActor () -> Bool?,
        apply: @MainActor (Bool) async -> Void
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
            if current() != want { await apply(want) }
            // 적용하는 사이 또 누르지 않았으면 끝이다. 눌렀으면 그 값은 손을 멈춘 뒤에 본다(이미 멈췄으면 곧바로 — `settleAgain`).
            if desired[id] == want { desired[id] = nil }
        } while settleAgain.contains(id)
        inFlight.remove(id)
        if desired[id] == nil, pending[id] == nil { shown[id] = nil }
    }
}
