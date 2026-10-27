import Foundation

/// 새 직접 입력 제작이 필요할 때 어디로 가나(`docs/spec/ad-rewards.md` §1-1 표). 안드로이드 `ManualCreationRoute` 와 같다.
///
/// ⚠ **폰에 있는 결과의 재사용은 여기까지 오지 않는다**(폰의 입력 캐시 — 서버를 부르지 않아 세지 않는다). 서버에 남은 내
/// 결과를 다시 받는 것(`cache_hit`)은 2026-10-27 부터 새 제작과 같이 한 번이라, 횟수가 없으면 서버가 같은 429 로 막는다.
/// 이 판정은 서버가 셀 것이 없다고 답한 뒤(429 `MANUAL_TTS_QUOTA_EXCEEDED`)의 갈래다.
enum ManualCreationRoute: Equatable {
    /// 플러스·스토어 체험·관리자 지급 — 월 30회 규칙. 광고를 권하지 않는다.
    case planRules
    /// 무료 월 기본분(3회)이 남았다.
    case useBase
    /// 기본분은 다 썼고 보상 잔액이 있다 — 광고를 다시 보게 하지 않는다.
    case useReward
    /// 끝까지 본 광고의 보상을 서버가 아직 확인 중이다 — '보상을 확인하고 있어요'.
    case rewardPending
    /// 둘 다 0 이고 지금 광고를 볼 수 있다 — '광고 보고 한 번 쓰기' 를 제안한다.
    case offerAd
    /// 이번 달 상한·이 빌드에 광고 없음·스위치 꺼짐·재고 없음 — 다음 제공일·만들어 둔 음성·플러스를 말한다.
    case nextDate
}

/// 무료 사용자의 광고 보상 판정. 안드로이드 `AdRewardGate` 와 같은 표를 쓴다.
enum AdRewardGate {
    /// 지금 광고를 제안할 수 있는가 — 이 빌드에 광고 단위가 있고(없으면 광고 제안 자체를 숨긴다) 서버가 지금 볼 수
    /// 있다고 했을 때만이다(`can_watch`).
    static func canOfferAd(freeTier: Bool, adReward: AdRewardStatus?, adsConfigured: Bool) -> Bool {
        guard freeTier, adsConfigured, let adReward else { return false }
        return adReward.canWatch && adReward.remainingGrants > 0
    }

    /// §1-1 표 그대로. `baseRemaining` 은 이번 달 남은 기본분(모르면 nil — 0 으로 본다).
    static func route(
        freeTier: Bool,
        baseRemaining: Int?,
        adReward: AdRewardStatus?,
        adsConfigured: Bool
    ) -> ManualCreationRoute {
        if !freeTier { return .planRules }
        if (baseRemaining ?? 0) > 0 { return .useBase }
        if (adReward?.credits ?? 0) > 0 { return .useReward }
        if (adReward?.pending ?? 0) > 0 { return .rewardPending }
        if canOfferAd(freeTier: freeTier, adReward: adReward, adsConfigured: adsConfigured) { return .offerAd }
        return .nextDate
    }

    /// 다음 광고 보상이 생기는 날(서버의 `next_grant_at`)을 KST 날짜로 — 서버의 월 경계가 KST 다. 못 읽으면 nil.
    static func formattedNextGrantDate(_ iso: String?, locale: Locale = .current) -> String? {
        guard let iso, let date = ISO8601DateFormatter().date(from: iso) else { return nil }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = TimeZone(identifier: "Asia/Seoul")
        formatter.dateStyle = .long
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }
}

/// 보상형 광고 앱 ID·광고 단위 ID(`docs/spec/ad-rewards.md` §6). 빌드 설정(`project.yml`·`Local.xcconfig`)이 Info.plist 로
/// 넣은 값만 쓴다 — 코드에 ID 를 적지 않는다.
struct AdMobConfig: Equatable {
    let appID: String
    let rewardedAdUnitID: String

    /// Google 이 공개한 시험용 게시자 — 이 접두의 ID 는 시험 광고다.
    static let googleTestPublisher = "ca-app-pub-3940256099942544"

    /// 광고를 켤 수 있는 설정인가. **비어 있으면 nil** — 광고 제안 자체를 숨기고 SDK 도 시작하지 않는다.
    /// 치환되지 않은 빌드 변수(`$(…)`)도 빈 값이다. Release 에서는 시험용 ID 도 nil 이다 — 시험 광고를 실광고처럼
    /// 보이지 않는다(시험용 단위는 DEBUG 에서만).
    static func resolve(appID: String?, rewardedAdUnitID: String?, isDebugBuild: Bool) -> AdMobConfig? {
        func clean(_ value: String?) -> String? {
            guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !trimmed.isEmpty, !trimmed.hasPrefix("$(") else { return nil }
            return trimmed
        }
        guard let app = clean(appID), let unit = clean(rewardedAdUnitID) else { return nil }
        if !isDebugBuild, app.hasPrefix(googleTestPublisher) || unit.hasPrefix(googleTestPublisher) { return nil }
        return AdMobConfig(appID: app, rewardedAdUnitID: unit)
    }

    /// 이 빌드의 설정.
    static let current: AdMobConfig? = {
        #if DEBUG
        let isDebug = true
        #else
        let isDebug = false
        #endif
        return resolve(
            appID: Bundle.main.object(forInfoDictionaryKey: "GADApplicationIdentifier") as? String,
            rewardedAdUnitID: Bundle.main.object(forInfoDictionaryKey: "ALARMTALK_ADMOB_REWARDED_AD_UNIT_ID") as? String,
            isDebugBuild: isDebug
        )
    }()
}
