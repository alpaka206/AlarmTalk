import Foundation

/// **기간 한정 개인 플랜** — 서버가 원시 `users.plan = free` 인 계정을 기간 중 개인(`plus`)으로
/// **읽어 주는** 프로모의, 앱이 받는 정보.
///
/// ## 계약(백엔드·안드로이드와 같다)
///
/// - `/auth/register`·`login`·`google`·`apple`·`me` 의 user 객체와 `GET /billing/subscription`
///   최상위에 `personal_promo: { ends_at, notice_from, deletes_voices_at_end } | null` 이 온다.
/// - **원시 plan 이 free 이고 프로모가 켜져 있을 때만** 값이 있다. 그때 `plan`(`user_plan`)은
///   이미 계산값 `plus` 다 — **앱이 등급을 올리지 않는다.** 구독 행은 만들지 않으므로
///   `subscription` 은 null 그대로다(가짜 구독이 없으니 해지 버튼도 없다).
///   거꾸로 **이 값이 있다 = 원시 plan 은 free** 다. 보류(ON_HOLD·PAUSED)로 남은 구독 행이
///   커플·가족 등급을 올리지 못하게 하는 근거가 이것이다(`PlanTier.bestKnown(user:)`).
/// - 날짜의 단일 출처는 `packages/shared` 다. **앱에 날짜를 박지 말 것** — 연장·조기 종료가
///   앱 릴리스 없이 돼야 하고, 스토어에 나간 구버전은 앱 코드를 못 받는다.
///
/// ## 앱이 이 값으로 하는 일은 넷뿐이다
///
/// 1. **낡은 캐시의 오프라인 컷오프**(`isStale`). 서버는 `endsAt` 에 곧바로 free 로 돌아가지만,
///    앱은 다음 `/auth/me` 전까지 캐시된 `plus` 를 들고 있다. **끝 전에 계산된** 답이 끝을
///    넘기면 그 `plus` 는 믿지 않는다. 끝 **뒤에** 계산된 답은 서버가 이미 그 시각에 판단한
///    것이라 그대로 믿는다. 계산 시각은 서버 시계(`computed_at`)가 우선이다(`fetchedAt`).
/// 2. 이용권 화면의 한 줄(무료 이용 중 · 언제까지).
/// 3. 종료 전 안내(`noticeFrom` 부터, 앱에 들어올 때마다 — `PersonalPromoNotice`).
/// 4. 보류 규칙 — 위 계약의 '이 값이 있다 = 원시 free'.
struct PersonalPromo: Codable, Equatable {
    /// 종료 시각(ISO 8601, **배타**). 이 시각부터 무료다.
    var endsAt: String?
    /// 종료 안내를 띄우기 시작하는 시각(ISO 8601).
    var noticeFrom: String?
    /// 지금 끝나면 이 계정의 목소리가 **3일 보관 후 삭제 대상인가**(서버의 종료 전환 대상 —
    /// 원시 free 이고 활성 구독 행이 없음). 보류(ON_HOLD) 계정처럼 대상이 아니면 false 라
    /// 종료 안내에서 삭제 문장을 뺀다.
    ///
    /// 구버전 서버처럼 **키가 없으면 true** 로 읽는다 — 삭제될 목소리를 안내하지 않는 쪽이
    /// 더 나쁘다(약관 제10조의 '전환 전에 앱 안에서 안내한다').
    var deletesVoicesAtEnd: Bool
    /// **이 답이 계산된 시각** — 오프라인 컷오프(`isStale`)가 "끝 전의 낡은 답인가" 를 가르는
    /// 근거라 **답과 함께 저장한다**(키체인 세션·권한 스냅샷).
    ///
    /// 출처(스펙 D7 — 안드로이드와 같은 규칙):
    ///  1. 서버가 준 `computed_at`(서버 시계, 그 plan 을 계산한 순간). 서버의 `ends_at` 과 같은
    ///     시계라, 기기 시계가 어긋나도 끝 전에 계산된 답은 끝 전의 답으로 읽힌다.
    ///  2. 없으면(구버전 서버) **응답을 받은 순간**의 기기 시계.
    ///  3. 저장본에 이 값이 없으면(이 필드 전의 개발 빌드가 남긴 캐시) nil — **끝 전에 받은
    ///     것으로 본다**(fail-closed, `isStale`).
    var fetchedAt: Date?

    init(
        endsAt: String?,
        noticeFrom: String?,
        deletesVoicesAtEnd: Bool = true,
        fetchedAt: Date?
    ) {
        self.endsAt = endsAt.nilIfBlank
        self.noticeFrom = noticeFrom.nilIfBlank
        self.deletesVoicesAtEnd = deletesVoicesAtEnd
        // 저장은 밀리초 정수라, 처음부터 밀리초로 맞춰 둔다 — 저장본을 다시 읽은 값과 메모리의
        // 값이 1ms 미만 차이로 '다른 프로모' 가 되지 않게.
        self.fetchedAt = fetchedAt.map {
            Date(timeIntervalSince1970: ($0.timeIntervalSince1970 * 1000).rounded() / 1000)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case endsAt
        case noticeFrom
        case deletesVoicesAtEnd
        /// 서버 계약(선택) — 그 plan 을 계산한 서버 시각. 구버전 서버는 보내지 않는다.
        case computedAt
        /// 앱 로컬 — `fetchedAt` 의 저장 키. 서버는 보내지 않고 저장본(기본 인코더)에만 있다.
        /// ⚠ 이름은 옛 필드(`receivedAt`)의 것이다 — 바꾸면 이미 저장된 캐시를 못 읽는다.
        case receivedAtMillis
    }

    /// 서버 응답을 읽는 디코더(`AlarmTalkAPI.makeResponseDecoder`)만 켜는 표시. 켜져 있으면
    /// `computed_at` 이 없을 때 **디코딩하는 순간**(= 받은 순간)을 `fetchedAt` 으로 찍는다.
    static let stampsReceiptKey = CodingUserInfoKey(rawValue: "PersonalPromo.stampsReceipt")!

    /// ⚠ **모양이 어긋나도 던지지 않는다.** 이 값은 **로그인 응답의 user 안**에 실린다 —
    /// 여기서 던지면 표시용 필드 하나 때문에 로그인·`/auth/me` 가 통째로 실패한다.
    /// 읽을 수 없는 값은 없는 것으로 친다(날짜가 없으면 아래 판정이 전부 '아무것도 안 함' 이다).
    ///
    /// ⚠ **계산 시각은 여기서 정한다** — 로그인·`/auth/me`·결제 전 조회·배경 갱신 어느 경로로
    /// 오든 빠짐없이 같은 규칙을 탄다(경로마다 손으로 찍으면 하나가 빠진다). 순서는 저장본의
    /// 값 → 서버의 `computed_at` → (서버 응답일 때만) 받은 순간이다.
    /// ⚠ **저장본을 읽을 때 지금 시각을 찍지 말 것.** 예전에는 저장 키가 없으면 무조건 `Date()`
    /// 를 넣어, 옛 캐시가 **읽을 때마다 방금 받은 답**이 되어 끝난 뒤에도 영영 낡지 않았다
    /// (2026-09-27 리뷰 — 안드로이드는 같은 경우를 끝 전의 답으로 본다). 저장본을 읽는
    /// 디코더(키체인·스냅샷)는 표시를 켜지 않으므로 여기서 nil 이 된다.
    init(from decoder: Decoder) throws {
        let container = try? decoder.container(keyedBy: CodingKeys.self)
        func string(_ key: CodingKeys) -> String? {
            guard let container else { return nil }
            let value: String?? = try? container.decodeIfPresent(String.self, forKey: key)
            return value ?? nil
        }
        let deletes: Bool?? = try? container?.decodeIfPresent(Bool.self, forKey: .deletesVoicesAtEnd)
        let millis: Int64?? = try? container?.decodeIfPresent(Int64.self, forKey: .receivedAtMillis)
        let stored = (millis ?? nil).map { Date(timeIntervalSince1970: Double($0) / 1000) }
        let computed = string(.computedAt).flatMap(PaidVoiceGate.parseTimestamp)
        let receipt = decoder.userInfo[Self.stampsReceiptKey] as? Bool == true ? Date() : nil
        self.init(
            endsAt: string(.endsAt),
            noticeFrom: string(.noticeFrom),
            deletesVoicesAtEnd: (deletes ?? nil) ?? true,
            fetchedAt: stored ?? computed ?? receipt
        )
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(endsAt, forKey: .endsAt)
        try container.encodeIfPresent(noticeFrom, forKey: .noticeFrom)
        try container.encode(deletesVoicesAtEnd, forKey: .deletesVoicesAtEnd)
        try container.encodeIfPresent(
            fetchedAt.map { Int64(($0.timeIntervalSince1970 * 1000).rounded()) },
            forKey: .receivedAtMillis
        )
    }

    /// 종료 시각이 없는 껍데기(모양이 어긋난 응답)는 **없는 것으로** 친다. 끝을 모르는 프로모로는
    /// 표시도 컷오프도 할 수 없고, 남겨 두면 `purchasedPlan` 만 근거 없이 free 가 된다.
    /// 세션에 싣는 자리(`AuthUser.init`·`AuthViewModel.applyFreshPlan`)가 이걸 거친다.
    static func normalized(_ promo: PersonalPromo?) -> PersonalPromo? {
        promo?.endsAt == nil ? nil : promo
    }

    var endsAtDate: Date? { endsAt.flatMap(PaidVoiceGate.parseTimestamp) }
    var noticeFromDate: Date? { noticeFrom.flatMap(PaidVoiceGate.parseTimestamp) }

    /// 기기 시계로 끝났는가 — **표시**(이용권 화면의 한 줄)만 쓴다. 권한 판정은 `isStale` 이다.
    /// 종료 시각을 못 읽으면 끝나지 않은 것으로 본다.
    func hasEnded(at now: Date) -> Bool {
        guard let end = endsAtDate else { return false }
        return now >= end
    }

    /// **이 캐시가 낡았는가** — 끝 **전에** 계산된 답이고, 지금은 끝이 지났다
    /// (안드로이드 `personalPromoLapsed` 와 같은 규칙).
    ///
    /// 그때의 계산값 `plus` 는 더는 사실이 아니다(서버는 끝부터 원시 free 를 준다). 그래서
    /// 판정기는 이 답의 `plus` 를 무료로 읽는다 — **단 활성 구독 행은 이긴다**(`PaidVoiceGate`).
    ///
    /// - 계산 시각(`fetchedAt`)이 끝 **뒤**면 낡지 않았다 — 서버가 그 시각에 이미 계산했다.
    /// - 계산 시각을 **모르면 끝 전의 답으로 본다**(fail-closed, 스펙 D7). 모르는 답을 끝 뒤의
    ///   답으로 치면 오프라인 기기가 끝난 프로모의 클론 목소리를 기한 없이 들고 간다.
    /// - 종료 시각을 못 읽으면 자르지 않는다 — 서버 게이트가 제 시각에 스스로 닫힌다.
    func isStale(at now: Date) -> Bool {
        guard let end = endsAtDate, now >= end else { return false }
        guard let fetchedAt else { return true }
        return fetchedAt < end
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
}

extension AuthUser {
    /// 결제·쿠폰·이용권으로 **실제로 가진** plan — 기간 한정 개인 플랜을 뺀 값.
    ///
    /// 이용권 화면이 결제·전환을 가를 때 쓴다. 프로모를 산 이용권으로 치면 개인 카드에서 결제 버튼이
    /// 사라지고, 다른 카드는 '이용권 변경'·'남은 기간 환산' 이라는 **사실이 아닌 말**을 하게 된다.
    /// ('현재 이용권' 뱃지는 한 번 더 간다 — 프로모만 쓰는 계정은 개인 카드다. `PlanScreenCurrent`.)
    var purchasedPlan: String {
        personalPromo == nil ? plan : "free"
    }
}
