import Foundation
import SwiftUI

#if canImport(AlarmKit)
import AlarmKit
#endif

@MainActor
final class AlarmKitViewModel: ObservableObject {
    @Published var authorizationLabel = "Unknown"
    @Published private(set) var alarmAuthorized = false
    @Published var statusMessage: String?

    private let holidayStore = HolidayStore()

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

    func refreshAuthorizationState() {
        #if canImport(AlarmKit)
        applyAuthorizationState(AlarmManager.shared.authorizationState)
        #else
        authorizationLabel = "Unavailable"
        alarmAuthorized = true
        #endif
    }

    func requestAuthorization() async {
        #if canImport(AlarmKit)
        do {
            let state = try await AlarmManager.shared.requestAuthorization()
            applyAuthorizationState(state)
            statusMessage = "Alarm authorization: \(authorizationLabel)"
        } catch {
            statusMessage = "Alarm authorization failed: \(error.localizedDescription)"
        }
        #else
        statusMessage = "AlarmKit is unavailable in this SDK."
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
        authorizationLabel = String(describing: state)
        alarmAuthorized = state == .authorized
    }

    private func observeAlarmUpdates(store: LocalAlarmStore) async {
        for await alarms in AlarmManager.shared.alarmUpdates {
            await processAlarmUpdate(alarms: alarms, store: store)
        }
    }

    /// 한 번의 alarmUpdates emit 을 처리. 별도 메서드로 분리해 테스트 가능성을
    /// 높이고 (직접 Alarm 배열을 주입 가능), 두 책임을 명시한다:
    ///   1. 사라진 alarmKitID -> markStopped + CharacterEvent.alarmCompleted emit
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
        for kitID in disappearedIDs {
            let recordExisted = store.recordByAlarmKitID(kitID) != nil
            // In-app voice fallback 재생 중이면 정지 (AlarmKit 자체 stop 과 별개).
            AlarmVoicePlayer.shared.stop()
            // CharacterEvent emit (LiveActivity 가 아닌 경로의 stop 도 포함).
            // AlarmAppContext 는 멱등 nonce 를 사용하므로 LiveActivity Intent
            // 가 이미 queue 했다면 store 측에서 중복 제거가 된다.
            if recordExisted, let ctx = AlarmAppContext.shared {
                await ctx.handleAlarmStopped(alarmKitIDString: kitID)
            } else {
                store.markStopped(alarmKitID: kitID)
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
    #endif

    @discardableResult
    func recoverScheduledAlarms(store: LocalAlarmStore) async -> Int {
        #if canImport(AlarmKit)
        let nowMillis = Int64(Date().timeIntervalSince1970 * 1000)
        let holidayPredicate = holidayStore.holidayPredicate()
        let candidates = store.alarms.filter { record in
            record.enabled && (
                record.alarmKitUUID == nil ||
                record.runtimeStateEnum == .failed
            )
        }
        var recovered = 0

        for record in candidates {
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
            statusMessage = "Recovered \(recovered) scheduled alarm(s)."
        }
        return recovered
        #else
        statusMessage = "AlarmKit is unavailable in this SDK."
        return 0
        #endif
    }

    func scheduleOneMinuteTest(store: LocalAlarmStore) async {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let fireDate = Date().addingTimeInterval(60)
        let parts = Calendar.current.dateComponents([.hour, .minute], from: fireDate)
        let record = LocalAlarmRecord(
            label: "1 min test",
            hour: parts.hour ?? 7,
            minute: parts.minute ?? 0,
            fireAtMillis: Int64(fireDate.timeIntervalSince1970 * 1000),
            repeatDaysMask: 0,
            snoozeEnabled: true,
            snoozeMinutes: 5,
            playMode: AlarmPlayMode.alarmOnly.rawValue,
            alarmVolumePercent: 80,
            createdAtMillis: now,
            updatedAtMillis: now
        )
        store.upsert(record)
        await schedule(record: record, store: store)
    }

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
            label: "Weekday test",
            hour: 7,
            minute: 30,
            fireAtMillis: fireAt,
            repeatDaysMask: mask,
            snoozeEnabled: true,
            snoozeMinutes: 5,
            playMode: AlarmPlayMode.alarmOnly.rawValue,
            alarmVolumePercent: 80,
            createdAtMillis: now,
            updatedAtMillis: now
        )
        store.upsert(record)
        await schedule(record: record, store: store)
    }

    @discardableResult
    func schedule(record: LocalAlarmRecord, store: LocalAlarmStore) async -> Bool {
        #if canImport(AlarmKit)
        do {
            if AlarmManager.shared.authorizationState != .authorized {
                let state = try await AlarmManager.shared.requestAuthorization()
                applyAuthorizationState(state)
                guard state == .authorized else {
                    statusMessage = "AlarmKit permission is required before scheduling."
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
            statusMessage = "Schedule failed: \(error.localizedDescription)"
            return false
        }
        #else
        statusMessage = "AlarmKit is unavailable in this SDK."
        return false
        #endif
    }

    @discardableResult
    func cancelScheduledAlarm(record: LocalAlarmRecord) async -> Bool {
        #if canImport(AlarmKit)
        guard let alarmKitUUID = record.alarmKitUUID else { return true }
        do {
            try AlarmManager.shared.cancel(id: alarmKitUUID)
            statusMessage = "Canceled \(record.label)"
            return true
        } catch {
            statusMessage = "Cancel failed: \(error.localizedDescription)"
            return false
        }
        #else
        statusMessage = "AlarmKit is unavailable in this SDK."
        return false
        #endif
    }

    func cancel(record: LocalAlarmRecord, store: LocalAlarmStore) async {
        guard record.alarmKitUUID != nil else {
            deleteLocalAlarm(record, store: store)
            return
        }
        if await cancelScheduledAlarm(record: record) {
            deleteLocalAlarm(record, store: store)
        }
    }

    private func deleteLocalAlarm(_ record: LocalAlarmRecord, store: LocalAlarmStore) {
        if let releasedAudioCacheKey = store.delete(record) {
            try? audioCache.deleteCachedAudio(cacheKey: releasedAudioCacheKey)
        }
    }

    #if canImport(AlarmKit)
    private func makeSchedule(_ record: LocalAlarmRecord) -> Alarm.Schedule {
        let time = Alarm.Schedule.Relative.Time(hour: record.hour, minute: record.minute)
        let weekdays = record.repeatDaysMask.repeatDays.compactMap(localeWeekday)
        let recurrence: Alarm.Schedule.Relative.Recurrence = weekdays.isEmpty
            ? .never
            : .weekly(weekdays)
        return .relative(.init(time: time, repeats: recurrence))
    }

    private func makeConfiguration(
        record: LocalAlarmRecord,
        alarmKitID: UUID,
        schedule: Alarm.Schedule,
        resolution: AlarmSoundResolution
    ) -> AlarmManager.AlarmConfiguration<VoiceAlarmMetadata> {
        typealias AlarmConfiguration = AlarmManager.AlarmConfiguration<VoiceAlarmMetadata>
        let stopButton = AlarmButton(text: "Stop", textColor: .white, systemImageName: "stop.fill")
        let snoozeButton = AlarmButton(text: "Snooze", textColor: .white, systemImageName: "moon.zzz.fill")
        let alert = AlarmPresentation.Alert(
            title: record.label,
            stopButton: stopButton,
            secondaryButton: snoozeButton,
            secondaryButtonBehavior: .countdown
        )
        let countdown = AlarmPresentation.Countdown(title: "Snoozing \(record.label)")
        let paused = AlarmPresentation.Paused(
            title: "Paused",
            resumeButton: AlarmButton(text: "Resume", textColor: .white, systemImageName: "play.fill")
        )
        let presentation = AlarmPresentation(alert: alert, countdown: countdown, paused: paused)
        // Phase 2-B4: 메타데이터에 playMode + voiceCacheKey 를 실어 LiveActivity /
        // alarmUpdates handler 가 어떤 in-app 폴백 전략을 쓸지 식별 가능.
        let metadata = VoiceAlarmMetadata(
            localAlarmID: record.id,
            label: record.label,
            playMode: record.playMode,
            voiceCacheKey: record.audioCacheKey
        )
        let attributes = AlarmAttributes(
            presentation: presentation,
            metadata: metadata,
            tintColor: VoiceAlarmTheme.primary
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
            return "Scheduled \(record.label)"
        case .bundledNamed(let name):
            return "Scheduled \(record.label) (custom sound: \(name))"
        case .cachedAudio(_, let durationMs):
            let seconds = max(1, Int((durationMs + 500) / 1000))
            return "Scheduled \(record.label). Voice \(seconds)s exceeds AlarmKit limit — system tone rings while in-app voice fallback plays when app is active."
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
