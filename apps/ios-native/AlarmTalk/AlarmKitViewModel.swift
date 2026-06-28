import Foundation
import SwiftUI

#if canImport(UIKit)
import UIKit
#endif

#if canImport(AlarmKit)
import AlarmKit
#endif

@MainActor
final class AlarmKitViewModel: ObservableObject {
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

    /// AlarmSoundResolver / AlarmVoicePlayer 가 사용하는 캐시.
    /// `AudioCacheStore.shared` 를 의도적으로 instance 로 잡아 두어 테스트 가능성 유지.
    let audioCache: AudioCacheStore = .shared

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

    func requestAuthorization() async {
        #if canImport(AlarmKit)
        do {
            let state = try await AlarmManager.shared.requestAuthorization()
            applyAuthorizationState(state)
            statusMessage = alarmAuthorized
                ? "알람 권한이 허용됐어요."
                : "알람 권한을 허용한 뒤 다시 시도해 주세요."
        } catch {
            statusMessage = "알람 권한을 확인하지 못했어요. 잠시 후 다시 시도해 주세요."
        }
        #else
        statusMessage = Self.alarmUnavailableMessage
        #endif
    }

    func startObserving(store: LocalAlarmStore) async {
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
            AlarmVoicePlayer.shared.stop()
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
                    fireForegroundRingHaptic()
                    // 30s 초과 또는 트랜스코드 실패로 AlarmKit 가 시스템 톤만 울리는 경우,
                    // 앱이 활성일 때 캐싱된 voice 를 동시 재생한다 (mixWithOthers).
                    let resolution = AlarmSoundResolver.resolve(for: record, audioCache: audioCache)
                    if resolution.requiresInAppFallback {
                        AlarmVoicePlayer.shared.playIfNeeded(for: record, audioCache: audioCache)
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
    private func fireForegroundRingHaptic() {
        #if canImport(UIKit)
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

    /// Android `AlarmRepository.createTestAlarm(delayMinutes)` parity.
    /// now + delayMinutes(1...5)분 뒤로 발화하는 단발 테스트 알람을 예약한다.
    /// - delayMinutes 는 1...5 로 검증한다 (Android `require(delayMinutes in 1..5)`).
    ///   범위 밖이면 크래시 대신 statusMessage 로 안내하고 no-op (저위험 테스트 표면).
    /// - 발화 instant 에서 hour/minute 를 파생하고, `requireUniqueTime` 로 같은 시각
    ///   중복을 막는다 (Android 동일 — 충돌 시 던지면 안내 후 skip).
    /// - snoozeRepeatLimit 를 `.three` 로 명시한다 (Android `SnoozeRepeatLimits.THREE`).
    /// - schedule 실패 시 store 에 흔적을 남기지 않는다. iOS 의 `schedule(...)` 은 AlarmKit
    ///   이 새로 발급한 UUID 를 `markScheduled(localID:)` 로 record 에 되써야 하는데, 이는
    ///   record 가 store 에 이미 있어야 동작한다(없으면 no-op → alarmKitID 유실). 따라서
    ///   Android 의 `alarmScheduler.schedule` 후 `alarmDao.upsert` 순서를 iOS 에서는
    ///   기존 `finishScheduling` 패턴(upsert → schedule → 실패 시 롤백)으로 옮긴다.
    func scheduleOneMinuteTest(store: LocalAlarmStore, delayMinutes: Int = 1) async {
        guard (1...5).contains(delayMinutes) else {
            statusMessage = "테스트 알람 지연은 1~5분 사이여야 해요."
            return
        }
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let fireDate = Date().addingTimeInterval(TimeInterval(delayMinutes * 60))
        let parts = Calendar.current.dateComponents([.hour, .minute], from: fireDate)
        let hour = parts.hour ?? 7
        let minute = parts.minute ?? 0
        do {
            try store.requireUniqueTime(hour: hour, minute: minute, repeatDaysMask: 0)
        } catch {
            statusMessage = (error as? LocalAlarmValidationError)?.errorDescription
                ?? "이미 같은 시간에 알람이 있어요. 다른 시간을 선택해 주세요."
            return
        }
        let record = LocalAlarmRecord(
            label: "\(delayMinutes)분 테스트 알람",
            hour: hour,
            minute: minute,
            fireAtMillis: Int64(fireDate.timeIntervalSince1970 * 1000),
            repeatDaysMask: 0,
            snoozeEnabled: true,
            snoozeMinutes: 5,
            snoozeRepeatLimit: SnoozeRepeatLimit.three.rawValue,
            playMode: AlarmPlayMode.alarmOnly.rawValue,
            alarmVolumePercent: 100,
            createdAtMillis: now,
            updatedAtMillis: now
        )
        store.upsert(record)
        guard await schedule(record: record, store: store) else {
            // schedule 실패 → 방금 넣은 테스트 record 를 되돌린다 (Android 는 schedule 실패
            // 시 upsert 자체에 도달하지 않으므로, iOS 도 store 에 흔적을 남기지 않는다).
            store.deleteByID(record.id)
            return
        }
    }

    #if DEBUG
    /// iOS 전용 DEBUG 헬퍼 — Android 에는 대응이 없다. 월~금 07:30 반복 알람을 빠르게
    /// 무장해 `.relative(.weekly)` 경로를 디바이스에서 점검할 때 쓴다. 릴리스 빌드에는
    /// 포함되지 않는다.
    func scheduleWeeklyMorningTest(store: LocalAlarmStore) async {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        // 월~금 (mask: bit 1..5).
        let mask = [RepeatDay.monday, .tuesday, .wednesday, .thursday, .friday].mask
        let fireAt = (try? AlarmTimeCalculator.nextFireAtMillis(
            hour: 7, minute: 30, repeatDaysMask: mask,
            holidayOff: false, nowMillis: now,
            isHoliday: holidayStore.holidayPredicate()
        )) ?? now + 60 * 60 * 1000
        let record = LocalAlarmRecord(
            label: "평일 테스트 알람",
            hour: 7,
            minute: 30,
            fireAtMillis: fireAt,
            repeatDaysMask: mask,
            snoozeEnabled: true,
            snoozeMinutes: 5,
            playMode: AlarmPlayMode.alarmOnly.rawValue,
            alarmVolumePercent: 100,
            createdAtMillis: now,
            updatedAtMillis: now
        )
        store.upsert(record)
        await schedule(record: record, store: store)
    }
    #endif

    @discardableResult
    func schedule(record: LocalAlarmRecord, store: LocalAlarmStore) async -> Bool {
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
            let resolution = AlarmSoundResolver.resolve(for: record, audioCache: audioCache)
            lastSoundResolution = resolution
            let configuration = makeConfiguration(
                record: record,
                alarmKitID: id,
                schedule: schedule,
                resolution: resolution
            )
            _ = try await AlarmManager.shared.schedule(id: id, configuration: configuration)
            store.markScheduled(localID: record.id, alarmKitID: id.uuidString)
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

    @discardableResult
    func cancelScheduledAlarm(record: LocalAlarmRecord) async -> Bool {
        #if canImport(AlarmKit)
        guard let alarmKitUUID = record.alarmKitUUID else { return true }
        do {
            try AlarmManager.shared.cancel(id: alarmKitUUID)
            statusMessage = "\(record.label) 알람을 취소했어요."
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

    @discardableResult
    func cancel(record: LocalAlarmRecord, store: LocalAlarmStore) async -> Bool {
        guard record.alarmKitUUID != nil else {
            deleteLocalAlarm(record, store: store)
            return true
        }
        if await cancelScheduledAlarm(record: record) {
            deleteLocalAlarm(record, store: store)
            return true
        }
        return false
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
        let alert = AlarmPresentation.Alert(
            title: LocalizedStringResource(stringLiteral: record.label),
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
            return trimmed
        }()
        let metadata = AlarmTalkMetadata(
            localAlarmID: record.id,
            label: record.label,
            playMode: record.playMode,
            voiceCacheKey: record.audioCacheKey,
            alarmKitID: alarmKitID.uuidString,
            voiceText: quotedVoiceText
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
