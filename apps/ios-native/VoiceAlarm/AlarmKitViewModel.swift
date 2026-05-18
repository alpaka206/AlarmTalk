import Foundation
import SwiftUI

#if canImport(AlarmKit)
import AlarmKit
#endif

@MainActor
final class AlarmKitViewModel: ObservableObject {
    @Published var authorizationLabel = "Unknown"
    @Published var statusMessage: String?

    func refreshAuthorizationState() {
        #if canImport(AlarmKit)
        authorizationLabel = String(describing: AlarmManager.shared.authorizationState)
        #else
        authorizationLabel = "Unavailable"
        #endif
    }

    func requestAuthorization() async {
        #if canImport(AlarmKit)
        do {
            let state = try await AlarmManager.shared.requestAuthorization()
            authorizationLabel = String(describing: state)
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
        for await alarms in AlarmManager.shared.alarmUpdates {
            let activeIDs = Set(alarms.map { $0.id })
            for record in store.alarms {
                if let alarmKitID = record.alarmKitID, !activeIDs.contains(alarmKitID) {
                    store.markStopped(alarmKitID: alarmKitID)
                }
            }
        }
        #endif
    }

    func scheduleOneMinuteTest(store: LocalAlarmStore) async {
        let fireDate = Date().addingTimeInterval(60)
        let parts = Calendar.current.dateComponents([.hour, .minute], from: fireDate)
        let record = LocalAlarmRecord(
            id: UUID(),
            label: "1 min test",
            hour: parts.hour ?? 7,
            minute: parts.minute ?? 0,
            repeatWeekdays: [],
            alarmKitID: nil,
            enabled: true,
            snoozeMinutes: 5,
            playMode: .alarmOnly,
            updatedAt: Date()
        )
        store.upsert(record)
        await schedule(record: record, store: store)
    }

    func scheduleWeeklyMorningTest(store: LocalAlarmStore) async {
        let record = LocalAlarmRecord(
            id: UUID(),
            label: "Weekday test",
            hour: 7,
            minute: 30,
            repeatWeekdays: [2, 3, 4, 5, 6],
            alarmKitID: nil,
            enabled: true,
            snoozeMinutes: 5,
            playMode: .alarmOnly,
            updatedAt: Date()
        )
        store.upsert(record)
        await schedule(record: record, store: store)
    }

    func schedule(record: LocalAlarmRecord, store: LocalAlarmStore) async {
        #if canImport(AlarmKit)
        do {
            if AlarmManager.shared.authorizationState != .authorized {
                let state = try await AlarmManager.shared.requestAuthorization()
                authorizationLabel = String(describing: state)
                guard state == .authorized else {
                    statusMessage = "AlarmKit permission is required before scheduling."
                    return
                }
            }
            let id = UUID()
            let schedule = makeSchedule(record)
            let configuration = makeConfiguration(record: record, alarmKitID: id, schedule: schedule)
            _ = try await AlarmManager.shared.schedule(id: id, configuration: configuration)
            store.markScheduled(localID: record.id, alarmKitID: id)
            statusMessage = record.hasVoiceAudio
                ? "Scheduled \(record.label). Voice audio is cached locally; AlarmKit sound behavior must be checked on device."
                : "Scheduled \(record.label)"
        } catch {
            statusMessage = "Schedule failed: \(error.localizedDescription)"
        }
        #else
        statusMessage = "AlarmKit is unavailable in this SDK."
        #endif
    }

    func cancel(record: LocalAlarmRecord, store: LocalAlarmStore) async {
        #if canImport(AlarmKit)
        guard let alarmKitID = record.alarmKitID else {
            store.delete(record)
            return
        }
        do {
            try AlarmManager.shared.cancel(id: alarmKitID)
            store.delete(record)
            statusMessage = "Canceled \(record.label)"
        } catch {
            statusMessage = "Cancel failed: \(error.localizedDescription)"
        }
        #else
        store.delete(record)
        statusMessage = "AlarmKit is unavailable in this SDK."
        #endif
    }

    #if canImport(AlarmKit)
    private func makeSchedule(_ record: LocalAlarmRecord) -> Alarm.Schedule {
        let time = Alarm.Schedule.Relative.Time(hour: record.hour, minute: record.minute)
        let recurrence: Alarm.Schedule.Relative.Recurrence = record.repeatWeekdays.isEmpty
            ? .never
            : .weekly(record.repeatWeekdays.compactMap(localeWeekday))
        return .relative(.init(time: time, repeats: recurrence))
    }

    private func makeConfiguration(
        record: LocalAlarmRecord,
        alarmKitID: UUID,
        schedule: Alarm.Schedule
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
        let attributes = AlarmAttributes(
            presentation: presentation,
            metadata: VoiceAlarmMetadata(localAlarmID: record.id.uuidString, label: record.label),
            tintColor: VoiceAlarmTheme.primary
        )
        let snoozeDuration = Alarm.CountdownDuration(preAlert: nil, postAlert: TimeInterval(record.snoozeMinutes * 60))
        return AlarmConfiguration(
            countdownDuration: snoozeDuration,
            schedule: schedule,
            attributes: attributes,
            stopIntent: StopAlarmIntent(alarmID: alarmKitID.uuidString),
            secondaryIntent: SnoozeAlarmIntent(alarmID: alarmKitID.uuidString),
            sound: .default
        )
    }

    private func localeWeekday(_ value: Int) -> Locale.Weekday? {
        switch value {
        case 1: return .sunday
        case 2: return .monday
        case 3: return .tuesday
        case 4: return .wednesday
        case 5: return .thursday
        case 6: return .friday
        case 7: return .saturday
        default: return nil
        }
    }
    #endif
}
