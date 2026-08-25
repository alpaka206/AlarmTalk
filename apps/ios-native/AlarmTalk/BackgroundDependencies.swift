import Foundation

/// **화면이 없어도 살아 있어야 하는 객체들.**
///
/// ⚠ 왜 싱글턴인가 — `BGTaskScheduler` 가 백그라운드 새로고침을 배달하려고 프로세스를
/// 깨울 때는 **scene 이 붙지 않을 수 있다.** 그러면 SwiftUI 뷰의 `.task` 가 돌지 않아,
/// 의존성을 거기서 만들던 구조에서는 백그라운드 사이클이 실행기를 영영 못 받는다
/// (2026-08-18 Codex #697 P2 — 등록은 launch 로 옮겼는데 실행기가 화면에 매여 있었다).
///
/// ⚠ **여기 담긴 것을 화면에서 또 만들지 말 것.** 같은 파일을 두 `LocalAlarmStore` 가
/// 쓰면 서로의 쓰기를 덮어쓴다. `AlarmTalkApp` 은 이 인스턴스를 `@StateObject` 로 감싸
/// 관찰만 한다.
///
/// 담는 기준은 **백그라운드 사이클(`BackgroundSyncTask`)이 필요로 하는가** 하나다.
/// 화면에서만 쓰는 것(목소리 스튜디오·구독 매니저 등)은 지금대로 화면이 소유한다.
@MainActor
final class BackgroundDependencies {
    static let shared = BackgroundDependencies()

    let alarmStore: LocalAlarmStore
    let alarmKit: AlarmKitViewModel
    let auth: AuthViewModel
    let socialFeatures: SocialFeatureViewModel
    /// 푸시 수신. **화면보다 먼저 살아 있어야 한다** — 백그라운드 푸시로 깨어난 콜드
    /// 실행에는 scene 이 없어, 화면에서 꽂으면 그 payload 를 그대로 버린다.
    let push: PushNotificationCoordinator
    /// 목소리 목록. 접근권 상실 시 알람을 내리는 판단이 여기 있어(`reconcileInaccessible…`)
    /// 백그라운드 푸시에서도 필요하다.
    let voiceStudio: VoiceStudioViewModel

    /**
     * **예약까지 실제로 맞았을 때만** 교체 세대를 확정한다.
     *
     * 강등은 로컬 행만 고치고, 울리는 것은 이미 구워 둔 AlarmKit 예약이다. 재예약이 실패한
     * (또는 실행이 끊긴) 회차에서 확정해 버리면 다음 회차가 같은 세대를 건너뛰어 **회수된
     * 목소리가 예약된 채 남는다.** 확정하지 않으면 다음 회차가 다시 집는다(안전한 방향).
     *
     * 판정은 이 세대로 내린 **그 행들만** 본다 — 전역으로 보면 결정적으로 실패하는 다른 행
     * 하나가 이 세대의 확정을 영영 막는다. 지난 회차에서 확인하지 못하고 넘어온 행도
     * 포함된다(그 행들은 이미 톤이라 다시 강등 대상이 되지 않는다).
     */
    @MainActor
    @discardableResult
    func confirmIfReservationsSettled(
        _ pending: VoiceReplacementMarkerStore.PendingApply,
        ownerID: String?
    ) async -> Bool {
        var settled = true
        for id in pending.unverified {
            // 사라진 행은 확인할 것이 없다.
            guard let record = alarmStore.record(id: id) else { continue }
            // ⚠ **지문이 없던 시절의 예약은 리컨사일러가 건너뛴다.**
            // `needsReschedule` 은 `scheduledSoundFingerprint == nil` 이면 false 를 돌려주는데
            // (옛 행을 함부로 다시 걸지 않으려는 판단), 그대로 '맞았다' 로 읽으면 회수된
            // 목소리를 문 예약을 그대로 둔 채 세대를 확정해 **다시는 고칠 기회가 없다.**
            // 이 경로에서는 직접 다시 건다 — 성공하면 지문이 새겨져 이후 판정도 정상화된다.
            if record.enabled, record.alarmKitID != nil, record.scheduledSoundFingerprint == nil {
                if await alarmKit.schedule(record: record, store: alarmStore) { continue }
                settled = false
                continue
            }
            if AlarmScheduleReconciler.needsReschedule(
                record,
                alarmKit: alarmKit,
                audioCache: .shared
            ) {
                settled = false
            }
        }
        guard settled, auth.session?.user.id == ownerID else { return false }
        pending.confirm()
        // 정리가 끝났으니 그 목소리를 다시 고를 수 있다.
        if !pending.profileID.isEmpty { voiceStudio.releaseReplacedProfile(pending.profileID) }
        return true
    }

    private init() {
        // 화면 확인 모드에서는 표본이 진짜 저장소에 남지 않도록 임시 파일을 쓴다
        // (`UIPreviewSeed.ephemeralAlarmStorageURL` 주석).
        alarmStore = LocalAlarmStore(
            storageURL: UIPreviewSeed.ephemeralAlarmStorageURL,
            loadFromDisk: !UIPreviewSeed.isEnabled
        )
        alarmKit = AlarmKitViewModel()
        auth = AuthViewModel()
        socialFeatures = SocialFeatureViewModel()
        push = PushNotificationCoordinator()
        voiceStudio = VoiceStudioViewModel()
    }
}
