import Foundation

/// **기간 한정 개인 플랜의 종료 안내** — 무엇을 언제 띄우는가.
///
/// ## 규칙(제품 결정 — `docs/spec/gates-and-overlays.md` 「개인 플랜 종료 안내」)
///
/// - 창은 서버가 준 `[notice_from, ends_at)` 이다. 앱이 날짜를 계산하지 않는다.
/// - **앱에 들어올 때마다** 띄운다 — 콜드 스타트, 그리고 **백그라운드에 갔다가** 돌아왔을 때.
///   화면 이동이나 알림 센터를 내렸다 올린 것(`inactive → active`)은 들어온 것이 아니다.
///   세는 쪽은 `AppEntryCounter` 다.
/// - **이 진입의** 계정 응답(`/auth/me`·로그인 응답)을 받은 **뒤에만** 판정한다. 앞 진입에서
///   캐시한 세션으로 판정하면, 그 사이 다른 기기에서 결제·쿠폰 등록을 한 사람에게도 "무료
///   이용이 곧 끝나요" 가 뜬다. 응답을 못 받은 진입은 건너뛴다 — 다음 진입이 다시 본다.
/// - '다시 보지 않기' 를 누른 **계정**에는 다시 띄우지 않는다(`PersonalPromoNoticeStore` — 그
///   종료 시각에 묶는다).
/// - 준비 신호가 다 오기 전·차단 게이트 위에는 띄우지 않는다. **다른 모달(시트·전체 화면 커버·
///   알럿)·시스템 권한 팝업 위에도** 띄우지 않고, 걷힐 때까지 기다렸다가 띄운다
///   (판정은 `decide`, 실행은 `RootView.runOverlayNotices`).
///
/// ⚠ **소진 플래그가 아니다.** 한 번 띄웠다고 기록하지 않는다 — 기록하는 것은 사용자가
/// **직접 고른** '다시 보지 않기' 뿐이다. 그래서 못 띄우고 지나가도 잃는 것이 없다(다음
/// 진입에 다시 뜬다). 옛 웰컴 안내의 `promo_prompted_*` 키는 재사용하지 않는다 —
/// 기존 사용자는 그 값이 이미 true 라 새 안내가 영영 안 뜬다.
enum PersonalPromoNotice {
    /// 이번 진입에서 안내를 띄울 조건이 맞는가(준비 신호·게이트는 호출부가 본다).
    static func shouldShow(promo: PersonalPromo?, now: Date, optedOut: Bool) -> Bool {
        guard let promo, !optedOut else { return false }
        return promo.isInEndNoticeWindow(at: now)
    }

    /// 판정에 드는 **지금 화면의 사실들**. 전부 호출부(`RootView`)가 채운다.
    struct Inputs: Equatable {
        /// 준비 신호가 다 왔고(동의·버전) 차단 게이트가 없다.
        var gatesClear: Bool
        /// 이 프로세스의 진입 번호(`AppEntryCounter.entry`). 0 이면 아직 들어오지 않았다.
        var entry: Int
        /// 지금 세션의 계정.
        var userID: String?
        /// 이 계정의 프로모(가장 최근 계정 응답의 값).
        var promo: PersonalPromo?
        /// 이 진입이 시작된 **뒤에** 계정 응답을 받았는가.
        var accountResponseArrived: Bool
        /// 이미 판정을 끝낸 진입 — `marker(entry:userID:)` 값.
        var handledMarker: String?
        /// 이 계정이 이 프로모에 '다시 보지 않기' 를 눌렀는가.
        var optedOut: Bool
        /// 우리 알럿(강등 안내)·민감 동의 시트가 떠 있는가 — 기다렸다가 닫힌 뒤 띄운다.
        var otherNoticeOpen: Bool
        /// 장면이 활성인가. 시스템 권한 팝업·제어 센터가 떠 있으면 비활성이다.
        var sceneActive: Bool
        /// 시스템 권한 요청이 떠 있거나 곧 뜰 수 있는가(`SystemPermissionPrompts`).
        var permissionPromptPending: Bool
        /// 창에 다른 모달(시트·전체 화면 커버·알럿·확인 대화상자)이 떠 있는가.
        var modalPresented: Bool
    }

    enum Decision: Equatable {
        /// 이번엔 띄울 것이 없다(아직 준비 전이거나 대상이 아님). 입력이 바뀌면 다시 본다.
        case skip
        /// 띄울 안내가 있는데 **다른 것이 화면을 쥐고 있다** — 걷힐 때까지 기다린다.
        case wait
        /// 지금 띄운다. `marker` 로 이 진입을 끝낸 것으로 적는다.
        case show(PersonalPromo, marker: String)
    }

    /// 한 진입·한 계정에 한 번 — 계정을 넣는 이유: 같은 진입 안에서 다른 계정으로 로그인하면
    /// 그 계정은 아직 못 봤다.
    static func marker(entry: Int, userID: String) -> String { "\(entry)|\(userID)" }

    static func decide(_ inputs: Inputs, now: Date) -> Decision {
        guard inputs.gatesClear, inputs.entry > 0,
              let userID = inputs.userID.nilIfBlank else { return .skip }
        let marker = marker(entry: inputs.entry, userID: userID)
        guard inputs.handledMarker != marker else { return .skip }
        // ⚠ **응답 전 캐시로 판정하지 말 것.** '안내할 것 없음' 으로도 끝내지 않는다 —
        // 응답이 오면(키가 바뀌면) 다시 본다.
        guard inputs.accountResponseArrived else { return .skip }
        guard shouldShow(promo: inputs.promo, now: now, optedOut: inputs.optedOut),
              let promo = inputs.promo, dayLabels(for: promo) != nil else { return .skip }
        if inputs.otherNoticeOpen || !inputs.sceneActive
            || inputs.permissionPromptPending || inputs.modalPresented {
            return .wait
        }
        return .show(promo, marker: marker)
    }

    /// 떠 있는 안내를 **새 계정 응답에 맞춘다**(안드로이드 `reconcileShownPersonalPromoNotice` 와
    /// 같은 규칙). 같은 종료 시각이면 새 값으로(삭제 문장 갈래가 바뀌었을 수 있다), 프로모가
    /// 사라졌거나(결제·쿠폰으로 원시 유료가 됨) 끝났거나 종료 시각이 바뀌었으면 닫는다(nil).
    /// 옛 응답의 안내를 그대로 들고 있으면 이미 결제한 사람에게 "곧 끝나요" 를 말한다.
    static func reconcileShown(_ showing: PersonalPromo, latest: PersonalPromo?, now: Date) -> PersonalPromo? {
        guard let latest, latest.endsAt == showing.endsAt,
              let end = latest.endsAtDate, now < end else { return nil }
        return latest
    }

    /// 본문에 넣을 두 날짜 — **서버 값으로만** 만든다.
    ///  - `lastDay`: 무료로 쓰는 마지막 날(`ends_at − 1초`의 기기 날짜) — "10월 31일까지"
    ///  - `firstFreeDay`: **그다음 날**(`lastDay + 1일`) — "11월 1일부터"
    ///
    /// ⚠ 뒤의 날짜를 `ends_at` 의 기기 날짜로 찍지 말 것. 한국이 아닌 시간대에서는 `ends_at`
    /// 과 `ends_at − 1초` 가 같은 날이라 "10월 31일까지 … 10월 31일부터" 가 된다(두 앱 합의).
    static func dayLabels(
        for promo: PersonalPromo,
        locale: Locale = .autoupdatingCurrent,
        timeZone: TimeZone = .autoupdatingCurrent
    ) -> (lastDay: String, firstFreeDay: String)? {
        guard let last = promo.lastFreeDate else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        guard let next = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: last)) else {
            return nil
        }
        return (
            PersonalPromo.dayLabel(last, locale: locale, timeZone: timeZone),
            PersonalPromo.dayLabel(next, locale: locale, timeZone: timeZone)
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
/// 백그라운드를 거쳤을 때만 센다(`.background → .active`).
struct AppEntryCounter: Equatable {
    private(set) var entry = 0
    /// 콜드 스타트도 '들어옴' 으로 세도록 처음에는 백그라운드에 있던 것으로 둔다.
    private var cameFromBackground = true

    /// 백그라운드를 거쳐 **다음 진입을 기다리는 중**인가(한 번이라도 들어온 뒤). 이 동안 받은
    /// 계정 응답은 **다음 진입의 것이 아니다** — 호출부가 여기서 기준을 다시 잡는다.
    var isAwayAfterEntry: Bool { entry > 0 && cameFromBackground }

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
