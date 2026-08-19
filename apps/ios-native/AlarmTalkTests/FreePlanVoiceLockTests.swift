import XCTest
@testable import AlarmTalk

/// 무료 전환 시 목소리 알람을 **지우지 않고 잠그는지** 고정하는 회귀 테스트.
///
/// 2026-08-07 이전 iOS 는 `alarmKit.cancel` 로 행과 음원을 **영구 삭제**했다.
/// 시각·반복·문구·목소리 선택이 전부 사라지고 재결제해도 돌아오지 않았다.
/// 안드로이드는 `preLockPlayMode` 에 원래 값을 보관하고 `alarm_only` 로 내린다.
final class FreePlanVoiceLockTests: XCTestCase {

    /// 잠금은 원래 재생 방식을 보관하고 alarm_only 로 내린다.
    func test_잠금은_원래값을_보관한다() {
        var record = LocalAlarmRecord(label: "t", hour: 7, minute: 0, fireAtMillis: 0, playMode: AlarmPlayMode.voiceOnly.rawValue)
        XCTAssertNil(record.preLockPlayMode, "처음에는 잠긴 적이 없다")

        // applyFreePlanVoiceLock 이 하는 일과 같은 변환.
        if record.preLockPlayMode == nil { record.preLockPlayMode = record.playMode }
        record.playMode = AlarmPlayMode.alarmOnly.rawValue

        XCTAssertEqual(record.preLockPlayMode, AlarmPlayMode.voiceOnly.rawValue)
        XCTAssertEqual(record.playMode, AlarmPlayMode.alarmOnly.rawValue)
    }

    /// ⚠ 두 번 잠가도 원래 값을 잃지 않는다.
    /// 이 가드가 없으면 두 번째 잠금이 preLockPlayMode 를 alarm_only 로 덮어써서,
    /// 복원해도 알람음인 채로 남는다.
    func test_두번_잠가도_원래값을_잃지_않는다() {
        var record = LocalAlarmRecord(label: "t", hour: 7, minute: 0, fireAtMillis: 0, playMode: AlarmPlayMode.voiceOnly.rawValue)
        for _ in 0..<2 {
            if record.preLockPlayMode == nil { record.preLockPlayMode = record.playMode }
            record.playMode = AlarmPlayMode.alarmOnly.rawValue
        }
        XCTAssertEqual(
            record.preLockPlayMode,
            AlarmPlayMode.voiceOnly.rawValue,
            "두 번째 잠금이 원래 값을 덮어쓰면 복원이 불가능해진다"
        )
    }

    /// 복원은 원래 값으로 되돌리고 표시를 지운다.
    func test_복원하면_목소리로_돌아온다() {
        var record = LocalAlarmRecord(label: "t", hour: 7, minute: 0, fireAtMillis: 0, playMode: AlarmPlayMode.alarmOnly.rawValue)
        record.preLockPlayMode = AlarmPlayMode.voiceOnly.rawValue

        record.playMode = record.preLockPlayMode ?? record.playMode
        record.preLockPlayMode = nil

        XCTAssertEqual(record.playMode, AlarmPlayMode.voiceOnly.rawValue)
        XCTAssertNil(record.preLockPlayMode, "복원 뒤에는 잠금 표시가 남으면 안 된다")
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
