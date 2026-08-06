import XCTest
@testable import AlarmTalk

final class AlarmUserCopyTests: XCTestCase {

    func test_authorizationDisplayLabel_mapsSystemStatesToKorean() {
        XCTAssertEqual(AlarmKitViewModel.authorizationDisplayLabel("authorized"), "허용됨")
        XCTAssertEqual(AlarmKitViewModel.authorizationDisplayLabel("notAuthorized"), "거부됨")
        XCTAssertEqual(AlarmKitViewModel.authorizationDisplayLabel("notDetermined"), "확인 필요")
        XCTAssertEqual(AlarmKitViewModel.authorizationDisplayLabel("unavailable"), "사용 불가")
    }

    func test_voiceRecorderMicrophoneDeniedCopy_isKorean() {
        XCTAssertEqual(
            VoiceRecorderError.microphoneDenied.errorDescription,
            "녹음하려면 마이크 권한이 필요해요."
        )
    }

    // MARK: - 권한 문구는 상태가 아니라 결과를 말한다

    /// 권한 없음의 **결과**를 말해야 한다. 필 라벨("거부됨")은 상태 이름일 뿐이라
    /// 무엇을 잃는지 알려 주지 않는다.
    func test_deniedConsequence_statesThatAlarmsDoNotRing() {
        let copy = AlarmKitViewModel.alarmDeniedConsequence
        XCTAssertTrue(copy.contains("울리지 않"), "권한이 없으면 안 울린다는 사실을 말해야 한다: \(copy)")
    }

    /// ⚠ **안드로이드 문구를 그대로 옮겨 오면 거짓말이 된다.**
    /// 안드로이드는 권한이 없어도 `RingingService` 가 소리를 직접 내므로 "울리긴 하되
    /// 알림만 안 뜬다" 가 사실이지만, iOS 는 `AlarmManager.schedule` 이 던져 **예약 자체가
    /// 안 된다.** "알림이 뜨지 않아요" 류로 순화하면 안 울릴 알람을 울릴 것으로 믿게 만든다.
    func test_deniedConsequence_doesNotInheritAndroidNotificationOnlyFraming() {
        let copy = AlarmKitViewModel.alarmDeniedConsequence
        XCTAssertFalse(copy.contains("알림이 뜨지"), "iOS 는 알림만 막히는 게 아니다: \(copy)")
        XCTAssertFalse(copy.contains("늦게"), "iOS 는 지연이 아니라 아예 예약되지 않는다: \(copy)")
    }

    /// 거부가 굳으면 iOS 는 권한 프롬프트를 **다시 띄우지 않는다.** 그 상태에서
    /// "다시 시도" 를 안내하면 눌러도 아무 일이 없는 버튼을 계속 누르게 만든다.
    func test_recoveryMessage_pointsToSettingsInsteadOfRetry() {
        let copy = AlarmKitViewModel.alarmRecoveryMessage
        XCTAssertTrue(copy.contains("설정"), "유일한 복구 경로(설정)를 말해야 한다: \(copy)")
        XCTAssertFalse(copy.contains("다시 시도"), "재시도로는 프롬프트가 뜨지 않는다: \(copy)")
        XCTAssertTrue(copy.contains(AlarmKitViewModel.alarmDeniedConsequence), "결과도 함께 말한다")
    }

    /// 굳은 거부(`denied`/`restricted`)만 설정 우회가 필요하다.
    /// `notDetermined` 는 아직 일반 프롬프트로 회복 가능하므로 설정으로 보내면 안 된다.
    func test_permissionRecoveryNeeded_onlyForHardenedDenial() {
        XCTAssertTrue(AlarmKitViewModel.isPermissionRecoveryNeeded("denied"))
        XCTAssertTrue(AlarmKitViewModel.isPermissionRecoveryNeeded("notAuthorized"))
        XCTAssertTrue(AlarmKitViewModel.isPermissionRecoveryNeeded("restricted"))
        XCTAssertFalse(AlarmKitViewModel.isPermissionRecoveryNeeded("notDetermined"))
        XCTAssertFalse(AlarmKitViewModel.isPermissionRecoveryNeeded("authorized"))
    }
}
