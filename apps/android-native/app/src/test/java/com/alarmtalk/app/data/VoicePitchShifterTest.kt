package com.alarmtalk.app.data

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.ln
import kotlin.math.sin

/**
 * 몸집을 두고 높이만 옮기는 TD-PSOLA — 합성 '목소리'(배음 여러 개 + 음절처럼 끊긴 포락선)로
 * 높이가 얼마나 옮겨지는지, 길이·크기가 그대로인지 고정한다.
 */
class VoicePitchShifterTest {

    private val rate = 44_100

    /** 기본 주파수 [f0] 에 배음 8개(1/k 세기), 0.4초 소리·0.1초 쉼을 되풀이하는 1.5초 신호. */
    private fun voiceLike(f0: Double, seconds: Double = 1.5): FloatArray =
        FloatArray((rate * seconds).toInt()) { i ->
            val t = i.toDouble() / rate
            val inSyllable = (t % 0.5) < 0.4
            if (!inSyllable) return@FloatArray 0f
            var v = 0.0
            for (k in 1..8) v += sin(2.0 * PI * f0 * k * t) / k
            (0.25 * v).toFloat()
        }

    private fun semitones(a: Double, b: Double): Double = 12.0 * ln(a / b) / ln(2.0)

    private fun assertShift(f0: Double, shift: Float, tolerance: Double = 0.5) {
        val input = voiceLike(f0)
        val output = VoicePitchShifter.shift(input, rate, shift)
        assertEquals("길이는 그대로", input.size, output.size)
        val measured = VoiceTuningAnalysis.medianF0(output, rate)
        assertNotNull(measured)
        val moved = semitones(measured!!, f0)
        assertTrue("$f0 Hz 를 $shift 반음 → ${"%.2f".format(moved)} 반음", abs(moved - shift) <= tolerance)
    }

    @Test
    fun lowersMaleVoiceBySixSemitones() = assertShift(f0 = 120.0, shift = -6f)

    @Test
    fun lowersByThreeSemitones() = assertShift(f0 = 120.0, shift = -3f)

    @Test
    fun raisesFemaleVoice() = assertShift(f0 = 220.0, shift = 3f)

    @Test
    fun halfStepIsHonored() = assertShift(f0 = 150.0, shift = -1.5f)

    @Test
    fun zeroReturnsAnUnchangedCopy() {
        val input = voiceLike(140.0)
        val output = VoicePitchShifter.shift(input, rate, 0f)
        assertArrayEquals(input, output, 0f)
        assertTrue("사본이어야 한다", input !== output)
    }

    /** 높이를 내리면 떨림 수가 줄어 작아진다 — 원래 클립 크기로 되맞춘다. */
    @Test
    fun loudnessIsMatchedToTheOriginal() {
        val input = voiceLike(120.0)
        val output = VoicePitchShifter.shift(input, rate, -6f)
        val before = VoiceTuningAnalysis.integratedLoudness(input, rate)!!
        val after = VoiceTuningAnalysis.integratedLoudness(output, rate)!!
        assertEquals(before, after, 0.5)
        assertTrue(output.all { abs(it) <= VoicePitchShifter.PEAK_LIMIT + 1e-6f })
    }

    @Test
    fun silenceStaysSilent() {
        val output = VoicePitchShifter.shift(FloatArray(rate), rate, -3f)
        assertTrue(output.all { it == 0f })
    }
}
