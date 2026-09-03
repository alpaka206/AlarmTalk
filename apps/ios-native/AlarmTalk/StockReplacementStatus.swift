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
    /// true 면 지금 재바인딩이 돌고 있다(재시도 버튼을 잠근다).
    @Published private(set) var working = false
    /// 차단 화면의 '다시 시도'. 값이 바뀌면 `AlarmTalkApp` 이 교체 절차를 다시 돈다.
    @Published private(set) var retryToken = 0

    private init() {}

    /// 판정을 기록한다. **매니페스트를 못 받았으면 아무것도 하지 않는다.**
    ///
    /// ⚠ **판단 근거가 없을 때 `false` 를 적으면 안 된다**(2026-09-03 리뷰 16차).
    ///   앞 회차가 '미완료' 로 세워 둔 문을, 오프라인 재시도 한 번이 **열어 버린다** —
    ///   옛 목소리를 물고 있는 알람은 그대로인데 앱이 쓸 수 있게 된다.
    ///   그래서 그 판정을 호출부에 맡기지 않고 **여기서** 막는다. 호출부마다 `guard` 를
    ///   적게 하면 언젠가 한 곳이 빠진다.
    func report(userId: String?, pending: Bool, manifestFetched: Bool) {
        guard manifestFetched else { return }
        pendingUserId = pending ? userId : nil
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
