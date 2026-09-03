import Foundation

/// **기본 목소리 교체가 아직 안 끝났는가.** 안드로이드 `sync/StockReplacementStatus.kt` 미러.
///
/// 목소리 4종을 갈아 끼우는 회차에는 순서가 있다 — **다 받고 → 다 묶고 → 그 다음에 지운다**
/// (`AlarmTalkApp.rebindStockClipsIfNeeded`). 그 중간에 앱을 쓰면 알람이 **이름은 새 이름인데
/// 소리는 옛 목소리**인 상태로 울 수 있다. 그래서 남은 것이 있으면 화면을 막고 다시 시도하게
/// 한다(2026-09-03 지시). 삭제는 실패해도 막지 않는다 — 그때는 교체가 이미 끝나 있다.
///
/// ⚠ **기본값 `false` 는 '아니오' 가 아니라 '아직 모른다' 다.** 그래서 기본값을 **막지 않는
///   쪽**으로 뒀다. 반대로 두면 매니페스트를 받기 전(콜드 스타트·비행기모드)에 **아무 일도
///   없는 사용자까지 차단 화면에 가둔다** — 그 화면의 탈출구는 재시도뿐인데 네트워크가 없으면
///   영영 못 나온다. 판정은 매니페스트를 실제로 받아 본 뒤에만 갱신한다.
@MainActor
final class StockReplacementStatus: ObservableObject {
    static let shared = StockReplacementStatus()

    /// **교체가 미완료인 계정 id.** 없으면 nil.
    ///
    /// ⚠ **`Bool` 하나로 두지 말 것**(2026-09-03 리뷰 18차). 이 값은 프로세스 전역인데
    ///   한 기기에서 계정이 바뀔 수 있다 — 계정을 함께 들고 있어야 **A 의 미완료로 B 를
    ///   가두는** 일이 없다. 화면은 "지금 계정과 같은가" 로만 판단한다.
    @Published private(set) var pendingUserId: String?
    /// **판정이 한 번이라도 끝났는가**(준비 신호).
    ///
    /// ⚠ **1회성 오버레이는 이 값을 기다려야 한다**(2026-09-03 리뷰 21차). 콜드 스타트에는
    ///   미완료 여부를 아직 모르는데, 그 틈에 웰컴 프로모가 뜨면 **소진 플래그를 태우고**
    ///   뒤늦게 온 차단 화면이 그 위를 덮는다 — 사용자는 본 적도 없이 잃는다.
    ///   CLAUDE.md 「1회성 오버레이는 확인이 끝난 뒤에만 판단한다」가 못 박은 자리다.
    ///
    /// ⚠ **계정별이다**(2026-09-03 리뷰 22차). 전역 Bool 이면 계정 A 가 한 번 확인한 뒤
    ///   B 가 로그인해도 true 로 남아, **B 의 판정이 오기 전에** B 의 오버레이가 소진된다.
    /// ⚠ **실패한 시도도 '끝났다' 로 센다**(같은 회차). 못 받았다고 false 로 두면
    ///   오프라인·서버 오류에서 오버레이가 **영영 안 뜬다** — 판정을 못 한 것과 시도가
    ///   안 끝난 것은 다르다.
    @Published private(set) var checkedUserId: String?

    /// true 면 지금 재바인딩이 돌고 있다(재시도 버튼을 잠근다).
    @Published private(set) var working = false
    /// 차단 화면의 '다시 시도'. 값이 바뀌면 `AlarmTalkApp` 이 교체 절차를 다시 돈다.
    @Published private(set) var retryToken = 0

    /// **앞 회차가 디스크에 못 앉힌 채 끝났다.**
    ///
    /// ⚠ 실패를 값으로 돌려주는 것만으로는 부족하다(2026-09-03 리뷰 19차). `upsert` 가
    ///   이미 메모리를 바꿔 놨으므로, 재시작 없이 다시 시도하면 재바인더가 그 행들을
    ///   **'이미 최신'** 으로 보고 아무것도 안 하며 `persisted: true` 를 돌려준다 —
    ///   그러면 호출부가 **못 앉힌 상태 그대로** 옛 오디오를 지우고 문을 연다.
    ///   그래서 그 사실을 남겨 두고, 다음 회차가 **정리 전에 먼저 저장**하게 한다.
    private(set) var hasUnsavedRebind = false

    func markUnsavedRebind() { hasUnsavedRebind = true }
    func clearUnsavedRebind() { hasUnsavedRebind = false }

    /// **아직 예약을 확인하지 못한, 이번 교체가 바꾼 알람 id.**
    ///
    /// ⚠ **회차마다 다시 계산하면 안 된다**(2026-09-03 리뷰 21차). 첫 `schedule` 이 실패한
    ///   뒤 재시도하면 행은 이미 최신이라 재바인더가 `.none` 을 돌려주고 이 집합이 **비어
    ///   버린다** — 그러면 `reconcile` 이 그 알람을 건너뛰고 `hasStaleSchedules` 도 false 라,
    ///   AlarmKit 이 은퇴한 목소리를 쥔 채로 문이 열린다. 지문이 없는 옛 예약은 그대로
    ///   영영 낡은 채 남는다.
    ///   **예약이 최신임을 확인할 때까지** 들고 있고, 재시작도 견디게 디스크에 남긴다.
    private(set) var pendingRearmIds: Set<String> = []

    private static let rearmKey = "stock_replacement_pending_rearm_ids"

    private init() {
        pendingRearmIds = Set(UserDefaults.standard.stringArray(forKey: Self.rearmKey) ?? [])
    }

    /// 이번 회차가 바꾼 id 를 더한다(앞 회차 것과 합친다).
    func noteReplaced(ids: Set<String>) {
        guard !ids.isEmpty else { return }
        pendingRearmIds.formUnion(ids)
        persistRearmIds()
    }

    /// 예약이 최신임을 확인했다 — 더 들고 있을 이유가 없다.
    func clearRearmIds() {
        guard !pendingRearmIds.isEmpty else { return }
        pendingRearmIds.removeAll()
        persistRearmIds()
    }

    private func persistRearmIds() {
        UserDefaults.standard.set(Array(pendingRearmIds), forKey: Self.rearmKey)
    }

    /// 판정을 기록한다. **매니페스트를 못 받았으면 아무것도 하지 않는다.**
    ///
    /// ⚠ **판단 근거가 없을 때 `false` 를 적으면 안 된다**(2026-09-03 리뷰 16차).
    ///   앞 회차가 '미완료' 로 세워 둔 문을, 오프라인 재시도 한 번이 **열어 버린다** —
    ///   옛 목소리를 물고 있는 알람은 그대로인데 앱이 쓸 수 있게 된다.
    ///   그래서 그 판정을 호출부에 맡기지 않고 **여기서** 막는다. 호출부마다 `guard` 를
    ///   적게 하면 언젠가 한 곳이 빠진다.
    func report(userId: String?, pending: Bool, manifestFetched: Bool) {
        // 판정은 근거가 있을 때만 갱신한다 — 못 받았으면 앞 판정을 그대로 지킨다.
        if manifestFetched {
            pendingUserId = pending ? userId : nil
        }
        // 준비 신호는 **시도가 끝났으면** 세운다(성공·실패 모두).
        checkedUserId = userId
    }

    /// 지금 계정의 판정이 한 번이라도 끝났는가.
    func isChecked(for userId: String?) -> Bool {
        guard let checkedUserId, let userId else { return false }
        return checkedUserId == userId
    }

    /// 지금 계정이 막혀 있는가.
    func isPending(for userId: String?) -> Bool {
        guard let pendingUserId, let userId else { return false }
        return pendingUserId == userId
    }

    func setWorking(_ working: Bool) {
        self.working = working
    }

    func retry() {
        retryToken &+= 1
    }
}
