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

    /// true 면 아직 갈아탈 알람이 남아 있다.
    @Published private(set) var pending = false
    /// true 면 지금 재바인딩이 돌고 있다(재시도 버튼을 잠근다).
    @Published private(set) var working = false
    /// 차단 화면의 '다시 시도'. 값이 바뀌면 `AlarmTalkApp` 이 교체 절차를 다시 돈다.
    @Published private(set) var retryToken = 0

    private init() {}

    /// ⚠ **매니페스트를 못 받은 회차에는 부르지 말 것.** 클립 목록이 비면 재바인더가
    ///   "갈아탈 것이 없다" 로 읽으므로, 그 값을 그대로 적으면 **네트워크가 죽은 것을
    ///   '교체 완료' 로** 기록한다.
    func report(pending: Bool) {
        self.pending = pending
    }

    func setWorking(_ working: Bool) {
        self.working = working
    }

    func retry() {
        retryToken &+= 1
    }
}
