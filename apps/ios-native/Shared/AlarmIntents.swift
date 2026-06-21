import AppIntents
import Foundation

#if canImport(AlarmKit)
import AlarmKit
#endif

// MARK: - Target boundary
//
// 이 파일은 `Shared/` 에 있어 메인 앱(AlarmTalk)과 위젯 확장(AlarmTalkWidget)
// 양쪽 타겟에 컴파일된다. 위젯은 LiveActivity 의 `Button(intent:)` 를 구성하기
// 위해 이 인텐트 *타입* 이 필요하다 (ActivityKit 요구사항). 하지만 위젯에는
// `AlarmAppContext` (앱 전용 상태 디스패처) 가 없으므로, 우리 측 상태 전이
// 부킹은 앱 타겟에서만 정의되는 `ALARMTALK_APP` 컴파일 조건으로 감싼다.
//
// `LiveActivityIntent.perform()` 는 항상 호스트 앱 프로세스에서 실행되므로
// (위젯 프로세스가 아님), 위젯은 버튼 구성을 위한 심볼만 필요하고 실제 동작은
// 앱이 제공한다. AlarmKit `stop(id:)` / `countdown(id:)` 은 시스템 프레임워크라
// 양쪽 타겟에서 모두 호출 가능하므로 가드하지 않는다.

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
    static let title: LocalizedStringResource = "알람 끄기"

    @Parameter(title: "알람 ID")
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
        #if ALARMTALK_APP
        if let ctx = AlarmAppContext.shared {
            await ctx.handleAlarmStopped(alarmKitIDString: uuid.uuidString)
        }
        #endif
        return .result()
        #else
        return .result()
        #endif
    }
}

// MARK: - SnoozeAlarmIntent
//
// secondaryButtonBehavior = .custom 이라 OS 는 자동 재무장하지 않고 이 intent 만
// 호출한다. 한도(canSnooze) 를 확인해 분기한다:
//  - 다시 울림 가능: `AlarmManager/countdown(id:)` 로 직접 재무장.
//    https://developer.apple.com/documentation/AlarmKit/AlarmManager/countdown(id:)
//    makeConfiguration 의 `countdownDuration.postAlert = snoozeMinutes * 60` 만큼
//    countdown 후 다시 alert.
//  - 한도 도달 / 비활성: Android AlarmRepository.snooze() 처럼 stop(id:) 로 종료.
//
// snoozeMinutes 파라미터는 OS UI 에서 노출되지 않으나, App Intent shortcut
// 으로 직접 호출될 가능성과 우리 측 markSnoozed(newFireAtMillis:) 계산을 위해
// 보존. 기본값 0 이면 LocalAlarmRecord.snoozeMinutes 값을 사용한다.
struct SnoozeAlarmIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "알람 다시 울리기"

    @Parameter(title: "알람 ID")
    var alarmID: String

    @Parameter(title: "다시 울릴 시간")
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
        #if ALARMTALK_APP
        // Android AlarmRepository.snooze() 와 동일하게 한도를 먼저 확인한다.
        // 다시 울림이 꺼져 있거나 snoozeRepeatLimit 에 도달했다면 countdown 으로
        // 재무장하지 않고 알람을 종료시켜야 한다.
        //
        // 판단은 3-state 로 한다. 락스크린 콜드 부팅 직후(Scene .task 미실행으로
        // ctx 가 nil 이거나, ctx 는 있어도 LocalAlarmStore 의 디스크 로드 전이라
        // 기록을 못 찾는 경우)에는 한도를 알 수 없으므로 .unknown 이 되고, 종료가
        // 아니라 다시 울림을 기본값으로 둔다. 종료는 기록이 로드돼 한도 도달/비활성이
        // 명확한 .deny 일 때만 수행한다. (잘못 종료하면 사용자가 의도한 다시 울림이
        // 사라지는 회귀가 되므로.)
        let ctx = AlarmAppContext.shared
        let decision = ctx?.snoozeDecision(alarmKitIDString: uuid.uuidString) ?? .unknown
        if decision == .deny {
            // 한도 도달 / 다시 울림 비활성 — Android 처럼 알람을 끝낸다.
            do {
                try AlarmManager.shared.stop(id: uuid)
            } catch {
                // ignored
            }
            await ctx?.handleAlarmStopped(alarmKitIDString: uuid.uuidString)
        } else {
            do {
                try AlarmManager.shared.countdown(id: uuid)
            } catch {
                // ignored
            }
            await ctx?.handleAlarmSnoozed(
                alarmKitIDString: uuid.uuidString,
                snoozeMinutesOverride: snoozeMinutes > 0 ? snoozeMinutes : nil
            )
        }
        #else
        // 위젯 타겟: AlarmAppContext 가 없다. LiveActivityIntent.perform() 은 호스트
        // 앱 프로세스에서 실행되므로 실제로 이 분기가 실행될 일은 없으나, 심볼만
        // 컴파일되면 되도록 안전한 기본 동작(다시 울림 재무장)만 둔다.
        do {
            try AlarmManager.shared.countdown(id: uuid)
        } catch {
            // ignored
        }
        #endif
        return .result()
        #else
        return .result()
        #endif
    }
}
