import Foundation

/// 광고를 불러온 결과 — 못 불러왔으면 왜인지(서버 세션에 그대로 알린다). 안드로이드 `AdLoadResult` 미러.
enum AdLoadResult<Ad> {
    case loaded(Ad)
    /// 재고 없음.
    case noFill
    /// 네트워크·내부 오류 등.
    case failed
    /// 규정 지역에서 동의를 받지 못했다 — 광고를 요청하지 않았다.
    case consentUnavailable
}

/// 광고 한 번을 띄운 결과. 안드로이드 `RewardedAdOutcome` 미러.
enum RewardedAdOutcome: Equatable {
    /// 끝까지 봤다(SDK 의 보상 신호). 보상은 AdMob 서버가 우리 서버로 따로 알린다.
    case earned
    /// 보상 신호 없이 닫혔다.
    case dismissed
    /// 불러왔는데 띄우지 못했다.
    case showFailed
}

/// 광고 한 번을 본 결과 — 편집기가 무엇을 말할지 고른다. 안드로이드 `RewardedWatchResult` 미러.
enum RewardedWatchResult: Equatable {
    /// 끝까지 봤다. 서버 확인(SSV)을 기다린다 — 앱은 적립하지 않는다.
    case earned
    /// 보상 신호 없이 닫혔다. 실패로 말하지 않는다.
    case dismissed
    /// 서버가 세션 발급·시작을 거절했다 — 코드로 문구를 고른다.
    case refused(code: String?)
    /// 볼 수 있는 광고가 없다.
    case noFill
    /// 불러오기·표시 실패·동의 불가.
    case unavailable
}

/// 서버의 시청 승인 세션. 실패는 던진다.
protocol AdRewardSessionClient: Sendable {
    func prepare(adUnit: String) async throws -> AdRewardSessionResponse
    func start(sessionID: String) async throws -> AdRewardSessionResponse
    func close(sessionID: String, outcome: String) async throws
}

/// **광고 한 번의 순서**(`docs/spec/ad-rewards.md` §3 「흐름」): 세션 발급 → 불러오기(SSV 옵션에 계정 PK·승인 id) →
/// **표시 직전** 시작 승인 → 표시 → 끝 알림. 안드로이드 `RewardedAdFlow.watch` 와 같은 순서다.
///
/// - 못 불러오면 시작 승인을 받지 않고 끝을 알린다 — 서버가 예약을 푼다.
/// - 시작 승인이 거절되면 띄우지 않는다.
/// - 끝 알림은 **최선**이다 — 실패해도 결과는 그대로다(서버는 15분 뒤 잠금을 스스로 풀고, 늦은 SSV 도 받는다).
@MainActor
struct RewardedAdFlow<Ad> {
    let client: AdRewardSessionClient
    let adUnit: String
    let load: (_ ssvUserID: String, _ ssvCustomData: String) async -> AdLoadResult<Ad>
    let show: (Ad) async -> RewardedAdOutcome
    let errorCode: (Error) -> String?

    func watch() async -> RewardedWatchResult {
        let prepared: AdRewardSessionResponse
        do {
            prepared = try await client.prepare(adUnit: adUnit)
        } catch {
            return .refused(code: errorCode(error))
        }
        let sessionID = prepared.session.id
        guard !sessionID.isEmpty, let ssv = prepared.ssv, !ssv.userId.isEmpty, !ssv.customData.isEmpty else {
            if !sessionID.isEmpty { await closeQuietly(sessionID, "cancelled") }
            return .unavailable
        }
        let ad: Ad
        switch await load(ssv.userId, ssv.customData) {
        case .loaded(let loaded):
            ad = loaded
        case .noFill:
            await closeQuietly(sessionID, "no_fill")
            return .noFill
        case .failed:
            await closeQuietly(sessionID, "load_failed")
            return .unavailable
        case .consentUnavailable:
            await closeQuietly(sessionID, "cancelled")
            return .unavailable
        }
        do {
            _ = try await client.start(sessionID: sessionID)
        } catch {
            // 서버가 이미 예약을 풀었다(만료·자격 변경) — 띄우지 않는다.
            return .refused(code: errorCode(error))
        }
        let outcome = await show(ad)
        switch outcome {
        case .earned:
            await closeQuietly(sessionID, "earned")
            return .earned
        case .dismissed:
            await closeQuietly(sessionID, "dismissed")
            return .dismissed
        case .showFailed:
            await closeQuietly(sessionID, "show_failed")
            return .unavailable
        }
    }

    private func closeQuietly(_ sessionID: String, _ outcome: String) async {
        try? await client.close(sessionID: sessionID, outcome: outcome)
    }
}

/// 서버 세션 창구 — 토큰을 **부를 때마다** 받는다(백그라운드 갱신으로 바뀐 토큰을 쓰게).
struct LiveAdRewardSessionClient: AdRewardSessionClient {
    let token: @Sendable () async -> String?

    private struct SignedOut: Error {}

    private func bearer() async throws -> String {
        guard let value = await token() else { throw SignedOut() }
        return value
    }

    func prepare(adUnit: String) async throws -> AdRewardSessionResponse {
        try await AlarmTalkAPI.shared.createAdRewardSession(adUnit: adUnit, token: bearer())
    }

    func start(sessionID: String) async throws -> AdRewardSessionResponse {
        try await AlarmTalkAPI.shared.startAdRewardSession(id: sessionID, token: bearer())
    }

    func close(sessionID: String, outcome: String) async throws {
        try await AlarmTalkAPI.shared.closeAdRewardSession(id: sessionID, outcome: outcome, token: bearer())
    }
}
