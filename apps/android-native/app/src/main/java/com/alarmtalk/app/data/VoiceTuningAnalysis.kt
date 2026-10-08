package com.alarmtalk.app.data

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.sqrt
import kotlin.math.tan

/**
 * 목소리 보정 **자동 추천**의 계산부 — 안드로이드 API 를 쓰지 않는 순수 코틀린이다(JVM 테스트).
 * 디코딩(`VoiceAudioDecoder`)이 만든 모노 float PCM 을 받는다.
 *
 *  - 기본 주파수(F0): 1.2 kHz 저역 통과 → ~8 kHz 로 솎기 → 25 ms 프레임 YIN(문턱 0.2, 50~500 Hz)
 *    → 유성 프레임의 **중앙값**.
 *  - 음량: ITU-R BS.1770 K-가중(셸프 + RLB 고역 통과) → 400 ms 블록(100 ms 간격)의 평균 제곱 →
 *    절대 게이트 −70 LUFS 만 건 **근사** 통합 음량. 상대 게이트(−10 LU)는 두지 않는다.
 *  - 추천: 높이 = −(미리듣기 F0 / 등록 녹음 F0 의 반음 차, 0.5 단위), 1.5 반음 미만이면 0,
 *    막대 범위(`VoiceTuning.PITCH_RANGE`, −10…+6)로 자름.
 *  - 음량은 추천하지 않는다 — 높이를 바꾼 소리를 원래 클립 크기로 되맞출 때만 쓴다(`VoicePitchShifter`).
 */
object VoiceTuningAnalysis {

    const val YIN_THRESHOLD = 0.2
    const val MIN_F0_HZ = 50.0
    const val MAX_F0_HZ = 500.0
    const val FRAME_SECONDS = 0.025
    const val HOP_SECONDS = 0.010
    const val LOWPASS_HZ = 1200.0
    const val ANALYSIS_RATE_HZ = 8000

    /** 유성 프레임이 이보다 적으면 F0 를 모른다고 본다(잡음 한두 프레임으로 높이를 바꾸지 않는다). */
    const val MIN_VOICED_FRAMES = 5

    /** 가장 큰 프레임보다 이만큼(dB) 작은 프레임은 묵음으로 보고 건너뛴다. */
    const val FRAME_GATE_DB = 30.0

    const val ABSOLUTE_GATE_LUFS = -70.0

    /** 반음 차가 이보다 작으면 높이를 건드리지 않는다 — 들어서 구분되지 않는 차이다. */
    const val PITCH_DEADBAND_SEMITONES = 1.5

    /** 유성 프레임 F0 의 중앙값(Hz). 유성 프레임이 모자라면 null. */
    fun medianF0(samples: FloatArray, sampleRate: Int): Double? {
        if (samples.isEmpty() || sampleRate <= 0) return null
        val filtered = lowpass(samples, sampleRate, LOWPASS_HZ)
        val factor = max(1, sampleRate / ANALYSIS_RATE_HZ)
        val signal = decimate(filtered, factor)
        val rate = sampleRate / factor
        val window = Math.round(FRAME_SECONDS * rate).toInt()
        val hop = max(1, Math.round(HOP_SECONDS * rate).toInt())
        val tauMax = ceil(rate / MIN_F0_HZ).toInt()
        val span = window + tauMax + 2
        if (signal.size < span) return null

        val starts = generateSequence(0) { it + hop }.takeWhile { it + span <= signal.size }.toList()
        val rms = DoubleArray(starts.size) { frameRms(signal, starts[it], window) }
        val loudest = rms.maxOrNull() ?: return null
        if (loudest <= 1e-6) return null
        val gate = max(1e-4, loudest * 10.0.pow(-FRAME_GATE_DB / 20.0))

        val voiced = ArrayList<Double>()
        starts.forEachIndexed { index, start ->
            if (rms[index] < gate) return@forEachIndexed
            yinFrequency(signal, start, window, rate)?.let(voiced::add)
        }
        if (voiced.size < MIN_VOICED_FRAMES) return null
        voiced.sort()
        val mid = voiced.size / 2
        return if (voiced.size % 2 == 1) voiced[mid] else (voiced[mid - 1] + voiced[mid]) / 2.0
    }

    /**
     * 한 프레임의 YIN 추정(Hz). 문턱 아래로 내려가는 첫 지연을 찾아 그 골짜기 바닥까지 따라가고,
     * 포물선 보간으로 소수 지연을 구한다. 문턱 아래가 없으면 무성(null).
     */
    fun yinFrequency(
        signal: FloatArray,
        start: Int,
        window: Int,
        sampleRate: Int,
        minHz: Double = MIN_F0_HZ,
        maxHz: Double = MAX_F0_HZ,
        threshold: Double = YIN_THRESHOLD,
    ): Double? {
        val tauMin = max(2, floor(sampleRate / maxHz).toInt())
        val tauMax = ceil(sampleRate / minHz).toInt()
        if (start < 0 || start + window + tauMax + 1 > signal.size) return null
        val difference = DoubleArray(tauMax + 2)
        for (tau in 1..tauMax + 1) {
            var sum = 0.0
            for (j in 0 until window) {
                val delta = signal[start + j].toDouble() - signal[start + j + tau].toDouble()
                sum += delta * delta
            }
            difference[tau] = sum
        }
        val normalized = DoubleArray(tauMax + 2)
        normalized[0] = 1.0
        var running = 0.0
        for (tau in 1..tauMax + 1) {
            running += difference[tau]
            normalized[tau] = if (running <= 0.0) 1.0 else difference[tau] * tau / running
        }
        var tau = tauMin
        var found = -1
        while (tau <= tauMax) {
            if (normalized[tau] < threshold) {
                while (tau + 1 <= tauMax && normalized[tau + 1] < normalized[tau]) tau++
                found = tau
                break
            }
            tau++
        }
        if (found < 0) return null
        val refined = if (found in 1 until tauMax + 1) {
            val s0 = normalized[found - 1]
            val s1 = normalized[found]
            val s2 = normalized[found + 1]
            val denominator = s0 + s2 - 2.0 * s1
            if (abs(denominator) > 1e-12) found + (s0 - s2) / (2.0 * denominator) else found.toDouble()
        } else {
            found.toDouble()
        }
        if (refined <= 0.0) return null
        return sampleRate / refined
    }

    /** BS.1770 근사 통합 음량(LUFS, 모노). 게이트를 통과한 블록이 없으면 null. */
    fun integratedLoudness(samples: FloatArray, sampleRate: Int): Double? {
        if (samples.isEmpty() || sampleRate <= 0) return null
        val weighted = kWeight(samples, sampleRate)
        val block = Math.round(0.4 * sampleRate).toInt()
        val hop = max(1, Math.round(0.1 * sampleRate).toInt())
        val powers = ArrayList<Double>()
        if (weighted.size <= block) {
            powers += meanSquare(weighted, 0, weighted.size)
        } else {
            var start = 0
            while (start + block <= weighted.size) {
                powers += meanSquare(weighted, start, block)
                start += hop
            }
        }
        val gated = powers.filter { it > 0.0 && blockLoudness(it) > ABSOLUTE_GATE_LUFS }
        if (gated.isEmpty()) return null
        return blockLoudness(gated.average())
    }

    /** 미리듣기 F0 와(있으면) 등록 녹음 F0 로 추천값을 만든다. 출처는 언제나 auto. */
    fun suggest(previewF0Hz: Double?, sourceF0Hz: Double?): VoiceTuning =
        VoiceTuning(
            pitchSemitones = suggestedPitchSemitones(previewF0Hz, sourceF0Hz),
            source = VoiceTuning.SOURCE_AUTO,
        ).normalized()

    /**
     * 클론이 원래 목소리보다 높게(낮게) 나오면 그만큼 내린다(올린다). 반음 차가
     * [PITCH_DEADBAND_SEMITONES] 미만이면 0. 어느 한쪽 F0 라도 모르면 0.
     */
    fun suggestedPitchSemitones(previewF0Hz: Double?, sourceF0Hz: Double?): Float {
        if (previewF0Hz == null || sourceF0Hz == null) return 0f
        if (previewF0Hz <= 0.0 || sourceF0Hz <= 0.0) return 0f
        val difference = 12.0 * ln(previewF0Hz / sourceF0Hz) / ln(2.0)
        if (!difference.isFinite()) return 0f
        // 0.5 단위로 **먼저** 반올림하고 그 크기로 데드밴드를 본다(iOS `VoiceTuningAnalyzer.suggestedPitch` 와 같은
        // 순서) — 거꾸로 하면 1.25~1.5 반음 차가 한쪽 앱에서만 1.5 로 고쳐진다.
        val rounded = VoiceTuning.roundToHalf(difference)
        if (abs(rounded) < PITCH_DEADBAND_SEMITONES) return 0f
        return VoiceTuning.snapToStep((-rounded).toFloat(), VoiceTuning.PITCH_RANGE)
    }

    // ── 필터 ──

    /** RBJ 저역 통과(Q 0.707)를 두 번 — 24 dB/oct. 솎기 전 앨리어싱과 고조파 오검출을 줄인다. */
    fun lowpass(samples: FloatArray, sampleRate: Int, cutoffHz: Double): FloatArray {
        val nyquist = sampleRate / 2.0
        if (cutoffHz >= nyquist * 0.95) return samples.copyOf()
        val w0 = 2.0 * PI * cutoffHz / sampleRate
        val alpha = kotlin.math.sin(w0) / (2.0 * 0.7071067811865476)
        val cos = kotlin.math.cos(w0)
        val a0 = 1.0 + alpha
        val stage = Biquad(
            b0 = (1.0 - cos) / 2.0 / a0,
            b1 = (1.0 - cos) / a0,
            b2 = (1.0 - cos) / 2.0 / a0,
            a1 = -2.0 * cos / a0,
            a2 = (1.0 - alpha) / a0,
        )
        return stage.process(stage.process(samples))
    }

    fun decimate(samples: FloatArray, factor: Int): FloatArray {
        if (factor <= 1) return samples
        return FloatArray(samples.size / factor) { samples[it * factor] }
    }

    /** BS.1770 K-가중 두 단(임의 샘플레이트 — libebur128 과 같은 설계식). */
    fun kWeight(samples: FloatArray, sampleRate: Int): FloatArray {
        val fs = sampleRate.toDouble()
        // 1단: 고역 셸프(+4 dB, ~1.68 kHz)
        val shelfF0 = 1681.974450955533
        val shelfGain = 3.999843853973347
        val shelfQ = 0.7071752369554196
        val k1 = tan(PI * shelfF0 / fs)
        val vh = 10.0.pow(shelfGain / 20.0)
        val vb = vh.pow(0.4996667741545416)
        val a0Shelf = 1.0 + k1 / shelfQ + k1 * k1
        val shelf = Biquad(
            b0 = (vh + vb * k1 / shelfQ + k1 * k1) / a0Shelf,
            b1 = 2.0 * (k1 * k1 - vh) / a0Shelf,
            b2 = (vh - vb * k1 / shelfQ + k1 * k1) / a0Shelf,
            a1 = 2.0 * (k1 * k1 - 1.0) / a0Shelf,
            a2 = (1.0 - k1 / shelfQ + k1 * k1) / a0Shelf,
        )
        // 2단: RLB 고역 통과(~38 Hz)
        val hpF0 = 38.13547087602444
        val hpQ = 0.5003270373238773
        val k2 = tan(PI * hpF0 / fs)
        val a0Hp = 1.0 + k2 / hpQ + k2 * k2
        val highPass = Biquad(
            b0 = 1.0,
            b1 = -2.0,
            b2 = 1.0,
            a1 = 2.0 * (k2 * k2 - 1.0) / a0Hp,
            a2 = (1.0 - k2 / hpQ + k2 * k2) / a0Hp,
        )
        return highPass.process(shelf.process(samples))
    }

    private fun blockLoudness(meanSquare: Double): Double = -0.691 + 10.0 * log10(meanSquare)

    private fun meanSquare(samples: FloatArray, start: Int, length: Int): Double {
        if (length <= 0) return 0.0
        var sum = 0.0
        for (i in start until start + length) {
            val value = samples[i].toDouble()
            sum += value * value
        }
        return sum / length
    }

    private fun frameRms(samples: FloatArray, start: Int, length: Int): Double =
        sqrt(meanSquare(samples, start, length))

    /** 직접형 I 바이쿼드(배정밀 상태). a0 는 1 로 정규화돼 있다. */
    private class Biquad(
        val b0: Double,
        val b1: Double,
        val b2: Double,
        val a1: Double,
        val a2: Double,
    ) {
        fun process(input: FloatArray): FloatArray {
            val output = FloatArray(input.size)
            var x1 = 0.0
            var x2 = 0.0
            var y1 = 0.0
            var y2 = 0.0
            for (i in input.indices) {
                val x0 = input[i].toDouble()
                val y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
                x2 = x1
                x1 = x0
                y2 = y1
                y1 = y0
                output[i] = y0.toFloat()
            }
            return output
        }
    }
}
