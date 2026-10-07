package com.alarmtalk.app.data

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * **목소리 몸집은 그대로 두고 높이만** 바꾼다 — TD-PSOLA(순수 코틀린·JVM 테스트).
 *
 * 원리: 성대가 한 번 떨 때마다 표시(pitch mark)를 찍고, 그 자리를 중심으로 앞뒤 한 주기씩 창을 씌운
 * 조각을 잘라 **조각 간격만** 1/배율 로 바꿔 다시 겹쳐 더한다. 조각 안의 파형(= 성도의 울림, 포먼트)은
 * 그대로라 목소리 몸집이 유지되고, 떨림 간격(= 높이)만 바뀐다. 폰 내장 높이 변환(`PlaybackParams.setPitch`)
 * 은 파형 자체를 늘이거나 줄여 몸집까지 움직인다 — 2026-10-07 사용자가 "변조된 목소리" 라며 거부했다.
 *
 * iOS(`VoicePitchShifter.swift`)와 **같은 알고리즘·같은 숫자**다 — 2026-10-07 사용자가 귀로 고른 소리를 두
 * 앱에서 똑같이 내기 위해서다. 숫자를 바꾸면 양쪽을 같이 바꾼다(스펙 §4-3).
 *
 * 한계: 크게 내리면(−5 반음 이하) 조각 사이가 벌어져 '웅웅' 거리고, 표시가 어긋난 구간은 거칠어진다.
 * 무성음(ㅅ·ㅎ)은 옮기지 않는다. 높이를 내리면 떨림 수가 줄어 소리가 작아지므로, 결과를 원래 클립과
 * **같은 통합 음량**으로 되맞춘다(봉우리는 [PEAK_LIMIT] 아래).
 */
object VoicePitchShifter {

    /** 되맞춘 뒤 봉우리 상한(−0.2 dBFS). */
    const val PEAK_LIMIT = 0.977f

    private const val ANALYSIS_RATE_HZ = 16_000
    private const val HOP_SECONDS = 0.010
    private const val WINDOW_SECONDS = 0.025
    private const val UNVOICED_HOP_SECONDS = 0.005
    private const val MARK_LOWPASS_HZ = 900.0
    private const val TRACK_HIGHPASS_HZ = 40.0
    private const val TRACK_LOWPASS_HZ = 1200.0

    /** 가장 큰 프레임(95 분위)보다 이만큼 작은 프레임은 무성으로 본다. */
    private const val VOICING_GATE_DB = 35.0

    /** 주변 프레임 중앙값에서 이보다 튄 프레임은 옥타브 오검출로 본다. */
    private const val OCTAVE_JUMP_SEMITONES = 7.0

    /** [samples] 의 높이를 [semitones] 반음 옮긴 새 배열(길이 같음). 0 이면 사본을 그대로 돌려준다. */
    fun shift(samples: FloatArray, sampleRate: Int, semitones: Float): FloatArray {
        if (semitones == 0f || samples.isEmpty() || sampleRate <= 0) return samples.copyOf()
        val factor = 2.0.pow(semitones / 12.0)
        val shifted = psola(samples, sampleRate, factor)
        return matchLoudness(shifted, sampleRate, VoiceTuningAnalysis.integratedLoudness(samples, sampleRate))
    }

    /** [y] 를 [targetLufs] 에 맞춘다(제자리). 봉우리가 [PEAK_LIMIT] 를 넘지 않게 게인을 줄인다. */
    fun matchLoudness(y: FloatArray, sampleRate: Int, targetLufs: Double?): FloatArray {
        var peak = 0f
        for (v in y) peak = max(peak, abs(v))
        if (peak <= 0f) return y
        val current = VoiceTuningAnalysis.integratedLoudness(y, sampleRate)
        val wanted = if (targetLufs != null && current != null) 10.0.pow((targetLufs - current) / 20.0) else 1.0
        val gain = min(wanted, PEAK_LIMIT / peak.toDouble()).toFloat()
        if (gain == 1f) return y
        for (i in y.indices) y[i] *= gain
        return y
    }

    /** 10 ms 간격 F0 트랙(Hz, 무성 0)과 첫 프레임 중심 시각(초). */
    internal class PitchTrack(val f0: DoubleArray, val firstFrameSeconds: Double)

    /**
     * 40 Hz~1.2 kHz 로 거른 뒤 ~16 kHz 로 솎아 25 ms 프레임 YIN(문턱 0.2). 큰 소리 대비 −35 dB 아래와
     * 주변보다 7 반음 넘게 튄 프레임은 무성으로 돌린다(앞에서부터 차례로 — 웹과 같은 순서).
     */
    internal fun pitchTrack(samples: FloatArray, sampleRate: Int): PitchTrack {
        val factor = max(1, sampleRate / ANALYSIS_RATE_HZ)
        val band = biquad(biquad(samples, highpass(TRACK_HIGHPASS_HZ, sampleRate)), lowpass(TRACK_LOWPASS_HZ, sampleRate))
        val x = if (factor == 1) band else FloatArray(band.size / factor) { band[it * factor] }
        val rate = sampleRate / factor
        val hop = Math.round(rate * HOP_SECONDS).toInt().coerceAtLeast(1)
        val window = Math.round(rate * WINDOW_SECONDS).toInt()
        val tauMax = ceil(rate / VoiceTuningAnalysis.MIN_F0_HZ).toInt()
        val f0 = ArrayList<Double>()
        val levels = ArrayList<Double>()
        var start = 0
        while (start + window + tauMax < x.size) {
            var energy = 0.0
            for (j in 0 until window) energy += x[start + j].toDouble() * x[start + j]
            levels += 20.0 * log10(sqrt(energy / window) + 1e-12)
            f0 += VoiceTuningAnalysis.yinFrequency(x, start, window, rate) ?: 0.0
            start += hop
        }
        val track = f0.toDoubleArray()
        if (track.isNotEmpty()) {
            val sorted = levels.sorted()
            val loud = sorted[(sorted.size * 0.95).toInt().coerceAtMost(sorted.size - 1)]
            for (i in track.indices) if (levels[i] < loud - VOICING_GATE_DB) track[i] = 0.0
            for (i in track.indices) {
                if (track[i] == 0.0) continue
                val neighbors = ArrayList<Double>()
                for (k in max(0, i - 5)..min(track.size - 1, i + 5)) if (track[k] > 0.0) neighbors += track[k]
                if (neighbors.size < 3) {
                    track[i] = 0.0
                    continue
                }
                neighbors.sort()
                val median = neighbors[neighbors.size / 2]
                if (abs(12.0 * ln(track[i] / median) / ln(2.0)) > OCTAVE_JUMP_SEMITONES) track[i] = 0.0
            }
        }
        return PitchTrack(track, window / 2.0 / rate)
    }

    private fun psola(x: FloatArray, sr: Int, factor: Double): FloatArray {
        val track = pitchTrack(x, sr)
        val raw = track.f0
        if (raw.isEmpty()) return x.copyOf()
        val xl = biquad(x, lowpass(MARK_LOWPASS_HZ, sr))

        // 5 프레임 중앙값으로 매끈하게 + 30 ms 이하 무성 틈은 양끝을 이어 메운다.
        val smooth = DoubleArray(raw.size) { i ->
            if (raw[i] == 0.0) {
                0.0
            } else {
                val window = (max(0, i - 2)..min(raw.size - 1, i + 2)).map { raw[it] }.filter { it > 0.0 }.sorted()
                window[window.size / 2]
            }
        }
        var i = 1
        while (i < smooth.size - 1) {
            if (smooth[i] != 0.0) {
                i++
                continue
            }
            var j = i
            while (j < smooth.size && smooth[j] == 0.0) j++
            if (j - i <= 3 && smooth[i - 1] != 0.0 && j < smooth.size) {
                for (k in i until j) smooth[k] = smooth[i - 1] + (smooth[j] - smooth[i - 1]) * (k - i + 1) / (j - i + 1)
            }
            i = j + 1
        }
        fun f0At(n: Int): Double {
            val idx = Math.round((n.toDouble() / sr - track.firstFrameSeconds) / HOP_SECONDS).toInt()
            return if (idx < 0 || idx >= smooth.size) 0.0 else smooth[idx]
        }

        // 분석 표시 — 유성이면 한 주기마다, 무성이면 5 ms 마다.
        val unvoicedHop = Math.round(sr * UNVOICED_HOP_SECONDS).toInt()
        val markAt = IntArrayList()
        val markPeriod = IntArrayList()
        val markVoiced = ArrayList<Boolean>()
        var n = 0
        var prevVoiced = false
        while (n < x.size) {
            val f = f0At(n)
            if (f > 0.0) {
                val period = Math.round(sr / f).toInt()
                var best: Int
                var bestValue = Double.NEGATIVE_INFINITY
                if (!prevVoiced) {
                    // 유성 구간의 첫 표시 — 한 주기 안에서 가장 큰 봉우리.
                    best = n
                    for (k in n..min(x.size - 1, n + period)) if (xl[k] > bestValue) {
                        bestValue = xl[k].toDouble()
                        best = k
                    }
                } else {
                    // 직전 표시 둘레 한 주기 파형과 가장 닮은 자리(정규화 상호상관)를 다음 표시로.
                    val previous = markAt[markAt.size - 1]
                    val half = Math.round(period / 2.0).toInt()
                    best = n
                    val reach = Math.round(0.15 * period).toInt()
                    for (k in max(half, n - reach)..min(x.size - 1 - half, n + reach)) {
                        var sxy = 0.0
                        var sxx = 0.0
                        var syy = 0.0
                        for (j in -half until half) {
                            val a = if (previous + j in xl.indices) xl[previous + j].toDouble() else 0.0
                            val b = xl[k + j].toDouble()
                            sxy += a * b
                            sxx += a * a
                            syy += b * b
                        }
                        val r = sxy / sqrt(sxx * syy + 1e-12)
                        if (r > bestValue) {
                            bestValue = r
                            best = k
                        }
                    }
                }
                if (markAt.size > 0 && best <= markAt[markAt.size - 1]) {
                    best = markAt[markAt.size - 1] + Math.round(0.5 * period).toInt()
                }
                markAt.add(best)
                markPeriod.add(period)
                markVoiced += true
                n = best + period
                prevVoiced = true
            } else {
                markAt.add(n)
                markPeriod.add(unvoicedHop)
                markVoiced += false
                n += unvoicedHop
                prevVoiced = false
            }
        }

        // 합성 — 유성 구간은 간격을 주기/배율 로, 무성 구간은 그대로 5 ms.
        val y = FloatArray(x.size)
        var k = 0
        var ts = markAt[0].toDouble()
        while (ts < x.size) {
            while (k + 1 < markAt.size && abs(markAt[k + 1] - ts) <= abs(markAt[k] - ts)) k++
            val center = markAt[k]
            val period = markPeriod[k].toDouble()
            val left = Math.round(
                if (k > 0) min(max((center - markAt[k - 1]).toDouble(), 0.5 * period), 1.5 * period) else period,
            ).toInt()
            val right = Math.round(
                if (k + 1 < markAt.size) min(max((markAt[k + 1] - center).toDouble(), 0.5 * period), 1.5 * period) else period,
            ).toInt()
            val t0 = Math.round(ts).toInt()
            for (j in -left..right) {
                val src = center + j
                val dst = t0 + j
                if (src < 0 || src >= x.size || dst < 0 || dst >= y.size) continue
                val w = if (j < 0) 0.5 * (1 + cos(PI * j / left)) else 0.5 * (1 + cos(PI * j / right))
                y[dst] += (x[src] * w).toFloat()
            }
            ts += if (markVoiced[k]) period / factor else unvoicedHop.toDouble()
        }
        return y
    }

    // ── 한 단 RBJ 필터(Q 0.707) ──

    private fun lowpass(cutoffHz: Double, sr: Int): DoubleArray = rbj(cutoffHz, sr, lowpass = true)

    private fun highpass(cutoffHz: Double, sr: Int): DoubleArray = rbj(cutoffHz, sr, lowpass = false)

    private fun rbj(cutoffHz: Double, sr: Int, lowpass: Boolean): DoubleArray {
        val w0 = 2.0 * PI * cutoffHz / sr
        val c = cos(w0)
        val alpha = sin(w0) / (2.0 * 0.7071067811865476)
        val a0 = 1.0 + alpha
        val b0 = if (lowpass) (1 - c) / 2 else (1 + c) / 2
        val b1 = if (lowpass) 1 - c else -(1 + c)
        return doubleArrayOf(b0 / a0, b1 / a0, b0 / a0, -2 * c / a0, (1 - alpha) / a0)
    }

    private fun biquad(x: FloatArray, c: DoubleArray): FloatArray {
        val y = FloatArray(x.size)
        var x1 = 0.0
        var x2 = 0.0
        var y1 = 0.0
        var y2 = 0.0
        for (i in x.indices) {
            val x0 = x[i].toDouble()
            val v = c[0] * x0 + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2
            x2 = x1
            x1 = x0
            y2 = y1
            y1 = v
            y[i] = v.toFloat()
        }
        return y
    }

    /** 박싱 없는 Int 목록(표시가 수만 개라 `ArrayList<Int>` 는 무겁다). */
    private class IntArrayList {
        private var data = IntArray(1024)
        var size = 0
            private set

        fun add(value: Int) {
            if (size == data.size) data = data.copyOf(size * 2)
            data[size++] = value
        }

        operator fun get(index: Int): Int = data[index]
    }
}
