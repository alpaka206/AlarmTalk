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
    /// - Returns: 실제로 해제됐는가. ⚠ **실패를 삼키지 말 것**(Codex #699 P2) —
    ///   호출부가 이 값으로 "다시 시도해야 하는가" 를 판단한다. 실패했는데 성공으로
    ///   보고하면 로그아웃 복구 표시가 지워져 **기기가 떠난 계정에 묶인 채 영구히** 남는다.
    ///   같은 이유로 **실패 시 기기 토큰 캐시도 비우지 않는다** — 그 값이 없으면 다음
    ///   시도가 무엇을 지워야 할지 모른다.
    @discardableResult
    func unregisterCurrentToken(authToken: String) async -> Bool {
        guard let deviceToken = lastRegisteredToken?.nilIfBlank else {
            // 올린 적이 없다 — 지울 것도 없으므로 끝난 것으로 본다.
            clearRegistrationCache()
            return true
        }
        do {
            try await AlarmTalkAPI.shared.unregisterPushToken(token: deviceToken, authToken: authToken)
            clearRegistrationCache()
            return true
        } catch {
            return false
        }
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
        // ⚠ **푸시 해제 훅도 launch 에서 꽂는다**(Codex #699 P2). 예전에는 화면의
        // `.task(id: 세션)` 안에서 꽂았는데, 그 태스크는 **알림 권한 팝업을 먼저 기다린다.**
        // 그 사이 '끊긴 로그아웃 이어서 끝내기' 가 먼저 도달하면 기본값(아무것도 안 함)이
        // 불려, `/auth/logout` 으로 토큰만 폐기되고 **기기는 그 계정에 묶인 채** 남는다.
        deps.auth.onSignOutUnregisterPush = { [weak push = deps.push] token in
            guard let push else { return false }
            return await push.unregisterCurrentToken(authToken: token)
        }
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
        // ⚠ **강등은 새로고침 자체에 매달려 있다**(`onAuthoritativeRefresh`) — 여기서
        // 또 부르지 말 것. 푸시는 그물이 아니라 **지연 시간**을 줄이는 경로일 뿐이고,
        // 오프라인이라 이 푸시를 놓쳐도 다음 시작·탭 진입의 새로고침이 같은 일을 한다.
        deps.push.onVoiceChanged = {
            // `force` 없이 부르면 진행 중인 새로고침에 막혀 곧바로 돌아온다 —
            // 그러면 철회 이전 목록으로 판단하게 된다(Codex #697 P1).
            await deps.voiceStudio.refresh(session: deps.auth.session, force: true)
        }

        // 접근권을 잃은 목소리를 쓰는 알람을 내리고 예약을 맞춘다.
        // ⚠ **여기 한 곳에서만 꽂는다.** 화면에서 꽂으면 백그라운드로 깨어난 실행에는
        // scene 이 없어 빠진다 — 등록·실행기와 같은 이유다.
        deps.voiceStudio.onAuthoritativeRefresh = {
            // ⚠ **로드 전 저장소로 판단하지 않는다.** 빈 목록은 "강등할 게 없다" 가 아니라
            // "아직 모른다" 다 — 그대로 넘기면 그 회차가 조용히 소진된다.
            //
            // ⚠ **기다리는 자리는 여기 하나다.** 예전에는 주기 사이클에만 대기가 있어서,
            // 콜드 백그라운드 실행에서 **푸시로 온 회차**는 여전히 조용히 삼켜졌다
            // (2026-08-18 Codex #697 P1). 강등으로 가는 모든 경로가 이 훅을 지나므로
            // 여기서 기다리면 호출부가 빠뜨릴 수 없다.
            await deps.alarmStore.waitUntilLoadedFromDisk()
            guard deps.alarmStore.hasLoadedFromDisk else { return }
            let ownerID = deps.auth.session?.user.id
            let degraded = deps.voiceStudio.reconcileInaccessibleVoiceAlarms(
                alarmStore: deps.alarmStore,
                audioCache: .shared,
                ownerUserId: ownerID
            )
            // ⚠ **조용히 바꾸지 말 것.** 이 경로는 화면이 없을 때 도는 일이 많다(주기
            // 사이클·백그라운드 푸시). 알려 주지 않으면 사용자는 어느 날 알람이 기본
            // 알람음으로 바뀐 것만 발견한다. 대기표에 적어 두면 `RootView` 가 보여줄 수
            // 있을 때 모달로 말한다 — 안드로이드 `VoiceAccessSyncWorker` 도 같은 자리에서
            // `SHARED_RELEASED` 를 기록한다(2026-08-18 Codex #697 P2).
            // 원인이 **공유 해제**인 이유: 이 판정은 목록에 없는 목소리를 걸러낸 것이라
            // 플랜 강등(복구되면 돌아온다)과 결말이 다르다 — 다시 공유받아야 한다.
            DowngradeNoticeStore().record(userID: ownerID, cause: .sharedReleased, count: degraded)
            guard degraded > 0 else { return }
            _ = await AlarmScheduleReconciler.reconcile(
                store: deps.alarmStore,
                alarmKit: deps.alarmKit,
                ownerUserId: deps.auth.session?.user.id
            )
        }
        deps.push.onPlanChanged = {
            await deps.socialFeatures.refreshAll(session: deps.auth.session, force: true)
            // ⚠ **스냅샷만 갱신하면 이미 걸린 예약은 그대로다.** 플랜 잠금을 적용하는
            // `applyFreePlanVoiceLockIfNeeded` 는 화면의 `.task` 라 여기서는 돌지 않는다.
            // 대신 리컨사일러를 돌린다 — 그 판정은 `effectiveRecordForScheduling`(유료
            // 게이트)을 거친 지문이라, 방금 갱신된 스냅샷으로 강등이 곧바로 반영된다.
            // 플랜 판정을 여기에 복제하지 않는 이유이기도 하다(복제하면 갈라진다).
            //
            // ⚠ **스냅샷이 반쪽이면 돌리지 않는다.** `refreshAll` 은 갈래마다 따로 실패를
            // 삼켜서, "그룹에서 빠졌다"(새 값) + "구독 없음"(옛 값)이 섞일 수 있다 —
            // 그 상태로 돌리면 지금 유료인 사용자의 목소리 알람이 톤이 된다.
            guard deps.socialFeatures.entitlementSnapshotComplete else { return }
            _ = await AlarmScheduleReconciler.reconcile(
                store: deps.alarmStore,
                alarmKit: deps.alarmKit,
                ownerUserId: deps.auth.session?.user.id
            )
        }

        // 로그아웃·탈퇴 때 OS 예약을 끊고, **떠나는 계정의 행은 함께 끈다**(2026-08-19 지시).
        // 예약 취소는 전부에 걸지만 `enabled = false` 는 떠나는 계정 것만이다 — 남의 계정
        // 행까지 끄면 자동 401 로 세션만 잃은 사람의 알람이 영영 꺼진다(Codex #699 P1).
        // 세션이 끝나기 직전에 소유자 미기록 알람에 그 계정을 새긴다 — 그 뒤로는
        // 누구 것이었는지 알 길이 없다(안드로이드 `claimUnownedAlarmsFor` 의 짝).
        deps.auth.onSessionEndClaimAlarms = { departingUserID in
            // ⚠ **로드를 기다린다.** 콜드 스타트 중이면 `alarms` 가 아직 비어 있어
            // 빈 배열을 새기고 끝난다(Codex #699 P1).
            await deps.alarmStore.waitUntilLoadedFromDisk()
            // ⚠ 그 기다림은 **상한이 있다**(BGTask 예산 때문에 3초). 못 기다렸으면
            // 빈 목록을 새기지 말고 물러선다 — `PendingSignOutStore` 표시가 남아 다음
            // 실행이 마저 한다. 자동 401 은 `SessionExpiryStore` 가 같은 근거가 된다.
            guard deps.alarmStore.hasLoadedFromDisk else { return false }
            deps.alarmStore.claimUnownedAlarms(for: departingUserID)
            return true
        }
        deps.auth.onLeaveAccountStopAlarms = { departingUserID in
            await deps.alarmStore.waitUntilLoadedFromDisk()
            // 못 기다렸으면 **끝내지 못했다고 알린다** — 호출부가 복구 표시를 붙들어 둔다.
            guard deps.alarmStore.hasLoadedFromDisk else { return false }
            _ = await deps.alarmKit.stopAllScheduledAlarms(
                store: deps.alarmStore,
                ownerUserId: departingUserID
            )
            // ⚠ 여기서 표시를 내리지 않는다 — **서버 쪽 뒷정리가 아직 남았다**
            // (푸시 해제·토큰 폐기). `signOutExplicitly` 가 그걸 마친 뒤 내린다.
            return true
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
            alarmKit: deps.alarmKit,
            // 주기 사이클이 목소리 접근권을 다시 받아야 한다(푸시를 놓쳤을 때의 그물).
            voiceStudio: deps.voiceStudio
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
