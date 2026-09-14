import XCTest
@testable import AlarmTalk

/// **직접 녹음으로 맞추는 알람은 유료 기능이 아니다**(2026-08-12 확정).
///
/// 내 폰에 있는 파일을 그대로 재생하는 것이라 서버 자산을 하나도 쓰지 않는다 —
/// 클론 목소리·서버 생성 클립과는 다른 축이다.
///
/// ⚠ **이 규칙은 네 층에 흩어져 있어 한 곳만 고치면 반드시 어긋난다.**
///  1. 목소리 시트의 '직접 녹음' 행 잠금 (`AlarmEditorSheet.voiceOptions`)
///  2. 저장 게이트 (`usesFreeSystemVoiceSelection` → `editorSaveBlockedReason`)
///  3. 예약 시점 강등 (`PaidVoiceGate.usesFreeSystemVoice` → `shouldDowngrade`)
///  4. 무료 강등 잠금 (`LocalAlarmRecord.isPaidVoiceForDowngrade` → `paidAlarmTalks`)
///
/// 3 과 4 는 **한 쌍**이다. 한쪽만 고치면 "예약은 목소리로 되는데 앱을 껐다 켜면 잠긴다"
/// (또는 그 반대)가 된다. 아래 테스트가 그 짝을 함께 고정한다.
final class LocalRecordingIsFreeTests: XCTestCase {

    private func recording(localAudioUri: String? = "file:///rec.m4a") -> LocalAlarmRecord {
        var record = LocalAlarmRecord(
            label: "t", hour: 7, minute: 0, fireAtMillis: 0,
            playMode: AlarmPlayMode.voiceOnly.rawValue
        )
        record.voiceSource = VoiceSource.localAudio.rawValue
        record.localAudioUri = localAudioUri
        return record
    }

    // MARK: 3 — 예약 시점 강등에서 면제

    func test_녹음알람은_무료에서_강등되지_않는다() {
        let record = recording()
        XCTAssertTrue(
            PaidVoiceGate.usesFreeSystemVoice(record),
            "직접 녹음은 무료에서 허용되는 자산이다"
        )
        XCTAssertFalse(
            PaidVoiceGate.shouldDowngrade(record: record, snapshot: .empty),
            "권한이 비어도(= 무료) 녹음 알람은 알람음으로 내려가면 안 된다"
        )
    }

    // MARK: 4 — 무료 강등 잠금에서 면제

    func test_녹음알람은_무료_강등_잠금_대상이_아니다() {
        XCTAssertFalse(
            recording().isPaidVoiceForDowngrade,
            "녹음 알람이 잠기면 다음 앱 시작에서 알람음으로 되돌아간다"
        )
    }

    // MARK: 빈 껍데기를 '녹음' 으로 오인하지 않는다

    /// 강등 표식은 **소스만 남기고 파일은 지운다**(`voiceSource=localAudio`,
    /// `localAudioUri=nil`). 그걸 녹음으로 읽으면 소리가 없는 알람이 무료로 통과한다.
    func test_파일없는_껍데기는_녹음으로_치지_않는다() {
        let empty = recording(localAudioUri: nil)
        XCTAssertFalse(
            PaidVoiceGate.usesFreeSystemVoice(empty),
            "파일이 없으면 녹음 알람이 아니다"
        )
    }

    // MARK: 유료 자산은 그대로 막힌다

    /// 이 변경이 **클론 목소리까지 열어 주면 안 된다.**
    func test_클론_목소리_알람은_여전히_유료다() {
        var clone = LocalAlarmRecord(
            label: "t", hour: 7, minute: 0, fireAtMillis: 0,
            playMode: AlarmPlayMode.voiceOnly.rawValue
        )
        clone.voiceSource = VoiceSource.ttsProfile.rawValue
        clone.voiceProfileId = "11111111-1111-1111-1111-111111111111"
        clone.ttsMessageId = "22222222-2222-2222-2222-222222222222"
        clone.localAudioUri = "file:///tts.mp3"

        XCTAssertFalse(
            PaidVoiceGate.usesFreeSystemVoice(clone),
            "클론 목소리는 서버 자산이라 유료다"
        )
        XCTAssertTrue(
            clone.isPaidVoiceForDowngrade,
            "클론 알람은 무료 전환 시 잠겨야 한다"
        )
    }
}
