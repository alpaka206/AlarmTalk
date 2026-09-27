import Foundation
import SwiftUI

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
///   이용이 곧 끝나요" 가 뜬다. '이 진입의 응답' 은 **이 진입에 보낸** 요청의 응답이다 —
///   앞 진입에 보낸 요청이 백그라운드를 건너 늦게 도착한 것은 세지 않는다
///   (`AppEntryCounter.entryForRequest`, 안드로이드 `accountAnswerEntryFor`).
/// - **한 진입에 판정은 한 번이다.** 이 진입의 응답이 오면 띄우든(`show`) 띄울 것이 없든
///   (`nothingToShow`) 그 진입을 끝낸다. 응답이 **실패**해도 그 진입은 끝난다 — 제어 센터를
///   닫는 순간의 재조회(`inactive → active`)가 성공했다고 세션 한가운데서 안내가 뜨면 안 된다.
///   다음 진입이 다시 본다(안드로이드 `PersonalPromoNoticeDecision.NothingToShow`).
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
        /// **이 진입에 보낸** 계정 요청의 결과(`entryAnswer(_:entry:)`).
        var accountAnswer: EntryAnswer
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

    /// 이 진입의 계정 응답이 어떻게 됐는가.
    enum EntryAnswer: Equatable {
        /// 아직 안 왔다 — 판정하지 않는다(준비 전).
        case pending
        /// 이 진입의 첫 응답이 실패했다 — 옛 값으로 판정하지 않고 이 진입을 끝낸다.
        case failed
        /// 이 진입의 응답이 왔다 — 세션의 값으로 판정한다.
        case arrived
    }

    /// `AuthViewModel.accountEntryAnswer` 를 **지금 진입** 기준으로 읽는다. 다른 진입의 기록은
    /// 이 진입의 것이 아니다(`pending`).
    static func entryAnswer(_ recorded: AccountEntryAnswer?, entry: Int) -> EntryAnswer {
        guard let recorded, entry > 0, recorded.entry == entry else { return .pending }
        switch recorded.outcome {
        case .answered: return .arrived
        case .failed: return .failed
        }
    }

    enum Decision: Equatable {
        /// **아직 판정할 때가 아니다** — 준비 신호·게이트 전, 이미 끝낸 진입, 이 진입의 계정
        /// 응답 전. 진입을 끝내지 않는다 — 입력이 바뀌면 다시 본다.
        case skip
        /// 이 진입의 판정은 **끝났다 — 띄울 것이 없다**(창 밖·'다시 보지 않기'·프로모 없음·
        /// 응답 실패). 호출부는 `marker` 를 적어 같은 진입의 뒤늦은 응답이 다시 판정하지 않게 한다.
        case nothingToShow(marker: String)
        /// 띄울 안내가 있는데 **다른 것이 화면을 쥐고 있다** — 걷힐 때까지 기다린다.
        case wait
        /// 지금 띄운다. ⚠ `marker` 는 **화면에 실제로 나온 뒤에** 적는다
        /// (`RootView.verifyShownNoticeIsVisible`) — 먼저 적으면 SwiftUI 가 조용히 건너뛴
        /// 안내가 이 진입을 삼킨다.
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
        // ⚠ **응답 전 캐시로 판정하지 말 것.** 응답 전에는 '안내할 것 없음' 으로도 끝내지
        // 않는다 — 응답이 오면(키가 바뀌면) 다시 본다.
        switch inputs.accountAnswer {
        case .pending: return .skip
        case .failed: return .nothingToShow(marker: marker)
        case .arrived: break
        }
        guard shouldShow(promo: inputs.promo, now: now, optedOut: inputs.optedOut),
              let promo = inputs.promo, dayLabels(for: promo) != nil else {
            return .nothingToShow(marker: marker)
        }
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
/// 활성이 될 때마다 1씩 오른다(안드로이드 `AppSignals.appEntries`).
///
/// ⚠ **`inactive → active` 는 세지 않는다.** 알림 센터·제어 센터를 내렸다 올리거나 시스템
/// 알럿이 떴다 사라질 때도 그 전이가 나는데, 그걸 들어온 것으로 치면 안내가 연달아 뜬다.
/// 백그라운드를 거쳤을 때만 센다(`.background → .active`).
struct AppEntryCounter: Equatable {
    private(set) var entry = 0
    /// 콜드 스타트도 '들어옴' 으로 세도록 처음에는 백그라운드에 있던 것으로 둔다.
    private var cameFromBackground = true
    /// 마지막으로 본 장면 상태. nil = 아직 못 봤다(콜드 스타트의 첫 전이 전).
    private(set) var phase: Phase?

    enum Phase { case active, inactive, background }

    /// **지금 보내는 계정 요청이 어느 진입의 몫인가** — 없으면 nil.
    ///
    /// - 백그라운드에 있으면 nil — 푸시·배경 작업이 보낸 요청은 어느 진입의 답도 아니다.
    /// - 들어와 있으면 그 진입.
    /// - 나갔다가 **돌아오는 길**(아직 활성 전)이거나 콜드 스타트의 첫 활성 전이면 **다음** 진입
    ///   — 세션 복원·전경 복귀의 `/auth/me` 가 그 진입의 답이다.
    ///
    /// 응답이 도착했을 때 이 값이 **보낼 때의 값과 같아야** 그 진입의 답이다
    /// (`AuthViewModel` 의 계정 응답 기록 — 안드로이드 `accountAnswerEntryFor` 와 같은 규칙).
    /// 앞 진입에 보낸 요청이 백그라운드를 건너 늦게 도착하면 값이 달라 세지 않는다.
    var entryForRequest: Int? {
        if phase == .background { return nil }
        return cameFromBackground ? entry + 1 : entry
    }

    /// - Returns: 이번 전이로 새 진입이 생겼는가.
    @discardableResult
    mutating func observe(_ next: Phase) -> Bool {
        phase = next
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

/// 한 진입에 보낸 계정 요청의 **첫 결과**(`AuthViewModel.accountEntryAnswer`). 종료 안내가
/// "이 진입의 응답이 왔나 · 실패했나" 를 가르는 준비 신호다(`PersonalPromoNotice.entryAnswer`).
struct AccountEntryAnswer: Equatable {
    enum Outcome: Equatable { case answered, failed }
    var entry: Int
    var outcome: Outcome
}

/// 진입 번호의 **유일한 출처**. 장면 상태를 받는 곳은 앱(`AlarmTalkApp`)의 `scenePhase` 하나다 —
/// 화면(`RootView`)은 읽기만 한다.
///
/// ⚠ **두 곳에서 세지 말 것.** 뷰의 `scenePhase` 는 앱의 것보다 늦게·건너뛰며 올 수 있어
/// 둘이 따로 세면 한 번의 복귀가 두 진입이 된다 — 그러면 복귀의 `/auth/me` 는 앞 번호로
/// 찍혀 '이 진입의 답' 이 영영 오지 않는다. 계정 요청(`AuthViewModel.beginAccountRequest`)도
/// 여기서 번호를 받는다.
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
