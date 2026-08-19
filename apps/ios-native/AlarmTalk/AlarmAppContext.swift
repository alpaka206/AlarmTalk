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
        // ⚠ **소리를 먼저 끈다.** 예전에는 `AlarmVoicePlayer.stop()` 호출부가
        // `AlarmKitViewModel` 의 '알람이 목록에서 사라졌을 때' 하나뿐이었는데,
        // **주간 반복 알람은 정지해도 목록에 남으므로**(AlarmKit 이 recurrence 를 소유)
        // 그 분기가 아예 안 돌아 목소리가 계속 났다. 시스템 알럿은 이미 사라진 뒤라
        // 화면에 멈출 버튼이 없어 앱을 강제 종료해야 그쳤다.
        // 안드로이드는 어떤 경로로 끝나든 `stopRingingOutputs` 를 먼저 부른다.
        stopVoiceIfOwned(by: recordBeforeStop?.id)
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

        // ⚠ **무료 테마 반복 알람은 다음 클립으로 다시 예약해야 한다.**
        // AlarmKit 은 사운드 파일을 **예약할 때** 받아 간다 — `markStopped` 가 회전
        // 인덱스를 올려도, 다시 예약하지 않으면 OS 는 지난 회차의 파일을 그대로 울린다.
        //
        // 공휴일off 반복은 위 재무장이 이미 같은 일을 하므로 건너뛴다(이중 예약 방지).
        if let record = recordBeforeStop,
           record.bucketId != nil,
           (record.bucketClipKeys?.count ?? 0) > 1,
           record.repeatDaysMask != 0,
           !record.isHolidayOffRecurring {
            await rescheduleForNextBucketClip(record.id)
        }
    }

    /// 회전한 클립으로 알람을 다시 예약한다. `AlarmTalkApp` 이 `AlarmKitViewModel` 로 잇는다.
    /// 기본은 no-op 이라 테스트·콜드부팅에서 안전하다.
    var rescheduleForNextBucketClip: (String) async -> Void = { _ in }

    /// 인스턴스가 없어도 같은 규칙을 쓰게 하는 진입점.
    /// `AlarmKitViewModel` 의 disappearance 루프가 `AlarmAppContext.shared == nil` 인
    /// 경로에서도 소유권 확인을 건너뛰지 않도록 static 으로 둔다.
    static func stopVoiceIfOwnedStatic(by recordID: String?) {
        #if ALARMTALK_APP
        guard let recordID else {
            AlarmVoicePlayer.shared.stop()
            return
        }
        if AlarmVoicePlayer.shared.currentRecordID == nil
            || AlarmVoicePlayer.shared.currentRecordID == recordID {
            AlarmVoicePlayer.shared.stop()
        }
        #endif
    }

    /// 지금 재생 중인 목소리가 **이 알람의 것일 때만** 끈다.
    ///
    /// 안드로이드 `RingingService.ringingTeardownBelongsToCurrentAlarm`(Codex #666 P1)과
    /// 같은 규칙이다 — 늦게 도는 마무리가 이미 다른 알람으로 넘어간 재생을 끄면
    /// **새로 울리는 알람이 소리 없이 살아 있다.**
    ///
    /// 대상을 모르면(레코드를 못 찾음) 끈다 — 소리가 남는 쪽이 더 나쁘다.
    func stopVoiceIfOwned(by recordID: String?) {
        Self.stopVoiceIfOwnedStatic(by: recordID)
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
        // ⚠ **다시 울림에서도 소리를 끈다.** 스누즈는 같은 id 로 countdown 을 걸어
        // 알람이 목록에 **남으므로**, disappearance 분기는 절대 돌지 않는다. 이걸
        // 빠뜨리면 스누즈 5분 내내 목소리가 900ms 간격으로 반복된다.
        stopVoiceIfOwned(by: record.id)

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
