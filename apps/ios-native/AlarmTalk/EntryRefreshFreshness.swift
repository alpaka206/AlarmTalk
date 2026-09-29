import Foundation

/// **화면 진입 새로고침의 신선도 창.** 같은 계정의 **완결된** 갱신이 같은 앱 진입 안에서
/// `window` 안에 있었으면 진입 갱신을 다시 보내지 않는다. 규칙은 `docs/spec/plan-gates.md` §4.
///
/// 예전에는 편집기·구성원·이용권 화면이 **뜰 때마다** 같은 목록을 다시 받았고, 목소리 패널은
/// 탭 진입(`MainTabsView.refreshForSelectedTab`)이 막 받은 것을 한 번 더 받았다. 주석은 "뷰모델의
/// 스로틀에 맡긴다" 고 했지만 그런 스로틀은 없었다 — 진행 중 가드(`isRefreshing`)뿐이었다.
///
/// - ⚠ **완결된 갱신만 적는다.** 실패·반쪽 갱신으로 창을 열면 다음 진입이 받아야 할 것을 못 받는다.
///   그래서 갱신이 **시작될 때** 창을 비우고 끝까지 성공했을 때만 다시 적는다 — 가장 최근에 시작한
///   갱신이 실패했으면 창은 닫혀 있다.
/// - ⚠ **키는 계정이다 — 토큰이 아니다.** `/auth/me` 는 부를 때마다 토큰을 굴린다.
/// - **앱 진입이 바뀌면 창은 닫힌다.** 백그라운드에 있는 동안 다른 기기에서 바뀐 것을 돌아와서
///   곧바로 보여야 한다(진입 번호는 `AppEntrySignal`).
/// - 쓰기 뒤·푸시의 갱신은 창을 보지 않는다(`force`) — 방금 바뀐 것을 창이 가리면 안 된다.
struct EntryRefreshFreshness {
    struct Stamp: Equatable {
        let userID: String
        let entry: Int
        let at: Date
    }

    static let window: TimeInterval = 60

    private(set) var last: Stamp?

    func isFresh(userID: String, entry: Int, now: Date) -> Bool {
        guard let last, last.userID == userID, last.entry == entry else { return false }
        let age = now.timeIntervalSince(last.at)
        // 시계가 뒤로 가면(사용자가 시각을 바꿈) 모른다 — 다시 받는다.
        return age >= 0 && age < Self.window
    }

    mutating func record(_ stamp: Stamp) { last = stamp }

    mutating func reset() { last = nil }
}

/// 신선도 창이 보는 **지금** — 진입 번호와 시각. 테스트가 바꿔 끼운다.
typealias EntryRefreshClock = @MainActor () -> (entry: Int, now: Date)
