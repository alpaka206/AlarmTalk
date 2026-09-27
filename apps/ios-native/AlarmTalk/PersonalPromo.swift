import Foundation

/// **기간 한정 개인 플랜** — 서버가 원시 `users.plan = free` 인 계정을 기간 중 개인(`plus`)으로
/// **읽어 주는** 프로모의, 앱이 받는 정보.
///
/// ## 계약(백엔드·안드로이드와 같다)
///
/// - `/auth/register`·`login`·`google`·`apple`·`me` 의 user 객체와 `GET /billing/subscription`
///   최상위에 `personal_promo: { ends_at, notice_from } | null` 이 온다.
/// - **원시 plan 이 free 이고 프로모가 켜져 있을 때만** 값이 있다. 그때 `plan`(`user_plan`)은
///   이미 계산값 `plus` 다 — **앱이 등급을 올리지 않는다.** 구독 행은 만들지 않으므로
///   `subscription` 은 null 그대로다(가짜 구독이 없으니 해지 버튼도 없다).
/// - 날짜의 단일 출처는 `packages/shared` 다. **앱에 날짜를 박지 말 것** — 연장·조기 종료가
///   앱 릴리스 없이 돼야 하고, 스토어에 나간 구버전은 앱 코드를 못 받는다.
///
/// ## 앱이 이 값으로 하는 일은 셋뿐이다
///
/// 1. **오프라인 컷오프**(`planAsOf`). 서버는 `endsAt` 에 곧바로 free 로 돌아가지만, 앱은 다음
///    `/auth/me` 전까지 캐시된 `plus` 를 들고 있다. 그 사이 계속 유료로 읽으면 오프라인 기기는
///    끝난 뒤에도 클론 목소리를 예약한다 — 구독 행의 `expires_at` 을 믿는 것과 같은 방식으로
///    **`endsAt` 이후의 계산값 plus 는 믿지 않는다.**
/// 2. 이용권 화면의 한 줄(무료 이용 중 · 언제까지).
/// 3. 종료 전 안내(`noticeFrom` 부터, 앱에 들어올 때마다 — `PersonalPromoNotice`).
struct PersonalPromo: Codable, Equatable {
    /// 종료 시각(ISO 8601, **배타**). 이 시각부터 무료다.
    var endsAt: String?
    /// 종료 안내를 띄우기 시작하는 시각(ISO 8601).
    var noticeFrom: String?

    init(endsAt: String?, noticeFrom: String?) {
        self.endsAt = endsAt.nilIfBlank
        self.noticeFrom = noticeFrom.nilIfBlank
    }

    private enum CodingKeys: String, CodingKey {
        case endsAt
        case noticeFrom
    }

    /// ⚠ **모양이 어긋나도 던지지 않는다.** 이 값은 **로그인 응답의 user 안**에 실린다 —
    /// 여기서 던지면 표시용 필드 하나 때문에 로그인·`/auth/me` 가 통째로 실패한다.
    /// 읽을 수 없는 값은 없는 것으로 친다(날짜가 없으면 아래 판정이 전부 '아무것도 안 함' 이다).
    init(from decoder: Decoder) throws {
        let container = try? decoder.container(keyedBy: CodingKeys.self)
        func string(_ key: CodingKeys) -> String? {
            guard let container else { return nil }
            let value: String?? = try? container.decodeIfPresent(String.self, forKey: key)
            return value ?? nil
        }
        self.init(endsAt: string(.endsAt), noticeFrom: string(.noticeFrom))
    }

    /// 종료 시각이 없는 껍데기(모양이 어긋난 응답)는 **없는 것으로** 친다. 끝을 모르는 프로모로는
    /// 표시도 컷오프도 할 수 없고, 남겨 두면 `purchasedPlan` 만 근거 없이 free 가 된다.
    /// 세션에 싣는 자리(`AuthUser.init`·`AuthViewModel.applyFreshPlan`)가 이걸 거친다.
    static func normalized(_ promo: PersonalPromo?) -> PersonalPromo? {
        promo?.endsAt == nil ? nil : promo
    }

    var endsAtDate: Date? { endsAt.flatMap(PaidVoiceGate.parseTimestamp) }
    var noticeFromDate: Date? { noticeFrom.flatMap(PaidVoiceGate.parseTimestamp) }

    /// 끝났는가. **종료 시각을 못 읽으면 끝나지 않은 것으로 본다** — 판정기의 fail-open
    /// (만료를 모르면 회수하지 않는다)과 같은 방향이다.
    func hasEnded(at now: Date) -> Bool {
        guard let end = endsAtDate else { return false }
        return now >= end
    }

    /// 종료 안내를 띄울 창 안인가 — `[noticeFrom, endsAt)`. 날짜 하나라도 못 읽으면 띄우지 않는다
    /// (무엇을 언제까지라고 말할지 모르는 안내는 없느니만 못하다).
    func isInEndNoticeWindow(at now: Date) -> Bool {
        guard let from = noticeFromDate, let end = endsAtDate else { return false }
        return now >= from && now < end
    }

    /// 무료로 쓸 수 있는 **마지막 날**. 종료 시각은 배타라 그대로 날짜로 찍으면 한국 기기에서
    /// '11월 1일까지' 로 보인다 — 1초 앞의 날짜를 쓴다.
    var lastFreeDate: Date? { endsAtDate?.addingTimeInterval(-1) }

    /// 날짜 한 칸의 표기 — 기기 로케일·시간대의 '월 일'("10월 31일" / "October 31" / "10月31日").
    static func dayLabel(
        _ date: Date,
        locale: Locale = .autoupdatingCurrent,
        timeZone: TimeZone = .autoupdatingCurrent
    ) -> String {
        date.formatted(
            Date.FormatStyle(locale: locale, timeZone: timeZone)
                .month(.wide)
                .day()
        )
    }

    /// **지금 시각 기준의 plan** — 서버가 준 계산값에서 끝난 프로모를 걷어낸다.
    ///
    /// 프로모가 붙어 있다 = 서버가 "원시 plan 은 free" 라고 말한 것이다. 그러니 끝난 뒤의 답은
    /// 언제나 free 다. 프로모가 없거나 아직 안 끝났으면 받은 값을 그대로 돌려준다.
    static func planAsOf(_ plan: String?, promo: PersonalPromo?, now: Date) -> String? {
        guard let promo, promo.hasEnded(at: now) else { return plan }
        return "free"
    }
}

extension AuthUser {
    /// 지금 시각 기준의 plan(끝난 프로모를 걷어낸 값). **등급·권한 판정은 이걸 쓴다.**
    func planAsOf(_ now: Date = Date()) -> String {
        PersonalPromo.planAsOf(plan, promo: personalPromo, now: now) ?? plan
    }

    /// 결제·쿠폰·이용권으로 **실제로 가진** plan — 기간 한정 개인 플랜을 뺀 값.
    ///
    /// 이용권 화면이 쓴다. 프로모를 '현재 이용권' 으로 치면 개인 카드에서 결제 버튼이 사라지고,
    /// 다른 카드는 '이용권 변경'·'남은 기간 환산' 이라는 **사실이 아닌 말**을 하게 된다.
    var purchasedPlan: String {
        personalPromo == nil ? plan : "free"
    }
}
