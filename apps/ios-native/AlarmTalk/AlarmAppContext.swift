import Foundation

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
//   - weak reference 는 앱 라이프사이클이 종료되어 AlarmTalkApp `@StateObject`
//     들이 deallocate 되면 자동으로 nil 이 되어 stale 참조를 막는다. 새 Scene
//     이 다시 init 하면 새 AlarmAppContext 가 `shared` 를 덮어쓴다 (init 마지막
//     줄에서). 두 인스턴스가 동시에 존재할 수 없는 이유: AlarmTalkApp 은
//     `@main` 단일 진입점이고 `@StateObject` 는 Scene 당 1회 init.
@MainActor
final class AlarmAppContext {
    static var shared: AlarmAppContext?

    weak var store: LocalAlarmStore?

    /// `now()` 를 주입 가능하게 만들어 테스트에서 clock 을 고정한다.
    var nowProvider: () -> Date = { Date() }

    /// PR3: dismiss 시 다음 발화 시각 재계산에 쓰는 공휴일 술어. 기본은
    /// `LocalHolidayCalendar` 고정 규칙이고, AlarmTalkApp 이 `HolidayStore`
    /// 기반 predicate 로 덮어써 서버 sync 공휴일까지 반영한다 (Android dismiss 의
    /// full-predicate recompute parity).
    var holidayPredicate: (Date) -> Bool = { LocalHolidayCalendar.isHoliday($0) }

    /// PR3: `.fixed` 공휴일off one-shot 의 OS 재무장 훅. AlarmAppContext 가
    /// ViewModel 을 강하게 잡지 않도록(weak-singleton 설계 보존) 클로저 간접 호출로
    /// 둔다. AlarmTalkApp 이 `alarmKit.rearmIfHolidayOffOneShot` 로 연결한다.
    /// 기본은 no-op 이라 테스트/콜드부팅에서 안전하다.
    var rearmHolidayOffOneShot: (String) async -> Void = { _ in }

    init(store: LocalAlarmStore) {
        self.store = store
        AlarmAppContext.shared = self
    }

    // MARK: - Stop / Dismiss

    /// LiveActivity 의 Stop 버튼 또는 alarmUpdates 의 disappearance 양쪽에서 호출된다.
    /// markStopped 가 alarmKitID 매칭이 안 되면 no-op 이므로 두 경로가 같은 stop 을
    /// emit 해도 안전하다.
    func handleAlarmStopped(alarmKitIDString: String) async {
        guard let store else { return }
        let recordBeforeStop = store.recordByAlarmKitID(alarmKitIDString)
        // markStopped 는 alarmKitID 매칭이 안 되면 no-op 이므로 안전.
        // PR3: 공휴일 술어를 넘겨 store 측 fireAtMillis 전진을 공휴일-정확하게 만든다
        // (Android dismiss 의 full-predicate recompute parity).
        store.markStopped(alarmKitID: alarmKitIDString, isHoliday: holidayPredicate)

        // PR3: `.fixed` 공휴일off one-shot 은 markStopped 후 OS 재무장이 필요하다.
        // markStopped 가 해당 서브셋의 alarmKitID 를 nil 로 비워두었고, 재무장 훅은
        // alarmKitID==nil guard 로 멱등하다 (StopAlarmIntent + disappearance 중복 안전).
        // 두 dismiss 진입점이 여기로 수렴하므로 dismiss-time 재무장의 1차 경로.
        if recordBeforeStop?.isHolidayOffRecurring == true,
           let id = recordBeforeStop?.id {
            await rearmHolidayOffOneShot(id)
        }
    }

    // MARK: - Snooze

    /// 스누즈 가부를 3-state 로 구분한다.
    /// - `.allow`: 기록이 로드돼 있고 다시 울림 가능.
    /// - `.deny` : 기록이 로드돼 있고 한도 도달 / 다시 울림 비활성.
    /// - `.unknown`: store 미주입이거나 디스크 로드 전, 또는 기록을 찾지 못함 —
    ///   판단 근거가 없으므로 호출 측은 안전한 기본값(다시 울림)으로 처리해야 한다.
    ///
    /// 콜드 부팅으로 `LocalAlarmStore` 의 async 디스크 로드가 끝나기 전 스누즈가
    /// 들어오면 `recordByAlarmKitID` 가 nil 이라, 단순 Bool 로는 "한도 도달" 과
    /// 구분되지 않아 알람을 꺼버리는 회귀가 있었다. `hasLoadedFromDisk` 와 기록
    /// 존재 여부를 `.deny` 판단에서 분리해 그 회귀를 막는다.
    func snoozeDecision(alarmKitIDString: String) -> AlarmSnoozeDecision {
        guard let store, store.hasLoadedFromDisk else { return .unknown }
        guard let record = store.recordByAlarmKitID(alarmKitIDString) else { return .unknown }
        return record.canSnooze ? .allow : .deny
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

        store.markSnoozed(
            id: record.id,
            newFireAtMillis: newFireAtMillis,
            incrementCount: true
        )
    }
}

/// 스누즈 인텐트가 알람을 종료(한도 도달)할지, 다시 울릴지 판단한 결과.
/// `.unknown` 은 store 미로딩/기록없음 등 판단 불가 상태로, 호출 측에서는
/// 안전하게 다시 울림으로 처리한다.
enum AlarmSnoozeDecision {
    case allow
    case deny
    case unknown
}

// MARK: - LocalAlarmStore convenience

extension LocalAlarmStore {
    /// 명세에서 요구하는 alias. 기존 `record(alarmKitID:)` 와 동일하지만
    /// 호출 사이트에서 의도가 더 명시적이다.
    func recordByAlarmKitID(_ alarmKitID: String) -> LocalAlarmRecord? {
        record(alarmKitID: alarmKitID)
    }
}
