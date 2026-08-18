import Foundation
import OSLog
import SwiftUI

#if canImport(UIKit)
import UIKit
#endif

#if canImport(AlarmKit)
import AlarmKit
#endif

@MainActor
final class AlarmKitViewModel: ObservableObject {
    private static let paidGateLogger = Logger(subsystem: "com.alarmtalk.app", category: "PaidVoiceGate")

    @Published var authorizationLabel = "확인 전"
    @Published private(set) var alarmAuthorized = false
    /// 권한이 `.denied`/`.restricted` 로 굳어 in-app 재프롬프트가 막힌 상태인지.
    /// true 면 CTA 를 일반 권한 요청 대신 "설정에서 권한 켜기" (openAppSettings) 로 바꿔야 한다.
    /// `.notDetermined` 는 false — 아직 일반 요청 프롬프트로 회복 가능. (Android denied 분기 parity)
    @Published private(set) var permissionRecoveryNeeded = false
    @Published var statusMessage: String?

    /// PR3: 앱 lifetime 동안 살아있는 단일 HolidayStore 를 주입받는다.
    /// AlarmTalkApp 의 @StateObject HolidayStore (AlarmAppContext.holidayPredicate 와
    /// timezone 재무장이 공유하는 그것) 와 동일 인스턴스를 가리켜야, 서버 sync 직후
    /// 로드 윈도우에서 공휴일 집합이 어긋나지 않는다 (Android 단일 holidayCalendarStore parity).
    /// 주입 전(`configure(holidayStore:)` 호출 전)에도 안전하도록 자체 인스턴스로 초기화하고,
    /// AlarmTalkApp 구성 시점에 앱-레벨 store 로 교체한다.
    private var holidayStore = HolidayStore()

    /// AlarmTalkApp 에서 앱-레벨 @StateObject HolidayStore 를 주입한다 (단일 source-of-truth).
    func configure(holidayStore: HolidayStore) {
        self.holidayStore = holidayStore
    }

    /// PR3 FIX: 같은 record 에 대해 재무장(`schedule()`)이 진행 중임을 표시하는 in-flight guard.
    /// rearmIfHolidayOffOneShot 와 recoverScheduledAlarms 두 @MainActor 경로가 동시에
    /// `alarmKitID == nil` guard 를 통과한 뒤 await 지점에서 인터리브되면, 각자 새 `.fixed`
    /// 알람을 schedule 해 미취소 중복이 남고 다음 회차가 이중 발화한다. id 를 await 전에
    /// 넣고 schedule 완료 후 defer 로 제거해, 진행 중인 record 를 concurrent sweep 이 건너뛴다.
    /// 두 경로 모두 @MainActor 격리라 추가 락 없이 안전하다.
    private var rearmInFlight: Set<String> = []

    /// 지금 이 알람을 다른 경로가 재예약하는 중인가.
    ///
    /// ⚠ **예약 경로가 겹치면 취소 불가능한 유령 알람이 남는다.** `schedule` 은 매번 새 UUID를
    /// 만들고 `markScheduled` 는 **마지막 것만** 행에 남기므로, 겹친 쪽의 핸들은 어느 행도
    /// 가리키지 않게 되어 앱이 영영 취소하지 못한다(그 알람은 계속 울린다).
    /// `AlarmScheduleReconciler` 가 이 값을 보고 겹침을 피한다.
    func isRearmInFlight(_ recordID: String) -> Bool { rearmInFlight.contains(recordID) }

    /// AlarmSoundResolver / AlarmVoicePlayer 가 사용하는 캐시.
    /// `AudioCacheStore.shared` 를 의도적으로 instance 로 잡아 두어 테스트 가능성 유지.
    let audioCache: AudioCacheStore = .shared
    /// 유료 목소리 권한 재확인용 로컬 스냅샷. 안드로이드 `RingingService` 가
    /// `AccessSnapshotStore` 를 직접 읽는 것과 같은 방식이다 — 예약은 앱 어느 경로에서나
    /// 일어나므로 주입 경로를 늘리지 않고 여기서 읽는다.
    let accessSnapshotStore = AccessSnapshotStore()

    /// 가장 최근 schedule(...) 호출이 결정한 사운드 전략. ContentView / debug surface
    /// 에서 in-app 폴백 안내 문구를 띄울 때 참조한다. nil = 아직 schedule 호출 없음.
    @Published private(set) var lastSoundResolution: AlarmSoundResolution?

    /// AlarmKit alarmUpdates 가 직전에 emit 한 알람들의 (alarmKitID, state-raw) 스냅샷.
    /// `.alerting` 진입 감지(idempotent) 와 사라짐 감지(dismiss) 를 위해 유지.
    private var lastAlarmStateSnapshot: [String: String] = [:]
    private var observationTask: Task<Void, Never>?

    private static let alarmUnavailableMessage = "이 iOS 버전에서는 알람 기능을 사용할 수 없어요."

    nonisolated static func authorizationDisplayLabel(_ rawValue: String) -> String {
        let normalized = rawValue
            .lowercased()
            .replacingOccurrences(of: "_", with: "")
            .replacingOccurrences(of: " ", with: "")
        if normalized.contains("unavailable") {
            return "사용 불가"
        }
        if normalized.contains("denied")
            || normalized.contains("restricted")
            || normalized.contains("notauthorized") {
            return "거부됨"
        }
        if normalized == "authorized" || normalized.hasSuffix(".authorized") {
            return "허용됨"
        }
        if normalized.contains("notdetermined") || normalized.contains("unknown") {
            return "확인 필요"
        }
        return "확인 필요"
    }

    /// 권한이 거부/제한으로 굳어 in-app 재프롬프트가 막혔는지 판정.
    /// `.notDetermined`/`.unknown`/`.authorized` 는 false — 설정 우회가 불필요.
    /// (Android `firstMissingTarget` 의 denied 분기 parity)
    nonisolated static func isPermissionRecoveryNeeded(_ rawValue: String) -> Bool {
        let normalized = rawValue
            .lowercased()
            .replacingOccurrences(of: "_", with: "")
            .replacingOccurrences(of: " ", with: "")
        if normalized.contains("notdetermined") || normalized.contains("unknown") {
            return false
        }
        return normalized.contains("denied")
            || normalized.contains("restricted")
            || normalized.contains("notauthorized")
    }

    func refreshAuthorizationState() {
        #if canImport(AlarmKit)
        applyAuthorizationState(AlarmManager.shared.authorizationState)
        #else
        authorizationLabel = Self.authorizationDisplayLabel("unavailable")
        alarmAuthorized = true
        permissionRecoveryNeeded = false
        #endif
    }

    /// 권한이 없을 때 **무슨 일이 벌어지는지**를 말한다 — 상태 이름("거부됨")이 아니라 결과다.
    ///
    /// ⚠ **안드로이드와 문구가 반대인 것이 의도다.** 규칙은 양쪽 다 "사실을 말한다" 로 같은데,
    /// 두 OS 의 사실이 다르다:
    ///  - 안드로이드는 권한 셋이 다 없어도 `RingingService` 가 소리·진동을 직접 시작한다.
    ///    그래서 "울리지 않는다" 고 쓰면 멀쩡히 울릴 알람을 없는 것으로 믿고 다른 알람을 또
    ///    맞춘다 — CLAUDE.md 가 그 문구를 금지하는 이유다.
    ///  - **iOS 에는 그 폴백이 없다.** AlarmKit 권한이 없으면 `AlarmManager.schedule` 이 던져
    ///    알람이 **예약조차 되지 않는다**. 울릴 코드가 애초에 돌지 않으므로 정말 안 울린다.
    ///
    /// 그러니 안드로이드 문구("알림만 안 뜬다")를 iOS 로 옮겨 오면 그게 거짓말이 된다.
    nonisolated static let alarmDeniedConsequence = "권한이 없으면 알람이 예약되지 않아 울리지 않아요."

    /// 거부가 굳은 뒤의 안내. **"다시 시도" 라고 하지 않는다** — iOS 는 권한 프롬프트를 한 번만
    /// 띄우므로 눌러도 아무 일이 없다. 유일하게 남은 경로(설정 앱)를 그대로 말한다.
    nonisolated static let alarmRecoveryMessage =
        "설정에서 알람 권한을 켜 주세요. \(alarmDeniedConsequence)"

    /// 울림 알럿 제목 — "오전 7:30 · 아침 알람". 라벨이 없으면 시각만.
    /// 안드로이드 울림 화면이 시각을 가장 크게 보여주는 것에 맞춘 최소 대응이다.
    nonisolated static func alertTitle(for record: LocalAlarmRecord) -> String {
        let time = "\(record.meridiemLabel) \(record.clockLabel12h)"
        let label = record.label.trimmingCharacters(in: .whitespacesAndNewlines)
        return label.isEmpty ? time : "\(time) · \(label)"
    }

    func requestAuthorization() async {
        // 화면 확인 모드에서는 권한 팝업이 화면을 가린다(스크립트로 탭할 방법이 없다).
        if UIPreviewSeed.isEnabled { return }
        #if canImport(AlarmKit)
        do {
            let state = try await AlarmManager.shared.requestAuthorization()
            applyAuthorizationState(state)
            if alarmAuthorized {
            } else if permissionRecoveryNeeded {
                // 프롬프트가 뜨지 않은 채 돌아온 경우다. "다시 시도" 를 안내하면
                // 눌러도 아무 일이 없는 버튼을 계속 누르게 만든다.
                statusMessage = Self.alarmRecoveryMessage
            } else {
                statusMessage = "알람 권한을 허용한 뒤 다시 시도해 주세요."
            }
        } catch {
            statusMessage = "알람 권한을 확인하지 못했어요. 잠시 후 다시 시도해 주세요."
        }
        #else
        statusMessage = Self.alarmUnavailableMessage
        #endif
    }

    func startObserving(store: LocalAlarmStore) async {
        // 화면 확인 모드에서는 구독하지 않는다 — `alarmUpdates` 구독만으로도 시스템이
        // 권한 팝업을 띄워 화면을 가린다.
        if UIPreviewSeed.isEnabled { return }
        #if canImport(AlarmKit)
        refreshAuthorizationState()
        guard observationTask == nil else { return }
        observationTask = Task { [weak self, weak store] in
            guard let self, let store else { return }
            await self.observeAlarmUpdates(store: store)
        }
        #endif
    }

    #if canImport(AlarmKit)
    private func applyAuthorizationState(_ state: AlarmManager.AuthorizationState) {
        let raw = String(describing: state)
        authorizationLabel = Self.authorizationDisplayLabel(raw)
        alarmAuthorized = state == .authorized
        permissionRecoveryNeeded = Self.isPermissionRecoveryNeeded(raw)
    }

    private func observeAlarmUpdates(store: LocalAlarmStore) async {
        for await alarms in AlarmManager.shared.alarmUpdates {
            await processAlarmUpdate(alarms: alarms, store: store)
        }
    }

    /// 한 번의 alarmUpdates emit 을 처리. 별도 메서드로 분리해 테스트 가능성을
    /// 높이고 (직접 Alarm 배열을 주입 가능), 두 책임을 명시한다:
    ///   1. 사라진 alarmKitID -> markStopped (+ dismiss-time 공휴일 재계산/재무장)
    ///   2. 새로 `.alerting` 진입한 alarmKitID -> markRinging
    ///
    /// Apple `Alarm.State` (https://developer.apple.com/documentation/AlarmKit/Alarm/State):
    ///   scheduled / countdown / alerting / paused
    /// 본 메서드는 알람의 `.state` 프로퍼티를 읽어 raw 문자열로 스냅샷한다.
    func processAlarmUpdate(alarms: [Alarm], store: LocalAlarmStore) async {
        let currentSnapshot = Dictionary(
            uniqueKeysWithValues: alarms.map { ($0.id.uuidString, String(describing: $0.state)) }
        )

        // 1. 사라진 알람 = stopped 로 간주.
        //    이전 스냅샷에 있었지만 이번에 없는 ID, 또는 store 에 alarmKitID 가
        //    있고 아직 dismiss 되지 않았는데 currentSnapshot 에 없는 ID 만 검사.
        //    이미 dismissed 인 record 는 알람이 끝난 뒤 store 에 alarmKitID 가
        //    잔존할 수 있어 매 emit 마다 중복 처리하는 것을 막아야 한다.
        let currentIDs = Set(currentSnapshot.keys)
        let previouslyKnownIDs = Set(lastAlarmStateSnapshot.keys)
        let activeStoredIDs: Set<String> = Set(
            store.alarms
                .filter { $0.runtimeStateEnum != .dismissed && $0.runtimeStateEnum != .disabled }
                .compactMap { $0.alarmKitID }
        )

        let disappearedIDs = previouslyKnownIDs
            .union(activeStoredIDs)
            .subtracting(currentIDs)
        let holidayPredicate = holidayStore.holidayPredicate()
        for kitID in disappearedIDs {
            let recordBeforeStop = store.recordByAlarmKitID(kitID)
            // In-app voice fallback 재생 중이면 정지 (AlarmKit 자체 stop 과 별개).
            //
            // ⚠ **무조건 끄지 말 것.** 이 루프는 '목록에서 사라진 알람' 을 도는데,
            // 사용자가 **다른** 알람을 지우거나 끄면 그 알람도 여기 들어온다. 그때
            // 조건 없이 끄면 **지금 울리고 있는 알람의 목소리가 끊긴다**(알람은 계속
            // 울리는데 목소리만 사라져 '왜 목소리가 안 나오지' 로 보인다).
            // 안드로이드 `ringingTeardownBelongsToCurrentAlarm`(Codex #666 P1)과 같은 규칙.
            AlarmAppContext.stopVoiceIfOwnedStatic(by: recordBeforeStop?.id)
            // LiveActivity 가 아닌 경로(앱이 살아있는 채 알람이 사라진 경우)의 stop 도
            // AlarmAppContext 로 수렴시켜 markStopped + dismiss-time 공휴일 재계산/재무장을
            // 한 곳에서 처리한다.
            if recordBeforeStop != nil, let ctx = AlarmAppContext.shared {
                await ctx.handleAlarmStopped(alarmKitIDString: kitID)
            } else {
                // ctx 가 nil 인데 observer 는 살아있는 경로. markStopped 에 공휴일
                // 술어를 넘겨 store 측 fireAtMillis 전진을 공휴일-정확하게 만들고,
                // `.fixed` 서브셋이면 OS 재무장까지 직접 수행한다 (그러지 않으면
                // `.fixed` 알람이 발화 후 다음 recovery sweep 까지 재무장되지 않음).
                store.markStopped(alarmKitID: kitID, isHoliday: holidayPredicate)
                if let stopped = recordBeforeStop, stopped.isHolidayOffRecurring {
                    await rearmIfHolidayOffOneShot(localID: stopped.id, store: store)
                }
            }
        }

        // 2. `.alerting` 진입 감지 = markRinging + voice fallback 재생.
        //    스냅샷 비교: 이전이 nil 또는 비-alerting 이고 현재 alerting 인 경우.
        for alarm in alarms {
            let kitID = alarm.id.uuidString
            let currentStateRaw = String(describing: alarm.state)
            let previousStateRaw = lastAlarmStateSnapshot[kitID]
            let didEnterAlerting =
                currentStateRaw.lowercased().contains("alerting") &&
                previousStateRaw?.lowercased().contains("alerting") != true
            if didEnterAlerting {
                if let record = store.recordByAlarmKitID(kitID) {
                    store.markRinging(id: record.id)
                    // GROUP 3 (6): 포그라운드 ring-time 1회성 햅틱. didEnterAlerting 의
                    // 스냅샷 멱등성으로 ring 당 1회만 진입하므로 별도 가드 불필요. 앱이
                    // 활성(.active)일 때만 발화 — 백그라운드/락스크린에선 AlarmKit/시스템이
                    // 자체 진동을 소유하므로 중복을 피한다 (Android RingingService 진동과 분리).
                    // ⚠ **진동을 '없음' 으로 끈 사용자에게는 울리지 않는다.**
                    // 실제 알람 진동은 시스템이 소유하지만, 이 한 번의 햅틱은 우리가
                    // 내는 것이라 사용자 선택을 따라야 한다(2026-08-07 수정).
                    fireForegroundRingHaptic(for: record)
                    // 30s 초과 또는 트랜스코드 실패로 AlarmKit 가 시스템 톤만 울리는 경우,
                    // 앱이 활성일 때 캐싱된 voice 를 동시 재생한다 (mixWithOthers).
                    //
                    // ⚠ **여기도 유료 게이트를 지나야 한다.** 예약 시점 게이트
                    // (`schedule`)는 AlarmKit 에 넘길 사운드만 강등하고 store 의 원본은
                    // 그대로 두는데, 이 폴백은 그 원본을 다시 읽는다. 게이트를 안 걸면
                    // 구독이 끝난 사용자가 앱을 열어 둔 상태에서 유료 복제 목소리를
                    // 그대로 듣게 된다 — 게이트가 있다고 믿는 바로 그 상황에서 샌다.
                    let snapshot = KeychainStore.readSession()
                        .map { accessSnapshotStore.read(userID: $0.user.id) } ?? .empty
                    let effective = PaidVoiceGate.shouldDowngrade(record: record, snapshot: snapshot)
                        ? PaidVoiceGate.downgraded(record)
                        : record
                    let resolution = AlarmSoundResolver.resolve(for: effective, audioCache: audioCache)
                    if resolution.requiresInAppFallback {
                        AlarmVoicePlayer.shared.playIfNeeded(for: effective, audioCache: audioCache)
                    }
                }
            }
        }

        lastAlarmStateSnapshot = currentSnapshot
    }

    /// GROUP 3 (6): ring-moment 포그라운드 1회성 경고 햅틱.
    /// 호출부(`processAlarmUpdate` 의 didEnterAlerting)가 ring 당 1회만 진입하므로
    /// 멱등성은 그쪽에서 보장된다. 앱이 포그라운드 활성일 때만 발화한다 — 백그라운드/
    /// 락스크린에서는 AlarmKit/시스템이 자체 진동을 소유하기 때문이다.
    private func fireForegroundRingHaptic(for record: LocalAlarmRecord) {
        #if canImport(UIKit)
        guard record.vibrationPatternEnum != .none else { return }
        guard UIApplication.shared.applicationState == .active else { return }
        let generator = UINotificationFeedbackGenerator()
        generator.notificationOccurred(.warning)
        #endif
    }
    #endif

    /// 예약 복구 sweep.
    /// - Parameter forceHolidayOffRecompute: true 면 발화 시각이 미래여도 모든
    ///   enabled `.fixed` 공휴일off one-shot 을 후보에 포함해 절대 시각을 재계산+재무장한다.
    ///   timezone/시간 변경 알림용 — `.fixed` 는 절대 instant 라 새 zone 에 자동 재anchor
    ///   되지 않으므로(어느 방향으로든 이동 가능) 강제 recompute 가 필요하다.
    @discardableResult
    func recoverScheduledAlarms(
        store: LocalAlarmStore,
        forceHolidayOffRecompute: Bool = false
    ) async -> Int {
        #if canImport(AlarmKit)
        let nowMillis = Int64(Date().timeIntervalSince1970 * 1000)
        let holidayPredicate = holidayStore.holidayPredicate()
        let candidates = store.alarms.filter { record in
            record.enabled && (
                record.alarmKitUUID == nil ||
                record.runtimeStateEnum == .failed ||
                // PR3: `.fixed` 공휴일off 반복 one-shot 은 발화 후에도 OS 자동 재무장이
                // 없으므로, 발화 시각이 지난(또는 도달한) 건을 후보에 추가해 prepareFor-
                // ScheduleRecovery 의 과거->advance/failed 분기로 다음 비공휴일 회차를
                // 재무장한다 (Android reschedulePendingAlarms 의 안전망). 네이티브
                // `.relative` 알람은 발화해도 alarmKitID 를 유지하고 AlarmKit 이 recurrence
                // 를 소유하므로 후보에서 제외되어야 한다 (이 술어가 그 분리를 보장).
                (record.isHolidayOffRecurring && record.fireAtMillis <= nowMillis) ||
                // timezone/시간 변경 시: 미래 건도 강제 재계산 (절대 instant 재anchor).
                (forceHolidayOffRecompute && record.isHolidayOffRecurring)
            )
        }
        var recovered = 0

        for record in candidates {
            // PR3 FIX: double-arm race guard. rearmIfHolidayOffOneShot(dismiss 경로)나
            // 또 다른 recovery sweep 가 같은 record 를 await schedule() 중이면 건너뛴다.
            // (`.fixed` one-shot 이 중복 schedule 되어 다음 회차가 이중 발화하는 것을 방지)
            guard !rearmInFlight.contains(record.id) else { continue }
            rearmInFlight.insert(record.id)
            defer { rearmInFlight.remove(record.id) }

            // timezone 강제 recompute 경로: 발화 시각이 아직 미래여도 새 zone 기준으로
            // fireAtMillis 를 다시 박아야 한다. prepareForScheduleRecovery 는 미래 건을
            // 건드리지 않으므로, `.fixed` 서브셋에 한해 setEnabled 로 재계산을 강제한다.
            if forceHolidayOffRecompute,
               record.isHolidayOffRecurring,
               record.fireAtMillis > nowMillis {
                store.setEnabled(id: record.id, enabled: true, nowMillis: nowMillis, isHoliday: holidayPredicate)
            }

            guard let prepared = store.prepareForScheduleRecovery(
                id: record.id,
                nowMillis: nowMillis,
                isHoliday: holidayPredicate
            ) else {
                continue
            }

            let scheduled = await schedule(record: prepared, store: store)
            if scheduled {
                recovered += 1
                if record.alarmKitUUID != nil {
                    _ = await cancelScheduledAlarm(record: record)
                }
            } else {
                store.markFailed(id: prepared.id)
            }
        }

        if recovered > 0 {
            statusMessage = "예약된 알람 \(recovered)개를 다시 연결했어요."
        }
        return recovered
        #else
        statusMessage = Self.alarmUnavailableMessage
        return 0
        #endif
    }

    /// PR3: dismiss 직후 `.fixed` 공휴일off one-shot 을 다음 비공휴일 회차로 재무장한다.
    /// markStopped(sync, store 계층)는 AlarmManager 를 await 할 수 없으므로 실제 OS
    /// 재무장은 async ViewModel 계층에서 수행한다. handleAlarmStopped 와 disappearance
    /// 폴백이 모두 이 헬퍼를 호출해 멱등하게 재무장한다.
    ///
    /// 멱등 guard: markStopped 가 `.fixed` 서브셋에 대해 alarmKitID 를 nil 로 비워
    /// "재무장 필요" 신호를 남긴다. 두 dismiss 경로가 겹쳐도, 먼저 도는 쪽이
    /// schedule() -> markScheduled 로 새 alarmKitID 를 세우면 두 번째는 guard 에서
    /// no-op 이 된다. iOS 판 Android dismiss 의 alarmScheduler.schedule(next).
    func rearmIfHolidayOffOneShot(localID: String, store: LocalAlarmStore) async {
        #if canImport(AlarmKit)
        guard let record = store.record(id: localID) else { return }
        guard record.enabled,
              record.isHolidayOffRecurring,
              record.alarmKitID == nil else { return }
        // PR3 FIX: double-arm race guard. await schedule() 사이에 concurrent sweep 가
        // 같은 nil guard 를 통과해 중복 `.fixed` 를 schedule 하는 것을 막는다.
        guard !rearmInFlight.contains(record.id) else { return }
        rearmInFlight.insert(record.id)
        defer { rearmInFlight.remove(record.id) }
        await schedule(record: record, store: store)
        #endif
    }

    @discardableResult
    func schedule(record: LocalAlarmRecord, store: LocalAlarmStore) async -> Bool {
        // UI 미리보기 모드에서는 실제 예약을 하지 않는다 — 화면을 보려는 것이지 알람을
        // 걸려는 게 아니다. 권한 프롬프트가 떠서 화면을 가리는 것도 막는다.
        //
        // ⚠ 단, `-UIPreviewRingIn` 은 **울리는 것을 보려는** 진입점이라 통과시킨다.
        // 여기서 막으면 그 인자가 아무 일도 하지 않는다.
        if UIPreviewSeed.isEnabled && UIPreviewSeed.ringInSeconds == nil {
            alarmAuthorized = true
            authorizationLabel = "허용됨"
            return true
        }
        #if canImport(AlarmKit)
        do {
            if AlarmManager.shared.authorizationState != .authorized {
                let state = try await AlarmManager.shared.requestAuthorization()
                applyAuthorizationState(state)
                guard state == .authorized else {
                    statusMessage = "알람 권한이 필요해요. 권한을 허용한 뒤 다시 시도해 주세요."
                    return false
                }
            }
            let id = UUID()
            let schedule = makeSchedule(record)
            // Phase 2-B4: playMode + 캐시 상태에 따라 AlarmKit sound 전략 결정.
            // 결과는 lastSoundResolution 으로 expose 하여 ContentView 등이 in-app
            // fallback 안내 문구를 표시할 수 있다.
            // 유료 목소리 권한을 **예약 시점에** 재확인한다.
            //
            // 안드로이드는 RingingService 가 울릴 때 이 판단을 한다. iOS 는 발사 시점에
            // 우리 코드가 돌지 않으므로(AlarmKit 은 해제 시점의 stopIntent 뿐) 예약해 둔
            // 사운드가 그대로 울린다 — 그래서 같은 게이트를 여기로 옮겼다.
            // 강등되어도 **알람 자체는 그대로 울린다**(기본 톤으로). 자세한 근거는 PaidVoiceGate.
            let effectiveRecord = effectiveRecordForScheduling(record)
            if effectiveRecord.playMode != record.playMode {
                Self.paidGateLogger.info(
                    "Free plan at schedule time — downgrading paid voice to alarm tone (id: \(record.id, privacy: .public))"
                )
            }
            let resolution = AlarmSoundResolver.resolve(for: effectiveRecord, audioCache: audioCache)
            lastSoundResolution = resolution
            let configuration = makeConfiguration(
                record: effectiveRecord,
                alarmKitID: id,
                schedule: schedule,
                resolution: resolution
            )
            _ = try await AlarmManager.shared.schedule(id: id, configuration: configuration)

            // ⚠ **await 사이에 행이 바뀌었을 수 있다**(2026-08-18 Codex #697 P1).
            // 예약은 비동기라 그동안 사용자가 알람을 끄거나 지울 수 있고, 그대로
            // `markScheduled` 하면 두 가지가 난다:
            //   - **지운 알람**: `markScheduled` 는 행이 없으면 조용히 no-op 인데, OS 에는
            //     방금 만든 알람이 남는다. 로컬에 핸들이 없어 **취소할 방법도 없는 고아**가
            //     되어 지운 알람이 울린다.
            //   - **끈 알람**: `markScheduled` 가 `enabled = true` 를 **무조건** 쓰므로
            //     사용자가 방금 끈 알람이 도로 켜진다.
            // 그래서 여기서 다시 읽고, 우리가 만든 OS 알람을 되돌린다.
            //
            // 판정은 **await 동안 바뀐 경우만** 본다 — 처음부터 꺼진 행을 예약하는 경로가
            // 따로 있어(잠금 복원 등) `enabled` 를 무조건 요구하면 그쪽이 깨진다.
            let afterAwait = store.record(id: record.id)
            let vanished = afterAwait == nil
            let disabledDuringAwait = record.enabled && afterAwait?.enabled == false
            if vanished || disabledDuringAwait {
                try? await AlarmManager.shared.cancel(id: id)
                Self.paidGateLogger.info(
                    "Alarm changed while scheduling — cancelled the OS alarm (id: \(record.id, privacy: .public))"
                )
                return false
            }

            // **예약과 그 소리의 지문을 함께 적는다.** 나중에 행이 바뀌면
            // `AlarmScheduleReconciler` 가 이 값과 비교해 다시 예약한다 — 그게 없으면
            // 행에는 새 소리가 적혀 있는데 OS 는 옛 파일을 그대로 운다.
            //
            // ⚠ **지문은 '실제로 예약된 것' 이어야 한다.** `plan` 을 다시 계산해 새기면,
            // 스테이징이 실패해 OS 에는 기본 톤이 실렸는데 행에는 목소리 지문이 적힌다 —
            // 그 뒤로는 비교가 **영원히 일치**해서 리컨사일러가 눈이 먼다. 일시적 쓰기 실패
            // 한 번으로 목소리 알람이 잠금화면에서 영구히 톤으로 울린다(자는 동안 인앱
            // 폴백은 돌지 않는다). 그래서 손에 있는 `resolution` 으로 지문을 만든다.
            store.markScheduled(
                localID: record.id,
                alarmKitID: id.uuidString,
                soundFingerprint: AlarmScheduleReconciler.scheduledFingerprint(
                    plan: AlarmSoundResolver.plan(for: effectiveRecord, audioCache: audioCache),
                    resolution: resolution
                )
            )
            statusMessage = describeScheduleStatus(record: record, resolution: resolution)
            return true
        } catch {
            statusMessage = "알람 예약에 실패했어요. 잠시 후 다시 시도해 주세요."
            return false
        }
        #else
        statusMessage = Self.alarmUnavailableMessage
        return false
        #endif
    }

    /// 예약에 실제로 실릴 행 — 유료 목소리 권한을 **예약 시점에** 재확인해 강등한 결과.
    ///
    /// ⚠ **예약과 지문 계산이 같은 행을 봐야 한다.** 한쪽만 강등을 적용하면 지문이 매번
    /// 어긋난 것으로 읽혀 `AlarmScheduleReconciler` 가 무한히 다시 예약한다.
    func effectiveRecordForScheduling(_ record: LocalAlarmRecord) -> LocalAlarmRecord {
        let snapshot = KeychainStore.readSession().map { accessSnapshotStore.read(userID: $0.user.id) } ?? .empty
        return PaidVoiceGate.shouldDowngrade(record: record, snapshot: snapshot)
            ? PaidVoiceGate.downgraded(record)
            : record
    }

    @discardableResult
    func cancelScheduledAlarm(record: LocalAlarmRecord) async -> Bool {
        #if canImport(AlarmKit)
        guard let alarmKitUUID = record.alarmKitUUID else { return true }
        do {
            try AlarmManager.shared.cancel(id: alarmKitUUID)
            // ⚠ **끈 것을 다시 말하지 않는다.** 스위치가 이미 꺼진 상태를 보여 주므로
            // 화면이 이미 답한 것을 한 번 더 말하는 셈이다. 안드로이드에도 이 토스트는 없다.
            // (실패는 결과가 달라지므로 아래 catch 에서 계속 알린다.)
            return true
        } catch {
            statusMessage = "알람 취소에 실패했어요. 잠시 후 다시 시도해 주세요."
            return false
        }
        #else
        statusMessage = Self.alarmUnavailableMessage
        return false
        #endif
    }

    /// 알람을 지운다(사용자가 삭제·스와이프로 부른다).
    ///
    /// ⚠ **취소 실패가 삭제를 막지 않는다**(2026-08-18 수정. 그전에는 막았다).
    ///
    /// `AlarmManager.cancel(id:)` 은 그 id 를 AlarmKit 이 **모를 때 throw** 한다 — 이미
    /// 울리고 끝난 알람, 이미 해제된 알람, 재설치·복구로 남은 낡은 UUID 가 전부 그렇다.
    /// 예전에는 그때 `false` 를 돌려주고 로컬 행을 **남겼다.** 그래서:
    ///
    ///   삭제 → "알람 취소에 실패했어요" → 목록에 그대로 → 또 삭제 → 또 실패 …
    ///
    /// **영영 지울 수 없는 알람**이 된다(2026-08-18 실기기 보고). 게다가 그 실패는
    /// 대개 "이미 예약돼 있지 않다" 는 뜻이라, 남길 이유가 없는데 남긴 셈이다.
    ///
    /// ⚠ 그렇다고 **무조건** 지우면 반대쪽 사고가 난다 — OS 에는 아직 예약이 살아 있는데
    /// 행만 지우면, 끌 수도 지울 수도 없는 알람이 울린다(이 파일 위쪽 주석의 그 상황).
    /// 그래서 **AlarmKit 이 정말 안 들고 있을 때만** 지운다. 판단은 마지막으로 받은
    /// `alarmUpdates` 스냅샷(`lastAlarmStateSnapshot`)으로 한다.
    @discardableResult
    func cancel(record: LocalAlarmRecord, store: LocalAlarmStore) async -> Bool {
        guard let alarmKitUUID = record.alarmKitUUID else {
            deleteLocalAlarm(record, store: store)
            return true
        }
        if await cancelScheduledAlarm(record: record) {
            deleteLocalAlarm(record, store: store)
            return true
        }
        // 취소가 실패했다 — OS 가 이 알람을 아직 들고 있는가?
        //
        // ⚠ **AlarmKit 에 직접 묻는다.** `AlarmManager.alarms` 가 권위 있는 값이다.
        // 예전에는 `lastAlarmStateSnapshot`(마지막 `alarmUpdates` emit 의 캐시)으로 판단했는데,
        // 그 캐시는 취소·예약 때 갱신되지 않고 emit 이 올 때만 바뀐다. 그래서 알람이 울리고
        // 해제된 직후처럼 **emit 이 아직 안 온 창**에서는 "아직 예약돼 있다" 고 잘못 답하고,
        // 사용자에게는 지워지지 않는 알람으로 보인다. 되돌릴 수 없게 느껴지는 판단을
        // 신선도 보장이 없는 값으로 내리고 있었다.
        // 못 물어보면(throws) 그때만 캐시로 폴백한다 — 아무 근거도 없이 막는 것보다 낫다.
        let scheduledIDs: Set<String>
        do {
            scheduledIDs = Set(try AlarmManager.shared.alarms.map { $0.id.uuidString })
        } catch {
            scheduledIDs = Set(lastAlarmStateSnapshot.keys)
        }
        if Self.mayDeleteAfterCancelFailure(
            alarmKitID: alarmKitUUID.uuidString,
            scheduledIDs: scheduledIDs
        ) {
            // 안 들고 있다. 취소할 게 없어서 난 실패이므로 삭제는 그대로 진행한다.
            // 사용자가 원한 결과(목록에서 사라진다)가 정확히 이뤄지므로 사유도 지운다.
            statusMessage = nil
            deleteLocalAlarm(record, store: store)
            return true
        }
        // 정말로 아직 예약돼 있다 — 행을 남기고 알린다. 지우면 못 끄는 알람이 된다.
        return false
    }

    /// 취소가 실패했을 때 **로컬 행을 지워도 되는가.**
    ///
    /// AlarmKit 이 그 id 를 안 들고 있으면(`scheduledIDs` 에 없으면) 취소할 것이 없어서 난
    /// 실패이므로 지워도 된다. 들고 있으면 지우면 안 된다 — **끌 수도 지울 수도 없는 알람**이
    /// 울린다. 순수 함수로 빼 둔 이유는 이 판단이 회귀했을 때 증상이
    /// "영영 안 지워지는 알람" 또는 "안 꺼지는 유령 알람" 둘 다로 나올 수 있어서다.
    /// 회귀 테스트: `AlarmCancelDeletionTests`.
    nonisolated static func mayDeleteAfterCancelFailure(alarmKitID: String, scheduledIDs: Set<String>) -> Bool {
        !scheduledIDs.contains(alarmKitID)
    }

    private func deleteLocalAlarm(_ record: LocalAlarmRecord, store: LocalAlarmStore) {
        if let releasedAudioCacheKey = store.delete(record) {
            try? audioCache.deleteCachedAudio(cacheKey: releasedAudioCacheKey)
        }
    }

    #if canImport(AlarmKit)
    private func makeSchedule(_ record: LocalAlarmRecord) -> Alarm.Schedule {
        // PR3 하이브리드: 반복+공휴일off 알람만 `.fixed` one-shot 으로 무장한다.
        // record.fireAtMillis 는 모든 writer(upsert 호출자/setEnabled/markStopped/
        // prepareForScheduleRecovery/copyAlarm)가 nextFireAtMillis(holidayOff:isHoliday:)
        // 로 이미 공휴일 skip 된 다음 발화 시각을 채워두므로 `.fixed(record.nextFireDate)`
        // 가 정의상 정확하다. AlarmKit 은 단일 절대 one-shot 만 들고, 다음 회차는
        // 앱이 dismiss/recovery/timezone 경로에서 직접 재무장한다.
        if record.isHolidayOffRecurring {
            return .fixed(record.nextFireDate)
        }
        // 그 외는 기존 동작 그대로: 단발 -> .relative(.never), 반복 -> .relative(.weekly).
        // AlarmKit 이 timezone 적응 + 자동 재무장을 소유한다 (blast radius 최소화).
        let time = Alarm.Schedule.Relative.Time(hour: record.hour, minute: record.minute)
        let weekdays = record.repeatDaysMask.repeatDays.compactMap(localeWeekday)
        let recurrence: Alarm.Schedule.Relative.Recurrence = weekdays.isEmpty
            ? .never
            : .weekly(weekdays)
        return .relative(.init(time: time, repeats: recurrence))
    }

    // `nonisolated` — main actor 격리된 self 에 의존하지 않고 순수 입력값으로만
    // configuration 을 만든다. 그래야 결과 `AlarmConfiguration`(Sendable 미보장 타입)
    // 을 AlarmManager 로 sending 할 때 Swift 6 의 region-based isolation 검사가
    // main actor region 에 묶이지 않는다.
    private nonisolated func makeConfiguration(
        record: LocalAlarmRecord,
        alarmKitID: UUID,
        schedule: Alarm.Schedule,
        resolution: AlarmSoundResolution
    ) -> AlarmManager.AlarmConfiguration<AlarmTalkMetadata> {
        typealias AlarmConfiguration = AlarmManager.AlarmConfiguration<AlarmTalkMetadata>
        let stopButton = AlarmButton(text: "알람 끄기", textColor: .white, systemImageName: "stop.fill")
        // GROUP 3 (5): 다시 울림 버튼 라벨에 분을 접어 정직하게 만든다 (Android
        // RingingActivity 의 "N분 더 자기" parity). AlarmKit 제약상 한도 도달 시에도
        // alert 의 보조 버튼 자체는 숨길 수 없고(라벨만 우리가 정할 수 있음),
        // 한도 종료 분기는 SnoozeAlarmIntent.perform() 의 .deny 가 담당한다.
        let snoozeButton = AlarmButton(
            text: LocalizedStringResource(stringLiteral: "\(record.snoozeMinutes)분 더 자기"),
            textColor: .white,
            systemImageName: "moon.zzz.fill"
        )
        // .custom 으로 두어 다시 울림 분기 전체를 SnoozeAlarmIntent 가 결정하게 한다.
        // .countdown 이면 OS 가 secondaryIntent 와 별개로 postAlert countdown 을
        // 자동 재무장하므로, snoozeRepeatLimit 도달 시에도 알람이 계속 되살아난다
        // (Android AlarmRepository.snooze() 의 한도 종료 동작과 어긋남). .custom 은
        // OS 자동 동작을 끄고 우리 intent 가 countdown(id:) / stop(id:) 을 직접 호출.
        // ⚠ **여기가 iOS 에서 우리가 쓸 수 있는 유일한 울림 화면 문구다.** AlarmKit 이
        // 시스템 ALERT UI 를 소유해 안드로이드 `RingingActivity`(전용 잠금화면 씬 —
        // 날짜·104sp 시계·낭독 문구 카드·밀어서 끄기) 를 복제할 수 없다. 그래서 최소한
        // **시각만이라도** 제목에 넣는다 — 라벨 하나만 뜨면 잠결에 어느 알람인지 모른다.
        let alert = AlarmPresentation.Alert(
            title: LocalizedStringResource(stringLiteral: Self.alertTitle(for: record)),
            stopButton: stopButton,
            secondaryButton: snoozeButton,
            secondaryButtonBehavior: .custom
        )
        let countdown = AlarmPresentation.Countdown(
            title: LocalizedStringResource(stringLiteral: "\(record.label) 다시 울릴 준비 중")
        )
        let paused = AlarmPresentation.Paused(
            title: "일시정지됨",
            resumeButton: AlarmButton(text: "다시 시작", textColor: .white, systemImageName: "play.fill")
        )
        let presentation = AlarmPresentation(alert: alert, countdown: countdown, paused: paused)
        // Phase 2-B4: 메타데이터에 playMode + voiceCacheKey 를 실어 LiveActivity /
        // alarmUpdates handler 가 어떤 in-app 폴백 전략을 쓸지 식별 가능.
        // GROUP 3: alarmKitID 를 실어 LiveActivity 가 Stop/Snooze 인텐트를 구성할 수
        // 있게 하고, voiceText 는 Android RingingActivity parity 로 alarm_only 가 아니고
        // 비어있지 않을 때만 실어 LA 가 ring-moment 인용 문구를 보여 줄 수 있게 한다.
        let quotedVoiceText: String? = {
            guard record.playModeEnum != .alarmOnly else { return nil }
            let trimmed = record.voiceText?.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let trimmed, !trimmed.isEmpty else { return nil }
            // ⚠ **delivery 태그를 벗겨서 싣는다.** 이 문구는 잠금화면 alert 과 Live Activity
            // 인용문으로 그대로 보인다 — 태그가 섞이면 대괄호가 화면에 뜬다.
            // 판정은 **출처**다(안드로이드 `RingingActivity.toRingingUiState` 와 같은 축):
            // 생성 문구·테마 클립은 우리가 만든 것이라 벗기고, 직접 입력은 손대지 않는다.
            let generated = record.voiceRandomPrompt || (record.bucketId).nilIfBlank != nil
            return DeliveryTags.strip(trimmed, generated: generated)
        }()
        let metadata = AlarmTalkMetadata(
            localAlarmID: record.id,
            label: record.label,
            playMode: record.playMode,
            voiceCacheKey: record.audioCacheKey,
            alarmKitID: alarmKitID.uuidString,
            voiceText: quotedVoiceText,
            hour: record.hour,
            minute: record.minute
        )
        let attributes = AlarmAttributes(
            presentation: presentation,
            metadata: metadata,
            // GROUP 3 (3): alert tint 를 LA 와 동일한 단일 브랜드 토큰으로 둔다.
            // AlarmTalkTheme.primary 는 AlarmTalkBrand.primaryLight 에서 파생되고,
            // LA 위젯도 AlarmTalkBrand 를 참조하므로 alert tint 와 LA tint 가 동기된다.
            tintColor: AlarmTalkTheme.primary
        )
        let snoozeDuration = Alarm.CountdownDuration(preAlert: nil, postAlert: TimeInterval(record.snoozeMinutes * 60))
        let alertSound = AlarmSoundResolver.makeAlertSound(resolution)
        return AlarmConfiguration(
            countdownDuration: snoozeDuration,
            schedule: schedule,
            attributes: attributes,
            stopIntent: StopAlarmIntent(alarmID: alarmKitID.uuidString),
            secondaryIntent: SnoozeAlarmIntent(alarmID: alarmKitID.uuidString),
            sound: alertSound
        )
    }

    /// schedule(...) 의 statusMessage 문구를 사운드 전략에 맞춰 구성한다.
    private func describeScheduleStatus(
        record: LocalAlarmRecord,
        resolution: AlarmSoundResolution
    ) -> String {
        switch resolution {
        case .systemDefault:
            return "\(record.label) 알람을 예약했어요."
        case .bundledNamed:
            return "\(record.label) 알람을 예약했어요."
        case .cachedAudio(_, let durationMs):
            let seconds = max(1, Int((durationMs + 500) / 1000))
            return "\(record.label) 알람을 예약했어요. \(seconds)초 목소리는 iOS 제한으로 기본 알람음 뒤 앱이 열려 있을 때 재생돼요."
        }
    }

    private func localeWeekday(_ day: RepeatDay) -> Locale.Weekday? {
        switch day {
        case .sunday: return .sunday
        case .monday: return .monday
        case .tuesday: return .tuesday
        case .wednesday: return .wednesday
        case .thursday: return .thursday
        case .friday: return .friday
        case .saturday: return .saturday
        }
    }
    #endif
}
