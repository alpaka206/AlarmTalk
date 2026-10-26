import XCTest
@testable import AlarmTalk

/// 광고 보상 판정(`docs/spec/ad-rewards.md` §1-1 표) — 안드로이드 `AdRewardGateTest`·`RewardedAdFlowTest` 와 같은 표를 지킨다.
final class AdRewardGateTests: XCTestCase {
    private func reward(
        credits: Int = 0,
        remaining: Int = 10,
        pending: Int = 0,
        canWatch: Bool = true,
        reason: String? = nil,
        next: String? = nil
    ) -> AdRewardStatus {
        AdRewardStatus(
            credits: credits,
            remainingGrants: remaining,
            monthlyLimit: 10,
            pending: pending,
            canWatch: canWatch,
            unavailableReason: reason,
            nextGrantAt: next
        )
    }

    func test_plusTrialOrAdminGrantUsesPlanRulesWithoutAds() {
        XCTAssertEqual(AdRewardGate.route(freeTier: false, baseRemaining: 0, adReward: reward(), adsConfigured: true), .planRules)
    }

    func test_baseThenRewardBalance() {
        XCTAssertEqual(AdRewardGate.route(freeTier: true, baseRemaining: 2, adReward: reward(credits: 1), adsConfigured: true), .useBase)
        XCTAssertEqual(AdRewardGate.route(freeTier: true, baseRemaining: 0, adReward: reward(credits: 1), adsConfigured: true), .useReward)
    }

    func test_pendingRewardIsNotAskedToWatchAgain() {
        XCTAssertEqual(AdRewardGate.route(freeTier: true, baseRemaining: 0, adReward: reward(pending: 1), adsConfigured: true), .rewardPending)
    }

    func test_offerOnlyWhenServerAndBuildAllow() {
        XCTAssertEqual(AdRewardGate.route(freeTier: true, baseRemaining: 0, adReward: reward(), adsConfigured: true), .offerAd)
        // 빈 운영 ID — 광고 제안 자체를 숨긴다.
        XCTAssertEqual(AdRewardGate.route(freeTier: true, baseRemaining: 0, adReward: reward(), adsConfigured: false), .nextDate)
        XCTAssertEqual(
            AdRewardGate.route(freeTier: true, baseRemaining: 0, adReward: reward(remaining: 0, canWatch: false, reason: "monthly_limit"), adsConfigured: true),
            .nextDate
        )
        XCTAssertEqual(
            AdRewardGate.route(freeTier: true, baseRemaining: 0, adReward: reward(canWatch: false, reason: "disabled"), adsConfigured: true),
            .nextDate
        )
        XCTAssertEqual(AdRewardGate.route(freeTier: true, baseRemaining: nil, adReward: nil, adsConfigured: true), .nextDate)
    }

    func test_nextGrantDateIsReadInKST() {
        let formatted = AdRewardGate.formattedNextGrantDate("2026-10-31T15:00:00Z", locale: Locale(identifier: "ko_KR"))
        XCTAssertEqual(formatted, "2026년 11월 1일")
        XCTAssertNil(AdRewardGate.formattedNextGrantDate(nil))
        XCTAssertNil(AdRewardGate.formattedNextGrantDate("not-a-date"))
    }

    func test_adMobConfigHidesAdsWhenEmptyAndRejectsTestIDsInRelease() {
        let realApp = "ca-app-pub-1111111111111111~2222222222"
        let realUnit = "ca-app-pub-1111111111111111/3333333333"
        let testApp = "ca-app-pub-3940256099942544~1458002511"
        let testUnit = "ca-app-pub-3940256099942544/1712485313"
        XCTAssertNil(AdMobConfig.resolve(appID: realApp, rewardedAdUnitID: "", isDebugBuild: false))
        XCTAssertNil(AdMobConfig.resolve(appID: realApp, rewardedAdUnitID: "$(ADMOB_REWARDED_AD_UNIT_ID)", isDebugBuild: false))
        XCTAssertNil(AdMobConfig.resolve(appID: nil, rewardedAdUnitID: realUnit, isDebugBuild: false))
        // 앱 ID 의 기본값은 시험용이다(SDK 가 빈 값이면 죽는다) — Release 에서는 그것만으로 광고를 켜지 않는다.
        XCTAssertNil(AdMobConfig.resolve(appID: testApp, rewardedAdUnitID: realUnit, isDebugBuild: false))
        XCTAssertNil(AdMobConfig.resolve(appID: realApp, rewardedAdUnitID: testUnit, isDebugBuild: false))
        XCTAssertEqual(
            AdMobConfig.resolve(appID: realApp, rewardedAdUnitID: realUnit, isDebugBuild: false),
            AdMobConfig(appID: realApp, rewardedAdUnitID: realUnit)
        )
        // 시험용 단위는 DEBUG 에서만.
        XCTAssertNotNil(AdMobConfig.resolve(appID: testApp, rewardedAdUnitID: testUnit, isDebugBuild: true))
    }

    func test_oldServerAdRewardDecodesToNoOffer() throws {
        let json = #"{"plan_key":"free","limit":3,"used":3,"remaining":0,"ad_reward":{"credits":1,"remaining_grants":9,"monthly_limit":10,"user_id":"pk"}}"#
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let quota = try decoder.decode(ManualQuotaResponse.self, from: Data(json.utf8))
        XCTAssertEqual(quota.adReward?.credits, 1)
        XCTAssertEqual(quota.adReward?.canWatch, false)
        XCTAssertFalse(AdRewardGate.canOfferAd(freeTier: true, adReward: quota.adReward, adsConfigured: true))
    }
}

@MainActor
final class RewardedAdFlowTests: XCTestCase {
    private struct Refusal: Error { let code: String }

    private final class FakeClient: AdRewardSessionClient, @unchecked Sendable {
        var calls: [String] = []
        var prepareError: Error?
        var startError: Error?
        var closeError: Error?

        func prepare(adUnit: String) async throws -> AdRewardSessionResponse {
            calls.append("prepare:\(adUnit)")
            if let prepareError { throw prepareError }
            return AdRewardSessionResponse(
                session: .init(id: "s-1", status: "prepared", granted: false),
                ssv: .init(userId: "pk-1", customData: "s-1")
            )
        }

        func start(sessionID: String) async throws -> AdRewardSessionResponse {
            calls.append("start:\(sessionID)")
            if let startError { throw startError }
            return AdRewardSessionResponse(session: .init(id: sessionID, status: "started", granted: false), ssv: nil)
        }

        func close(sessionID: String, outcome: String) async throws {
            calls.append("close:\(outcome)")
            if let closeError { throw closeError }
        }
    }

    private func flow(
        _ client: FakeClient,
        load: AdLoadResult<String> = .loaded("ad"),
        outcome: RewardedAdOutcome = .earned
    ) -> RewardedAdFlow<String> {
        RewardedAdFlow(
            client: client,
            adUnit: "ca-app-pub-1/123",
            load: { userID, customData in
                client.calls.append("load:\(userID):\(customData)")
                return load
            },
            show: { ad in
                client.calls.append("show:\(ad)")
                return outcome
            },
            errorCode: { ($0 as? Refusal)?.code }
        )
    }

    func test_earnedOrderAndSSVOptionsFromServer() async {
        let client = FakeClient()
        let result = await flow(client).watch()
        XCTAssertEqual(result, .earned)
        XCTAssertEqual(client.calls, ["prepare:ca-app-pub-1/123", "load:pk-1:s-1", "start:s-1", "show:ad", "close:earned"])
    }

    func test_noFillReleasesWithoutStart() async {
        let client = FakeClient()
        let result = await flow(client, load: .noFill).watch()
        XCTAssertEqual(result, .noFill)
        XCTAssertEqual(client.calls, ["prepare:ca-app-pub-1/123", "load:pk-1:s-1", "close:no_fill"])
    }

    func test_dismissedIsNotAFailure() async {
        let client = FakeClient()
        let result = await flow(client, outcome: .dismissed).watch()
        XCTAssertEqual(result, .dismissed)
        XCTAssertEqual(client.calls.last, "close:dismissed")
    }

    func test_refusedPrepareDoesNotLoad() async {
        let client = FakeClient()
        client.prepareError = Refusal(code: "AD_REWARD_SESSION_OPEN")
        let result = await flow(client).watch()
        XCTAssertEqual(result, .refused(code: "AD_REWARD_SESSION_OPEN"))
        XCTAssertEqual(client.calls, ["prepare:ca-app-pub-1/123"])
    }

    func test_refusedStartDoesNotShow() async {
        let client = FakeClient()
        client.startError = Refusal(code: "AD_REWARD_SESSION_INVALID")
        let result = await flow(client).watch()
        XCTAssertEqual(result, .refused(code: "AD_REWARD_SESSION_INVALID"))
        XCTAssertFalse(client.calls.contains { $0.hasPrefix("show") })
        // 시작이 들어갔는지 모르는 실패(연결 끊김·5xx)도 있다 — 닫아서 잠금과 월 자리를 푼다(코덱스 #959).
        XCTAssertEqual(client.calls.last, "close:show_failed")
    }

    func test_closeFailureKeepsResult() async {
        let client = FakeClient()
        client.closeError = URLError(.notConnectedToInternet)
        let result = await flow(client).watch()
        XCTAssertEqual(result, .earned)
    }
}
