import Foundation

/// 목소리를 등록할 때 고르는 **목소리 높이**(반음 — 화면 이름은 `톤 조절`). 규칙은 `docs/spec/voice-and-message.md` §4-3.
///
/// 등록 미리듣기 화면(`VoicePreviewConfirmView`)에서 들으면서 고르고, 등록을 확정하는 요청에 **한 번** 싣는다
/// (`VoiceDraftPromoteRequest.pitchSemitones`). 서버가 그 값을 목소리에 적어 두고, 그 목소리로 만드는 **모든 알람
/// 소리에 굽는다** — 공유받은 가족·가족 알람을 받는 사람·다른 기기도 같은 소리를 듣는다. 앱은 받은 파일을 그대로 튼다.
///
/// ⚠ **이 값을 기기에 저장하거나 알람 소리에 다시 굽지 말 것.** 서버가 구운 파일에 한 번 더 걸린다. 높이는 등록
/// 확정 뒤에 바꿀 수 없다(서버가 409 `VOICE_PITCH_LOCKED` 로 거절한다) — 다시 고르려면 교체 등록이다.
///
/// 높이는 TD-PSOLA(`VoicePitchShifter`)로 바꾼다 — 목소리 몸집(포먼트)은 그대로 두고 높이만
/// 움직인다. `AVAudioUnitTimePitch` 는 몸집까지 같이 움직여 변조된 목소리로 들렸다(2026-10-07
/// 사용자 판단). 음량·굵기 슬라이더도 같은 날 뺐다 — 크기는 원래 미리듣기와 같게 되맞춘다.
///
/// 범위·눈금은 서버·안드로이드 슬라이더와 **같은 숫자**여야 한다 — 서버보다 넓으면 고른 값이 400
/// `INVALID_VOICE_PITCH` 로 거절되고, 안드로이드와 다르면 한쪽에서만 고를 수 있는 높이가 생긴다.
struct VoiceTuning: Equatable, Sendable {
    /// 값이 어디서 왔는가. 소리와 무관하다 — 사용자가 고른 값을 새 추천값이 덮지 않게 하는 데만 쓴다.
    enum Source: Sendable {
        /// 자동 추천값 그대로(사용자가 슬라이더를 건드리지 않았다).
        case suggested
        /// 사용자가 슬라이더로 바꿨다.
        case user
    }

    /// 목소리 높이(반음). 길이는 바꾸지 않는다.
    var pitchSt: Double
    var source: Source

    /// 2026-10-08 에 −6…+3 에서 넓혔다 — v4 Turbo 가 저음을 8반음 넘게 올리는 경우가 있었다(사용자). 서버
    /// `VOICE_PITCH_MIN_SEMITONES`·`VOICE_PITCH_MAX_SEMITONES` 와 같은 숫자다.
    static let pitchRange: ClosedRange<Double> = -10...6
    static let step: Double = 0.5

    static let neutral = VoiceTuning(pitchSt: 0, source: .suggested)

    /// 범위 안으로 자르고 눈금(0.5)에 맞춘다. 굽기·비교·전송 전에 언제나 거친다 —
    /// 0.49999 같은 값이 서버에서 눈금 밖으로 거절되지 않게.
    func normalized() -> VoiceTuning {
        VoiceTuning(pitchSt: Self.snap(pitchSt, to: Self.pitchRange), source: source)
    }

    /// 원래 소리(0)인가.
    var isNeutral: Bool { normalized().pitchSt == 0 }

    /// 들리는 소리가 같은가(출처는 보지 않는다).
    func soundsSame(as other: VoiceTuning) -> Bool { normalized().pitchSt == other.normalized().pitchSt }

    private static func snap(_ value: Double, to range: ClosedRange<Double>) -> Double {
        guard value.isFinite else { return 0 }
        let snapped = (value / step).rounded(.toNearestOrAwayFromZero) * step
        let clamped = min(max(snapped, range.lowerBound), range.upperBound)
        // -0.0 을 0 으로 — 표시에 "-0" 이 나오지 않게.
        return clamped == 0 ? 0 : clamped
    }
}
