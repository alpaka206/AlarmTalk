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

    /**
     * 높이 추적과 변환 결과는 **두 앱이 같다** — 기대값은 iOS `VoicePitchShifterTests` 와 같은 숫자다(같은 입력을 두 앱에서
     * 돌려 맞춘 값, Codex #870). 앞 0.2초 무음 + 떨림(160±15 Hz) 있는 배음 소리를 −2 반음.
     */
    @Test
    fun pitchTrackAndShiftMatchIos() {
        val sr = 44_100
        var phase = 0.0
        val x = FloatArray(sr) { i ->
            val t = i.toDouble() / sr
            if (t < 0.2) {
                0f
            } else {
                val f = 160 + 15 * sin(2 * PI * 1.3 * t)
                phase += 2 * PI * f / sr
                (0.4 * (sin(phase) + 0.5 * sin(2 * phase) + 0.25 * sin(3 * phase))).toFloat()
            }
        }
        val track = VoicePitchShifter.pitchTrack(x, sr)
        assertEquals(96, track.f0.size)
        assertEquals(77, track.f0.count { it > 0.0 })
        assertEquals(12322.340158236248, track.f0.sum(), 1e-6)

        val y = VoicePitchShifter.shift(x.copyOf(), sr, -2f)
        assertEquals(44_100, y.size)
        assertEquals(9739.548, y.sumOf { abs(it).toDouble() }, 1e-3)
        assertEquals(0.32448906f, y[30_000], 1e-6f)
        assertEquals(0.546782f, y[40_000], 1e-6f)
    }

    /** 표본률 바꾸기는 **두 앱이 같은 값**을 낸다 — 기대값은 iOS `VoicePitchShifterTests` 와 같은 숫자다(같은 식을 파이썬으로 따로 셈한 값, Codex #870). */
    @Test
    fun resampleMatchesTheIosImplementation() {
        val sr = 44_100.0
        val x = FloatArray(4_410) { i ->
            val t = i / sr
            (0.5 * sin(2 * PI * 220 * t) + 0.25 * sin(2 * PI * 3_100 * t) + 0.1 * sin(2 * PI * 9_000 * t)).toFloat()
        }
        val y = VoicePitchShifter.resample(x, 44_100, 16_000)
        assertEquals(1_600, y.size)
        assertEquals(0.08122162520885468f, y[1], 1e-5f)
        assertEquals(0.5854929089546204f, y[100], 1e-5f)
        assertEquals(-0.24569550156593323f, y[777], 1e-5f)
        assertEquals(-0.26356241106987f, y[1_599], 1e-5f)
        assertEquals(539.0014692312106, y.sumOf { abs(it).toDouble() }, 1e-2)
    }

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

    /** 높이 분석은 원본 표본률과 상관없이 **정확히 16 kHz** 에서 한다 — iOS 와 같은 규칙(Codex #870). */
    @Test
    fun analysisRunsAtExactlySixteenKilohertz() {
        assertEquals(16_000, VoicePitchShifter.resample(FloatArray(44_100), 44_100, 16_000).size)
        assertEquals(16_000, VoicePitchShifter.resample(FloatArray(48_000), 48_000, 16_000).size)
        assertEquals(16_000, VoicePitchShifter.resample(FloatArray(8_000), 8_000, 16_000).size)
        // 48 kHz 원본도 같은 높이로 옮긴다.
        val rate48 = 48_000
        val input = FloatArray((rate48 * 1.5).toInt()) { i ->
            val t = i.toDouble() / rate48
            if ((t % 0.5) >= 0.4) return@FloatArray 0f
            var v = 0.0
            for (k in 1..8) v += sin(2.0 * PI * 120.0 * k * t) / k
            (0.25 * v).toFloat()
        }
        val measured = VoiceTuningAnalysis.medianF0(VoicePitchShifter.shift(input, rate48, -3f), rate48)!!
        assertTrue("48 kHz −3 반음 → ${semitones(measured, 120.0)}", abs(semitones(measured, 120.0) + 3) <= 0.5)
    }

    @Test
    fun silenceStaysSilent() {
        val output = VoicePitchShifter.shift(FloatArray(rate), rate, -3f)
        assertTrue(output.all { it == 0f })
    }
}
