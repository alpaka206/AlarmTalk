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
            // ⚠ **행이 사라져도 그 행이 남긴 예약은 남는다**(Codex #703 P1). 강등 재예약이
            // 옛 손잡이를 회수 목록에 남긴 뒤 사용자가 그 알람을 지우면(지금 손잡이 취소는
            // 성공했으므로 삭제는 통과한다) 옛 고아는 **어느 행도 가리키지 않은 채** 남는다.
            // 행이 없다고 건너뛰면 그대로 확정되어, 아무도 못 끄는 예약이 회수된 목소리로
            // 운다. 주인 행 id 는 회수 목록에 적혀 있으므로 행 없이도 되짚을 수 있다.
            if await alarmKit.releaseOwedHandles(forAlarmID: id, store: alarmStore) == false {
                settled = false
            }
            // 사라진 행은 그 밖에 확인할 것이 없다.
            guard let record = alarmStore.record(id: id) else { continue }
            // ⚠ **지문이 없던 시절의 예약은 리컨사일러가 건너뛴다.**
            // `needsReschedule` 은 `scheduledSoundFingerprint == nil` 이면 false 를 돌려주는데
            // (옛 행을 함부로 다시 걸지 않으려는 판단), 그대로 '맞았다' 로 읽으면 회수된
            // 목소리를 문 예약을 그대로 둔 채 세대를 확정해 **다시는 고칠 기회가 없다.**
            // 이 경로에서는 직접 다시 건다 — 성공하면 지문이 새겨져 이후 판정도 정상화된다.
            if record.enabled, record.alarmKitID != nil, record.scheduledSoundFingerprint == nil {
                // ⚠ **새로 걸고 나서 옛것을 푼다.** `schedule` 은 새 UUID 로 예약하고 행의
                // 핸들만 갈아 끼우므로, 옛 예약을 취소하지 않으면 **회수된 목소리를 문 예약이
                // 그대로 남는다** — 행에서 핸들이 사라져 다시 손댈 수도 없다.
                // 순서를 뒤집지 않는 이유는 리컨사일러와 같다(실패 시 무예약이 최악).
                let previous = record
                guard await alarmKit.schedule(record: record, store: alarmStore) else {
                    settled = false
                    continue
                }
                if let previousHandle = previous.alarmKitID,
                   alarmStore.record(id: previous.id)?.alarmKitID != previousHandle {
                    // ⚠ **해제 실패는 확정을 미룬다**(Codex #703 P1). 여기서 결과를 버리면
                    // **회수된 목소리를 문 옛 예약이 살아 있는 채로** 세대가 확정되고 그
                    // 목소리가 다시 고를 수 있게 된다 — 표식이 확정된 뒤라 다음 회차가 이
                    // 행을 다시 집지도 않는다. `releaseScheduledAlarm` 은 이미 OS 에 없는
                    // 예약을 성공으로 세므로(그 경우 끊을 것이 없다) 확정을 막지 않는다.
                    if await alarmKit.releaseScheduledAlarm(record: previous) == false {
                        settled = false
                    }
                }
                // 이 행이 예전 회차에 남긴 고아도 함께 되짚는다 — 손잡이는 이미 밀려나
                // 어느 행도 가리키지 않으므로 주인 행 id 로만 찾을 수 있다.
                if await alarmKit.releaseOwedHandles(forAlarmID: record.id, store: alarmStore) == false {
                    settled = false
                }
                continue
            }
            // ⚠ **켜져 있는데 예약이 아예 없으면 끝난 것이 아니다**(Codex #703 P1).
            // `needsReschedule` 은 `alarmKitID == nil` 이면 false 를 돌려준다(옛 행을 함부로
            // 걸지 않으려는 판단) — 그걸 '맞았다' 로 읽으면, 앞서 예약에 실패해 손잡이가 없는
            // 알람이 **OS 예약 없이** 세대만 확정된다. 다음 회차들은 그 세대를 건너뛰므로
            // 그 알람은 무관한 복구가 돌기 전까지 **울지 못한 채** 남는다.
            if record.enabled, record.alarmKitID == nil {
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
            // ⚠ **못 끊은 예약은 지문으로 드러나지 않는다**(Codex #703 P1).
            // 리컨사일러가 다시 걸고 옛 손잡이 취소에 실패하면, 행에는 **새 톤 지문**이
            // 새겨져 `needsReschedule` 이 "맞았다" 고 답한다 — 그대로 확정하면 회수된
            // 목소리를 문 옛 예약이 살아 있는 채로 그 목소리가 다시 고를 수 있게 된다.
            // 회수 목록 확인은 **루프 첫머리에서 행 유무와 무관하게** 이미 했다.
        }
        // ⚠ **예약을 맞춘 결과가 디스크에 남아야 확정이다**(Codex #703 P1). `schedule` 은
        // `markScheduled` 로 새 손잡이·지문을 행에 적지만 그 저장은 **비동기 Task 만 띄운다** —
        // 백그라운드 실행이 그 전에 끝나면 다음 실행은 **옛 손잡이와 옛 지문**을 다시 읽는다.
        // 표식은 이미 확정된 뒤라 그 세대를 다시 집지 않고, 지문이 없던 행은 리컨사일러가
        // 일부러 건너뛰므로 **새로 건 예약이 영영 관리 밖으로 떨어진다.**
        // ⚠ **강등 자체가 실패한 회차는 확정 대상이 아니다**(Codex #703 P1). 프로필 id 만
        // 들고 오므로 아래 `guard` 가 그것을 '정리 중' 으로 올리고 물러선다.
        if pending.failed { settled = false }
        if settled, alarmStore.saveNow() == false { settled = false }
        let stillOwner = auth.session?.user.id == ownerID
        guard settled, stillOwner else {
            // ⚠ **실패하면 그 목소리를 계속 '정리 중' 으로 둔다**(Codex #703 P1).
            // 예전에는 승격 화면만 이 처리를 했는데, 이 함수는 **푸시·새로고침 훅**도 부른다 —
            // 다른 기기나 공유받은 목소리의 교체가 여기서 실패하면 그 목소리가 그대로 고를 수
            // 있는 채 남고, 그때 만든 알람을 다음 재시도가 되돌릴 수 없이 벗긴다.
            // 판정을 호출부마다 두면 언젠가 빠뜨리므로 **실패하는 이 한 곳**에 둔다.
            //
            // ⚠ **단, 계정이 바뀌어서 들어온 회차는 표시를 세우지 않는다**(Codex #703 P2).
            // 이 `guard` 는 '떠난 계정의 회차' 로도 들어오는데, 그때 세우면 **지금 사람의**
            // 화면에서 남의 정리 때문에 목소리가 잠긴다 — 그 사람에게는 풀어 줄 작업 자체가
            // 없다(표식이 앞 계정 것이라 `applyIfChanged` 가 `.nothing` 을 돌려준다).
            // 잃는 것도 없다: 확정하지 못했으므로 `applied` 가 그대로라, 앞 계정이 다시
            // 들어오면 그 세대를 다시 집어 스스로 가린다.
            if !pending.profileID.isEmpty, stillOwner {
                voiceStudio.suppressReplacedProfile(pending.profileID)
            }
            return false
        }
        // ⚠ **다른 세대가 남아 있으면 아직 풀지 않는다**(Codex #703 P1). 이 회차의
        // `unverified` 는 만들어질 때의 스냅샷이라, 그 뒤에 도착한 세대의 칸은 담고 있지
        // 않다 — 그대로 풀면 아직 반영되지 않은 세대의 목소리로 알람을 만들 수 있고
        // 그 세대가 재시도할 때 벗겨진다.
        let allGenerationsSettled = pending.confirm()
        if !pending.profileID.isEmpty {
            if allGenerationsSettled {
                voiceStudio.releaseReplacedProfile(pending.profileID)
            } else {
                voiceStudio.suppressReplacedProfile(pending.profileID)
            }
        }
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
        // 배경 `plan_changed` 경로는 `refreshAll` 하나만 돈다 — 거기서 굴러온 토큰을
        // 세션에 반영하지 않으면 그 기기의 토큰이 수명대로 죽는다(위 뷰모델 주석).
        socialFeatures.onRolledToken = { [weak auth] userID, from, to in
            auth?.applyRolledToken(userID: userID, from: from, to: to)
        }
        // 코드 등록으로 서버 plan 이 올라가도 세션이 free 그대로면 게이트가 잠긴 채 남는다.
        socialFeatures.onFreshPlan = { [weak auth] userID, from, plan in
            auth?.applyFreshPlan(userID: userID, from: from, plan: plan)
        }
        push = PushNotificationCoordinator()
        voiceStudio = VoiceStudioViewModel()
    }
}
