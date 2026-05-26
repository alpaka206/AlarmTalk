import Foundation
import SwiftUI

#if canImport(AlarmKit)
import AlarmKit
#endif

@MainActor
final class AlarmKitViewModel: ObservableObject {
    @Published var authorizationLabel = "확인 전"
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

    func refreshAuthorizationState() {
        #if canImport(AlarmKit)
        applyAuthorizationState(AlarmManager.shared.authorizationState)
        #else
        authorizationLabel = Self.authorizationDisplayLabel("unavailable")
        alarmAuthorized = true
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
        authorizationLabel = Self.authorizationDisplayLabel(String(describing: state))
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
            statusMessage = "예약된 알람 \(recovered)개를 다시 연결했어요."
        }
        return recovered
        #else
        statusMessage = Self.alarmUnavailableMessage
        return 0
        #endif
    }

    func scheduleOneMinuteTest(store: LocalAlarmStore) async {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let fireDate = Date().addingTimeInterval(60)
        let parts = Calendar.current.dateComponents([.hour, .minute], from: fireDate)
        let record = LocalAlarmRecord(
            label: "1분 테스트 알람",
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
            label: "평일 테스트 알람",
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
        let stopButton = AlarmButton(text: "알람 끄기", textColor: .white, systemImageName: "stop.fill")
        let snoozeButton = AlarmButton(text: "다시 울리기", textColor: .white, systemImageName: "moon.zzz.fill")
        let alert = AlarmPresentation.Alert(
            title: record.label,
            stopButton: stopButton,
            secondaryButton: snoozeButton,
            secondaryButtonBehavior: .countdown
        )
        let countdown = AlarmPresentation.Countdown(title: "\(record.label) 다시 울릴 준비 중")
        let paused = AlarmPresentation.Paused(
            title: "일시정지됨",
            resumeButton: AlarmButton(text: "다시 시작", textColor: .white, systemImageName: "play.fill")
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
