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
    /**
     * **제자리 교체로 그 목소리의 직접 입력 음원이 무효가 됐다.**
     *
     * `onVoiceChanged` 로는 부족하다 — 교체는 프로필 행을 재사용해 id 가 목록에 그대로
     * 남으므로 접근권 재확인이 아무것도 걸러내지 못한다. 그래서 서버가 payload 에 어떤
     * 프로필인지를 실어 보내고, 앱이 그 목소리의 custom 알람만 좁혀 내린다.
     *
     * 두 번째 인자는 그 교체의 **세대**다. 이미 반영한 세대면 무시해야 한다 — 늦게 도착한
     * 푸시가 그 사이 사용자가 **새 목소리로** 다시 만든 알람까지 지우면 안 된다.
     */
    var onVoiceReplaced: (String, String?) async -> Void = { _, _ in }
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

    /// 등록/해제를 **한 줄로 세운다.**
    ///
    /// ⚠ 둘 다 네트워크 왕복이라 서로 끼어든다(Codex #699 P2). A 의 해제 요청이 날아가는
    /// 동안 B 가 같은 기기 토큰으로 등록을 마치면, 서버의 `/push/unregister` 는 **토큰만 보고
    /// 지우므로** 뒤늦게 도착한 A 의 요청이 **B 의 새 바인딩을 지운다.** 완료 처리도 B 의
    /// 등록 캐시를 비운다. 주인 검사만으로는 그 창을 못 닫는다 — 검사는 요청 **전에** 하고,
    /// 사고는 요청이 **떠 있는 동안** 나기 때문이다.
    private var pushMutationChain: Task<Void, Never>?

    /// 앞선 등록/해제가 끝난 뒤에 실행한다.
    private func serializePushMutation(_ body: @escaping @MainActor () async -> Void) async {
        let previous = pushMutationChain
        let current = Task { @MainActor in
            await previous?.value
            await body()
        }
        pushMutationChain = current
        await current.value
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
        // ⚠ **중복 판정도 줄을 선 뒤에 한다**(Codex #699 P2). 같은 계정이 다시 로그인할 때,
        // 앞선 **해제**가 아직 줄에 있으면 캐시는 여전히 그 계정을 가리킨다 — 여기서 "이미
        // 올렸다" 며 돌아가면 뒤이어 그 해제가 서버 바인딩을 지우고 캐시까지 비운다.
        // 그러면 **등록해 줄 사람이 아무도 없다**(다음 실행의 APNs 등록까지 푸시를 놓친다).
        await serializePushMutation { [weak self] in
            guard let self else { return }
            guard hex != self.lastRegisteredToken || session.user.id != self.lastRegisteredUserID else { return }
            do {
                try await AlarmTalkAPI.shared.registerPushToken(
                    token: hex,
                    platform: "ios",
                    authToken: session.token
                )
                self.lastRegisteredToken = hex
                self.lastRegisteredUserID = session.user.id
            } catch {
                // 실패해도 앱 흐름을 깨지 않는다 — 다음 실행이 다시 시도한다.
                // 잃는 것은 푸시의 즉시성뿐이고, 주기 동기화가 그물로 남아 있다.
            }
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
    /// - Parameter expectedOwnerUserID: 이 해제가 **어느 계정 몫**인가. 지금 캐시된 기기
    ///   토큰의 주인이 다르면 **아무것도 하지 않는다**(Codex #699 P2).
    ///   서버의 `/push/unregister` 는 **토큰만 보고 지우므로**(`routes/push.ts`), 떠난 계정 A 의
    ///   뒷정리가 지금 B 에게 등록된 그 토큰을 지워 **B 가 가족 알람 푸시를 놓친다.**
    ///   A 의 바인딩은 B 가 등록할 때 서버가 이미 지웠다(`token = ? AND user_id != ?`).
    @discardableResult
    /// - Parameter stillNeeded: **줄을 선 뒤에** 다시 묻는다. 앞선 등록 뒤에 대기하는 사이
    ///   사용자가 탈퇴를 철회하면, 그대로 요청하면 **되살아난 계정의 새 바인딩을 지운다**
    ///   (Codex #699 P2).
    func unregisterCurrentToken(
        authToken: String,
        expectedOwnerUserID: String? = nil,
        stillNeeded: @escaping @Sendable () -> Bool = { true }
    ) async -> Bool {
        // ⚠ **줄부터 선다 — 여기서 미리 판단하지 않는다**(Codex #699 P2). 앞선
        // `registerToken` 이 아직 줄에 있거나 날아가는 중이면 캐시는 **옛 주인**을 가리킨다.
        // 그걸 보고 "내 것이 아니다" 며 그냥 돌아가면, 뒤이어 끝난 그 등록이 **떠난 계정에
        // 기기를 묶어 놓은 채** 남는다 — 뒤에 정리할 사람이 없다.
        var result = false
        await serializePushMutation { [weak self] in
            guard let self else { return }
            // ⚠ **줄을 선 뒤에 다시 본다.** 기다리는 동안 철회되거나 다른 계정이 등록을
            // 마쳤을 수 있다.
            guard stillNeeded() else { result = false; return }
            if let expected = expectedOwnerUserID?.nilIfBlank,
               let current = self.lastRegisteredUserID?.nilIfBlank,
               current != expected {
                result = true
                return
            }
            guard let deviceToken = self.lastRegisteredToken?.nilIfBlank else {
                // 올린 적이 없다 — 지울 것도 없으므로 끝난 것으로 본다.
                self.clearRegistrationCache()
                result = true
                return
            }
            do {
                try await AlarmTalkAPI.shared.unregisterPushToken(token: deviceToken, authToken: authToken)
                self.clearRegistrationCache()
                result = true
            } catch {
                result = false
            }
        }
        return result
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
            // 교체 신호에만 실려 오는 payload. 목록 갱신만으로는 이 알람들을 못 찾는다.
            if type == .voiceAccessRevoked,
               userInfo["scope"] as? String == "custom_messages",
               let profileID = (userInfo["voiceProfileId"] as? String)?.nilIfBlank {
                await onVoiceReplaced(profileID, (userInfo["invalidatedAt"] as? String)?.nilIfBlank)
            }
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
        deps.auth.onSignOutUnregisterPush = { [weak push = deps.push] token, expectedOwner, stillNeeded in
            guard let push else { return false }
            return await push.unregisterCurrentToken(
                authToken: token,
                expectedOwnerUserID: expectedOwner,
                stillNeeded: stillNeeded
            )
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
            _ = await deps.voiceStudio.loadStockClips(session: deps.auth.session, force: true)
            if await deps.voiceStudio.refreshChangedCachedStockClips(session: deps.auth.session).changed {
                await deps.alarmStore.waitUntilLoadedFromDisk()
                _ = await AlarmScheduleReconciler.reconcile(
                    store: deps.alarmStore,
                    alarmKit: deps.alarmKit,
                    ownerUserId: deps.auth.session?.user.id
                )
            }
        }

        // 제자리 교체로 무효가 된 **직접 입력** 알람을 내린다. 위 `onVoiceChanged` 의
        // 목록 갱신·클립 재다운로드로는 못 잡는다 — 프로필 id 가 그대로 살아 있어서
        // 접근권 재확인이 통과시키고, 그 알람의 음원은 서버에서 이미 사라졌다.
        deps.push.onVoiceReplaced = { profileID, generation in
            await deps.alarmStore.waitUntilLoadedFromDisk()
            guard deps.alarmStore.hasLoadedFromDisk else { return }
            let ownerID = deps.auth.session?.user.id
            // ⚠ **이미 반영한 세대면 아무것도 하지 않는다.** 늦게 도착한 푸시는, 그 사이
            // 사용자가 **새 목소리로** 다시 만든 직접 입력 알람까지 되돌릴 수 없이 지운다.
            // 판정·강등·확정은 저장소가 한 임계구역에서 돈다.
            // ⚠ 확정을 미루더라도 **이미 내린 것은 세어 안내한다** — 강등은 이미 일어났고,
            // 그 이유를 말해 줄 곳이 여기뿐이다(다음 회차는 대상이 0이라 셀 것이 없다).
            let pending = VoiceReplacementMarkerStore().applyIfNotApplied(
                userID: ownerID,
                profileID: profileID,
                invalidatedAt: generation
            ) {
                let ids = deps.voiceStudio.degradeCustomMessageAlarms(
                    forProfileID: profileID,
                    alarmStore: deps.alarmStore,
                    audioCache: .shared,
                    ownerUserId: ownerID
                )
                // ⚠ **디스크에 남은 뒤에만 확정 후보가 된다.** 백그라운드 실행은 비동기 쓰기
                // 전에 끝날 수 있고, 그러면 다음 실행이 옛 알람을 다시 읽는데 표식만 앞서 나간다.
                guard deps.alarmStore.saveNow() else { return nil }
                // 그 사이 계정이 바뀌었으면 확정하지 않는다.
                return deps.auth.session?.user.id == ownerID ? ids : nil
            }
            // ⚠ **빈 회차를 그냥 확정하지 말 것.** 지난 회차에서 강등은 됐는데 예약 정리가
            // 실패했다면 그 행들은 이미 톤이라 다시 강등 대상이 아니다 — `unverified` 로
            // 넘어온 그 행들의 예약을 확인한 뒤에야 확정할 수 있다.
            // 위와 같은 이유 — 비동기 정리에 들어가기 전에 먼저 가린다.
            // ⚠ **넘어온 미확인 작업도 가려야 한다**(Codex #703 P1). 지난 실행이 강등은
            // 했는데 예약 정리에 실패했으면, 이번 회차는 내릴 것이 없어 `degraded` 가 비고
            // `unverified` 만 차 있다 — 그 조건을 빼면 예약을 확인하는 내내 그 목소리를 고를
            // 수 있고, 확인이 또 실패하면 그 사이 만든 알람을 다음 재시도가 벗긴다.
            if !pending.profileID.isEmpty,
               !pending.degraded.isEmpty || !pending.unverified.isEmpty || pending.failed {
                deps.voiceStudio.suppressReplacedProfile(pending.profileID)
            }
            // ⚠ **실패한 회차는 반드시 확정 함수를 거친다**(Codex #703 P1). 강등이 실패하면
            // 내린 것도 확인할 것도 없어 아래 빈 회차 갈래로 새는데, 거기서 그냥 `confirm()`
            // 하면 **아무 표시도 남기지 않고** 끝난다 — 그 목소리가 확정 없이 고를 수 있는
            // 채로 남고, 그때 만든 알람을 다음 재시도가 벗긴다. 확정 함수만이 실패를 보고
            // '정리 중' 으로 올린다.
            guard !pending.failed else {
                await deps.confirmIfReservationsSettled(pending, ownerID: ownerID)
                return
            }
            // ⚠ **프리셋 재렌더가 끝나야 이 세대를 확정한다**(Codex #703 P1) — 권위 경로와
            // 같은 게이트다. 이 푸시는 `onVoiceChanged` 뒤에 오므로 목록은 방금 새로 받은
            // 것이고, 그 매니페스트가 '아직 안 구웠다' 고 말하면 여기서 확정하면 안 된다.
            // 확정해 버리면 cron 이 끝난 뒤에도 다음 회차들이 그 세대를 건너뛰어, 완료 푸시를
            // 놓친 기기는 회수된 프리셋을 캐시·예약에 문 채로 남는다.
            let presetPending = deps.voiceStudio.stockClips.contains { !$0.isRenderedForCurrentVoice }
            guard !pending.degraded.isEmpty || !pending.unverified.isEmpty else {
                if !presetPending { pending.confirm() }
                return
            }
            guard !pending.degraded.isEmpty else {
                // 이번엔 새로 내린 것이 없다 — 안내는 생략하고 예약만 확인한다.
                _ = await AlarmScheduleReconciler.reconcile(
                    store: deps.alarmStore,
                    alarmKit: deps.alarmKit,
                    ownerUserId: ownerID
                )
                if !presetPending {
                    await deps.confirmIfReservationsSettled(pending, ownerID: ownerID)
                }
                return
            }
            // 화면이 없을 수 있는 경로다 — 대기표에 적어 두면 다음에 앱을 열 때 말한다.
            DowngradeNoticeStore().record(
                userID: ownerID,
                cause: .voiceReplaced,
                count: pending.degraded.count
            )
            _ = await AlarmScheduleReconciler.reconcile(
                store: deps.alarmStore,
                alarmKit: deps.alarmKit,
                ownerUserId: ownerID
            )
            // ⚠ **예약까지 맞춘 뒤에 확정한다.** 강등은 로컬 행만 고치고 울리는 것은 이미
            // 구워 둔 예약이다 — 여기서 실패했는데 확정하면 다음 회차가 같은 세대를 건너뛰어
            // 회수된 목소리가 예약된 채 남는다. 안 맞으면 확정하지 않고 다음 회차에 맡긴다.
            // 프리셋 재렌더가 남아 있어도 같다(위 `presetPending` 주석).
            if !presetPending {
                await deps.confirmIfReservationsSettled(pending, ownerID: ownerID)
            }
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
            // ⚠ **제자리 교체는 위 대조로 절대 안 걸린다** — 프로필 id 가 그대로 살아 있다.
            // 서버가 준 `custom_audio_invalidated_at` 이 지난번과 다르면 그 목소리의 직접
            // 입력 알람만 내린다. 푸시(`onVoiceReplaced`)는 즉시성만 맡고, **정확성은 이
            // 경로**가 맡는다 — 앱 시작·탭 진입·백그라운드 주기가 모두 여기를 지난다.
            let markers = VoiceReplacementMarkerStore()
            var replacedCount = 0
            // 확정은 아래 예약 정리가 끝난 뒤에 한다(예약이 안 맞으면 하지 않는다).
            var pendingApplies: [VoiceReplacementMarkerStore.PendingApply] = []
            // ⚠ **공유받은 목소리도 본다** — 그 목소리로 만든 내 직접 입력 알람도 함께
            // 무효가 되는데, 내 목록만 보면 공유받은 기기는 푸시를 놓쳤을 때 영영 모른다.
            // ⚠ **가려진 목소리도 본다**(`authoritativeProfiles`) — 정리에 실패해 목록에서
            // 가린 그 프로필이야말로 다시 집어야 할 대상이다. 거른 목록으로 훑으면 사용자에게
            // "새로고침해 주세요" 라고 해 놓고 새로고침이 아무 일도 하지 않는다.
            let markerCandidates: [(id: String, invalidatedAt: String?)] =
                deps.voiceStudio.authoritativeProfiles.map { ($0.id, $0.customAudioInvalidatedAt) } +
                deps.voiceStudio.familyVoices.map { ($0.id, $0.customAudioInvalidatedAt) }
            for candidate in markerCandidates {
                // 판정·강등·확정을 저장소가 함께 잠근다 — 판정만 먼저 해 두면 그 사이 더 새
                // 세대가 반영되고 사용자가 새 목소리로 만든 알람을 뒤늦게 지우게 된다.
                let pending = markers.applyIfChanged(
                    userID: ownerID,
                    profileID: candidate.id,
                    invalidatedAt: candidate.invalidatedAt
                ) {
                    let ids = deps.voiceStudio.degradeCustomMessageAlarms(
                        forProfileID: candidate.id,
                        alarmStore: deps.alarmStore,
                        audioCache: .shared,
                        ownerUserId: ownerID
                    )
                    // 디스크에 남은 뒤에만 확정 후보가 된다(위 푸시 경로와 같은 이유).
                    guard deps.alarmStore.saveNow() else { return nil }
                    // ⚠ 그 사이 계정이 바뀌었으면 확정하지 않는다 — 소유자 불일치로 돌려받은
                    // 0을 '처리 완료' 로 적으면 그 계정은 영영 재시도하지 않는다.
                    return deps.auth.session?.user.id == ownerID ? ids : nil
                }
                // ⚠ **비동기 정리 전에 먼저 가린다**(Codex #703 P1). 아래 예약 정리는
                // `await` 이라, 그 사이 **이미 열려 있는 편집기**가 이 목소리로 알람을
                // 저장할 수 있다 — 정리가 실패하면 다음 회차가 그 새 알람까지 벗긴다.
                // 확정에 성공하면 `confirmIfReservationsSettled` 가 곧바로 푼다.
                // 위 푸시 경로와 같은 이유 — 넘어온 미확인 작업도 가린다(Codex #703 P1).
                if !pending.profileID.isEmpty,
                   !pending.degraded.isEmpty || !pending.unverified.isEmpty || pending.failed {
                    deps.voiceStudio.suppressReplacedProfile(pending.profileID)
                }
                // 확정을 미뤘어도 이미 내린 것은 센다 — 안내는 여기서만 남길 수 있다.
                replacedCount += pending.degraded.count
                pendingApplies.append(pending)
            }
            // ⚠ **조용히 바꾸지 말 것.** 이 경로는 화면이 없을 때 도는 일이 많다(주기
            // 사이클·백그라운드 푸시). 알려 주지 않으면 사용자는 어느 날 알람이 기본
            // 알람음으로 바뀐 것만 발견한다. 대기표에 적어 두면 `RootView` 가 보여줄 수
            // 있을 때 모달로 말한다 — 안드로이드 `VoiceAccessSyncWorker` 도 같은 자리에서
            // `SHARED_RELEASED` 를 기록한다(2026-08-18 Codex #697 P2).
            // 원인이 **공유 해제**인 이유: 이 판정은 목록에 없는 목소리를 걸러낸 것이라
            // 플랜 강등(복구되면 돌아온다)과 결말이 다르다 — 다시 공유받아야 한다.
            // 원인별로 따로 적는다 — 대기표가 우선순위로 합친다(안내할 액션이 있는 쪽이 이긴다).
            // 뭉쳐서 적으면 공유 해제의 안내를 액션 없는 교체 안내로 덮어쓴다.
            let notices = DowngradeNoticeStore()
            notices.record(userID: ownerID, cause: .sharedReleased, count: degraded)
            notices.record(userID: ownerID, cause: .voiceReplaced, count: replacedCount)
            let unverifiedCount = pendingApplies.reduce(0) { $0 + $1.unverified.count }
            // ⚠ **실패한 회차가 하나라도 있으면 빈 회차로 접지 않는다**(Codex #703 P1).
            // 그냥 `confirm()` 하면 아무 표시도 남기지 않고 끝나 그 목소리가 확정 없이
            // 고를 수 있게 된다 — 확정 함수만이 실패를 '정리 중' 으로 올린다.
            let anyFailed = pendingApplies.contains(where: \.failed)
            // ⚠ **강등한 알람이 없어도 세대가 바뀌었으면 캐시를 갱신해야 한다**(Codex #703 P1).
            // 그 목소리를 **프리셋 알람만** 쓰고 있으면 `applyIfChanged` 는 확정 가능한
            // 세대를 빈 목록과 함께 돌려준다 — 여기서 접으면 표식만 확정되고, 다음 회차부터는
            // '이미 반영함' 이라 **캐시와 구워 둔 사운드가 회수된 목소리로 영영 남는다.**
            // ⚠ **배열 길이로 세지 말 것**(Codex #703 P2). 루프는 `.nothing` 회차도 그대로
            // 담으므로, 길이로 보면 목소리를 하나라도 가진 계정에서는 **언제나 참**이 된다 —
            // 콜드 스타트·탭 진입마다 매니페스트를 강제로 다시 받고 예약을 통째로 맞추게 된다.
            // 실제로 뭔가 있었던 회차만 프로필 id 를 들고 온다.
            let markerGenerationChanged = pendingApplies.contains { !$0.profileID.isEmpty }
            guard anyFailed || markerGenerationChanged || degraded + replacedCount + unverifiedCount > 0 else {
                pendingApplies.forEach { _ = $0.confirm() }
                return
            }
            // ⚠ **프리셋 캐시도 여기서 갈아 끼운다**(Codex #703 P1). 예전에는
            // `refreshChangedCachedStockClips` 를 **푸시 콜백에서만** 불렀다 — 교체 푸시를
            // 놓치면(오프라인·스로틀링) 이 경로가 직접 입력 알람만 강등하고, 프리셋 캐시와
            // 거기서 구워 둔 알람 사운드는 **회수된 목소리 그대로** 남는다. 그 알람은 다음
            // 교체 푸시가 올 때까지 옛 목소리로 운다.
            //
            // 여기까지 온 것은 **교체를 실제로 감지했다**는 뜻이라(위 guard), 매 콜드
            // 스타트가 아니라 그때만 도는 비용이다. 매니페스트는 강제로 다시 읽는다 —
            // 캐시된 옛 매니페스트로는 어떤 클립이 바뀌었는지 알 수 없다.
            let manifestFresh = await deps.voiceStudio.loadStockClips(session: deps.auth.session, force: true)
            let presetRefresh = await deps.voiceStudio.refreshChangedCachedStockClips(session: deps.auth.session)
            // ⚠ **프리셋 갱신이 남아 있으면 그 세대를 확정하지 않는다**(Codex #703 P1).
            // 매니페스트를 못 받았거나 낡은 키를 다 갈아 끼우지 못했는데 확정하면, 다음
            // 회차부터 '이미 반영함' 이라 프리셋 알람이 회수된 목소리로 계속 운다.
            let presetWorkSettled = manifestFresh && presetRefresh.settled
            _ = await AlarmScheduleReconciler.reconcile(
                store: deps.alarmStore,
                alarmKit: deps.alarmKit,
                ownerUserId: deps.auth.session?.user.id
            )
            // 예약까지 맞춘 것만 확정한다(위 푸시 경로와 같은 규칙).
            for pending in pendingApplies {
                // ⚠ **프리셋 작업이 남아 있으면 어떤 회차도 확정하지 않는다**(Codex #703 P1).
                // 예전에는 '프리셋만 남은 회차' 로 좁혔는데, 한 목소리를 커스텀 알람과 프리셋
                // 알람이 **함께** 쓰면 커스텀 강등이 성공했다는 이유로 세대가 확정돼 — 다음
                // 회차부터 '이미 반영함' 이라 그 프리셋 알람이 회수된 목소리로 계속 운다.
                // 확정을 미루는 비용은 다음 회차에 같은 일을 한 번 더 하는 것뿐이다(멱등).
                if !presetWorkSettled { continue }
                await deps.confirmIfReservationsSettled(pending, ownerID: ownerID)
            }
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
