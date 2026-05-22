import AppIntents
import Foundation

#if canImport(AlarmKit)
import AlarmKit
#endif

// MARK: - StopAlarmIntent
//
// LiveActivityIntent 로 등록되어 Lock Screen / Dynamic Island 의 Stop 버튼이
// 눌렸을 때 OS 에서 직접 invoke 한다. AlarmKit `Alarm` 의 식별자(UUID)를
// 문자열로 전달받아 두 작업을 순차 수행한다.
//
// 1. AlarmKit 자체 stop — Apple 문서 `AlarmManager/stop(id:)` (throws, non-async)
//    https://developer.apple.com/documentation/AlarmKit/AlarmManager/stop(id:)
// 2. 우리 측 상태 전이 — `AlarmAppContext.shared` 를 통해 `LocalAlarmStore`
//    의 markStopped, `CharacterEventStore` 의 alarmCompleted 이벤트 queue.
//
// AlarmAppContext 가 nil 일 수 있는 시나리오: 앱이 백그라운드에서 콜드 부팅된
// 직후 SwiftUI Scene 의 `.task` 가 아직 안 돌은 경우. 그 때라도 AlarmKit
// 자체 stop 은 OS 에 의해 처리되고, 다음 앱 활성화 시 alarmUpdates 루프가
// 사라진 alarmKitID 를 감지해 markStopped + characterEvents.queue 를 호출하므로
// 멱등성이 유지된다 (clientNonce 는 동일 패턴이라 중복 enqueue 방지).
struct StopAlarmIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "알람 중지"

    @Parameter(title: "Alarm ID")
    var alarmID: String

    init() {
        alarmID = ""
    }

    init(alarmID: String) {
        self.alarmID = alarmID
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        #if canImport(AlarmKit)
        guard let uuid = UUID(uuidString: alarmID) else {
            return .result()
        }
        // AlarmKit stop. 이미 stopped 거나 unknown id 면 throw 가능 — 무시.
        do {
            try AlarmManager.shared.stop(id: uuid)
        } catch {
            // ignored: AlarmKit 에서 이미 dismiss 된 알람일 가능성.
        }
        if let ctx = AlarmAppContext.shared {
            await ctx.handleAlarmStopped(alarmKitIDString: uuid.uuidString)
        }
        return .result()
        #else
        return .result()
        #endif
    }
}

// MARK: - SnoozeAlarmIntent
//
// secondaryButtonBehavior = .countdown 일 때 OS 가 자동으로 호출.
// `AlarmManager/countdown(id:)` — https://developer.apple.com/documentation/AlarmKit/AlarmManager/countdown(id:)
// AlarmKitViewModel.makeConfiguration 에서 `countdownDuration.postAlert =
// snoozeMinutes * 60` 로 등록했기 때문에 OS 가 그 만큼 countdown 후 다시 alert.
//
// snoozeMinutes 파라미터는 OS UI 에서 노출되지 않으나, App Intent shortcut
// 으로 직접 호출될 가능성과 우리 측 markSnoozed(newFireAtMillis:) 계산을 위해
// 보존. 기본값 0 이면 LocalAlarmRecord.snoozeMinutes 값을 사용한다.
struct SnoozeAlarmIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "알람 스누즈"

    @Parameter(title: "Alarm ID")
    var alarmID: String

    @Parameter(title: "Snooze Minutes")
    var snoozeMinutes: Int

    init() {
        alarmID = ""
        snoozeMinutes = 0
    }

    init(alarmID: String, snoozeMinutes: Int = 0) {
        self.alarmID = alarmID
        self.snoozeMinutes = snoozeMinutes
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        #if canImport(AlarmKit)
        guard let uuid = UUID(uuidString: alarmID) else {
            return .result()
        }
        do {
            try AlarmManager.shared.countdown(id: uuid)
        } catch {
            // ignored
        }
        if let ctx = AlarmAppContext.shared,
           ctx.canSnooze(alarmKitIDString: uuid.uuidString) {
            await ctx.handleAlarmSnoozed(
                alarmKitIDString: uuid.uuidString,
                snoozeMinutesOverride: snoozeMinutes > 0 ? snoozeMinutes : nil
            )
        }
        return .result()
        #else
        return .result()
        #endif
    }
}
