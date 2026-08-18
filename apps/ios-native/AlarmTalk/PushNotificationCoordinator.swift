import Foundation
import UIKit
import UserNotifications

/// iOS 푸시 — 기기 토큰 등록과 수신 처리.
///
/// ⚠ **알림 권한과 별개다.** APNs 는 두 종류인데:
///   - **alert push**: 배너를 띄운다 → 알림 권한이 **필요**
///   - **background push**(`content-available`): 앱을 깨워 데이터를 가져오게 한다 → **권한 불필요**
/// 가족 알람은 background 로 온다. 그래서 **알림을 거절한 사용자도 받은 알람이 제때 예약되고
/// 제때 울린다.** 기기 토큰(`registerForRemoteNotifications`)도 권한과 무관하게 받는다.
///
/// ⚠ **`BackgroundSyncTask` 를 대체하지 않는다.** 푸시는 서버→앱 단방향이라 (a) 로컬 변경을
/// 서버로 올리는 것, (b) 날씨·운세 음성 사전 생성, (c) 공휴일off 재무장, (d) 세션 갱신 —
/// 전부 **시각 기반**이라 푸시로는 못 덮는다. 게다가 APNs 는 best-effort 라 오프라인·스로틀링·
/// 강제종료에서 조용히 버려진다. 주기 태스크가 그 그물이다.
/// 둘은 역할이 다르다: **푸시 = 지연 시간, 백그라운드 = 신뢰성.**
///
/// 안드로이드 대응: `fcm/AlarmTalkMessagingService.kt`.
@MainActor
final class PushNotificationCoordinator: NSObject, ObservableObject {

    /// 서버가 보내는 `type` 값. 안드로이드 핸들러와 **같은 문자열**이어야 한다.
    enum PushType: String {
        /// 상대가 나에게 알람을 보냈다 → 즉시 pull 해서 기기에 예약한다.
        case familyAlarm = "family_alarm"
        /// 공유 목소리 목록이 바뀌었다.
        case voiceShareChanged = "voice_share_changed"
        /// 목소리 접근권이 사라졌다(동의 철회·보관 만료).
        case voiceAccessRevoked = "voice_access_revoked"
        /// 플랜이 바뀌었다(강등·복구) → 재조회.
        case planChanged = "plan_changed"
        /// 공유 이용권 결제 실패 — 표시 전용(서버가 alert 로 보낸다).
        case billingHold = "billing_hold"
    }

    /// 푸시가 도착했을 때 할 일. `AlarmTalkApp` 이 꽂는다 —
    /// 이 클래스가 동기화 객체들을 직접 들면 순환 참조가 된다.
    var onFamilyAlarm: () async -> Void = {}
    var onVoiceChanged: () async -> Void = {}
    var onPlanChanged: () async -> Void = {}

    /// 마지막으로 **서버에 올린** 기기 토큰.
    ///
    /// ⚠ **메모리에만 두지 말 것**(2026-08-18 Codex #697 P2). 서버의 `push_tokens` 행은
    /// 앱을 껐다 켜도 남는데 이 값은 매 실행 nil 로 시작한다 — APNs 콜백이 오기 전에
    /// (또는 등록이 실패한 기기에서) 로그아웃하면 지울 토큰을 몰라 **옛 계정에 묶인 채**
    /// 남는다. 그러면 로그아웃한 기기가 그 계정의 알림을 계속 받는다.
    private var lastRegisteredToken: String? {
        get { UserDefaults.standard.string(forKey: Self.lastTokenKey) }
        set {
            if let newValue, !newValue.isEmpty {
                UserDefaults.standard.set(newValue, forKey: Self.lastTokenKey)
            } else {
                UserDefaults.standard.removeObject(forKey: Self.lastTokenKey)
            }
        }
    }

    private var lastRegisteredUserID: String? {
        get { UserDefaults.standard.string(forKey: Self.lastUserKey) }
        set {
            if let newValue, !newValue.isEmpty {
                UserDefaults.standard.set(newValue, forKey: Self.lastUserKey)
            } else {
                UserDefaults.standard.removeObject(forKey: Self.lastUserKey)
            }
        }
    }

    private static let lastTokenKey = "push_last_registered_token"
    private static let lastUserKey = "push_last_registered_user"

    /// 원격 알림 등록을 시작한다. **권한 팝업을 띄우지 않는다** — 토큰만 받는다.
    func start() {
        // 화면 확인 모드에서는 시뮬레이터에 APNs 가 없어 항상 실패한다(로그만 더럽힌다).
        guard !UIPreviewSeed.isEnabled else { return }
        UIApplication.shared.registerForRemoteNotifications()
    }

    /// APNs 가 준 기기 토큰을 서버에 등록한다.
    ///
    /// ⚠ **같은 값을 반복해서 올리지 않는다.** 토큰은 앱 실행마다 전달되는데, 매번 POST 하면
    /// 앱을 열 때마다 불필요한 왕복이 생긴다. 계정이 바뀌면 다시 올린다 — 토큰은 같아도
    /// **주인이 달라지면 서버가 다시 묶어야** 한다(그러지 않으면 앞 계정으로 푸시가 간다).
    func registerToken(_ deviceToken: Data, session: AuthSession?) async {
        guard let session else { return }
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        guard hex != lastRegisteredToken || session.user.id != lastRegisteredUserID else { return }
        do {
            try await AlarmTalkAPI.shared.registerPushToken(
                token: hex,
                platform: "ios",
                authToken: session.token
            )
            lastRegisteredToken = hex
            lastRegisteredUserID = session.user.id
        } catch {
            // 실패해도 앱 흐름을 깨지 않는다 — 다음 실행이 다시 시도한다.
            // 잃는 것은 푸시의 즉시성뿐이고, 주기 동기화가 그물로 남아 있다.
        }
    }

    /// 로그아웃·탈퇴 신청 때 **이 기기 토큰을 서버에서 지운다.**
    ///
    /// ⚠ 안 지우면 로그아웃한 기기가 그 계정의 푸시를 계속 받는다 — 결제 보류·목소리
    /// 삭제 같은 **눈에 보이는 알림**까지 온다. 다른 계정이 같은 토큰을 가져갈 때까지
    /// 계속된다(2026-08-18 Codex #697 P2). 안드로이드는 처음부터
    /// `AlarmTalkMessagingService.unregisterCurrentToken` 으로 이 일을 했다.
    ///
    /// ⚠ **`/auth/logout` 보다 먼저** 불러야 한다(토큰이 아직 유효할 때).
    /// 실패해도 로그아웃은 그대로 진행한다 — 막으면 로그아웃을 못 하게 된다.
    func unregisterCurrentToken(authToken: String) async {
        guard let deviceToken = lastRegisteredToken?.nilIfBlank else {
            clearRegistrationCache()
            return
        }
        try? await AlarmTalkAPI.shared.unregisterPushToken(token: deviceToken, authToken: authToken)
        clearRegistrationCache()
    }

    /// 로그아웃 시 다음 로그인에서 반드시 다시 올리도록 캐시를 비운다.
    func clearRegistrationCache() {
        lastRegisteredToken = nil
        lastRegisteredUserID = nil
    }

    /// 푸시 payload 를 처리한다. background·alert 양쪽에서 불린다.
    ///
    /// - Returns: 새 데이터를 받았는지(백그라운드 fetch 결과 보고용).
    @discardableResult
    func handle(userInfo: [AnyHashable: Any]) async -> Bool {
        guard let raw = userInfo["type"] as? String, let type = PushType(rawValue: raw) else {
            return false
        }
        switch type {
        case .familyAlarm:
            // ⚠ 여기서 pull 하지 않으면 **받은 알람이 기기에 예약되지 않아 안 울린다.**
            // iOS 에는 안드로이드 WorkManager 같은 보장된 주기 실행이 없어서, 이 푸시가
            // 실질적으로 유일한 즉시 경로다.
            await onFamilyAlarm()
            return true
        case .voiceShareChanged, .voiceAccessRevoked:
            await onVoiceChanged()
            return true
        case .planChanged:
            await onPlanChanged()
            return true
        case .billingHold:
            // 표시 전용 — 시스템이 배너를 띄운다. 앱이 할 일은 없다.
            // (짝이 되는 data-only `plan_changed` 가 재조회를 담당한다.)
            return false
        }
    }
}

// MARK: - UIApplicationDelegate

/// SwiftUI `App` 에는 원격 알림 콜백이 없어서 델리게이트가 필요하다.
/// `@UIApplicationDelegateAdaptor` 로 꽂는다.
final class PushAppDelegate: NSObject, UIApplicationDelegate {
    /// `AlarmTalkApp` 이 `@StateObject` 로 들고 있는 것과 **같은 인스턴스**를 꽂아 준다.
    static weak var coordinator: PushNotificationCoordinator?
    /// 세션은 델리게이트가 직접 못 보므로 앱이 최신 값을 여기 넣어 준다.
    static var currentSession: (() -> AuthSession?)?

    /// ⚠ **크래시 리포팅은 여기서 켠다 — 앱에서 가장 이른 훅이다.**
    /// 더 늦게(예: 첫 화면의 `.task`) 켜면 그전에 난 크래시를 못 잡는데, 실행 직후
    /// 크래시야말로 제일 봐야 할 것이다. 안드로이드도 `Application.onCreate` 에서 켠다.
    func application(
        _ application: UIApplication,
        // ⚠ **기본값(`= nil`)을 붙이지 말 것.** 붙여도 컴파일은 되지만 프로토콜 요구사항과
        // 정확히 같은 시그니처가 아니게 될 소지가 있어, 안 불리면 **크래시 리포팅이 조용히
        // 꺼진다** — 안 켜진 걸 알아챌 방법이 없는 종류의 실패다.
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        AlarmTalkLog.startCrashReporting()
        // ⚠ **BGTask 핸들러는 launch 가 끝나기 전에 등록돼 있어야 한다.**
        // 뷰의 `.task` 에서 하면 이 콜백이 반환한 뒤라 늦고, 시스템이 백그라운드
        // 새로고침으로 앱을 깨운 경우에는 scene 이 안 붙어 아예 안 돌 수도 있다
        // (`BackgroundSyncTask.registerLaunchHandler` 주석 참조).
        BackgroundSyncTask.registerLaunchHandler()
        // ⚠ **실행기도 여기서 꽂는다.** 등록만 launch 로 옮기고 실행기를 화면의 `.task` 에
        // 두면, 백그라운드 새로고침만을 위해 깨어난(=scene 이 없는) 실행에서 task 가
        // **붙들린 채 완료조차 되지 않는다**(2026-08-18 Codex #697 P2).
        // 의존성은 화면과 같은 인스턴스다(`BackgroundDependencies`).
        let deps = BackgroundDependencies.shared
        // ⚠ **세션을 여기서 채택한다.** 백그라운드로 깨어난 실행에는 화면이 없어
        // `restoreSession()` 이 돌지 않는다 — 세션이 없으면 받은 알람을 당겨올 토큰이 없어
        // 푸시가 와도 아무 일도 일어나지 않는다. 키체인 읽기는 동기라 여기서 해도 된다.
        deps.auth.adoptStoredSessionIfNeeded()

        // ⚠ **푸시 코디네이터도 launch 에서 꽂는다.** 백그라운드 푸시로 깨어난 콜드
        // 실행에는 scene 이 보장되지 않아, 화면의 `.task` 에서 꽂으면 그 payload 를 그대로
        // 버린다(`.noData`) — 방금 도착한 가족 알람이 다음 폴백까지 예약되지 않는다.
        // 화면이 뜨면 같은 인스턴스에 더 풍부한 핸들러(목소리 스튜디오 등)를 덮어쓴다.
        Self.coordinator = deps.push
        Self.currentSession = { deps.auth.session }
        let launchPull = RemoteAlarmPullSync(
            store: deps.alarmStore,
            alarmKit: deps.alarmKit,
            audioCache: .shared,
            auth: deps.auth
        )
        deps.push.onFamilyAlarm = {
            // 실패는 삼킨다 — 다음 주기 동기화가 그물이다(백그라운드에서 던지면 잃는 게 더 크다).
            _ = try? await launchPull.runOnce()
        }
        // ⚠ **목소리 갈래도 여기서 꽂는다.** 안 꽂으면 `voice_share_changed`·
        // `voice_access_revoked` 가 기본 빈 핸들러로 떨어져 `.newData` 만 돌려주고
        // **아무것도 하지 않는다** — 접근권을 잃은 목소리가 계속 예약된 채 울린다.
        deps.push.onVoiceChanged = {
            await deps.voiceStudio.refresh(session: deps.auth.session)
            if deps.voiceStudio.reconcileInaccessibleVoiceAlarms(
                alarmStore: deps.alarmStore,
                audioCache: .shared
            ) > 0 {
                _ = await AlarmScheduleReconciler.reconcile(
                    store: deps.alarmStore,
                    alarmKit: deps.alarmKit
                )
            }
        }
        deps.push.onPlanChanged = {
            await deps.socialFeatures.refreshAll(session: deps.auth.session, force: true)
            // ⚠ **스냅샷만 갱신하면 이미 걸린 예약은 그대로다.** 플랜 잠금을 적용하는
            // `applyFreePlanVoiceLockIfNeeded` 는 화면의 `.task` 라 여기서는 돌지 않는다.
            // 대신 리컨사일러를 돌린다 — 그 판정은 `effectiveRecordForScheduling`(유료
            // 게이트)을 거친 지문이라, 방금 갱신된 스냅샷으로 강등이 곧바로 반영된다.
            // 플랜 판정을 여기에 복제하지 않는 이유이기도 하다(복제하면 갈라진다).
            _ = await AlarmScheduleReconciler.reconcile(
                store: deps.alarmStore,
                alarmKit: deps.alarmKit
            )
        }

        BackgroundSyncTask.register(
            pull: RemoteAlarmPullSync(
                store: deps.alarmStore,
                alarmKit: deps.alarmKit,
                audioCache: .shared,
                auth: deps.auth
            ),
            push: RemoteAlarmPushSync(store: deps.alarmStore, auth: deps.auth),
            socialFeatures: deps.socialFeatures,
            store: deps.alarmStore,
            alarmKit: deps.alarmKit
        )
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in
            await Self.coordinator?.registerToken(deviceToken, session: Self.currentSession?())
        }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // 시뮬레이터·프로비저닝 미비에서 흔하다. 조용히 넘어간다 — 주기 동기화가 그물이다.
    }

    /// background push 진입점. **이게 없으면 조용한 푸시가 앱을 깨우지 못한다.**
    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any]
    ) async -> UIBackgroundFetchResult {
        guard let coordinator = Self.coordinator else { return .noData }
        let changed = await coordinator.handle(userInfo: userInfo)
        return changed ? .newData : .noData
    }
}
