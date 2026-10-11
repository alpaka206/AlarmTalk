package com.alarmtalk.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin

/**
 * 목소리 보정 자동 추천의 계산부 — 합성 신호로 정확도와 경계값을 고정한다.
 */
class VoiceTuningAnalysisTest {

    private fun sine(frequencyHz: Double, sampleRate: Int, seconds: Double, amplitude: Double = 0.5): FloatArray =
        FloatArray((sampleRate * seconds).toInt()) {
            (amplitude * sin(2.0 * PI * frequencyHz * it / sampleRate)).toFloat()
        }

    private fun assertWithinPercent(expected: Double, actual: Double?, percent: Double) {
        assertNotNull(actual)
        val error = abs(actual!! - expected) / expected * 100.0
        assertTrue("expected $expected got $actual (${"%.2f".format(error)}%)", error <= percent)
    }

    /**
     * 높이 측정은 **두 앱이 같은 값**을 낸다 — 기대값은 iOS `VoiceTuningAnalyzerTests` 와 같은 숫자다(같은 식을 파이썬으로
     * 따로 셈한 값, Codex #870). 앞 0.2초 무음 + 떨림(160±15 Hz) 있는 배음 소리.
     */
    @Test
    fun medianF0MatchesIos() {
        val sr = 44_100
        var phase = 0.0
        val x = FloatArray(sr) { i ->
            val t = i.toDouble() / sr
            if (t < 0.2) {
                0f
            } else {
                val f = 160 + 15 * kotlin.math.sin(2 * PI * 1.3 * t)
                phase += 2 * PI * f / sr
                (0.4 * (kotlin.math.sin(phase) + 0.5 * kotlin.math.sin(2 * phase) + 0.25 * kotlin.math.sin(3 * phase))).toFloat()
            }
        }
        assertEquals(160.19798146036143, VoiceTuningAnalysis.medianF0(x, sr)!!, 1e-4)
    }

    /** 유성 프레임 하한은 두 앱이 같다 — iOS `VoiceTuningAnalyzer.minVoicedFrames`(Codex #870). */
    @Test
    fun minVoicedFramesMatchesIos() {
        assertEquals(5, VoiceTuningAnalysis.MIN_VOICED_FRAMES)
    }

    @Test
    fun yinFindsSineFundamentalAt16k() {
        assertWithinPercent(150.0, VoiceTuningAnalysis.medianF0(sine(150.0, 16_000, 2.0), 16_000), 1.0)
    }

    @Test
    fun yinFindsSineFundamentalAt44k() {
        assertWithinPercent(220.0, VoiceTuningAnalysis.medianF0(sine(220.0, 44_100, 2.0), 44_100), 1.0)
    }

    @Test
    fun yinFindsLowAndHighVoiceRange() {
        assertWithinPercent(85.0, VoiceTuningAnalysis.medianF0(sine(85.0, 48_000, 1.5), 48_000), 1.5)
        assertWithinPercent(400.0, VoiceTuningAnalysis.medianF0(sine(400.0, 24_000, 1.5), 24_000), 1.5)
    }

    /** 고조파가 센 신호도 배음(200 Hz)이 아니라 기본음(100 Hz)을 잡는다. */
    @Test
    fun yinDoesNotJumpToHarmonic() {
        val rate = 24_000
        val samples = FloatArray(rate * 2) {
            val t = it.toDouble() / rate
            (0.3 * sin(2 * PI * 100 * t) + 0.25 * sin(2 * PI * 200 * t) + 0.2 * sin(2 * PI * 300 * t)).toFloat()
        }
        assertWithinPercent(100.0, VoiceTuningAnalysis.medianF0(samples, rate), 1.5)
    }

    @Test
    fun silenceHasNoPitch() {
        assertNull(VoiceTuningAnalysis.medianF0(FloatArray(16_000), 16_000))
        assertNull(VoiceTuningAnalysis.medianF0(FloatArray(10), 16_000))
    }

    /** 앞뒤 묵음은 중앙값을 끌어내리지 않는다(게이트). */
    @Test
    fun silentPaddingDoesNotChangeMedian() {
        val rate = 16_000
        val tone = sine(180.0, rate, 1.0)
        val padded = FloatArray(rate) + tone + FloatArray(rate)
        assertWithinPercent(180.0, VoiceTuningAnalysis.medianF0(padded, rate), 1.0)
    }

    /** 1 kHz, −20 dBFS 피크 사인 = 약 −23 LUFS(모노). 샘플레이트가 달라도 같은 값이다. */
    @Test
    fun loudnessOfReferenceSine() {
        val at48 = VoiceTuningAnalysis.integratedLoudness(sine(1000.0, 48_000, 3.0, amplitude = 0.1), 48_000)
        val at44 = VoiceTuningAnalysis.integratedLoudness(sine(1000.0, 44_100, 3.0, amplitude = 0.1), 44_100)
        assertEquals(-23.0, at48!!, 0.3)
        assertEquals(-23.0, at44!!, 0.3)
    }

    @Test
    fun loudnessGatesSilence() {
        assertNull(VoiceTuningAnalysis.integratedLoudness(FloatArray(48_000), 48_000))
        val padded = FloatArray(48_000) + sine(1000.0, 48_000, 2.0, amplitude = 0.1) + FloatArray(48_000)
        // 묵음 블록은 −70 LUFS 절대 게이트에서 빠진다. 상대 게이트가 없어 소리가 일부만 걸친 경계
        // 블록은 섞인다 — 2초 신호에서 ~0.8 dB 낮게 나온다(근사로 받아들인 차이).
        assertEquals(-23.0, VoiceTuningAnalysis.integratedLoudness(padded, 48_000)!!, 1.0)
    }

    @Test
    fun pitchSuggestionCorrectsDirectionWithDeadbandAndClamp() {
        // 클론이 1.65 반음 높다 → 1.5 로 반올림 → 1.5 내린다.
        assertEquals(-1.5f, VoiceTuningAnalysis.suggestedPitchSemitones(220.0, 200.0), 0f)
        // 0.43 반음 차 → 데드밴드 안 → 0.
        assertEquals(0f, VoiceTuningAnalysis.suggestedPitchSemitones(205.0, 200.0), 0f)
        // 1.3 반음 차 → **먼저** 1.5 로 반올림 → 데드밴드 밖 → 1.5 내린다(iOS 와 같은 순서 — Codex #870).
        assertEquals(-1.5f, VoiceTuningAnalysis.suggestedPitchSemitones(200.0 * Math.pow(2.0, 1.3 / 12), 200.0), 0f)
        // 1.2 반음 차 → 1.0 으로 반올림 → 데드밴드 안 → 0.
        assertEquals(0f, VoiceTuningAnalysis.suggestedPitchSemitones(200.0 * Math.pow(2.0, 1.2 / 12), 200.0), 0f)
        // 7 반음 높다 → −7. 2026-10-08 전(−6…+3)에는 −6 으로 잘렸다 — v4 Turbo 가 8반음 넘게 올리는 경우가 있어 넓혔다.
        assertEquals(-7f, VoiceTuningAnalysis.suggestedPitchSemitones(300.0, 200.0), 0f)
        // 12 반음(한 옥타브) 높다 → −12 → −10 으로 자른다.
        assertEquals(-10f, VoiceTuningAnalysis.suggestedPitchSemitones(400.0, 200.0), 0f)
        // 5 반음 낮다 → +5(예전에는 +3 으로 잘렸다).
        assertEquals(5f, VoiceTuningAnalysis.suggestedPitchSemitones(150.0, 200.0), 0f)
        // 12 반음 낮다 → +12 → +6 으로 자른다.
        assertEquals(6f, VoiceTuningAnalysis.suggestedPitchSemitones(100.0, 200.0), 0f)
        // 2 반음 낮다 → +2.
        assertEquals(2f, VoiceTuningAnalysis.suggestedPitchSemitones(200.0 / Math.pow(2.0, 2.0 / 12), 200.0), 0f)
        // 등록 녹음이 없으면 높이는 건드리지 않는다.
        assertEquals(0f, VoiceTuningAnalysis.suggestedPitchSemitones(220.0, null), 0f)
        assertEquals(0f, VoiceTuningAnalysis.suggestedPitchSemitones(null, 200.0), 0f)
    }

    @Test
    fun suggestionWithoutRecordingIsNeutral() {
        val tuning = VoiceTuningAnalysis.suggest(previewF0Hz = 240.0, sourceF0Hz = null)
        assertEquals(VoiceTuning(pitchSemitones = 0f, source = VoiceTuning.SOURCE_AUTO), tuning)
        assertTrue(tuning.isNeutral)
    }

    /** 합성 신호 끝에서 끝까지 — F0 측정 → 반음 차 → 추천. */
    @Test
    fun endToEndPitchSuggestionFromSines() {
        val rate = 16_000
        val source = VoiceTuningAnalysis.medianF0(sine(200.0, rate, 1.5), rate)
        val preview = VoiceTuningAnalysis.medianF0(sine(200.0 * Math.pow(2.0, 3.0 / 12), rate, 1.5), rate)
        assertEquals(-3f, VoiceTuningAnalysis.suggestedPitchSemitones(preview, source), 0f)
    }

    @Test
    fun roundToHalfIsSymmetric() {
        assertEquals(1.5, VoiceTuning.roundToHalf(1.25), 0.0)
        assertEquals(-1.5, VoiceTuning.roundToHalf(-1.25), 0.0)
        assertEquals(0.5, VoiceTuning.roundToHalf(0.74), 0.0)
        assertEquals(1.0, VoiceTuning.roundToHalf(0.75), 0.0)
        assertEquals(0.0, VoiceTuning.roundToHalf(-0.24), 0.0)
        // −0.0 을 남기지 않는다(표시가 "-0.0" 이 되지 않게).
        assertEquals(0.0.toBits(), VoiceTuning.roundToHalf(-0.2).toBits())
    }

    /**
     * 서버로 가는 높이는 범위·0.5 눈금 안이다 — 밖이면 서버가 400 `INVALID_VOICE_PITCH` 로 거절한다(스펙 §4-3).
     * 모르는 출처는 auto 로 둔다.
     */
    @Test
    fun normalizedSnapsToTheServerGrid() {
        assertEquals(VoiceTuning(pitchSemitones = -10f), VoiceTuning(pitchSemitones = -12f).normalized())
        // 범위 안 — 예전(−6…+3)에는 잘렸던 값이 그대로 남는다.
        assertEquals(VoiceTuning(pitchSemitones = -9f), VoiceTuning(pitchSemitones = -9f).normalized())
        assertEquals(
            VoiceTuning(pitchSemitones = 4f, source = VoiceTuning.SOURCE_MANUAL),
            VoiceTuning(pitchSemitones = 4.2f, source = VoiceTuning.SOURCE_MANUAL).normalized(),
        )
        assertEquals(
            VoiceTuning(pitchSemitones = 6f, source = VoiceTuning.SOURCE_MANUAL),
            VoiceTuning(pitchSemitones = 7.2f, source = VoiceTuning.SOURCE_MANUAL).normalized(),
        )
        assertEquals(-1.5f, VoiceTuning(pitchSemitones = -1.3f).normalized().pitchSemitones, 0f)
        assertEquals(0f.toBits(), VoiceTuning(pitchSemitones = -0.2f).normalized().pitchSemitones.toBits())
        assertEquals(0f, VoiceTuning(pitchSemitones = Float.NaN).normalized().pitchSemitones, 0f)
        assertEquals(VoiceTuning.SOURCE_AUTO, VoiceTuning(source = "weird").normalized().source)
    }

    /**
     * 막대 범위·눈금은 서버와 **같은 숫자**다 — 넓으면 고른 값이 400 `INVALID_VOICE_PITCH` 로 거절되고, 좁으면 서버가 받는 높이를
     * 이 앱에서만 못 고른다(스펙 §4-3). 원본은 `@alarmtalk/shared` 의 `VOICE_PITCH_*_SEMITONES` 다(소스를 읽어 대조한다).
     */
    @Test
    fun pitchRangeMatchesSharedSchema() {
        assertEquals(-10f, VoiceTuning.PITCH_RANGE.start, 0f)
        assertEquals(6f, VoiceTuning.PITCH_RANGE.endInclusive, 0f)
        assertEquals(0.5f, VoiceTuning.STEP, 0f)

        // 테스트는 app/ 에서 돈다 — 저장소 루트까지 세 단계(`FamilyAlarmFailureMessageTest` 와 같은 형태).
        val schema = java.io.File("../../../packages/shared/src/schemas/voice.ts").readText()
        fun constant(name: String): Float =
            Regex("""export const $name = (-?[0-9.]+);""").find(schema)?.groupValues?.get(1)?.toFloat()
                ?: error("$name not found in packages/shared/src/schemas/voice.ts")
        assertEquals(constant("VOICE_PITCH_MIN_SEMITONES"), VoiceTuning.PITCH_RANGE.start, 0f)
        assertEquals(constant("VOICE_PITCH_MAX_SEMITONES"), VoiceTuning.PITCH_RANGE.endInclusive, 0f)
        assertEquals(constant("VOICE_PITCH_STEP_SEMITONES"), VoiceTuning.STEP, 0f)
    }
}
