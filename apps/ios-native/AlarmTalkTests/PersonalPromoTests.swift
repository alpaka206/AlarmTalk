import SwiftUI
import XCTest
@testable import AlarmTalk

/// **기간 한정 개인 플랜** — 서버가 원시 free 계정을 기간 중 개인(`plus`)으로 읽어 주고,
/// 앱은 그 계산값을 받아 쓰기만 한다.
///
/// 이 파일이 고정하는 것:
///  1. `personal_promo` 는 **추가 필드**다 — 없어도, 모양이 어긋나도 로그인이 깨지지 않는다.
///     계산 시각은 서버의 `computed_at` 이 우선이고, 없으면 서버 응답을 받은 순간이다. 저장본을
///     거쳐도 유지되고, 저장본에 없으면 **모르는 것**(nil)이지 지금이 아니다(스펙 D7).
///  2. 구독 행 없이 `users.plan` 으로 유료인 계정은 **편집기·등록 제출·판정기가 같은 답**을 낸다.
///     기간 중에는 **보류 규칙**이 그대로다 — 남은 행이 커플·가족으로 올리지 못한다.
///  3. 오프라인 컷오프는 **낡은 캐시에만** 건다 — 끝 **전에** 계산된 `plus` 만 끝난 뒤 무료로
///     읽고, 끝 **뒤에** 계산된 답은 서버 값 그대로 믿는다. 계산 시각을 모르면 끝 전의 답이다
///     (fail-closed). **활성 구독 행은 언제나 이긴다.**
///  4. 이용권 화면의 '현재 이용권' 은 **산 것**만 친다 — 프로모는 산 이용권이 아니다.
///  5. 종료 안내는 서버가 준 창 안에서, 앱에 **들어올 때마다**, **이 진입에 보낸 계정 요청의
///     응답 뒤에**, 다른 모달·권한 팝업이 없을 때, '다시 보지 않기' 전까지 뜬다. 한 진입의 판정은
///     한 번이다 — 띄울 것이 없거나 응답이 실패해도 그 진입은 끝난다.
final class PersonalPromoTests: XCTestCase {

    // 2026-11-01 00:00 KST(배타). 실제 운영 값과 같게 두면 날짜 표기 기대값이 읽기 쉽다.
    // ⚠ 앱 코드에는 이 날짜가 없다 — 서버 값을 받아 쓰는지 보려고 테스트에만 둔다.
    private let endsAt = "2026-10-31T15:00:00Z"
    private let noticeFrom = "2026-10-24T15:00:00Z"

    private var end: Date { PaidVoiceGate.parseTimestamp(endsAt)! }
    private var from: Date { PaidVoiceGate.parseTimestamp(noticeFrom)! }

    /// 끝 **전에** 계산된 프로모(기본). 끝이 지나면 낡은 캐시다.
    private var promo: PersonalPromo { promo(fetchedAt: from.addingTimeInterval(3_600)) }

    private func promo(fetchedAt: Date?, deletesVoicesAtEnd: Bool = true) -> PersonalPromo {
        PersonalPromo(
            endsAt: endsAt,
            noticeFrom: noticeFrom,
            deletesVoicesAtEnd: deletesVoicesAtEnd,
            fetchedAt: fetchedAt
        )
    }

    /// 서버 응답을 읽는 디코더 — 앱이 쓰는 것과 **같은 것**이다(받은 순간을 찍어도 된다는 표시 포함).
    private func apiDecoder() -> JSONDecoder {
        AlarmTalkAPI.makeResponseDecoder()
    }

    private func subscription(status: String = "active", expiresAt: String = "2099-01-01T00:00:00Z") -> BillingSubscription {
        BillingSubscription(
            id: "sub-1", planId: "plan-1", planGroupId: nil, status: status,
            startsAt: "2026-01-01T00:00:00Z", expiresAt: expiresAt,
            cancelAtPeriodEnd: nil, canceledAt: nil, nextPlanId: nil
        )
    }

    private func plan(key: String, type: String) -> BillingPlan {
        BillingPlan(id: "p-\(key)", key: key, name: key, planType: type, periodDays: 30, maxMembers: 1, priceKrw: 0)
    }

    private func response(_ subscription: BillingSubscription?, key: String = "personal", type: String = "personal") -> BillingSubscriptionResponse {
        BillingSubscriptionResponse(
            subscription: subscription,
            plan: subscription == nil ? nil : plan(key: key, type: type),
            nextPlan: nil
        )
    }

    private var noSubscription: BillingSubscriptionResponse { response(nil) }

    private func promoUser(plan: String = "plus", promo: PersonalPromo?) -> AuthUser {
        AuthUser(id: "user-1", email: "a@example.com", plan: plan, personalPromo: promo)
    }

    private func snapshot(
        _ response: BillingSubscriptionResponse?,
        userPlan: String? = "plus",
        promo: PersonalPromo?
    ) -> AccessSnapshot {
        var snapshot = AccessSnapshot.empty
        snapshot.subscriptionResponse = response
        snapshot.userPlan = userPlan
        snapshot.personalPromo = promo
        return snapshot
    }

    // MARK: - 1. 디코딩(추가 필드)

    func test_authUser_decodesPersonalPromoFromSnakeCase_andStampsReceipt() throws {
        let json = """
        {
          "id": "user-1", "email": "a@example.com", "plan": "plus",
          "personal_promo": { "ends_at": "\(endsAt)", "notice_from": "\(noticeFrom)", "deletes_voices_at_end": false }
        }
        """.data(using: .utf8)!
        let before = Date().addingTimeInterval(-1)
        let user = try apiDecoder().decode(AuthUser.self, from: json)
        let after = Date().addingTimeInterval(1)
        XCTAssertEqual(user.plan, "plus", "앱은 서버가 준 계산값을 그대로 받는다")
        XCTAssertEqual(user.personalPromo?.endsAt, endsAt)
        XCTAssertEqual(user.personalPromo?.noticeFrom, noticeFrom)
        XCTAssertEqual(user.personalPromo?.deletesVoicesAtEnd, false)
        let fetchedAt = try XCTUnwrap(user.personalPromo?.fetchedAt, "받은 순간이 찍힌다")
        XCTAssertTrue(fetchedAt >= before && fetchedAt <= after)
    }

    /// 스펙 D7: 서버가 `computed_at`(서버 시계)을 주면 **그것이 계산 시각**이다 — 받은 순간의 기기
    /// 시계가 아니다. 기기 시계가 앞서 있어도 끝 전에 계산된 답은 끝 전의 답으로 읽힌다.
    func test_computedAt_isTheFetchStampWhenPresent() throws {
        let computedAt = "2026-10-31T14:59:30Z"
        let json = """
        {
          "id": "user-1", "email": "a@example.com", "plan": "plus",
          "personal_promo": {
            "ends_at": "\(endsAt)", "notice_from": "\(noticeFrom)",
            "deletes_voices_at_end": true, "computed_at": "\(computedAt)"
          }
        }
        """.data(using: .utf8)!
        let user = try apiDecoder().decode(AuthUser.self, from: json)
        let promo = try XCTUnwrap(user.personalPromo)
        XCTAssertEqual(promo.fetchedAt, PaidVoiceGate.parseTimestamp(computedAt), "받은 순간이 아니라 서버의 계산 시각")
        // 기기 시계가 끝을 넘어 있어도 — 서버가 끝 **전에** 계산한 `plus` 는 낡은 답이다.
        XCTAssertTrue(promo.isStale(at: end.addingTimeInterval(120)))

        // 끝 **뒤에** 계산한 답은 그대로 믿는다.
        let after = #"{ "ends_at": "\#(endsAt)", "notice_from": "\#(noticeFrom)", "computed_at": "2026-10-31T15:00:05Z" }"#
        let late = try apiDecoder().decode(PersonalPromo.self, from: after.data(using: .utf8)!)
        XCTAssertFalse(late.isStale(at: end.addingTimeInterval(120)))
    }

    /// `computed_at` 을 못 읽으면(구버전 서버·모양 어긋남) 받은 순간으로 돌아간다 — 로그인은 깨지지 않는다.
    func test_computedAt_missingOrMalformed_fallsBackToReceipt() throws {
        for extra in ["", #", "computed_at": "soon""#, #", "computed_at": 42"#, #", "computed_at": null"#] {
            let json = #"{ "ends_at": "\#(endsAt)", "notice_from": "\#(noticeFrom)"\#(extra) }"#.data(using: .utf8)!
            let before = Date().addingTimeInterval(-1)
            let decoded = try apiDecoder().decode(PersonalPromo.self, from: json)
            let fetchedAt = try XCTUnwrap(decoded.fetchedAt, "\(extra)")
            XCTAssertTrue(fetchedAt >= before && fetchedAt <= Date().addingTimeInterval(1), "\(extra)")
            XCTAssertEqual(decoded.endsAt, endsAt, "\(extra) — 다른 필드는 그대로 읽는다")
        }
    }

    /// 회귀(2026-09-27 리뷰 2차, 스펙 D7): **저장본을 읽을 때 지금 시각을 찍지 않는다.** 이 필드
    /// 전의 개발 빌드가 남긴 캐시(`receivedAtMillis` 없음)는 계산 시각을 **모르는** 답이고,
    /// 끝 전에 받은 답으로 본다 — 예전에는 읽을 때마다 '방금 받은 답' 이 되어 영영 낡지 않았다.
    func test_persistedPromoWithoutStamp_isUnknownAndFailsClosed() throws {
        let legacyPromo = #"{ "endsAt": "\#(endsAt)", "noticeFrom": "\#(noticeFrom)", "deletesVoicesAtEnd": true }"#
        let decoded = try JSONDecoder().decode(PersonalPromo.self, from: legacyPromo.data(using: .utf8)!)
        XCTAssertNil(decoded.fetchedAt, "저장본을 읽는 기본 디코더는 지금 시각을 찍지 않는다")
        XCTAssertTrue(decoded.isStale(at: end), "모르면 끝 전의 답 — 끝이 지나면 낡았다")
        XCTAssertFalse(decoded.isStale(at: end.addingTimeInterval(-1)), "끝 전에는 그대로 쓴다")

        // 키체인 세션·권한 스냅샷도 같은 디코더로 읽는다.
        let legacySession = #"{ "token": "t", "user": { "id": "user-1", "email": "a@example.com", "plan": "plus", "personalPromo": \#(legacyPromo) } }"#
        let session = try JSONDecoder().decode(AuthSession.self, from: legacySession.data(using: .utf8)!)
        XCTAssertNil(session.user.personalPromo?.fetchedAt)
        XCTAssertEqual(
            PlanTier.bestKnown(serverSubscription: noSubscription, user: session.user, now: end.addingTimeInterval(60)),
            .free,
            "끝난 뒤 옛 캐시의 `plus` 로 개인 등급을 주지 않는다"
        )
        let legacySnapshot = #"{ "userPlan": "plus", "personalPromo": \#(legacyPromo) }"#
        let snapshot = try JSONDecoder().decode(AccessSnapshot.self, from: legacySnapshot.data(using: .utf8)!)
        XCTAssertEqual(PaidVoiceGate.resolve(snapshot: snapshot, now: end.addingTimeInterval(60)), .notEntitled)
    }

    /// 구버전 서버처럼 `deletes_voices_at_end` 가 없거나 모양이 어긋나면 **삭제 대상으로** 읽는다 —
    /// 지워질 목소리를 안내하지 않는 쪽이 더 나쁘다.
    func test_deletesVoicesAtEnd_missingOrMalformed_defaultsToTrue() throws {
        for extra in ["", #", "deletes_voices_at_end": "no""#, #", "deletes_voices_at_end": null"#] {
            let json = #"{ "ends_at": "\#(endsAt)", "notice_from": "\#(noticeFrom)"\#(extra) }"#.data(using: .utf8)!
            let decoded = try apiDecoder().decode(PersonalPromo.self, from: json)
            XCTAssertTrue(decoded.deletesVoicesAtEnd, "\(extra)")
            XCTAssertEqual(decoded.endsAt, endsAt, "다른 필드는 그대로 읽는다")
        }
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
        for value in [#""soon""#, "42", #"{ "ends_at": 42 }"#, "[]", "true"] {
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
          "personal_promo": { "ends_at": "\(endsAt)", "notice_from": "\(noticeFrom)", "deletes_voices_at_end": true }
        }
        """.data(using: .utf8)!
        let response = try apiDecoder().decode(BillingSubscriptionResponse.self, from: json)
        XCTAssertNil(response.subscription, "프로모는 가짜 구독을 만들지 않는다")
        XCTAssertEqual(response.userPlan, "plus")
        XCTAssertEqual(response.personalPromo?.endsAt, endsAt)
        XCTAssertNotNil(response.personalPromo?.fetchedAt)
    }

    /// 키체인 세션·권한 스냅샷은 **기본 인코더**로 왕복한다(스네이크 변환 없음). 받은 시각과
    /// 삭제 대상 여부까지 그대로 돌아와야 한다 — 받은 시각이 날아가면 낡은 캐시를 못 가른다.
    func test_sessionAndSnapshot_roundTripThroughDefaultCoders() throws {
        let stored = promo(fetchedAt: Date(timeIntervalSince1970: 1_792_000_000.123), deletesVoicesAtEnd: false)
        let session = AuthSession(token: "t", user: promoUser(promo: stored))
        let decodedSession = try JSONDecoder().decode(AuthSession.self, from: JSONEncoder().encode(session))
        XCTAssertEqual(decodedSession.user.personalPromo, stored)

        let saved = snapshot(noSubscription, promo: stored)
        let decodedSnapshot = try JSONDecoder().decode(AccessSnapshot.self, from: JSONEncoder().encode(saved))
        XCTAssertEqual(decodedSnapshot, saved)
        XCTAssertEqual(decodedSnapshot.personalPromo?.fetchedAt, stored.fetchedAt)
        XCTAssertEqual(decodedSnapshot.personalPromo?.deletesVoicesAtEnd, false)
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
        XCTAssertEqual(PlanTier.bestKnown(serverSubscription: noSubscription, userPlan: "plus"), .personal)
        XCTAssertEqual(PlanTier.bestKnown(serverSubscription: noSubscription, userPlan: "family"), .family)
        XCTAssertEqual(PlanTier.bestKnown(serverSubscription: noSubscription, userPlan: "free"), .free)
        XCTAssertEqual(PlanTier.bestKnown(serverSubscription: nil, userPlan: "plus"), .personal, "응답 전")
    }

    /// 2단(보류)은 그대로다 — `users.plan = free` 면 남은 행으로 등급을 올리지 않는다.
    func test_bestKnown_keepsSuspendedRule() {
        let retained = response(subscription(), key: "family", type: "family")
        XCTAssertEqual(PlanTier.bestKnown(serverSubscription: retained, userPlan: "free"), .free)
        XCTAssertEqual(PlanTier.bestKnown(serverSubscription: retained, userPlan: "family"), .family)
        XCTAssertEqual(
            PlanTier.bestKnown(serverSubscription: retained, storeTier: .personal, userPlan: "free"),
            .personal,
            "스토어는 언제나 후보다"
        )
    }

    /// 회귀(2026-09-27 리뷰): **기간 중에도 보류 규칙을 지킨다.** 결제 보류 그룹의 소유자·멤버는
    /// 원시 free 라 프로모가 붙고 plan 은 계산값 `plus` 다 — 그 `plus` 로 보류를 풀면 남은
    /// 커플·가족 행이 등급을 올려, 서버가 원시값으로 막는 공유·가족 알람 UI 가 열린다.
    func test_bestKnownUser_duringPromo_retainedGroupRowDoesNotLiftTier() {
        let user = promoUser(promo: promo)
        let beforeEnd = end.addingTimeInterval(-60)
        for (key, type) in [("couple", "family"), ("family", "family")] {
            let retained = response(subscription(), key: key, type: type)
            XCTAssertEqual(
                PlanTier.bestKnown(serverSubscription: retained, user: user, now: beforeEnd),
                .personal,
                "\(key) — 기간 중 원시 free 는 남은 행으로 올리지 않는다(개인만)"
            )
            XCTAssertEqual(
                PlanTier.bestKnown(serverSubscription: retained, storeTier: .family, user: user, now: beforeEnd),
                .family,
                "스토어는 언제나 후보다"
            )
        }
        XCTAssertFalse(
            canShareVoiceWithOthers(
                subscriptionResponse: response(subscription(), key: "couple", type: "family"),
                familyGroup: nil,
                authSession: AuthSession(token: "t", user: user),
                now: beforeEnd
            ),
            "보류 커플 행으로 공유 토글이 열리지 않는다"
        )
    }

    /// 회귀(스펙 D9 — 안드로이드 `personalPromoTierHoldOf` 미러): 기간 중에는 **남은 가족 그룹**
    /// 으로도 커플·가족 기능을 열지 않는다. 결제 보류는 그룹을 남긴 채 plan 만 회수하므로, 그룹의
    /// 멤버 수로 공유 토글을 열면 서버가 원시값으로 막는 공유를 켜게 된다. 프로모가 낡으면(끝 전에
    /// 계산된 답이 끝을 넘김) 예전 규칙 그대로 그룹이 연다.
    func test_promoHold_groupMembersDoNotUnlockSharingDuringPromo() {
        let user = promoUser(promo: promo)
        let session = AuthSession(token: "t", user: user)
        let beforeEnd = end.addingTimeInterval(-60)
        let retainedGroup = FamilyGroupCurrentResponse(
            group: FamilyGroup(
                id: "group-1", ownerUserId: "owner-1", planId: "plan-1",
                maxMembers: 5, createdAt: "2026-01-01T00:00:00Z"
            ),
            role: "member",
            members: [
                FamilyGroupMember(
                    id: "m-1", userId: "owner-1", role: "owner",
                    joinedAt: "2026-01-01T00:00:00Z", email: "owner@example.com", name: "Owner"
                ),
                FamilyGroupMember(
                    id: "m-2", userId: user.id, role: "member",
                    joinedAt: "2026-01-01T00:00:00Z", email: user.email, name: "Me"
                ),
            ]
        )

        XCTAssertTrue(PlanTier.personalPromoHoldActive(user: user, now: beforeEnd))
        XCTAssertFalse(
            canShareVoiceWithOthers(
                subscriptionResponse: noSubscription,
                familyGroup: retainedGroup,
                authSession: session,
                now: beforeEnd
            ),
            "기간 중 보류 계정은 남은 그룹의 멤버로 공유 토글이 열리지 않는다"
        )
        XCTAssertTrue(
            canShareVoiceWithOthers(
                subscriptionResponse: noSubscription,
                familyGroup: retainedGroup,
                authSession: session,
                storeTier: .family,
                now: beforeEnd
            ),
            "스토어 등급은 보류 규칙 아래에서도 연다"
        )

        // 끝 전에 계산된 답이 끝을 넘기면 낡은 캐시다 — 보류 규칙이 풀리고 예전 규칙(그룹)이다.
        XCTAssertFalse(PlanTier.personalPromoHoldActive(user: user, now: end))
        XCTAssertTrue(
            canShareVoiceWithOthers(
                subscriptionResponse: noSubscription,
                familyGroup: retainedGroup,
                authSession: session,
                now: end
            ),
            "낡은 프로모에서는 그룹 멤버가 예전처럼 연다"
        )

        // 프로모가 없는 계정은 규칙이 없다.
        XCTAssertFalse(PlanTier.personalPromoHoldActive(user: promoUser(plan: "family", promo: nil), now: beforeEnd))
    }

    /// 편집기(`bestKnown(user:)`)와 판정기(`PaidVoiceGate`)가 **같은 계정에 같은 답**을 낸다.
    func test_editorTierAndGateAgreeForPromoUser() {
        let user = promoUser(promo: promo)
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

    /// 회귀(2026-09-27 리뷰, major): 낡은 프로모가 **진짜 구독자**를 잠그지 않는다. 프로모 뒤에
    /// 다른 기기에서 결제해 구독 응답에는 활성 행이 있는데, plan·프로모는 옛 `/auth/me` 값이다.
    func test_bestKnownUser_stalePromo_activeRowWins() {
        let user = promoUser(promo: promo)
        let later = end.addingTimeInterval(86_400)
        XCTAssertEqual(
            PlanTier.bestKnown(serverSubscription: response(subscription()), user: user, now: later),
            .personal
        )
        XCTAssertEqual(
            PlanTier.bestKnown(serverSubscription: response(subscription(), key: "family", type: "family"), user: user, now: later),
            .family
        )
        XCTAssertEqual(PlanTier.bestKnown(serverSubscription: nil, user: user, now: later), .free, "행이 없으면 무료")
    }

    /// 끝 **뒤에** 받은 답은 서버가 이미 계산한 것이다 — 기기 시계가 앞서 있어도 무료로 읽지 않는다.
    func test_bestKnownUser_answerReceivedAfterEnd_isAuthoritative() {
        let aheadClock = end.addingTimeInterval(120)
        let user = promoUser(promo: promo(fetchedAt: aheadClock))
        XCTAssertEqual(
            PlanTier.bestKnown(serverSubscription: noSubscription, user: user, now: aheadClock.addingTimeInterval(5)),
            .personal
        )
    }

    // MARK: - 3. 오프라인 컷오프 — 낡은 캐시에만

    func test_isStale_onlyForAnswersReceivedBeforeTheEnd() {
        XCTAssertFalse(promo.isStale(at: end.addingTimeInterval(-0.001)), "아직 끝 전")
        XCTAssertTrue(promo.isStale(at: end), "끝은 배타 — 그 순간부터 낡았다")
        XCTAssertFalse(promo(fetchedAt: end).isStale(at: end.addingTimeInterval(60)), "끝에 받은 답은 서버 값")
        XCTAssertFalse(promo(fetchedAt: end.addingTimeInterval(1)).isStale(at: end.addingTimeInterval(60)))
        XCTAssertTrue(promo(fetchedAt: nil).isStale(at: end.addingTimeInterval(60)), "계산 시각을 모르면 끝 전의 답이다(D7)")
        XCTAssertFalse(promo(fetchedAt: nil).isStale(at: end.addingTimeInterval(-1)), "끝 전에는 모르는 답도 쓴다")
        XCTAssertFalse(
            PersonalPromo(endsAt: "언젠가", noticeFrom: nil, fetchedAt: from).isStale(at: end.addingTimeInterval(60)),
            "끝을 못 읽으면 회수하지 않는다"
        )
    }

    /// 예약 게이트(저장된 스냅샷)도 끝난 뒤에는 **끝 전에 받아 둔** `plus` 를 믿지 않는다.
    func test_gate_staleCachedPlusIsNotEntitledAfterEnd() {
        let cached = snapshot(noSubscription, promo: promo)
        XCTAssertEqual(PaidVoiceGate.resolve(snapshot: cached, now: end.addingTimeInterval(-1)), .entitled)
        XCTAssertEqual(PaidVoiceGate.resolve(snapshot: cached, now: end), .notEntitled)
        XCTAssertEqual(PaidVoiceGate.resolve(snapshot: cached, now: end.addingTimeInterval(86_400)), .notEntitled)

        // 구독 스냅샷을 아직 못 받았어도(콜드 스타트) 낡은 프로모는 '아는 free' 다.
        let coldStart = snapshot(nil, promo: promo)
        XCTAssertEqual(PaidVoiceGate.resolve(snapshot: coldStart, now: end), .notEntitled)
        XCTAssertEqual(PaidVoiceGate.resolve(snapshot: coldStart, now: end.addingTimeInterval(-1)), .unknown)
    }

    /// 회귀(2026-09-27 리뷰, major): **활성 구독 행이 낡은 프로모를 이긴다** — 안드로이드
    /// `resolvePaidVoiceAccess` 와 같은 순서다. 예전 iOS 는 plan 을 먼저 free 로 덮어써서
    /// '서버가 free 라고 함'(2단)에 걸려 행을 보기도 전에 잠갔다.
    func test_gate_activeRowBeatsStalePromo() {
        let later = end.addingTimeInterval(86_400)
        XCTAssertEqual(PaidVoiceGate.resolve(snapshot: snapshot(response(subscription()), promo: promo), now: later), .entitled)
        XCTAssertEqual(
            PaidVoiceGate.resolve(
                snapshot: snapshot(response(subscription(expiresAt: "2026-11-01T00:00:00Z")), promo: promo),
                now: later
            ),
            .notEntitled,
            "행도 만료됐으면 무료"
        )
        XCTAssertEqual(
            PaidVoiceGate.resolve(snapshot: snapshot(response(subscription(status: "canceled")), promo: promo), now: later),
            .notEntitled
        )
    }

    /// 끝 **뒤에** 받은 답은 서버 값이다 — 기기 시계가 앞서 있어도 **방금 받은 답으로 잠그지
    /// 않는다**(되돌릴 수 없는 잠금 `applyFreePlanVoiceLockIfNeeded`·예약 강등이 이 판정을 쓴다).
    func test_gate_freshAnswerAfterEndIsNotRevokedByDeviceClock() {
        let aheadClock = end.addingTimeInterval(300)
        let fresh = snapshot(noSubscription, promo: promo(fetchedAt: aheadClock))
        XCTAssertEqual(PaidVoiceGate.resolve(snapshot: fresh, now: aheadClock), .entitled)
        XCTAssertEqual(PaidVoiceGate.resolve(snapshot: snapshot(nil, promo: promo(fetchedAt: aheadClock)), now: aheadClock), .unknown)

        let createdAt = Int64(from.timeIntervalSince1970 * 1000)
        var record = LocalAlarmRecord(
            id: "alarm-1", label: "아침", hour: 7, minute: 0, fireAtMillis: createdAt + 60_000,
            origin: AlarmOrigin.localOwned.rawValue, createdAtMillis: createdAt, updatedAtMillis: createdAt
        )
        record.playMode = AlarmPlayMode.voiceOnly.rawValue
        record.voiceProfileId = "clone-1"   // 시스템 보이스가 아니다 = 유료 클론
        XCTAssertFalse(PaidVoiceGate.shouldDowngrade(record: record, snapshot: fresh, now: aheadClock))
        XCTAssertTrue(
            PaidVoiceGate.shouldDowngrade(record: record, snapshot: snapshot(noSubscription, promo: promo), now: aheadClock),
            "끝 전에 받아 둔 낡은 캐시면 예약 시점에 강등한다"
        )
    }

    /// 스토어가 유효하다고 하면 끝난 프로모로도 뒤집지 않는다(「스토어가 권위다」).
    func test_gate_storeSignalBeatsEndedPromo() {
        var cached = snapshot(nil, promo: promo)
        cached.storePlanKey = "personal"
        cached.storeEntitlementUntilMillis = Int64((end.timeIntervalSince1970 + 30 * 86_400) * 1000)
        XCTAssertEqual(PaidVoiceGate.resolve(snapshot: cached, now: end.addingTimeInterval(60)), .entitled)
    }

    /// 종료 시각을 못 읽으면 **회수하지 않는다**(서버 게이트가 제 시각에 스스로 닫힌다). 계산 시각을
    /// 모르면 **끝 전의 답**이다(스펙 D7 — 안드로이드 `personalPromoLapsed` 와 같은 fail-closed).
    func test_gate_unreadableEndDoesNotRevoke_unknownFetchStampDoes() {
        let unreadable = snapshot(noSubscription, promo: PersonalPromo(endsAt: "언젠가", noticeFrom: nil, fetchedAt: from))
        XCTAssertEqual(PaidVoiceGate.resolve(snapshot: unreadable, now: end.addingTimeInterval(86_400)), .entitled)
        let unknownStamp = snapshot(noSubscription, promo: promo(fetchedAt: nil))
        XCTAssertEqual(PaidVoiceGate.resolve(snapshot: unknownStamp, now: end.addingTimeInterval(86_400)), .notEntitled)
        XCTAssertEqual(PaidVoiceGate.resolve(snapshot: unknownStamp, now: end.addingTimeInterval(-60)), .entitled, "끝 전")
        XCTAssertEqual(
            PaidVoiceGate.resolve(snapshot: snapshot(response(subscription()), promo: promo(fetchedAt: nil)), now: end.addingTimeInterval(86_400)),
            .entitled,
            "활성 구독 행은 여전히 이긴다"
        )
    }

    /// 프로모가 끝났다고 **실제 구독자**를 떨어뜨리지 않는다 — 프로모는 원시 free 에만 붙는다.
    func test_gate_realSubscriptionUnaffectedWithoutPromo() {
        let paid = snapshot(response(subscription()), promo: nil)
        XCTAssertEqual(PaidVoiceGate.resolve(snapshot: paid, now: end.addingTimeInterval(86_400)), .entitled)
    }

    // MARK: - 4. 이용권 화면: 산 것만 '현재 이용권'

    func test_purchasedPlan_excludesPromo() {
        XCTAssertEqual(promoUser(promo: promo).purchasedPlan, "free")
        XCTAssertEqual(promoUser(promo: nil).purchasedPlan, "plus")
        XCTAssertEqual(promoUser(plan: "family", promo: nil).purchasedPlan, "family")

        // 이용권 화면이 넘기는 값으로 등급을 보면 프로모 계정은 무료 카드가 현재다 —
        // 개인 카드에 결제 버튼이 남고, 전환·환산 문구가 뜨지 않는다.
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
                promo: PersonalPromo(endsAt: endsAt, noticeFrom: nil, fetchedAt: from), now: from, optedOut: false
            ),
            "언제부터인지 모르면 띄우지 않는다"
        )
    }

    /// 날짜는 **서버 값**을 기기 로케일·시간대로 찍는다. 마지막 날은 `ends_at − 1초`,
    /// 뒤의 날은 **그다음 날**이다(두 앱 합의 — `ends_at` 의 날로 찍으면 한국 밖에서
    /// "10월 31일까지 … 10월 31일부터" 가 된다).
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

        for zone in ["America/Los_Angeles", "UTC"] {
            let labels = try XCTUnwrap(PersonalPromoNotice.dayLabels(
                for: promo,
                locale: Locale(identifier: "en_US"),
                timeZone: try XCTUnwrap(TimeZone(identifier: zone))
            ))
            XCTAssertEqual(labels.lastDay, "October 31", zone)
            XCTAssertEqual(labels.firstFreeDay, "November 1", "\(zone) — 마지막 날의 다음 날")
        }

        XCTAssertNil(PersonalPromoNotice.dayLabels(for: PersonalPromo(endsAt: nil, noticeFrom: noticeFrom, fetchedAt: from)))
    }

    func test_noticeStore_isPerAccountAndPerPromo() throws {
        let suite = "personal-promo-notice-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = PersonalPromoNoticeStore(defaults: defaults)

        XCTAssertFalse(store.isOptedOut(userID: "a", promo: promo))
        store.optOut(userID: "a", promo: promo)
        XCTAssertTrue(store.isOptedOut(userID: "a", promo: promo))
        XCTAssertTrue(
            store.isOptedOut(userID: "a", promo: promo(fetchedAt: end.addingTimeInterval(-60))),
            "같은 종료 시각이면 다시 받은 값이어도 같은 안내다"
        )
        XCTAssertFalse(store.isOptedOut(userID: "b", promo: promo), "다른 계정은 아직 안 봤다")

        let extended = PersonalPromo(endsAt: "2026-11-30T15:00:00Z", noticeFrom: "2026-11-23T15:00:00Z", fetchedAt: from)
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

        // 알림 센터·제어 센터·시스템 권한 팝업 — 들어온 것이 아니다.
        counter.observe(.inactive)
        XCTAssertFalse(counter.observe(.active))
        XCTAssertEqual(counter.entry, 1)

        // 홈으로 나갔다가 돌아옴.
        counter.observe(.inactive)
        counter.observe(.background)
        counter.observe(.inactive)
        XCTAssertTrue(counter.observe(.active))
        XCTAssertEqual(counter.entry, 2)

        // 같은 active 가 두 번 와도 한 번이다(앱의 두 `onChange` 가 같은 전이를 넘긴다).
        XCTAssertFalse(counter.observe(.active))
        XCTAssertEqual(counter.entry, 2)
    }

    /// 회귀(2026-09-27 리뷰 2차): 계정 요청은 **보낼 때의 진입**을 들고 간다. 앞 진입에 보낸 요청이
    /// 백그라운드를 건너 늦게 도착하면 이번 진입의 답이 아니다(안드로이드 `accountAnswerEntryFor`).
    func test_appEntryCounter_entryForRequest() {
        var counter = AppEntryCounter()
        XCTAssertEqual(counter.entryForRequest, 1, "콜드 스타트의 첫 활성 전 — 세션 복원의 `/auth/me` 는 첫 진입의 답")
        counter.observe(.inactive)
        XCTAssertEqual(counter.entryForRequest, 1)
        counter.observe(.active)
        XCTAssertEqual(counter.entryForRequest, 1)

        counter.observe(.inactive)
        XCTAssertEqual(counter.entryForRequest, 1, "제어 센터 — 같은 진입이다")
        counter.observe(.active)
        let sentInFirstEntry = counter.entryForRequest

        counter.observe(.inactive)
        counter.observe(.background)
        XCTAssertNil(counter.entryForRequest, "백그라운드에서 보낸 요청은 어느 진입의 답도 아니다")
        counter.observe(.inactive)
        XCTAssertEqual(counter.entryForRequest, 2, "돌아오는 길 — 다음 진입의 몫")
        counter.observe(.active)
        XCTAssertEqual(counter.entryForRequest, 2)
        XCTAssertNotEqual(sentInFirstEntry, counter.entryForRequest, "앞 진입의 요청은 이번 진입의 답이 아니다")

        var backgroundLaunch = AppEntryCounter()
        backgroundLaunch.observe(.background)
        XCTAssertNil(backgroundLaunch.entryForRequest, "푸시·배경 작업으로 뜬 프로세스")
        backgroundLaunch.observe(.inactive)
        backgroundLaunch.observe(.active)
        XCTAssertEqual(backgroundLaunch.entry, 1)
        XCTAssertEqual(backgroundLaunch.entryForRequest, 1)
    }

    /// 앱은 같은 전이를 두 `onChange` 로 넘긴다(콜드 스타트용 `initial` · 전경 복귀 처리) —
    /// 두 번 받아도 한 진입이어야 한다. 한 번의 복귀가 두 진입이 되면 복귀의 `/auth/me` 가
    /// 앞 번호로 찍혀 이번 진입의 답이 영영 오지 않는다.
    @MainActor
    func test_appEntrySignal_sameTransitionTwiceIsOneEntry() {
        let signal = AppEntrySignal()
        for phase in [ScenePhase.inactive, .inactive, .active, .active] { signal.observe(phase) }
        XCTAssertEqual(signal.counter.entry, 1)
        for phase in [ScenePhase.inactive, .inactive, .background, .background, .inactive, .active, .active] {
            signal.observe(phase)
        }
        XCTAssertEqual(signal.counter.entry, 2)
        XCTAssertEqual(signal.counter.entryForRequest, 2)
    }

    /// 진입 기록은 **지금 진입의 것**만 읽는다.
    func test_entryAnswer_readsOnlyThisEntrysRecord() {
        XCTAssertEqual(PersonalPromoNotice.entryAnswer(nil, entry: 2), .pending)
        XCTAssertEqual(PersonalPromoNotice.entryAnswer(AccountEntryAnswer(entry: 1, outcome: .answered), entry: 2), .pending)
        XCTAssertEqual(PersonalPromoNotice.entryAnswer(AccountEntryAnswer(entry: 2, outcome: .answered), entry: 2), .arrived)
        XCTAssertEqual(PersonalPromoNotice.entryAnswer(AccountEntryAnswer(entry: 2, outcome: .failed), entry: 2), .failed)
        XCTAssertEqual(PersonalPromoNotice.entryAnswer(AccountEntryAnswer(entry: 0, outcome: .answered), entry: 0), .pending)
    }

    // MARK: - 5-1. 종료 안내 판정(`PersonalPromoNotice.decide`)

    private func inputs(
        entry: Int = 2,
        userID: String? = "user-1",
        promo: PersonalPromo? = nil,
        answer: PersonalPromoNotice.EntryAnswer = .arrived,
        handled: String? = nil,
        optedOut: Bool = false,
        gatesClear: Bool = true,
        otherNoticeOpen: Bool = false,
        sceneActive: Bool = true,
        permissionPending: Bool = false,
        modalPresented: Bool = false
    ) -> PersonalPromoNotice.Inputs {
        PersonalPromoNotice.Inputs(
            gatesClear: gatesClear,
            entry: entry,
            userID: userID,
            promo: promo ?? self.promo,
            accountAnswer: answer,
            handledMarker: handled,
            optedOut: optedOut,
            otherNoticeOpen: otherNoticeOpen,
            sceneActive: sceneActive,
            permissionPromptPending: permissionPending,
            modalPresented: modalPresented
        )
    }

    private var inWindow: Date { from.addingTimeInterval(3_600) }

    func test_decide_showsOncePerEntryAndAccount() {
        XCTAssertEqual(
            PersonalPromoNotice.decide(inputs(), now: inWindow),
            .show(promo, marker: PersonalPromoNotice.marker(entry: 2, userID: "user-1"))
        )
        XCTAssertEqual(
            PersonalPromoNotice.decide(inputs(handled: "2|user-1"), now: inWindow), .skip,
            "같은 진입에서는 한 번"
        )
        XCTAssertEqual(
            PersonalPromoNotice.decide(inputs(userID: "user-2", handled: "2|user-1"), now: inWindow),
            .show(promo, marker: "2|user-2"),
            "같은 진입이라도 다른 계정은 아직 못 봤다"
        )
        XCTAssertEqual(
            PersonalPromoNotice.decide(inputs(entry: 3, handled: "2|user-1"), now: inWindow),
            .show(promo, marker: "3|user-1"),
            "다시 들어오면 또 뜬다"
        )
    }

    /// 회귀(2026-09-27 리뷰): 전경 복귀에서 **이 진입의 `/auth/me` 전에는** 판정하지 않는다 —
    /// 앞 진입에서 캐시한 세션으로 "무료 이용이 곧 끝나요" 를 띄우지 않는다.
    func test_decide_waitsForThisEntrysAccountResponse() {
        XCTAssertEqual(PersonalPromoNotice.decide(inputs(answer: .pending), now: inWindow), .skip)
        XCTAssertEqual(
            PersonalPromoNotice.decide(inputs(answer: .pending, modalPresented: true), now: inWindow), .skip,
            "응답 전에는 기다리는 것도 아니다 — 응답이 오면(키가 바뀌면) 다시 본다"
        )
        XCTAssertEqual(
            PersonalPromoNotice.decide(inputs(answer: .pending, optedOut: true), now: inWindow), .skip,
            "응답 전에는 '띄울 것 없음' 으로도 끝내지 않는다"
        )
    }

    /// 회귀(2026-09-27 리뷰 2차): **한 진입의 판정은 한 번이다.** 이 진입의 응답이 왔는데 띄울 것이
    /// 없으면 그 진입을 끝낸다(`nothingToShow`) — 같은 진입에 뒤늦게 오는 계정 응답(제어 센터를
    /// 닫을 때의 재조회, `notice_from` 을 넘긴 채 켜 둔 앱)이 세션 한가운데서 안내를 띄우지 않는다.
    /// 응답이 **실패**한 진입도 끝난다 — 오프라인으로 들어와 제어 센터에서 와이파이를 켜도 뜨지 않는다.
    func test_decide_endsTheEntryWhenThereIsNothingToShow() {
        let marker = PersonalPromoNotice.marker(entry: 2, userID: "user-1")
        XCTAssertEqual(PersonalPromoNotice.decide(inputs(answer: .failed), now: inWindow), .nothingToShow(marker: marker))
        XCTAssertEqual(
            PersonalPromoNotice.decide(inputs(answer: .failed, modalPresented: true), now: inWindow),
            .nothingToShow(marker: marker),
            "실패한 진입은 기다리지도 않는다"
        )
        XCTAssertEqual(
            PersonalPromoNotice.decide(inputs(), now: from.addingTimeInterval(-60)), .nothingToShow(marker: marker),
            "창 전 — 이 진입은 끝났다"
        )
        XCTAssertEqual(PersonalPromoNotice.decide(inputs(optedOut: true), now: inWindow), .nothingToShow(marker: marker))

        // 끝낸 뒤에는 같은 진입의 어떤 응답으로도 다시 판정하지 않는다 — 창이 열려도.
        XCTAssertEqual(PersonalPromoNotice.decide(inputs(handled: marker), now: inWindow), .skip)
        // 다음 진입은 다시 본다.
        XCTAssertEqual(
            PersonalPromoNotice.decide(inputs(entry: 3, handled: marker), now: inWindow),
            .show(promo, marker: "3|user-1")
        )
    }

    /// 회귀(2026-09-27 리뷰): 다른 모달·시스템 권한 팝업·다른 안내 위에 띄우지 않고 **기다린다**
    /// (skip 이 아니다 — 걷히면 이 진입의 몫으로 뜬다).
    func test_decide_waitsBehindModalsPermissionPromptsAndOtherNotices() {
        XCTAssertEqual(PersonalPromoNotice.decide(inputs(modalPresented: true), now: inWindow), .wait)
        XCTAssertEqual(PersonalPromoNotice.decide(inputs(permissionPending: true), now: inWindow), .wait)
        XCTAssertEqual(PersonalPromoNotice.decide(inputs(sceneActive: false), now: inWindow), .wait)
        XCTAssertEqual(PersonalPromoNotice.decide(inputs(otherNoticeOpen: true), now: inWindow), .wait)
    }

    /// 준비 전이면 진입을 끝내지 않고(`skip`), 준비됐는데 띄울 것이 없으면 끝낸다(`nothingToShow`).
    func test_decide_skipsWhenNotReady_endsWhenNotDue() {
        XCTAssertEqual(PersonalPromoNotice.decide(inputs(gatesClear: false), now: inWindow), .skip)
        XCTAssertEqual(PersonalPromoNotice.decide(inputs(optedOut: true, gatesClear: false), now: inWindow), .skip, "게이트 전에는 끝내지 않는다")
        XCTAssertEqual(PersonalPromoNotice.decide(inputs(entry: 0), now: inWindow), .skip)
        XCTAssertEqual(PersonalPromoNotice.decide(inputs(userID: nil), now: inWindow), .skip)
        let marker = PersonalPromoNotice.marker(entry: 2, userID: "user-1")
        XCTAssertEqual(PersonalPromoNotice.decide(inputs(optedOut: true), now: inWindow), .nothingToShow(marker: marker))
        XCTAssertEqual(PersonalPromoNotice.decide(inputs(), now: from.addingTimeInterval(-1)), .nothingToShow(marker: marker), "창 전")
        XCTAssertEqual(PersonalPromoNotice.decide(inputs(), now: end), .nothingToShow(marker: marker), "끝났다")
        XCTAssertEqual(
            PersonalPromoNotice.decide(inputs(optedOut: true, modalPresented: true), now: inWindow),
            .nothingToShow(marker: marker),
            "띄울 것이 없으면 기다리지도 않는다"
        )
    }

    /// 삭제 대상이 아닌 계정(`deletes_voices_at_end: false`)에도 안내는 뜬다 — 문장만 다르다
    /// (그 갈래는 `RootView` 의 알럿 본문이 고른다).
    func test_decide_showsForAccountsWhoseVoicesAreKept() {
        let kept = promo(fetchedAt: from, deletesVoicesAtEnd: false)
        XCTAssertEqual(
            PersonalPromoNotice.decide(inputs(promo: kept), now: inWindow),
            .show(kept, marker: "2|user-1")
        )
    }

    /// 떠 있는 안내는 **새 계정 응답에 맞춘다**(안드로이드 `reconcileShownPersonalPromoNotice` 와
    /// 같은 규칙) — 결제·쿠폰으로 프로모가 사라진 사람에게 "곧 끝나요" 를 들고 있지 않는다.
    func test_reconcileShown_followsLatestAccountAnswer() {
        let shown = promo
        let now = inWindow
        XCTAssertNil(PersonalPromoNotice.reconcileShown(shown, latest: nil, now: now), "프로모가 사라졌다 — 닫는다")
        XCTAssertNil(PersonalPromoNotice.reconcileShown(shown, latest: shown, now: end), "끝났다 — 닫는다")
        let extended = PersonalPromo(endsAt: "2026-11-30T15:00:00Z", noticeFrom: "2026-11-23T15:00:00Z", fetchedAt: now)
        XCTAssertNil(PersonalPromoNotice.reconcileShown(shown, latest: extended, now: now), "연장됐다 — 옛 안내는 닫는다")
        let kept = promo(fetchedAt: now, deletesVoicesAtEnd: false)
        XCTAssertEqual(
            PersonalPromoNotice.reconcileShown(shown, latest: kept, now: now), kept,
            "같은 끝이면 새 값으로 — 삭제 문장 갈래가 바뀔 수 있다"
        )
    }

    /// 권한 팝업 추적 — 첫 알림 권한 확인이 끝나기 전·요청 중에는 '곧 뜰 수 있다' 다.
    @MainActor
    func test_systemPermissionPrompts_pendingUntilSettledAndWhileInFlight() async {
        let prompts = SystemPermissionPrompts()
        XCTAssertTrue(prompts.isPending, "메인 탭의 첫 알림 권한 확인 전")
        prompts.markNotificationRequestSettled()
        XCTAssertFalse(prompts.isPending)

        var sawPending = false
        await prompts.track {
            sawPending = prompts.isPending
        }
        XCTAssertTrue(sawPending, "요청이 떠 있는 동안")
        XCTAssertFalse(prompts.isPending, "끝나면 내린다")

        struct Denied: Error {}
        _ = try? await prompts.track { throw Denied() }
        XCTAssertFalse(prompts.isPending, "실패해도 내린다")
    }
}
