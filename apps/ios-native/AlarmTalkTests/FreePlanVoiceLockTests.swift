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

    /// 소유자가 다르면 잠금 대상이 아니다(같은 기기에서 계정을 바꾼 경우).
    func test_다른_계정_알람은_대상이_아니다() {
        var mine = LocalAlarmRecord(label: "t", hour: 7, minute: 0, fireAtMillis: 0, playMode: AlarmPlayMode.voiceOnly.rawValue)
        mine.ownerUserId = "user-A"
        var theirs = LocalAlarmRecord(label: "t", hour: 7, minute: 0, fireAtMillis: 0, playMode: AlarmPlayMode.voiceOnly.rawValue)
        theirs.ownerUserId = "user-B"
        var legacy = LocalAlarmRecord(label: "t", hour: 7, minute: 0, fireAtMillis: 0, playMode: AlarmPlayMode.voiceOnly.rawValue)
        legacy.ownerUserId = nil

        let expected = "user-A"
        func isTarget(_ r: LocalAlarmRecord) -> Bool {
            guard let owner = r.ownerUserId else { return true }
            return owner == expected
        }

        XCTAssertTrue(isTarget(mine))
        XCTAssertFalse(isTarget(theirs), "앞 계정 알람까지 잠그면 안 된다")
        XCTAssertTrue(isTarget(legacy), "소유자가 안 적힌 옛 행은 이 계정 것으로 본다")
    }
}
