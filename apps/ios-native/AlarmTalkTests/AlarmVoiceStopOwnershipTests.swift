import XCTest
@testable import AlarmTalk

/// 울릴 때 난 목소리를 **누가·언제** 끄는가에 대한 회귀 테스트.
///
/// 2026-08-07 에 두 가지가 동시에 잘못돼 있었다:
///  1. `stop()` 호출부가 '알람이 목록에서 사라졌을 때' 하나뿐이라, **스누즈**와
///     **주간 반복 알람의 끄기**에서는 목소리가 안 멈췄다(둘 다 알람이 목록에 남는다).
///  2. 그 하나마저 소유권 확인 없이 무조건 껐다 — 남의 알람을 지우면 지금 울리는
///     알람의 목소리가 끊겼다.
///
/// 그래서 판정은 `AlarmAppContext.stopVoiceIfOwnedStatic(by:)` 한 곳으로 모았고,
/// 이 테스트가 그 규칙을 고정한다.
final class AlarmVoiceStopOwnershipTests: XCTestCase {

    @MainActor
    func test_소유자가_같으면_끈다() {
        AlarmVoicePlayer.shared.stop()
        AlarmVoicePlayer.shared.debugSetCurrentRecordID("alarm-A")
        AlarmAppContext.stopVoiceIfOwnedStatic(by: "alarm-A")
        XCTAssertNil(
            AlarmVoicePlayer.shared.currentRecordID,
            "자기 알람이면 목소리를 꺼야 한다"
        )
    }

    @MainActor
    func test_다른_알람이면_끄지_않는다() {
        AlarmVoicePlayer.shared.stop()
        AlarmVoicePlayer.shared.debugSetCurrentRecordID("alarm-A")
        AlarmAppContext.stopVoiceIfOwnedStatic(by: "alarm-B")
        XCTAssertEqual(
            AlarmVoicePlayer.shared.currentRecordID,
            "alarm-A",
            "다른 알람이 사라졌다고 울리는 알람의 목소리를 끊으면 안 된다"
        )
        AlarmVoicePlayer.shared.stop()
    }

    @MainActor
    func test_대상을_모르면_끈다() {
        AlarmVoicePlayer.shared.stop()
        AlarmVoicePlayer.shared.debugSetCurrentRecordID("alarm-A")
        AlarmAppContext.stopVoiceIfOwnedStatic(by: nil)
        XCTAssertNil(
            AlarmVoicePlayer.shared.currentRecordID,
            "대상을 모르면 끄는 쪽이 안전하다 — 소리가 남는 게 더 나쁘다"
        )
    }
}
