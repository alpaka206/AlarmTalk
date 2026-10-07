package com.alarmtalk.app.data

import kotlin.math.abs
import kotlin.math.floor

/**
 * 목소리 하나에 붙는 **높이 보정값**. 등록 미리듣기에서 들으며 맞추고, 이 기기에서 그 목소리로
 * 울리는 모든 알람에 똑같이 걸린다(`RingingService` 의 목소리 재생, 편집기의 목소리 크기 미리듣기).
 * 규칙은 `docs/spec/voice-and-message.md` §4-3.
 *
 * - [pitchSemitones] 목소리 높이 −6…+3 반음(0.5 눈금). **목소리 몸집(포먼트)은 그대로 두고 높이만**
 *   바꾼다(`VoicePitchShifter` — TD-PSOLA). 2026-10-07 사용자 판정: 폰 내장 높이 변환
 *   (`PlaybackParams.setPitch`)은 몸집까지 움직여 "변조된 목소리" 로 들려 거부감이 든다.
 * - 음량·굵기 보정은 같은 날 뺐다(사용자: "목소리 높이만 하면 될 것 같다"). 높이를 바꾼 소리는
 *   원래 클립과 **같은 크기**로 되맞춘다 — 음량을 따로 고르게 하지 않는다.
 */
data class VoiceTuning(
    val pitchSemitones: Float = 0f,
    /** [SOURCE_AUTO] = 자동 추천 그대로, [SOURCE_MANUAL] = 사용자가 슬라이더를 움직였다. */
    val source: String = SOURCE_AUTO,
) {
    /** 아무 처리도 하지 않는 값인가 — 이때 울림 경로는 예전과 **한 줄도 다르지 않게** 돈다. */
    val isNeutral: Boolean get() = pitchSemitones == 0f

    /** 값이 같은가(출처는 보지 않는다) — '자동으로 맞추기' 버튼을 끌지 판단할 때 쓴다. */
    fun sameValuesAs(other: VoiceTuning): Boolean = pitchSemitones == other.pitchSemitones

    /** 범위·눈금(0.5)에 맞춘 값. 저장·적용 전에 한 번 거친다. */
    fun normalized(): VoiceTuning = copy(
        pitchSemitones = snapToStep(pitchSemitones, PITCH_RANGE),
        source = if (source == SOURCE_MANUAL) SOURCE_MANUAL else SOURCE_AUTO,
    )

    /** 저장 문자열 — `pitch;source`. org.json 없이 JVM 테스트에서 그대로 검증한다. */
    fun encode(): String = "$pitchSemitones;$source"

    companion object {
        const val SOURCE_AUTO = "auto"
        const val SOURCE_MANUAL = "manual"

        const val STEP = 0.5f
        val PITCH_RANGE: ClosedFloatingPointRange<Float> = -6f..3f

        val NEUTRAL = VoiceTuning()

        /** 저장 문자열(`pitch;source`)을 푼다. 모양이 다르면 null — 그때는 보정 없이 운다. */
        fun decode(raw: String?): VoiceTuning? {
            val parts = raw?.split(';') ?: return null
            if (parts.size != 2) return null
            val pitch = parts[0].toFloatOrNull()?.takeIf { it.isFinite() } ?: return null
            return VoiceTuning(pitch, parts[1]).normalized()
        }

        /**
         * 이 알람에 높이 보정을 걸 수 있는가 — **이 기기에서 만든**(받은 것이 아닌) 등록 목소리 알람뿐이다.
         * 가족이 내가 공유한 목소리로 보낸 알람은 내 목소리 id 를 달고 오므로 출처로 거른다(스펙 §4-3).
         * 직접 녹음·기본(시스템) 목소리·목소리 없음도 제외.
         */
        fun appliesTo(origin: String?, voiceSource: String?, voiceProfileId: String?): Boolean {
            if (origin != AlarmOrigins.LOCAL_OWNED) return false
            if (voiceSource == VoiceSources.LOCAL_AUDIO) return false
            val voiceId = voiceProfileId?.takeIf { it.isNotBlank() } ?: return false
            return !isSystemVoiceId(voiceId)
        }

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
