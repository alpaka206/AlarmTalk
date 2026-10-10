package com.alarmtalk.app.data

import kotlin.math.abs
import kotlin.math.floor

/**
 * 등록 미리듣기에서 들으며 고르는 **목소리 높이**. 규칙은 `docs/spec/voice-and-message.md` §4-3.
 *
 * - 앱은 **미리듣기만** 이 값으로 굽는다 — 서버가 준 초안 미리듣기(원래 소리)를 메모리에서 바꿔 튼다
 *   (`VoiceTuningRenderer`). 기기에 저장하지 않는다.
 * - 등록을 확정할 때 끝까지 들은 값을 **한 번** 서버에 보낸다(`PATCH /voice/:id` 의 `pitch_semitones`).
 *   서버가 그 목소리로 만드는 모든 알람 소리에 굽고, 앱은 받은 파일을 그대로 튼다 — 공유받은 가족·다른
 *   기기도 같은 소리를 듣는다. ⚠ 앱에서 알람 소리를 다시 굽지 말 것(서버가 구운 파일에 한 번 더 걸린다).
 *
 * - [pitchSemitones] 목소리 높이 −10…+6 반음(0.5 눈금 — 서버 `VOICE_PITCH_*_SEMITONES` 와 같은 숫자). 화면 이름은
 *   `톤 조절`이다(2026-10-08 사용자). 범위는 같은 날 −6…+3 에서 넓혔다 — v4 Turbo 가 저음을 8반음 넘게 올리는 경우가
 *   있었다. **목소리 몸집(포먼트)은 그대로 두고 높이만** 바꾼다(`VoicePitchShifter` — TD-PSOLA). 2026-10-07 사용자
 *   판정: 폰 내장 높이 변환(`PlaybackParams.setPitch`)은 몸집까지 움직여 "변조된 목소리" 로 들려 거부감이 든다.
 * - 음량·굵기 보정은 같은 날 뺐다(사용자: "목소리 높이만 하면 될 것 같다"). 높이를 바꾼 소리는
 *   원래 클립과 **같은 크기**로 되맞춘다 — 음량을 따로 고르게 하지 않는다.
 */
data class VoiceTuning(
    val pitchSemitones: Float = 0f,
    /** [SOURCE_AUTO] = 자동 추천 그대로, [SOURCE_MANUAL] = 사용자가 슬라이더를 움직였다. */
    val source: String = SOURCE_AUTO,
) {
    /** 높이를 바꾸지 않는 값인가 — 이때 미리듣기는 원래 클립을 그대로 틀고, 서버에도 보내지 않는다. */
    val isNeutral: Boolean get() = pitchSemitones == 0f

    /** 범위·눈금(0.5)에 맞춘 값. 굽기·전송 전에 한 번 거친다. */
    fun normalized(): VoiceTuning = copy(
        pitchSemitones = snapToStep(pitchSemitones, PITCH_RANGE),
        source = if (source == SOURCE_MANUAL) SOURCE_MANUAL else SOURCE_AUTO,
    )

    companion object {
        const val SOURCE_AUTO = "auto"
        const val SOURCE_MANUAL = "manual"

        const val STEP = 0.5f
        /** 서버 `VOICE_PITCH_MIN_SEMITONES`·`VOICE_PITCH_MAX_SEMITONES`(`@alarmtalk/shared`)와 같은 숫자 — 넓으면 고른 값이 400 으로 거절된다. */
        val PITCH_RANGE: ClosedFloatingPointRange<Float> = -10f..6f

        val NEUTRAL = VoiceTuning()

        /** 0.5 눈금으로 반올림(0 을 기준으로 대칭) 후 범위로 자른다. −0 은 0 으로 둔다. */
        fun snapToStep(value: Float, range: ClosedFloatingPointRange<Float>): Float {
            if (!value.isFinite()) return 0f.coerceIn(range.start, range.endInclusive)
            val snapped = roundToHalf(value.toDouble()).toFloat().coerceIn(range.start, range.endInclusive)
            return if (snapped == 0f) 0f else snapped
        }

        /** 0.5 단위 반올림. 음수도 크기 기준으로 반올림한다(−1.25 → −1.5, 1.25 → 1.5). */
        fun roundToHalf(value: Double): Double {
            val magnitude = floor(abs(value) * 2.0 + 0.5) / 2.0
            val signed = if (value < 0) -magnitude else magnitude
            return if (signed == 0.0) 0.0 else signed
        }
    }
}
