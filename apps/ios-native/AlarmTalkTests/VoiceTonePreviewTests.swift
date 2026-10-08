import XCTest
@testable import AlarmTalk

/// 등록 확정 화면 톤 카드의 두 재생 버튼(`원본 듣기`·`현재 톤 듣기`) 규칙 — 스펙 voice-and-message §4-3
/// 「누가 어디서 바꾸는가」. 소리는 내지 않는다(순수 셈만 본다).
final class VoiceTonePreviewTests: XCTestCase {

    private func tone(_ semitones: Double) -> VoiceTuning {
        VoiceTuning(pitchSt: semitones, source: .user)
    }

    // MARK: - 누르기

    /// 트는 중인 버튼을 다시 누르면 멈추고, 다른 버튼을 누르면 그것을 처음부터 튼다. 서버에서 받는 동안도 같은 셈이다 —
    /// `active` 는 받은 뒤에 틀 버튼(진행 표시가 도는 버튼)이고, 그 버튼을 누르면 받기만 하고(받은 뒤 틀지 않는다) 다른
    /// 버튼을 누르면 받은 뒤에 그것을 튼다(화면이 받는 중이면 새로 받지 않는다).
    func test_press_togglesTheActiveButtonAndSwitchesToTheOther() {
        XCTAssertEqual(VoiceTonePreview.press(.original, active: nil), .play(.original))
        XCTAssertEqual(VoiceTonePreview.press(.current, active: nil), .play(.current))
        XCTAssertEqual(VoiceTonePreview.press(.current, active: .current), .stop)
        XCTAssertEqual(VoiceTonePreview.press(.original, active: .original), .stop)
        XCTAssertEqual(VoiceTonePreview.press(.original, active: .current), .play(.original))
        XCTAssertEqual(VoiceTonePreview.press(.current, active: .original), .play(.current))
    }

    /// 원본 듣기는 막대와 상관없이 0 이다. 현재 톤은 막대 값을 눈금에 맞춰 싣는다.
    func test_target_originalIsAlwaysZeroAndCurrentFollowsTheSlider() {
        XCTAssertEqual(VoiceTonePreview.target(of: .original, slider: tone(-3)).pitchSt, 0)
        XCTAssertTrue(VoiceTonePreview.target(of: .original, slider: tone(4)).isNeutral)
        XCTAssertEqual(VoiceTonePreview.target(of: .current, slider: tone(-3.2)).pitchSt, -3)
        XCTAssertEqual(VoiceTonePreview.target(of: .current, slider: tone(-12)).pitchSt, -10)
    }

    // MARK: - 들은 높이

    /// '들었다' 는 **실제로 걸린** 높이로 센다 — 원본 듣기·굽지 못함·구운 소리 대신 원본은 0 이다(Codex #870).
    func test_applied_countsWhatActuallyPlayed() {
        let target = tone(-2.5)
        XCTAssertEqual(
            VoiceTonePreview.applied(.current, target: target, baked: true, playedOriginalInstead: false).pitchSt,
            -2.5
        )
        XCTAssertEqual(
            VoiceTonePreview.applied(.current, target: target, baked: true, playedOriginalInstead: true).pitchSt,
            0,
            "구운 소리가 깨져 원본을 대신 틀었으면 0 을 들은 것이다"
        )
        XCTAssertEqual(
            VoiceTonePreview.applied(.current, target: target, baked: false, playedOriginalInstead: false).pitchSt,
            0,
            "굽지 못해 원본을 틀었으면 0 을 들은 것이다"
        )
        XCTAssertEqual(
            VoiceTonePreview.applied(.original, target: .neutral, baked: false, playedOriginalInstead: false).pitchSt,
            0
        )
        // 막대가 0 이면 굽지 않는다 — 원본을 틀어도 고른 값(0)을 들은 것이다.
        XCTAssertTrue(
            VoiceTonePreview.applied(.current, target: tone(0), baked: false, playedOriginalInstead: false)
                .soundsSame(as: tone(0))
        )
    }

    /// 두 버튼을 번갈아 들어도 저장이 잠기지 않는다 — 막대 값은 이미 끝까지 들었다(2026-10-08 사용자: 번갈아 듣기).
    func test_hearing_keepsEveryPitchHeardToTheEnd() {
        var hearing = VoiceTonePreview.Hearing()
        XCTAssertFalse(hearing.hasHeard(tone(-3)))

        hearing.record(tone(-3))
        hearing.record(.neutral)  // 원본 듣기를 끝까지
        XCTAssertTrue(hearing.hasHeard(tone(-3)))
        XCTAssertTrue(hearing.hasHeard(tone(0)))
        XCTAssertTrue(hearing.hasHeard(tone(-3.1)), "눈금에 맞춘 뒤 비교한다")
        XCTAssertFalse(hearing.hasHeard(tone(-2.5)))
    }

    // MARK: - 저장

    /// 저장은 서버가 청취를 확인했고, 새 높이를 굽는 중이 아니고, **지금 막대 값**을 끝까지 들었을 때만 열린다.
    func test_canSave_requiresConfirmedListenOfTheCurrentSliderValue() {
        var hearing = VoiceTonePreview.Hearing()
        hearing.record(tone(-3))

        XCTAssertTrue(VoiceTonePreview.canSave(listenConfirmed: true, rendering: false, hearing: hearing, slider: tone(-3)))
        XCTAssertFalse(
            VoiceTonePreview.canSave(listenConfirmed: false, rendering: false, hearing: hearing, slider: tone(-3)),
            "서버가 청취를 기록하기 전에는 승격이 거절된다"
        )
        XCTAssertFalse(
            VoiceTonePreview.canSave(listenConfirmed: true, rendering: true, hearing: hearing, slider: tone(-3)),
            "새 높이를 굽는 중이다"
        )
        XCTAssertFalse(
            VoiceTonePreview.canSave(listenConfirmed: true, rendering: false, hearing: hearing, slider: tone(-4)),
            "듣지 않은 값이다"
        )
        // 원본 듣기를 끝까지 들었으면 0 을 들은 것이다.
        XCTAssertFalse(VoiceTonePreview.canSave(listenConfirmed: true, rendering: false, hearing: hearing, slider: tone(0)))
        hearing.record(VoiceTonePreview.applied(.original, target: .neutral, baked: false, playedOriginalInstead: false))
        XCTAssertTrue(VoiceTonePreview.canSave(listenConfirmed: true, rendering: false, hearing: hearing, slider: tone(0)))
        // 원본마저 못 틀었으면(깨짐) 아무것도 적지 않는다 — 빈 기록으로는 어떤 값도 저장할 수 없다.
        XCTAssertFalse(
            VoiceTonePreview.canSave(listenConfirmed: true, rendering: false, hearing: .init(), slider: tone(0))
        )
    }

    // MARK: - 잠금표

    /// 확정 화면의 잠금표(안드로이드 `confirmStepLocks` 와 같은 표). 서버 일 다섯 — 받기·청취 확인·문구 저장·등록 확정·초안
    /// 삭제 — 중 하나라도 돌면 `working`(뒤로·다시 만들기·저장하기·공유·문구 고치기를 잠근다)이다. 톤 카드는 입력칸이 열린
    /// 동안·문구 저장·등록 확정/초안 삭제 중에만 잠근다 — 받는 동안·청취 확인 중에도 두 버튼은 누를 수 있다(받는 중의 진행
    /// 표시도 '트는 중' 이다).
    func test_locks_matchTheConfirmStepTable() {
        func locks(
            fetching: Bool = false,
            confirming: Bool = false,
            saving: Bool = false,
            busy: Bool = false,
            editing: Bool = false
        ) -> VoicePreviewConfirmView.Locks {
            VoicePreviewConfirmView.locks(
                fetching: fetching,
                confirming: confirming,
                saving: saving,
                busy: busy,
                editing: editing
            )
        }
        XCTAssertEqual(locks(), .init(working: false, toneEnabled: true))
        XCTAssertEqual(locks(fetching: true), .init(working: true, toneEnabled: true), "받는 동안에도 두 버튼은 살아 있다")
        XCTAssertEqual(locks(confirming: true), .init(working: true, toneEnabled: true))
        XCTAssertEqual(locks(saving: true), .init(working: true, toneEnabled: false), "문구 저장·등록 확정 중")
        XCTAssertEqual(locks(busy: true), .init(working: true, toneEnabled: false), "등록 확정·초안 삭제 중")
        XCTAssertEqual(
            locks(editing: true),
            .init(working: false, toneEnabled: false),
            "입력칸이 열린 동안은 옛 문구의 소리를 굽지도 틀지도 않는다"
        )
    }

    // MARK: - 막대

    /// 첫 재생(청취 확인 전)이 소리 나는 중이면 끊지 않고 끝난 뒤로 미룬다. 그 밖에는 곧바로 현재 톤을 다시 튼다.
    /// 받은 클립이 없으면 막대는 아무것도 하지 않는다(서버를 부르지 않는다).
    func test_sliderRelease_defersOnlyDuringTheFirstAudiblePlayback() {
        XCTAssertEqual(
            VoiceTonePreview.sliderReleased(hasClip: false, listenConfirmed: false, audible: false),
            .ignore
        )
        XCTAssertEqual(
            VoiceTonePreview.sliderReleased(hasClip: false, listenConfirmed: true, audible: true),
            .ignore
        )
        XCTAssertEqual(
            VoiceTonePreview.sliderReleased(hasClip: true, listenConfirmed: false, audible: true),
            .afterCurrentPlayback
        )
        // 첫 재생이 아직 굽는 중(소리 전)이면 새 값으로 다시 굽는다 — 끊을 소리가 없다.
        XCTAssertEqual(
            VoiceTonePreview.sliderReleased(hasClip: true, listenConfirmed: false, audible: false),
            .replayNow
        )
        XCTAssertEqual(
            VoiceTonePreview.sliderReleased(hasClip: true, listenConfirmed: true, audible: true),
            .replayNow
        )
        XCTAssertEqual(
            VoiceTonePreview.sliderReleased(hasClip: true, listenConfirmed: true, audible: false),
            .replayNow
        )
    }
}
