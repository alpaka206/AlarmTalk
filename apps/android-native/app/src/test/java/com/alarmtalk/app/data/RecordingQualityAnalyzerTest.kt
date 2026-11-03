package com.alarmtalk.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.pow
import kotlin.math.sin
import kotlin.random.Random

/**
 * 기본 신호 검사의 판정을 고정한다(스펙 voice-and-message §4-1 「녹음 품질 판정」). iOS 짝은
 * `AlarmTalkTests/RecordingQualityAnalyzerTests` — 같은 합성 신호·같은 답이어야 한다.
 */
class RecordingQualityAnalyzerTest {
    private val rate = RecordingQualityThresholds.ANALYSIS_SAMPLE_RATE
    private val minimum = 12_000L

    /** 잡음 바닥 [noiseDbfs] 위에, 말하는 구간(1초 말하고 [pauseMillis] 쉰다)에 [speechDbfs] 크기의 톤을 얹는다. */
    private fun recording(
        seconds: Int,
        speechDbfs: Double?,
        noiseDbfs: Double = -65.0,
        pauseMillis: Int = 250,
        clipEverySpeechSample: Boolean = false,
    ): FloatArray {
        val random = Random(7)
        val noiseAmplitude = 10.0.pow(noiseDbfs / 20) * 1.732 // 균등 잡음의 RMS 보정
        // 사인파 RMS = 진폭/√2.
        val speechAmplitude = speechDbfs?.let { 10.0.pow(it / 20) * 1.4142 }
        val cycle = (1_000 + pauseMillis) * rate / 1000
        val speaking = rate
        return FloatArray(seconds * rate) { i ->
            val noise = (random.nextDouble() * 2 - 1) * noiseAmplitude
            val inSpeech = speechAmplitude != null && i % cycle < speaking
            val tone = if (inSpeech) speechAmplitude!! * sin(2 * PI * 220 * i / rate) else 0.0
            val value = if (inSpeech && clipEverySpeechSample) tone.coerceIn(-0.99, 0.99) * 3 else tone + noise
            value.coerceIn(-1.0, 1.0).toFloat()
        }
    }

    @Test
    fun normalSpeechPasses() {
        val verdict = RecordingQualityAnalyzer.analyze(recording(20, speechDbfs = -22.0), minimum)
        assertTrue("$verdict", verdict is RecordingQualityVerdict.Passed)
        val metrics = verdict.metrics!!
        assertEquals(SpeechDetectionMethod.BASIC_SIGNAL, metrics.method)
        assertTrue("speech=${metrics.speechMillis}", metrics.speechMillis in 15_000L..16_500L)
        assertTrue("silence=${metrics.silenceRatio}", metrics.silenceRatio < RecordingQualityThresholds.MOSTLY_SILENT_RATIO)
    }

    @Test
    fun quietVoiceIsAdvisedNotRejected() {
        // 작은 목소리는 거절하지 않는다 — 말소리로는 세고, 크기만 안내한다.
        val verdict = RecordingQualityAnalyzer.analyze(recording(20, speechDbfs = -47.0, noiseDbfs = -72.0), minimum)
        assertTrue("$verdict", verdict is RecordingQualityVerdict.Advisory)
        verdict as RecordingQualityVerdict.Advisory
        assertEquals(listOf(RecordingAdvisory.QUIET), verdict.advisories)
        assertTrue(verdict.metrics.speechMillis > RecordingQualityThresholds.LITTLE_SPEECH_MILLIS)
    }

    @Test
    fun steadyNoiseWithoutSpeechIsLittleSpeechAdvisory() {
        // 선풍기 같은 고른 잡음만 있으면 잡음 바닥보다 큰 프레임이 없다 — 말소리 거의 없음(권장 안내).
        val verdict = RecordingQualityAnalyzer.analyze(recording(15, speechDbfs = null, noiseDbfs = -35.0), minimum)
        verdict as RecordingQualityVerdict.Advisory
        assertEquals(listOf(RecordingAdvisory.LITTLE_SPEECH), verdict.advisories)
    }

    @Test
    fun longPausesAreMostlySilentAdvisory() {
        val verdict = RecordingQualityAnalyzer.analyze(recording(30, speechDbfs = -22.0, pauseMillis = 2_500), minimum)
        verdict as RecordingQualityVerdict.Advisory
        assertEquals(listOf(RecordingAdvisory.MOSTLY_SILENT), verdict.advisories)
    }

    @Test
    fun clippedSpeechIsAdvised() {
        val verdict = RecordingQualityAnalyzer.analyze(
            recording(20, speechDbfs = -6.0, clipEverySpeechSample = true),
            minimum,
        )
        verdict as RecordingQualityVerdict.Advisory
        assertTrue("${verdict.advisories}", RecordingAdvisory.CLIPPING in verdict.advisories)
    }

    @Test
    fun definitiveRejections() {
        assertEquals(
            RecordingRejection.UNREADABLE,
            (RecordingQualityAnalyzer.analyze(null, minimum) as RecordingQualityVerdict.Rejected).reason,
        )
        assertEquals(
            RecordingRejection.UNREADABLE,
            (RecordingQualityAnalyzer.analyze(FloatArray(0), minimum) as RecordingQualityVerdict.Rejected).reason,
        )
        // 마이크가 아무것도 주지 않았다(디지털 무음).
        assertEquals(
            RecordingRejection.NO_INPUT,
            (RecordingQualityAnalyzer.analyze(FloatArray(20 * rate), minimum) as RecordingQualityVerdict.Rejected).reason,
        )
        assertEquals(
            RecordingRejection.TOO_SHORT,
            (RecordingQualityAnalyzer.analyze(recording(8, speechDbfs = -22.0), minimum) as RecordingQualityVerdict.Rejected)
                .reason,
        )
    }

    @Test
    fun decodedLengthJustUnderTheMinimumIsNotTooShort() {
        // AAC 앞뒤 여백으로 디코딩 길이가 메타데이터보다 조금 짧다 — 12초 녹음을 '너무 짧음' 으로 읽지 않는다.
        val samples = recording(12, speechDbfs = -22.0).copyOf(12 * rate - rate / 5)
        assertTrue(RecordingQualityAnalyzer.analyze(samples, minimum) !is RecordingQualityVerdict.Rejected)
    }

    @Test
    fun aPluggedDetectorDecidesSpeechTimeAndIsNamed() {
        val samples = recording(20, speechDbfs = -22.0)
        val verdict = RecordingQualityAnalyzer.analyze(samples, minimum, voiceActivityDetector = { _, _ -> 1_000L })
        verdict as RecordingQualityVerdict.Advisory
        assertEquals(SpeechDetectionMethod.VAD, verdict.metrics.method)
        assertEquals(listOf(RecordingAdvisory.LITTLE_SPEECH), verdict.advisories)
        // 검출기가 이 기기에서 돌지 못하면(null) 기본 신호 검사다 — 'VAD' 로 꾸미지 않는다.
        val fallback = RecordingQualityAnalyzer.analyze(samples, minimum, voiceActivityDetector = { _, _ -> null })
        assertEquals(SpeechDetectionMethod.BASIC_SIGNAL, fallback.metrics!!.method)
    }

    @Test
    fun diagnosticsCarryOnlyNumbersAndCodes() {
        val verdict = RecordingQualityAnalyzer.analyze(recording(20, speechDbfs = -47.0, noiseDbfs = -72.0), minimum)
        val diagnostics = verdict.diagnostics()
        assertEquals(
            setOf(
                "verdict", "advisories", "method", "duration_ms", "speech_ms", "silence_pct", "peak_dbfs",
                "speech_rms_dbfs", "clipping_permille",
            ),
            diagnostics.keys,
        )
        assertEquals("advisory", diagnostics["verdict"])
        assertEquals("quiet", diagnostics["advisories"])
        assertEquals("basic_signal", diagnostics["method"])
        diagnostics.filterKeys { it !in setOf("verdict", "advisories", "method") }.values.forEach {
            assertTrue("$it", it is Number)
        }
    }

    @Test
    fun normalizerResamplesToTheAnalysisRate() {
        val source = FloatArray(44_100) { i -> sin(2 * PI * 220 * i / 44_100).toFloat() }
        val out = MonoPcmNormalizer.toAnalysisRate(source, 44_100)
        assertTrue("size=${out.size}", out.size in 15_999..16_001)
        // 같은 시각의 값이 같다(선형 보간 — 220 Hz 는 충분히 느리다).
        val at = 4_000
        assertEquals(sin(2 * PI * 220 * at / 16_000.0), out[at].toDouble(), 0.01)
        assertEquals(0, MonoPcmNormalizer.toAnalysisRate(FloatArray(0), 44_100).size)
        assertEquals(10, MonoPcmNormalizer.toAnalysisRate(FloatArray(10) { 0.5f }, 16_000).size)
        // 48 kHz 도 같은 길이로 맞는다.
        assertTrue(MonoPcmNormalizer.toAnalysisRate(FloatArray(48_000), 48_000).size in 15_999..16_001)
    }
}
