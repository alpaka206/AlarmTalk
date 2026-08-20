import Foundation
import os

/// **행이 바뀌면 예약도 따라간다** — iOS에만 필요한 한 걸음을 한 곳에 모은 것.
///
/// 안드로이드는 울릴 때 우리 코드가 돌아서 그 순간 행을 보고 파일을 고른다
/// (`RingingService` → `resolveBucketClipLocalUri`). iOS는 AlarmKit이 **예약할 때** 사운드
/// 파일을 받아 가고 발사 시점에는 우리 코드가 아예 돌지 않는다. 그래서 행만 고치면
/// **행에는 새 소리가 적혀 있는데 OS는 옛 파일을 그대로 운다.**
///
/// 예전에는 그 재예약을 호출자마다 손으로 붙였고, 실제로 다섯 곳이 빠뜨렸다
/// (동적 문구 갱신·언어 재바인딩·목소리 삭제·조건 갱신 등). 게다가 빠뜨려도 **행은
/// 멀쩡해 보여서** 코드 리뷰로도 테스트로도 잡히지 않고, 실기기에서 다음 알람이 울려야만
/// 드러났다. 그래서 판단을 호출자에게서 걷어내고 여기로 옮긴다:
///
/// > 예약할 때 새긴 소리 지문(`scheduledSoundFingerprint`)과 지금 행의 지문이 다르면
/// > 다시 예약한다.
///
/// 지문은 손으로 관리하는 필드 목록이 아니라 **`AlarmSoundResolver.plan` 의 출력**이다.
/// 소리를 바꾸는 새 필드가 생기면 plan이 그걸 읽는 순간 지문에 저절로 들어온다.
@MainActor
enum AlarmScheduleReconciler {
    private static let logger = Logger(subsystem: "com.alarmtalk.app", category: "ScheduleReconcile")

    /// ⚠ **겹쳐 돌면 취소 불가능한 유령 알람이 남는다.**
    ///
    /// 호출부가 넷이고(전경 복귀·세션 복원·언어 변경·백그라운드 동기화) 콜드 스타트에서는
    /// 그 중 여럿이 거의 동시에 깨어난다. 두 회차가 같은 행을 보면 각자 `schedule` 을 불러
    /// **서로 다른 UUID** 두 개를 만드는데, `markScheduled` 는 마지막 것만 행에 남긴다 →
    /// 먼저 만든 핸들은 어느 행도 가리키지 않아 앱이 영영 취소하지 못하고, 매 회차 같은
    /// 시각에 한 번 더 울린다. 사용자가 그 알람을 끄거나 지워도 남는다.
    private static var isRunning = false

    /// 스테이징이 실패해 **의도한 소리가 실리지 못한** 예약의 표시.
    ///
    /// 이걸 안 남기면 행에는 목소리 지문이 적히고 OS 에는 톤이 실려, 다음 비교가 영원히
    /// 일치한다 — 한 번의 일시적 실패로 목소리 알람이 잠금화면에서 **영구히 톤**이 된다.
    private static let fallbackMarker = "!fallback"

    /// 예약에 실제로 실린 소리의 지문. `plan` 과 `resolution` 이 어긋나면(=스테이징 실패)
    /// 표시를 붙여, 다음 회차가 **한 번 더 시도**하게 한다.
    static func scheduledFingerprint(plan: AlarmSoundPlan, resolution: AlarmSoundResolution) -> String {
        let intended = plan.fingerprint
        switch (plan, resolution) {
        case (.systemDefault, _):
            return intended
        case (_, .bundledNamed):
            return intended
        default:
            // 목소리·알람음을 실으려 했는데 `.cachedAudio`(인앱 폴백)나 `.systemDefault` 로
            // 떨어졌다 — OS 에는 톤이 실렸다.
            return intended + fallbackMarker
        }
    }

    /// 어긋난 예약을 다시 건다.
    ///
    /// ⚠ **소유자 범위 안에서만 건다**(Codex #699 P1). 예전에는 `store.alarms` 를 통째로
    /// 돌았다. 그러면 A 의 세션이 자동 401 로 끊긴 상태에서 B 가 로그인했을 때, 이 sweep 가
    /// **A 의 알람을 B 의 앱에서 다시 예약한다** — 목록에는 안 보이는데 울리고, B 는 끌 수
    /// 없다. 로그인 때 남의 예약을 끊어도(`cancelScheduledAlarmsNotOwnedBy`) 이쪽이 도로
    /// 걸면 소용이 없다. 두 경로는 **같은 범위**를 봐야 한다.
    ///
    /// - Parameter ownerUserId: 지금 로그인한 계정. `nil` 이면 **자동으로 끊긴 계정**
    ///   (`SessionExpiryStore`)으로 되짚고, 그것도 없으면 아무것도 하지 않는다 —
    ///   `AlarmKitViewModel.recoverScheduledAlarms` 와 같은 판정이다.
    /// - Returns: 다시 예약한 알람 수.
    @discardableResult
    static func reconcile(
        store: LocalAlarmStore,
        alarmKit: AlarmKitViewModel,
        audioCache: AudioCacheStore = .shared,
        ownerUserId: String?
    ) async -> Int {
        guard !isRunning else { return 0 }
        isRunning = true
        defer { isRunning = false }

        var repaired = 0
        // 스테이징이 **결정적으로** 실패하는 소스(지원 못 하는 포맷 등)는 다시 걸어도 또
        // 실패한다. 한 회차에 한 번만 시도해 무한 재예약을 막는다 — 다음 트리거(전경 복귀·
        // 백그라운드 동기화)에서 또 한 번 기회가 온다.
        var attempted: Set<String> = []

        let owner = ownerUserId?.nilIfBlank ?? SessionExpiryStore.expiredOwnerUserId
        for snapshot in store.alarms(visibleTo: owner) {
            guard !attempted.contains(snapshot.id) else { continue }

            // ⚠ **반영 직전에 다시 읽는다.** 위 배열은 루프 시작 시점의 **복사본**이고,
            // 아래 `await` 두 개 사이에 다른 경로가 행을 바꾼다. 낡은 값으로 판단하면
            // (a) 그 사이 울리기 시작한 알람을 **취소해 조용해지고**
            // (b) 사용자가 끈 알람을 `markScheduled` 가 다시 켜고
            // (c) 방금 저장한 편집을 옛 시각으로 되돌려 예약한다.
            // 같은 위험을 아는 다른 경로들(recoverScheduledAlarms·WeatherVariantRefreshService·
            // RemoteAlarmPullSync)은 전부 이렇게 다시 읽는다.
            guard let current = store.record(id: snapshot.id) else { continue }
            guard needsReschedule(current, alarmKit: alarmKit, audioCache: audioCache) else { continue }
            // 울리는 중·스누즈 중에는 건드리지 않는다 — 재예약이 지금 울리는 알람을
            // 취소하거나 카운트다운을 날린다.
            guard !isInFlight(current) else { continue }
            // 다른 경로가 같은 행을 재예약하는 중이면 비켜선다(위 `isRunning` 과 같은 이유).
            guard !alarmKit.isRearmInFlight(current.id) else { continue }

            attempted.insert(current.id)
            let previous = current
            // **새로 예약해 성공한 뒤에** 옛 핸들을 푼다. 순서를 뒤집으면 실패했을 때
            // 알람이 무예약 상태로 남는다 — 안 울리는 방향이라 가장 나쁘다.
            let scheduled = await alarmKit.schedule(record: current, store: store)
            guard scheduled else { continue }
            if let previousHandle = previous.alarmKitID,
               store.record(id: previous.id)?.alarmKitID != previousHandle {
                // 새 핸들이 정상적으로 행에 새겨졌을 때만 옛것을 푼다. 같아졌다면
                // 그 사이 다른 경로가 개입한 것이므로 건드리지 않는다.
                await alarmKit.cancelScheduledAlarm(record: previous)
            }
            repaired += 1
            Self.logger.info("Rescheduled stale alarm sound (id: \(previous.id, privacy: .public))")
        }
        if repaired > 0 {
            Self.logger.info("Schedule reconcile repaired \(repaired, privacy: .public) alarm(s)")
        }
        return repaired
    }

    /// 이 행의 예약이 낡았는가.
    ///
    /// `nil` 지문은 **옛 버전이 만든 행**이다(이 기능 이전에 예약된 것). 그건 어긋났다고
    /// 보지 않는다 — 앱을 올리자마자 전 알람을 재예약하면 첫 전경 진입이 뻣뻣해지고,
    /// 어차피 다음 저장·회전·갱신에서 지문이 새겨진다.
    static func needsReschedule(
        _ record: LocalAlarmRecord,
        alarmKit: AlarmKitViewModel,
        audioCache: AudioCacheStore
    ) -> Bool {
        guard record.enabled,
              record.alarmKitID != nil,
              let scheduled = record.scheduledSoundFingerprint else { return false }
        let effective = alarmKit.effectiveRecordForScheduling(record)
        return AlarmSoundResolver.plan(for: effective, audioCache: audioCache).fingerprint != scheduled
    }

    /// 울리는 중이거나 스누즈 중.
    static func isInFlight(_ record: LocalAlarmRecord) -> Bool {
        record.runtimeStateEnum == .ringing || record.runtimeStateEnum == .snoozed
    }
}
