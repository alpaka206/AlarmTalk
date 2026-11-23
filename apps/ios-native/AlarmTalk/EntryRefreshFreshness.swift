import Foundation
import SwiftUI

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
/// - ⚠ **적는 진입·시각은 요청을 보낼 때의 것이다 — 응답이 도착했을 때가 아니다**(코덱스 #823).
///   응답이 백그라운드를 건너 다음 진입에 도착하면, 완료 시점 값으로는 그 옛 답이 돌아온 진입의
///   창을 열어 1분 동안 따라잡기를 막는다.
/// - 탭 진입도 이 창으로 가른다(`MainTabsView.refreshForSelectedTab` 의 목소리·더보기). 탭 스로틀
///   표는 갱신 **전에** 적혀서, 거기 걸면 실패한 뒤 60초 동안 재시도가 막힌다.
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

/// **앱에 들어온 횟수**(이 프로세스 안에서). 콜드 스타트가 1이고, 백그라운드에 갔다가 다시
/// 활성이 될 때마다 1씩 오른다(안드로이드 `AppSignals.appEntries`). 진입 갱신의 신선도 창(`EntryRefreshFreshness`)과
/// 루트의 강등 안내 재판정(`RootView.overlayKey`)이 이 번호를 본다.
///
/// ⚠ **`inactive → active` 는 세지 않는다.** 알림 센터·제어 센터를 내렸다 올리거나 시스템
/// 알럿이 떴다 사라질 때도 그 전이가 나는데, 그걸 들어온 것으로 치면 신선도 창이 그때마다 닫혀 같은 목록을 또 받는다.
/// 백그라운드를 거쳤을 때만 센다(`.background → .active`).
struct AppEntryCounter: Equatable {
    private(set) var entry = 0
    /// 콜드 스타트도 '들어옴' 으로 세도록 처음에는 백그라운드에 있던 것으로 둔다.
    private var cameFromBackground = true

    enum Phase { case active, inactive, background }

    /// - Returns: 이번 전이로 새 진입이 생겼는가.
    @discardableResult
    mutating func observe(_ next: Phase) -> Bool {
        switch next {
        case .active:
            guard cameFromBackground else { return false }
            cameFromBackground = false
            entry += 1
            return true
        case .background:
            cameFromBackground = true
            return false
        case .inactive:
            return false
        }
    }
}

/// 진입 번호의 **유일한 출처**. 장면 상태를 받는 곳은 앱(`AlarmTalkApp`)의 `scenePhase` 하나다 —
/// 화면(`RootView`)은 읽기만 한다.
///
/// ⚠ **두 곳에서 세지 말 것.** 뷰의 `scenePhase` 는 앱의 것보다 늦게·건너뛰며 올 수 있어
/// 둘이 따로 세면 한 번의 복귀가 두 진입이 된다.
@MainActor
final class AppEntrySignal: ObservableObject {
    static let shared = AppEntrySignal()

    @Published private(set) var counter = AppEntryCounter()

    /// 같은 전이를 두 번 받아도 한 번이다(`AppEntryCounter.observe` 가 멱등).
    func observe(_ phase: ScenePhase) {
        var next = counter
        switch phase {
        case .active: next.observe(.active)
        case .background: next.observe(.background)
        default: next.observe(.inactive)
        }
        if next != counter { counter = next }
    }
}
