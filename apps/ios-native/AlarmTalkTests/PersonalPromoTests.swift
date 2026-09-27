import XCTest
@testable import AlarmTalk

/// **기간 한정 개인 플랜** — 서버가 원시 free 계정을 기간 중 개인(`plus`)으로 읽어 주고,
/// 앱은 그 계산값을 받아 쓰기만 한다.
///
/// 이 파일이 고정하는 것:
///  1. `personal_promo` 는 **추가 필드**다 — 없어도, 모양이 어긋나도 로그인이 깨지지 않는다.
///  2. 구독 행 없이 `users.plan` 으로 유료인 계정은 **편집기·등록 제출·판정기가 같은 답**을 낸다
///     (`PlanTier.bestKnown` 의 4단 — `subscription: null` 에도 `users.plan` 을 믿는다).
///  3. 끝난 뒤의 계산값 `plus` 는 **오프라인에서도** 유료가 아니다(서버의 `ends_at` 기준).
///  4. 이용권 화면의 '현재 이용권' 은 **산 것**만 친다 — 프로모는 산 이용권이 아니다.
///  5. 종료 안내는 서버가 준 창 안에서, 앱에 **들어올 때마다**, '다시 보지 않기' 전까지 뜬다.
final class PersonalPromoTests: XCTestCase {

    // 2026-11-01 00:00 KST(배타). 실제 운영 값과 같게 두면 날짜 표기 기대값이 읽기 쉽다.
    // ⚠ 앱 코드에는 이 날짜가 없다 — 서버 값을 받아 쓰는지 보려고 테스트에만 둔다.
    private let endsAt = "2026-10-31T15:00:00Z"
    private let noticeFrom = "2026-10-24T15:00:00Z"

    private var promo: PersonalPromo { PersonalPromo(endsAt: endsAt, noticeFrom: noticeFrom) }
    private var end: Date { PaidVoiceGate.parseTimestamp(endsAt)! }
    private var from: Date { PaidVoiceGate.parseTimestamp(noticeFrom)! }

    private func apiDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }

    private func activeSubscription(expiresAt: String = "2099-01-01T00:00:00Z") -> BillingSubscription {
        BillingSubscription(
            id: "sub-1", planId: "plan-1", planGroupId: nil, status: "active",
            startsAt: "2026-01-01T00:00:00Z", expiresAt: expiresAt,
            cancelAtPeriodEnd: nil, canceledAt: nil, nextPlanId: nil
        )
    }

    private func plan(key: String, type: String) -> BillingPlan {
        BillingPlan(id: "p-\(key)", key: key, name: key, planType: type, periodDays: 30, maxMembers: 1, priceKrw: 0)
    }

    private func promoUser(plan: String = "plus", promo: PersonalPromo?) -> AuthUser {
        AuthUser(id: "user-1", email: "a@example.com", plan: plan, personalPromo: promo)
    }

    // MARK: - 1. 디코딩(추가 필드)

    func test_authUser_decodesPersonalPromoFromSnakeCase() throws {
        let json = """
        {
          "id": "user-1", "email": "a@example.com", "plan": "plus",
          "personal_promo": { "ends_at": "\(endsAt)", "notice_from": "\(noticeFrom)" }
        }
        """.data(using: .utf8)!
        let user = try apiDecoder().decode(AuthUser.self, from: json)
        XCTAssertEqual(user.plan, "plus", "앱은 서버가 준 계산값을 그대로 받는다")
        XCTAssertEqual(user.personalPromo, promo)
    }

    func test_authUser_withoutOrNullPromo_decodesAsNil() throws {
        for extra in ["", #", "personal_promo": null"#] {
            let json = #"{ "id": "user-1", "email": "a@example.com", "plan": "free"\#(extra) }"#
                .data(using: .utf8)!
            let user = try apiDecoder().decode(AuthUser.self, from: json)
            XCTAssertNil(user.personalPromo, "구버전 서버·프로모 없음은 nil")
            XCTAssertEqual(user.purchasedPlan, "free")
        }
    }

    /// 표시용 추가 필드 하나 때문에 **로그인 응답 전체가 버려지면 안 된다.**
    func test_authUser_malformedPromo_doesNotBreakLogin() throws {
        for value in [#""soon""#, "42", #"{ "ends_at": 42 }"#, "[]"] {
            let json = #"{ "id": "user-1", "email": "a@example.com", "plan": "plus", "personal_promo": \#(value) }"#
                .data(using: .utf8)!
            let user = try apiDecoder().decode(AuthUser.self, from: json)
            XCTAssertEqual(user.id, "user-1", "\(value) 때문에 로그인이 깨졌다")
            XCTAssertNil(user.personalPromo, "\(value) — 끝을 모르는 프로모는 없는 것으로 친다")
            XCTAssertEqual(user.purchasedPlan, "plus", "근거 없이 free 로 읽지 않는다")
        }
    }

    func test_billingSubscriptionResponse_decodesTopLevelPromo() throws {
        let json = """
        {
          "user_plan": "plus",
          "subscription": null,
          "store_renewal_providers": [],
          "personal_promo": { "ends_at": "\(endsAt)", "notice_from": "\(noticeFrom)" }
        }
        """.data(using: .utf8)!
        let response = try apiDecoder().decode(BillingSubscriptionResponse.self, from: json)
        XCTAssertNil(response.subscription, "프로모는 가짜 구독을 만들지 않는다")
        XCTAssertEqual(response.userPlan, "plus")
        XCTAssertEqual(response.personalPromo, promo)
    }

    /// 키체인 세션·권한 스냅샷은 **기본 인코더**로 왕복한다(스네이크 변환 없음).
    func test_sessionAndSnapshot_roundTripThroughDefaultCoders() throws {
        let session = AuthSession(token: "t", user: promoUser(promo: promo))
        let decodedSession = try JSONDecoder().decode(AuthSession.self, from: JSONEncoder().encode(session))
        XCTAssertEqual(decodedSession.user.personalPromo, promo)

        var snapshot = AccessSnapshot.empty
        snapshot.userPlan = "plus"
        snapshot.personalPromo = promo
        let decodedSnapshot = try JSONDecoder().decode(AccessSnapshot.self, from: JSONEncoder().encode(snapshot))
        XCTAssertEqual(decodedSnapshot, snapshot)
    }

    /// 이 필드가 생기기 전에 저장된 스냅샷도 그대로 읽혀야 한다(예약 게이트가 읽는다).
    func test_legacySnapshotWithoutPromo_stillDecodes() throws {
        let legacy = #"{ "userPlan": "plus", "storePlanKey": null }"#.data(using: .utf8)!
        let snapshot = try JSONDecoder().decode(AccessSnapshot.self, from: legacy)
        XCTAssertEqual(snapshot.userPlan, "plus")
        XCTAssertNil(snapshot.personalPromo)
    }

    // MARK: - 2. 등급 판정(편집기·등록 제출이 판정기와 같은 답)

    /// 회귀: 서버가 "본인 구독 없음" 으로 답해도 `users.plan` 의 유료값을 믿는다.
    /// 예전에는 응답이 **도착하기 전에만** `users.plan` 을 봐서 여기서 무료가 됐다.
    func test_bestKnown_trustsPaidUserPlanWhenServerSaysNoSubscription() {
        let noSubscription = BillingSubscriptionResponse(subscription: nil, plan: nil, nextPlan: nil)
        XCTAssertEqual(PlanTier.bestKnown(serverSubscription: noSubscription, userPlan: "plus"), .personal)
        XCTAssertEqual(PlanTier.bestKnown(serverSubscription: noSubscription, userPlan: "family"), .family)
        XCTAssertEqual(PlanTier.bestKnown(serverSubscription: noSubscription, userPlan: "free"), .free)
        XCTAssertEqual(PlanTier.bestKnown(serverSubscription: nil, userPlan: "plus"), .personal, "응답 전")
    }

    /// 2단(보류)은 그대로다 — `users.plan = free` 면 남은 행으로 등급을 올리지 않는다.
    func test_bestKnown_keepsSuspendedRule() {
        let retained = BillingSubscriptionResponse(
            subscription: activeSubscription(), plan: plan(key: "family", type: "family"), nextPlan: nil
        )
        XCTAssertEqual(PlanTier.bestKnown(serverSubscription: retained, userPlan: "free"), .free)
        XCTAssertEqual(PlanTier.bestKnown(serverSubscription: retained, userPlan: "family"), .family)
        XCTAssertEqual(
            PlanTier.bestKnown(serverSubscription: retained, storeTier: .personal, userPlan: "free"),
            .personal,
            "스토어는 언제나 후보다"
        )
    }

    /// 편집기(`bestKnown(user:)`)와 판정기(`PaidVoiceGate`)가 **같은 계정에 같은 답**을 낸다.
    func test_editorTierAndGateAgreeForPromoUser() {
        let user = promoUser(promo: promo)
        let noSubscription = BillingSubscriptionResponse(subscription: nil, plan: nil, nextPlan: nil)
        let beforeEnd = end.addingTimeInterval(-1)

        let tier = PlanTier.bestKnown(serverSubscription: noSubscription, user: user, now: beforeEnd)
        let access = PaidVoiceGate.resolve(
            snapshot: PaidVoiceGate.liveSnapshot(
                subscriptionResponse: noSubscription, familyGroup: nil, storeTier: .free, user: user
            ),
            now: beforeEnd
        )
        XCTAssertEqual(tier, .personal)
        XCTAssertEqual(access, .entitled)

        let tierAfter = PlanTier.bestKnown(serverSubscription: noSubscription, user: user, now: end)
        let accessAfter = PaidVoiceGate.resolve(
            snapshot: PaidVoiceGate.liveSnapshot(
                subscriptionResponse: noSubscription, familyGroup: nil, storeTier: .free, user: user
            ),
            now: end
        )
        XCTAssertEqual(tierAfter, .free)
        XCTAssertEqual(accessAfter, .notEntitled)
    }

    // MARK: - 3. 오프라인 컷오프

    func test_planAsOf_boundaryIsExclusive() {
        XCTAssertEqual(PersonalPromo.planAsOf("plus", promo: promo, now: end.addingTimeInterval(-0.001)), "plus")
        XCTAssertEqual(PersonalPromo.planAsOf("plus", promo: promo, now: end), "free")
        XCTAssertEqual(PersonalPromo.planAsOf("plus", promo: nil, now: end), "plus", "프로모가 없으면 받은 값 그대로")
        XCTAssertNil(PersonalPromo.planAsOf(nil, promo: nil, now: end))
    }

    /// 예약 게이트(저장된 스냅샷)도 끝난 뒤에는 캐시된 `plus` 를 믿지 않는다.
    func test_gate_cachedPlusIsNotEntitledAfterEnd() {
        var snapshot = AccessSnapshot.empty
        snapshot.subscriptionResponse = BillingSubscriptionResponse(subscription: nil, plan: nil, nextPlan: nil)
        snapshot.userPlan = "plus"
        snapshot.personalPromo = promo

        XCTAssertEqual(PaidVoiceGate.resolve(snapshot: snapshot, now: end.addingTimeInterval(-1)), .entitled)
        XCTAssertEqual(PaidVoiceGate.resolve(snapshot: snapshot, now: end), .notEntitled)
        XCTAssertEqual(
            PaidVoiceGate.resolve(snapshot: snapshot, now: end.addingTimeInterval(86_400)),
            .notEntitled
        )

        // 구독 스냅샷을 아직 못 받았어도(콜드 스타트) 끝난 프로모는 '아는 free' 다.
        var coldStart = AccessSnapshot.empty
        coldStart.userPlan = "plus"
        coldStart.personalPromo = promo
        XCTAssertEqual(PaidVoiceGate.resolve(snapshot: coldStart, now: end), .notEntitled)
    }

    /// 스토어가 유효하다고 하면 끝난 프로모로도 뒤집지 않는다(「스토어가 권위다」).
    func test_gate_storeSignalBeatsEndedPromo() {
        var snapshot = AccessSnapshot.empty
        snapshot.userPlan = "plus"
        snapshot.personalPromo = promo
        snapshot.storePlanKey = "personal"
        snapshot.storeEntitlementUntilMillis = Int64((end.timeIntervalSince1970 + 30 * 86_400) * 1000)
        XCTAssertEqual(PaidVoiceGate.resolve(snapshot: snapshot, now: end.addingTimeInterval(60)), .entitled)
    }

    /// 종료 시각을 못 읽으면 **회수하지 않는다**(판정기의 fail-open 과 같은 방향).
    func test_gate_unreadableEndDoesNotRevoke() {
        var snapshot = AccessSnapshot.empty
        snapshot.subscriptionResponse = BillingSubscriptionResponse(subscription: nil, plan: nil, nextPlan: nil)
        snapshot.userPlan = "plus"
        snapshot.personalPromo = PersonalPromo(endsAt: "언젠가", noticeFrom: nil)
        XCTAssertEqual(PaidVoiceGate.resolve(snapshot: snapshot, now: end.addingTimeInterval(86_400)), .entitled)
    }

    /// 프로모가 끝났다고 **실제 구독자**를 떨어뜨리지 않는다 — 프로모는 원시 free 에만 붙는다.
    func test_gate_realSubscriptionUnaffectedWithoutPromo() {
        var snapshot = AccessSnapshot.empty
        snapshot.subscriptionResponse = BillingSubscriptionResponse(
            subscription: activeSubscription(), plan: plan(key: "personal", type: "personal"), nextPlan: nil
        )
        snapshot.userPlan = "plus"
        XCTAssertEqual(PaidVoiceGate.resolve(snapshot: snapshot, now: end.addingTimeInterval(86_400)), .entitled)
    }

    // MARK: - 4. 이용권 화면: 산 것만 '현재 이용권'

    func test_purchasedPlan_excludesPromo() {
        XCTAssertEqual(promoUser(promo: promo).purchasedPlan, "free")
        XCTAssertEqual(promoUser(promo: nil).purchasedPlan, "plus")
        XCTAssertEqual(promoUser(plan: "family", promo: nil).purchasedPlan, "family")

        // 이용권 화면이 넘기는 값으로 등급을 보면 프로모 계정은 무료 카드가 현재다 —
        // 개인 카드에 결제 버튼이 남고, 전환·환산 문구가 뜨지 않는다.
        let noSubscription = BillingSubscriptionResponse(subscription: nil, plan: nil, nextPlan: nil)
        XCTAssertEqual(
            PlanTier.bestKnown(serverSubscription: noSubscription, userPlan: promoUser(promo: promo).purchasedPlan),
            .free
        )
    }

    /// 프로모 계정의 결제를 막지 않는다 — 산 이용권이 없으니 갱신을 쥔 스토어도 없다.
    /// (프로모를 '현재 이용권' 으로 치면 응답 전에 `renewalOwnerUnknown` 으로 막혔다.)
    @MainActor
    func test_promoUserPurchaseIsNotBlocked() {
        let user = promoUser(promo: promo)
        let tier = PlanTier.bestKnown(serverSubscription: nil, userPlan: user.purchasedPlan)
        XCTAssertEqual(tier, .free)
        XCTAssertNil(BillingPanel.purchaseBlockReason(currentTier: tier, response: nil))
        let noSubscription = BillingSubscriptionResponse(
            subscription: nil, plan: nil, nextPlan: nil, storeRenewalProviders: [], userPlan: "plus",
            personalPromo: promo
        )
        XCTAssertNil(BillingPanel.purchaseBlockReason(currentTier: tier, response: noSubscription))
    }

    func test_lastFreeDay_isOneSecondBeforeExclusiveEnd() {
        XCTAssertEqual(promo.lastFreeDate, end.addingTimeInterval(-1))
    }

    // MARK: - 5. 종료 안내

    func test_notice_windowIsNoticeFromInclusiveEndExclusive() {
        XCTAssertFalse(PersonalPromoNotice.shouldShow(promo: promo, now: from.addingTimeInterval(-1), optedOut: false))
        XCTAssertTrue(PersonalPromoNotice.shouldShow(promo: promo, now: from, optedOut: false))
        XCTAssertTrue(PersonalPromoNotice.shouldShow(promo: promo, now: end.addingTimeInterval(-1), optedOut: false))
        XCTAssertFalse(PersonalPromoNotice.shouldShow(promo: promo, now: end, optedOut: false))
        XCTAssertFalse(PersonalPromoNotice.shouldShow(promo: promo, now: from, optedOut: true), "다시 보지 않기")
        XCTAssertFalse(PersonalPromoNotice.shouldShow(promo: nil, now: from, optedOut: false), "프로모 없음")
        XCTAssertFalse(
            PersonalPromoNotice.shouldShow(
                promo: PersonalPromo(endsAt: endsAt, noticeFrom: nil), now: from, optedOut: false
            ),
            "언제부터인지 모르면 띄우지 않는다"
        )
    }

    /// 날짜는 **서버 값**을 기기 로케일·시간대로 찍는다. 마지막 날은 `ends_at − 1초`라
    /// 한국 기기에서 '11월 1일까지' 가 되지 않는다.
    func test_notice_dayLabels_followLocaleAndTimeZone() throws {
        let korea = try XCTUnwrap(PersonalPromoNotice.dayLabels(
            for: promo,
            locale: Locale(identifier: "ko_KR"),
            timeZone: try XCTUnwrap(TimeZone(identifier: "Asia/Seoul"))
        ))
        XCTAssertEqual(korea.lastDay, "10월 31일")
        XCTAssertEqual(korea.firstFreeDay, "11월 1일")

        let japan = try XCTUnwrap(PersonalPromoNotice.dayLabels(
            for: promo,
            locale: Locale(identifier: "ja_JP"),
            timeZone: try XCTUnwrap(TimeZone(identifier: "Asia/Tokyo"))
        ))
        XCTAssertEqual(japan.lastDay, "10月31日")
        XCTAssertEqual(japan.firstFreeDay, "11月1日")

        // 끝나는 순간은 전 세계가 같다 — 시간대가 다르면 날짜 표기도 그 시각을 따른다.
        let pacific = try XCTUnwrap(PersonalPromoNotice.dayLabels(
            for: promo,
            locale: Locale(identifier: "en_US"),
            timeZone: try XCTUnwrap(TimeZone(identifier: "America/Los_Angeles"))
        ))
        XCTAssertEqual(pacific.lastDay, "October 31")
        XCTAssertEqual(pacific.firstFreeDay, "October 31")

        XCTAssertNil(PersonalPromoNotice.dayLabels(for: PersonalPromo(endsAt: nil, noticeFrom: noticeFrom)))
    }

    func test_noticeStore_isPerAccountAndPerPromo() throws {
        let suite = "personal-promo-notice-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = PersonalPromoNoticeStore(defaults: defaults)

        XCTAssertFalse(store.isOptedOut(userID: "a", promo: promo))
        store.optOut(userID: "a", promo: promo)
        XCTAssertTrue(store.isOptedOut(userID: "a", promo: promo))
        XCTAssertFalse(store.isOptedOut(userID: "b", promo: promo), "다른 계정은 아직 안 봤다")

        let extended = PersonalPromo(endsAt: "2026-11-30T15:00:00Z", noticeFrom: "2026-11-23T15:00:00Z")
        XCTAssertFalse(store.isOptedOut(userID: "a", promo: extended), "다른 기간의 안내까지 삼키지 않는다")

        store.optOut(userID: nil, promo: promo)
        XCTAssertFalse(store.isOptedOut(userID: nil, promo: promo), "계정 없이 기록하지 않는다")
    }

    /// '앱에 들어왔다' 는 콜드 스타트와 **백그라운드에서 돌아온 것**뿐이다.
    func test_appEntryCounter_countsOnlyColdStartAndReturnFromBackground() {
        var counter = AppEntryCounter()
        XCTAssertEqual(counter.entry, 0)

        XCTAssertFalse(counter.observe(.inactive))
        XCTAssertTrue(counter.observe(.active), "콜드 스타트")
        XCTAssertEqual(counter.entry, 1)

        // 알림 센터를 내렸다 올림 — 들어온 것이 아니다.
        counter.observe(.inactive)
        XCTAssertFalse(counter.observe(.active))
        XCTAssertEqual(counter.entry, 1)

        // 홈으로 나갔다가 돌아옴.
        counter.observe(.inactive)
        counter.observe(.background)
        counter.observe(.inactive)
        XCTAssertTrue(counter.observe(.active))
        XCTAssertEqual(counter.entry, 2)

        // 같은 active 가 두 번 와도 한 번이다.
        XCTAssertFalse(counter.observe(.active))
        XCTAssertEqual(counter.entry, 2)
    }
}
