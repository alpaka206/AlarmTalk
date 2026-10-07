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
        // 7 반음 높다 → −7 → −6 으로 자른다.
        assertEquals(-6f, VoiceTuningAnalysis.suggestedPitchSemitones(300.0, 200.0), 0f)
        // 5 반음 낮다 → +5 → +3 으로 자른다.
        assertEquals(3f, VoiceTuningAnalysis.suggestedPitchSemitones(150.0, 200.0), 0f)
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

    @Test
    fun tuningCodecRoundTripsAndRejectsGarbage() {
        val tuning = VoiceTuning(pitchSemitones = -1.5f, source = VoiceTuning.SOURCE_MANUAL)
        assertEquals(tuning, VoiceTuning.decode(tuning.encode()))
        assertNull(VoiceTuning.decode(null))
        assertNull(VoiceTuning.decode("1;2;3"))
        assertNull(VoiceTuning.decode("7.5;-5.5;2.0;manual"))
        assertNull(VoiceTuning.decode("a;auto"))
        assertNull(VoiceTuning.decode("NaN;auto"))
        // 범위 밖·눈금 밖 값은 읽을 때 맞춘다. 모르는 출처는 auto.
        assertEquals(VoiceTuning(pitchSemitones = -6f, source = VoiceTuning.SOURCE_AUTO), VoiceTuning.decode("-9;weird"))
    }
}
