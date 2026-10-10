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

/// **알람 탭 동기화의 60초 스로틀 표** — 키는 `MainTabsView.tabRefreshThrottleKey`(탭 + 계정).
///
/// 들여보내는 순간 적는다 — 동기화가 도는 동안 탭을 오가며 다시 들어온 진입이 두 벌을 내지
/// 않게. 대신 ⚠ **완결되지 않은 회차는 자기가 적은 칸을 지운다**(코덱스 #823 7차). 오프라인·
/// 저장소 로드 전·탭을 떠나 취소된 회차가 칸을 남기면, 60초 동안 알람 탭에 다시 들어와도
/// 재시도하지 않는다 — 놓친 가족 알람 푸시를 따라잡는 자리가 그만큼 늦어진다. 예전에는 키에
/// 토큰이 있어 다른 탭에서 토큰이 구르면 우연히 풀렸지만, 계정 키에서는 그 우연이 없다.
/// 규칙은 `docs/spec/plan-gates.md` §4 「실패했거나 반쪽인 갱신은 창을 열지 않는다」.
struct AlarmTabSyncThrottle {
    static let window: TimeInterval = 60

    private(set) var admittedAt: [String: Date] = [:]

    /// 창 안이면 false. 들여보내면 곧바로 칸을 적는다.
    mutating func admit(key: String, now: Date) -> Bool {
        if let last = admittedAt[key] {
            let age = now.timeIntervalSince(last)
            // 시계가 뒤로 가면(사용자가 시각을 바꿈) 모른다 — 다시 돈다.
            if age >= 0 && age < Self.window { return false }
        }
        admittedAt[key] = now
        return true
    }

    /// 회차가 끝났을 때. 완결되지 않았으면 **자기가 적은 칸만** 지운다 — 그 사이 다른 회차가
    /// 적은 칸은 그 회차의 것이다.
    mutating func settle(key: String, admittedAt stamp: Date, completed: Bool) {
        guard !completed, admittedAt[key] == stamp else { return }
        admittedAt[key] = nil
    }
}
