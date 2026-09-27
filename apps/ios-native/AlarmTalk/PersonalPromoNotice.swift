import Foundation

/// **기간 한정 개인 플랜의 종료 안내** — 무엇을 언제 띄우는가.
///
/// ## 규칙(제품 결정)
///
/// - 창은 서버가 준 `[notice_from, ends_at)` 이다. 앱이 날짜를 계산하지 않는다.
/// - **앱에 들어올 때마다** 띄운다 — 콜드 스타트, 그리고 **백그라운드에 갔다가** 돌아왔을 때.
///   화면 이동이나 알림 센터를 내렸다 올린 것(`inactive → active`)은 들어온 것이 아니다.
///   세는 쪽은 `AppEntryCounter` 다.
/// - '다시 보지 않기' 를 누른 **계정**에는 다시 띄우지 않는다(`PersonalPromoNoticeStore`).
/// - 준비 신호가 다 오기 전·차단 게이트 위에는 띄우지 않는다
///   (`docs/spec/gates-and-overlays.md` — 판정은 `RootView.evaluatePersonalPromoNotice`).
///
/// ⚠ **소진 플래그가 아니다.** 한 번 띄웠다고 기록하지 않는다 — 기록하는 것은 사용자가
/// **직접 고른** '다시 보지 않기' 뿐이다. 그래서 차단 화면 아래에서 잘못 판정돼도 잃는 것이
/// 없다(다음 진입에 다시 뜬다). 옛 웰컴 안내의 `promo_prompted_*` 키는 재사용하지 않는다 —
/// 기존 사용자는 그 값이 이미 true 라 새 안내가 영영 안 뜬다.
enum PersonalPromoNotice {
    /// 이번 진입에서 안내를 띄울 조건이 맞는가(준비 신호·게이트는 호출부가 본다).
    static func shouldShow(promo: PersonalPromo?, now: Date, optedOut: Bool) -> Bool {
        guard let promo, !optedOut else { return false }
        return promo.isInEndNoticeWindow(at: now)
    }

    /// 본문에 넣을 두 날짜 — **서버 값으로만** 만든다.
    ///  - `lastDay`: 무료로 쓰는 마지막 날(`ends_at − 1초`) — "10월 31일까지"
    ///  - `firstFreeDay`: 무료 플랜으로 돌아가는 날(`ends_at`) — "11월 1일부터"
    static func dayLabels(
        for promo: PersonalPromo,
        locale: Locale = .autoupdatingCurrent,
        timeZone: TimeZone = .autoupdatingCurrent
    ) -> (lastDay: String, firstFreeDay: String)? {
        guard let end = promo.endsAtDate, let last = promo.lastFreeDate else { return nil }
        return (
            PersonalPromo.dayLabel(last, locale: locale, timeZone: timeZone),
            PersonalPromo.dayLabel(end, locale: locale, timeZone: timeZone)
        )
    }
}

/// '다시 보지 않기' 를 **계정별로** 기억한다.
///
/// 값으로 **그 프로모의 종료 시각**을 적는다 — 다음에 다른 기간의 프로모가 열리면 옛 선택이
/// 새 안내까지 삼키지 않는다(같은 끝을 가리킬 때만 '봤다' 로 친다).
///
/// 로그아웃해도 지우지 않는다 — 같은 사람이 다시 로그인해 같은 안내를 또 보는 것은 조르기다.
struct PersonalPromoNoticeStore {
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func isOptedOut(userID: String?, promo: PersonalPromo?) -> Bool {
        guard let key = key(userID), let endsAt = promo?.endsAt else { return false }
        return defaults.string(forKey: key) == endsAt
    }

    func optOut(userID: String?, promo: PersonalPromo?) {
        guard let key = key(userID), let endsAt = promo?.endsAt else { return }
        defaults.set(endsAt, forKey: key)
    }

    private func key(_ userID: String?) -> String? {
        guard let id = userID.nilIfBlank else { return nil }
        return "personal_promo_end_notice_opt_out_\(id)"
    }
}

/// **앱에 들어온 횟수**(이 프로세스 안에서). 콜드 스타트가 1이고, 백그라운드에 갔다가 다시
/// 활성이 될 때마다 1씩 오른다.
///
/// ⚠ **`inactive → active` 는 세지 않는다.** 알림 센터·제어 센터를 내렸다 올리거나 시스템
/// 알럿이 떴다 사라질 때도 그 전이가 나는데, 그걸 들어온 것으로 치면 안내가 연달아 뜬다.
/// 백그라운드를 거쳤을 때만 센다.
struct AppEntryCounter: Equatable {
    private(set) var entry = 0
    /// 콜드 스타트도 '들어옴' 으로 세도록 처음에는 백그라운드에 있던 것으로 둔다.
    private var cameFromBackground = true

    enum Phase { case active, inactive, background }

    /// - Returns: 이번 전이로 새 진입이 생겼는가.
    @discardableResult
    mutating func observe(_ phase: Phase) -> Bool {
        switch phase {
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
