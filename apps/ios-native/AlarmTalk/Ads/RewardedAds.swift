import Foundation
import GoogleMobileAds
import UIKit
import UserMessagingPlatform

/// AdMob 보상형 광고 + Google 동의(UMP) — 안드로이드 `ads/RewardedAds.kt` 미러(`docs/spec/ad-rewards.md` §4·§5).
///
/// ⚠ **앱은 보상을 적립하지 않는다.** 끝까지 봤다는 신호(`earned`)는 화면을 이어 가는 데만 쓰고, 보상은 AdMob 서버가
/// 우리 서버의 확인 콜백을 불러 적립한다. 그래서 광고의 `ServerSideVerificationOptions` 에 **서버 승인 세션이 준**
/// 계정 PK(`userIdentifier`)와 승인 id(`customRewardText`)를 싣는다.
///
/// ⚠ **ATT(앱 추적 투명성) 팝업을 띄우지 않는다.** 우리는 IDFA 를 읽지 않고, 추적 동의를 보상 조건으로 만들지 않는다 —
/// ATT 를 묻지 않은 기기에서 SDK 는 IDFA 없이(비추적) 광고를 낸다. IDFA 를 직접 쓰게 되면 그때 ATT 와 처리방침·App Store
/// 개인정보 라벨을 함께 바꾼다(스펙 §5).
///
/// 울림 경로에서는 부르지 않는다 — 광고는 사용자가 편집기에서 고른 순간에만 뜬다(스펙 §2).
/// 불러온 광고 하나 — SDK 타입을 이 파일 밖으로 내보내지 않는다(편집기는 `GoogleMobileAds` 를 가져오지 않는다).
struct RewardedAdHandle {
    fileprivate let ad: RewardedAd
}

@MainActor
final class RewardedAds: NSObject {
    static let shared = RewardedAds()

    /// 이 빌드에 광고 설정이 있는가. 없으면(빈 운영 ID·Release 의 시험용 ID) 광고 제안 자체를 숨기고 SDK 를 건드리지 않는다.
    var configured: Bool { AdMobConfig.current != nil }
    var adUnitID: String { AdMobConfig.current?.rewardedAdUnitID ?? "" }

    private var started = false
    private var showContinuation: CheckedContinuation<RewardedAdOutcome, Never>?
    private var earnedDuringShow = false
    /// 이번 표시가 실제로 뜰 때 한 번 부를 것(`show` 의 `onPresented`).
    private var presentedHandler: (@MainActor () -> Void)?

    // MARK: 동의(UMP)

    /// 이번 실행의 동의 정보를 갱신한다. 실패해도 지난번 정보가 남는다.
    func refreshConsentInfo() async {
        do {
            try await ConsentInformation.shared.requestConsentInfoUpdate(with: RequestParameters())
        } catch {
            AlarmTalkLog.logger.warning("RewardedAds consent update failed: \(String(describing: error), privacy: .public)")
        }
    }

    /// 동의 정보를 갱신하고, 필요하면 양식을 띄운 뒤 광고를 요청해도 되는지 답한다. 규정이 없는 지역은 양식 없이 지난다.
    func gatherConsent(from viewController: UIViewController) async -> Bool {
        await refreshConsentInfo()
        do {
            try await ConsentForm.loadAndPresentIfRequired(from: viewController)
        } catch {
            AlarmTalkLog.logger.warning("RewardedAds consent form failed: \(String(describing: error), privacy: .public)")
        }
        // 갱신이 실패해도 지난번에 받은 동의가 남아 있으면 요청할 수 있다 — 판정은 이 값 하나다.
        return ConsentInformation.shared.canRequestAds
    }

    /// 광고 개인정보 선택을 다시 열 자리가 필요한가(규정 지역에서 Google 이 요구한다). 광고 설정이 없는 빌드는 거짓이다.
    func privacyOptionsRequired() async -> Bool {
        guard configured else { return false }
        await refreshConsentInfo()
        return ConsentInformation.shared.privacyOptionsRequirementStatus == .required
    }

    /// Google 의 광고 개인정보 선택 양식을 띄운다.
    func presentPrivacyOptions() async {
        guard let presenter = Self.topViewController() else { return }
        do {
            try await ConsentForm.presentPrivacyOptionsForm(from: presenter)
        } catch {
            AlarmTalkLog.logger.warning("RewardedAds privacy options failed: \(String(describing: error), privacy: .public)")
        }
    }

    // MARK: 불러오기·표시

    /// 동의를 거쳐 광고를 불러오고 SSV 옵션을 싣는다. 서버의 시작 승인은 이 **뒤**, [show] **앞**에 받는다.
    func load(ssvUserID: String, ssvCustomData: String) async -> AdLoadResult<RewardedAdHandle> {
        guard let config = AdMobConfig.current, !ssvUserID.isEmpty, !ssvCustomData.isEmpty else { return .failed }
        guard let presenter = Self.topViewController() else { return .failed }
        guard await gatherConsent(from: presenter) else { return .consentUnavailable }
        if !started {
            started = true
            _ = await MobileAds.shared.start()
        }
        do {
            let ad = try await RewardedAd.load(with: config.rewardedAdUnitID, request: Request())
            let options = ServerSideVerificationOptions()
            options.userIdentifier = ssvUserID
            options.customRewardText = ssvCustomData
            ad.serverSideVerificationOptions = options
            return .loaded(RewardedAdHandle(ad: ad))
        } catch {
            let ns = error as NSError
            // 재고 없음은 흔하다 — 경보가 아니라 기록만 남긴다.
            AlarmTalkLog.logger.notice("RewardedAds load failed code=\(ns.code, privacy: .public)")
            if ns.domain == GoogleMobileAds.RequestError.errorDomain, ns.code == GoogleMobileAds.RequestError.Code.noFill.rawValue { return .noFill }
            return .failed
        }
    }

    /// 불러온 광고를 띄우고 닫힐 때까지 기다린다. `onPresented` 는 광고가 **실제로 뜰 때** 한 번 불린다(SDK 의
    /// `adWillPresentFullScreenContent`) — 띄울 화면이 없거나 표시에 실패하면 불리지 않는다. 안드로이드 `RewardedAds.show` 의
    /// `onShown` 짝.
    func show(_ handle: RewardedAdHandle, onPresented: @escaping @MainActor () -> Void = {}) async -> RewardedAdOutcome {
        let ad = handle.ad
        guard let presenter = Self.topViewController() else { return .showFailed }
        return await withCheckedContinuation { continuation in
            showContinuation = continuation
            presentedHandler = onPresented
            earnedDuringShow = false
            ad.fullScreenContentDelegate = self
            ad.present(from: presenter) { [weak self] in
                self?.earnedDuringShow = true
            }
        }
    }

    private func finishShow(_ outcome: RewardedAdOutcome) {
        showContinuation?.resume(returning: outcome)
        showContinuation = nil
        presentedHandler = nil
    }

    /// 지금 맨 위 화면 — 시트·알럿이 떠 있으면 그 위에 띄운다.
    static func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let windows = scenes.flatMap(\.windows)
        var top = (windows.first(where: \.isKeyWindow) ?? windows.first)?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
}

// 세 콜백은 SDK 가 메인 스레드에서 부른다(헤더의 `NS_SWIFT_UI_ACTOR`) — 이 클래스의 격리와 같다.
extension RewardedAds: FullScreenContentDelegate {
    func adWillPresentFullScreenContent(_ ad: FullScreenPresentingAd) {
        presentedHandler?()
        presentedHandler = nil
    }

    func adDidDismissFullScreenContent(_ ad: FullScreenPresentingAd) {
        finishShow(earnedDuringShow ? .earned : .dismissed)
    }

    func ad(_ ad: FullScreenPresentingAd, didFailToPresentFullScreenContentWithError error: Error) {
        finishShow(.showFailed)
    }
}
