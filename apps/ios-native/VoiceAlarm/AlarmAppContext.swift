import Foundation

// MARK: - CharacterEventQueueing
//
// Phase 2-B5 의 `CharacterEventStore` 가 외부에서 enqueue 받기 위한 추상.
// AlarmAppContext 는 구체 타입에 의존하지 않고 이 protocol 만 본다.
// B5 머지 후 `CharacterEventStore` 는 다음과 같이 conform 한다:
//
//     extension CharacterEventStore: CharacterEventQueueing {
//         func queueAlarmEvent(eventType: CharacterEventKind,
//                              occurredAtMillis: Int64,
//                              clientNonce: String,
//                              context: [String: String]?) async {
//             await queue(eventType: .init(rawValue: eventType.rawValue)!, ...)
//         }
//     }
//
// protocol 분리 이유:
//   1. 컴파일 순서 독립성 — B2 가 B5 보다 먼저 머지될 수 있다.
//   2. 테스트에서 mock 주입이 자명해진다 (`AlarmAppContextTests` 참고).
//   3. clientNonce 멱등성 검증을 store 내부 책임으로 떠넘긴다.
enum CharacterEventKind: String, Sendable {
    case alarmCompleted = "alarm_completed"
    case alarmSnoozed = "alarm_snoozed"
}

@MainActor
protocol CharacterEventQueueing: AnyObject {
    func queueAlarmEvent(
        eventType: CharacterEventKind,
        occurredAtMillis: Int64,
        clientNonce: String,
        context: [String: String]?
    ) async
}

// MARK: - AlarmAppContext
//
// App Intent 가 ViewModel 인스턴스에 직접 접근할 수 없으므로 (`perform()` 은
// 별도 프로세스/콜드 부팅에서 호출될 수 있음) 정적 weak singleton 으로
// 디스패처를 노출한다.
//
// 동시성/race 방어:
//   - `@MainActor` 로 격리되어 `shared` 접근, 핸들러 메서드 호출, store
//     mutation 모두 main thread 직렬화. App Intent perform 은 `@MainActor`
//     로 마킹되어 같은 actor 에서 실행되므로 weak singleton 접근이 안전.
//   - weak reference 는 앱 라이프사이클이 종료되어 VoiceAlarmApp `@StateObject`
//     들이 deallocate 되면 자동으로 nil 이 되어 stale 참조를 막는다. 새 Scene
//     이 다시 init 하면 새 AlarmAppContext 가 `shared` 를 덮어쓴다 (init 마지막
//     줄에서). 두 인스턴스가 동시에 존재할 수 없는 이유: VoiceAlarmApp 은
//     `@main` 단일 진입점이고 `@StateObject` 는 Scene 당 1회 init.
@MainActor
final class AlarmAppContext {
    static var shared: AlarmAppContext?

    weak var store: LocalAlarmStore?
    weak var characterEvents: AnyObject?

    /// CharacterEventQueueing 으로 cast 해서 사용. weak any-protocol 은 Swift 에서
    /// 직접 표현이 까다로워 AnyObject 로 보관 후 호출 시점에 cast.
    private var queueing: CharacterEventQueueing? {
        characterEvents as? CharacterEventQueueing
    }

    /// `now()` 를 주입 가능하게 만들어 테스트에서 clock 을 고정한다.
    var nowProvider: () -> Date = { Date() }

    init(
        store: LocalAlarmStore,
        characterEvents: (AnyObject & CharacterEventQueueing)?
    ) {
        self.store = store
        self.characterEvents = characterEvents
        AlarmAppContext.shared = self
    }

    // MARK: - Stop / Dismiss

    /// LiveActivity 의 Stop 버튼 또는 alarmUpdates 의 disappearance 양쪽에서 호출된다.
    /// 멱등성: clientNonce 가 `"{record.id}-stop-{record.updatedAtMillis}"` 형태로
    /// 같은 알람의 같은 stop 시점에 항상 같은 값을 만들도록 한다 — 두 경로가
    /// 1초 내 같은 stop 을 emit 해도 store 측 멱등 검사에서 한 번만 처리된다.
    func handleAlarmStopped(alarmKitIDString: String) async {
        guard let store else { return }
        let recordBeforeStop = store.recordByAlarmKitID(alarmKitIDString)
        // markStopped 는 alarmKitID 매칭이 안 되면 no-op 이므로 안전.
        store.markStopped(alarmKitID: alarmKitIDString)

        guard let queueing else { return }
        guard let record = recordBeforeStop else { return }
        let now = nowProvider()
        let occurredAtMillis = Int64(now.timeIntervalSince1970 * 1000)
        // 멱등 nonce: 같은 알람 + 같은 updatedAt 이면 두 경로가 같은 값을 만든다.
        // updatedAtMillis 는 markStopped 호출 직전 값을 쓰지 못하므로 record.id
        // 와 fireAtMillis (해당 회차 발화 시각) 의 조합으로 충돌 회피.
        let nonce = "\(record.id)-stop-\(record.fireAtMillis)"
        await queueing.queueAlarmEvent(
            eventType: .alarmCompleted,
            occurredAtMillis: occurredAtMillis,
            clientNonce: nonce,
            context: [
                "alarmId": record.id,
                "alarmKitId": alarmKitIDString,
                "playMode": record.playMode,
                "voiceProfileId": record.voiceProfileId ?? "",
            ]
        )
    }

    // MARK: - Snooze

    func canSnooze(alarmKitIDString: String) -> Bool {
        guard let record = store?.recordByAlarmKitID(alarmKitIDString) else { return false }
        return record.canSnooze
    }

    /// LiveActivity 의 Snooze 버튼이 눌렸을 때 호출.
    /// snoozeMinutesOverride 가 nil 이면 record.snoozeMinutes 사용.
    func handleAlarmSnoozed(
        alarmKitIDString: String,
        snoozeMinutesOverride: Int? = nil
    ) async {
        guard let store else { return }
        guard let record = store.recordByAlarmKitID(alarmKitIDString) else { return }
        guard record.canSnooze else { return }

        let now = nowProvider()
        let minutes = snoozeMinutesOverride ?? record.snoozeMinutes
        let newFireAtMillis = Int64(now.timeIntervalSince1970 * 1000) + Int64(minutes) * 60_000
        // snoozeCount 는 markSnoozed 가 +1 해주므로 nonce 는 호출 *전* 값을 본다.
        // 두 번 같은 snooze 가 들어와도 store.markSnoozed 가 두 번 +1 하면 nonce 가
        // 달라져 중복이 흘러갈 수 있는데, 사실상 OS 가 같은 countdown 을 두 번
        // 트리거하지 않으므로 (countdown 은 알람당 1회 큐) 실무적으로는 안전.
        let nonce = "\(record.id)-snooze-\(record.snoozeCount + 1)"

        store.markSnoozed(
            id: record.id,
            newFireAtMillis: newFireAtMillis,
            incrementCount: true
        )

        guard let queueing else { return }
        await queueing.queueAlarmEvent(
            eventType: .alarmSnoozed,
            occurredAtMillis: Int64(now.timeIntervalSince1970 * 1000),
            clientNonce: nonce,
            context: [
                "alarmId": record.id,
                "alarmKitId": alarmKitIDString,
                "snoozeMinutes": "\(minutes)",
                "snoozeCount": "\(record.snoozeCount + 1)",
            ]
        )
    }
}

// MARK: - LocalAlarmStore convenience

extension LocalAlarmStore {
    /// 명세에서 요구하는 alias. 기존 `record(alarmKitID:)` 와 동일하지만
    /// 호출 사이트에서 의도가 더 명시적이다.
    func recordByAlarmKitID(_ alarmKitID: String) -> LocalAlarmRecord? {
        record(alarmKitID: alarmKitID)
    }
}
