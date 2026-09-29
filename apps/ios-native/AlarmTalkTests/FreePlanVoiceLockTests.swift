import XCTest
@testable import AlarmTalk

/// 무료 전환 시 목소리 알람을 **지우지 않고 기본 목소리 알람으로 잠그는지** 고정하는 회귀 테스트.
///
/// 2026-08-07 이전 iOS 는 `alarmKit.cancel` 로 행과 음원을 **영구 삭제**했다.
/// 시각·반복·문구·목소리 선택이 전부 사라지고 재결제해도 돌아오지 않았다.
/// 2026-09-29 전에는 `alarm_only` 로 내려 목록·편집기에서 **그냥 기본 알람**이 됐다(dev 리허설 —
/// 안드로이드는 그 모양이 무음으로 울렸다). 이제 재생 방식은 그대로 두고 목소리만 기본 목소리로
/// 바꾼다 — `DefaultVoiceSubstitute.locked` / `restored`(안드로이드 `lockedToDefaultVoice` /
/// `restoredFromLock` 미러). 규칙: `docs/spec/billing-lifecycle.md` 「목소리를 못 쓰게 되면」.
final class FreePlanVoiceLockTests: XCTestCase {

    private let systemVoice = bundledSystemVoiceProfiles()[0].id

    private func cloneAlarm() -> LocalAlarmRecord {
        var record = LocalAlarmRecord(label: "t", hour: 7, minute: 0, fireAtMillis: 0, playMode: AlarmPlayMode.voiceOnly.rawValue)
        record.voiceProfileId = "clone-a"
        record.audioCacheKey = "stock_clone-greeting-0"
        record.localAudioUri = "stock_clone-greeting-0.mp3"
        record.ttsMessageId = "clone-greeting-0"
        record.bucketId = "greeting"
        record.voiceRandomContext = RandomPromptContext.preset.rawValue
        return record
    }

    /// 잠금은 원래 재생 방식·목소리를 보관하고 **목소리 모드 그대로** 기본 목소리로 바꾼다.
    func test_잠금은_원래값을_보관하고_기본_목소리로_바꾼다() {
        let record = cloneAlarm()
        XCTAssertNil(record.preLockPlayMode, "처음에는 잠긴 적이 없다")

        let locked = DefaultVoiceSubstitute.locked(record, voiceID: systemVoice, binding: nil, nowMillis: 1)

        XCTAssertEqual(locked.preLockPlayMode, AlarmPlayMode.voiceOnly.rawValue)
        XCTAssertEqual(locked.playMode, AlarmPlayMode.voiceOnly.rawValue, "'그냥 기본 알람' 이 되지 않는다")
        XCTAssertEqual(locked.voiceProfileId, systemVoice)
        XCTAssertEqual(locked.preLockVoice?.voiceProfileId, "clone-a")
        XCTAssertNil(locked.bucketId, "기본 목소리의 greeting 은 테마가 아니다")
        XCTAssertFalse(locked.isPaidVoiceForDowngrade, "이제 무료 기본 목소리 알람이다 — 다음 잠금 대상이 아니다")
    }

    /// ⚠ 두 번 잠가도 원래 값을 잃지 않는다.
    /// 이 가드가 없으면 두 번째 잠금이 보관본을 기본 목소리로 덮어써서 복원이 불가능해진다.
    func test_두번_잠가도_원래값을_잃지_않는다() {
        var record = cloneAlarm()
        for _ in 0..<2 {
            record = DefaultVoiceSubstitute.locked(record, voiceID: systemVoice, binding: nil, nowMillis: 1)
        }
        XCTAssertEqual(record.preLockPlayMode, AlarmPlayMode.voiceOnly.rawValue)
        XCTAssertEqual(record.preLockVoice?.voiceProfileId, "clone-a", "두 번째 잠금이 원래 값을 덮어쓰면 복원이 불가능해진다")
    }

    /// 옛 모양(`alarm_only` + `preLockPlayMode`)도 목소리 모드로 옮긴다.
    func test_옛_모양_잠금은_목소리_모드로_옮긴다() {
        var legacy = cloneAlarm()
        legacy.playMode = AlarmPlayMode.alarmOnly.rawValue
        legacy.preLockPlayMode = AlarmPlayMode.voiceOnly.rawValue

        let locked = DefaultVoiceSubstitute.locked(legacy, voiceID: systemVoice, binding: nil, nowMillis: 1)

        XCTAssertEqual(locked.playMode, AlarmPlayMode.voiceOnly.rawValue)
        XCTAssertEqual(locked.preLockPlayMode, AlarmPlayMode.voiceOnly.rawValue)
    }

    /// 복원은 원래 목소리로 되돌리고 표시를 지운다.
    func test_복원하면_원래_목소리로_돌아온다() {
        let original = cloneAlarm()
        let locked = DefaultVoiceSubstitute.locked(original, voiceID: systemVoice, binding: nil, nowMillis: 1)

        let restored = DefaultVoiceSubstitute.restored(locked, nowMillis: 2)

        XCTAssertEqual(restored.playMode, AlarmPlayMode.voiceOnly.rawValue)
        XCTAssertEqual(restored.voiceProfileId, original.voiceProfileId)
        XCTAssertEqual(restored.audioCacheKey, original.audioCacheKey)
        XCTAssertEqual(restored.ttsMessageId, original.ttsMessageId)
        XCTAssertEqual(restored.bucketId, original.bucketId)
        XCTAssertNil(restored.preLockPlayMode, "복원 뒤에는 잠금 표시가 남으면 안 된다")
        XCTAssertNil(restored.preLockVoice)
    }

    // MARK: - 한 번의 잠금 실행이 건드리는 행 (`FreePlanLockSelection` — `applyFreePlanVoiceLock` 의 선별)

    private func record(
        _ id: String,
        owner: String? = "user-A",
        playMode: AlarmPlayMode = .voiceOnly
    ) -> LocalAlarmRecord {
        var record = cloneAlarm()
        record.id = id
        record.ownerUserId = owner
        record.playMode = playMode.rawValue
        return record
    }

    /// 선별대로 한 번 실행한다 — 예약(AlarmKit)만 빼고 `applyFreePlanVoiceLock` 과 같은 변환이다.
    private func runLock(_ alarms: [LocalAlarmRecord], owner: String?) -> (newLocks: Int, alarms: [LocalAlarmRecord]) {
        let selection = FreePlanLockSelection(alarms: alarms, expectedOwnerUserId: owner)
        var byID = Dictionary(uniqueKeysWithValues: alarms.map { ($0.id, $0) })
        for record in selection.toUnlock { byID[record.id] = FreePlanLockSelection.unlocked(record) }
        for record in selection.toLock {
            byID[record.id] = DefaultVoiceSubstitute.locked(record, voiceID: systemVoice, binding: nil, nowMillis: 1)
        }
        return (selection.newLockCount, alarms.map { byID[$0.id]! })
    }

    /// 소유자가 다르면 잠금 대상이 아니다(같은 기기에서 계정을 바꾼 경우). 소유자가 안 적힌 옛 행은
    /// 이 계정 것으로 본다.
    func test_다른_계정_알람은_대상이_아니다() {
        let alarms = [record("mine"), record("theirs", owner: "user-B"), record("legacy", owner: nil)]

        let selection = FreePlanLockSelection(alarms: alarms, expectedOwnerUserId: "user-A")

        XCTAssertEqual(Set(selection.toLock.map(\.id)), ["mine", "legacy"], "앞 계정 알람까지 잠그면 안 된다")
    }

    /// ⚠ 새 모양으로 잠긴 행(보관본 있음)은 **되돌리기 대상도 잠금 대상도 아니다.** 그 행은 이제 무료
    /// 기본 목소리 알람이라 `isPaidVoiceForDowngrade` 가 거짓인데, 되돌리기 갈래에서 빼지 않으면
    /// 보관본을 버린 채 잠금이 풀린다 — 재결제해도 내 목소리가 돌아오지 않는다.
    func test_새_모양으로_잠긴_행은_건드리지_않는다() {
        let locked = DefaultVoiceSubstitute.locked(record("locked"), voiceID: systemVoice, binding: nil, nowMillis: 1)
        XCTAssertFalse(locked.isPaidVoiceForDowngrade, "전제 — 되돌리기 갈래의 조건에 걸리는 모양이다")

        let selection = FreePlanLockSelection(alarms: [locked], expectedOwnerUserId: "user-A")

        XCTAssertTrue(selection.toUnlock.isEmpty, "되돌리면 보관본을 버린 채 풀린다")
        XCTAssertTrue(selection.toLock.isEmpty)
    }

    /// 옛 모양(`alarm_only` + `preLockPlayMode`)은 옮기되 **세지 않는다** — 이미 알린 알람이다.
    /// 자격을 잃은 옛 잠금(무료 기본 목소리 알람인데 잠긴 행)은 재생 방식만 되돌린다.
    func test_옛_모양은_옮기되_세지_않고_자격_잃은_잠금은_푼다() {
        var legacy = record("legacy-lock", playMode: .alarmOnly)
        legacy.preLockPlayMode = AlarmPlayMode.voiceOnly.rawValue
        var stale = LocalAlarmRecord(id: "stale", label: "t", hour: 7, minute: 0, fireAtMillis: 0, playMode: AlarmPlayMode.alarmOnly.rawValue)
        stale.voiceProfileId = systemVoice
        stale.preLockPlayMode = AlarmPlayMode.voiceOnly.rawValue
        stale.ownerUserId = "user-A"

        let result = runLock([legacy, stale], owner: "user-A")

        XCTAssertEqual(result.newLocks, 0, "옛 모양을 옮긴 것으로 강등 모달을 다시 띄우지 않는다")
        let moved = result.alarms[0]
        XCTAssertEqual(moved.playMode, AlarmPlayMode.voiceOnly.rawValue)
        XCTAssertEqual(moved.voiceProfileId, systemVoice)
        XCTAssertEqual(moved.preLockVoice?.voiceProfileId, "clone-a")
        let unlocked = result.alarms[1]
        XCTAssertEqual(unlocked.playMode, AlarmPlayMode.voiceOnly.rawValue)
        XCTAssertNil(unlocked.preLockPlayMode)
    }

    /// ⚠ 두 번째 실행은 **아무것도 바꾸지 않고 0 을 돌려준다** — 안 그러면 앱을 열 때마다 강등 모달이
    /// 다시 뜬다(2026-08-11 "모달 계속 뜨네"). 안드로이드 `aSecondLockRunChangesNothingAndCountsNothing` 짝.
    func test_두번째_실행은_아무것도_바꾸지_않는다() {
        var legacy = record("legacy-lock", playMode: .alarmOnly)
        legacy.preLockPlayMode = AlarmPlayMode.voiceOnly.rawValue
        let first = runLock([record("fresh"), legacy], owner: "user-A")
        XCTAssertEqual(first.newLocks, 1, "처음 잠그는 행만 센다")

        let selection = FreePlanLockSelection(alarms: first.alarms, expectedOwnerUserId: "user-A")
        let second = runLock(first.alarms, owner: "user-A")

        XCTAssertTrue(selection.toLock.isEmpty)
        XCTAssertTrue(selection.toUnlock.isEmpty)
        XCTAssertEqual(second.newLocks, 0)
        XCTAssertEqual(second.alarms, first.alarms)
    }
}
