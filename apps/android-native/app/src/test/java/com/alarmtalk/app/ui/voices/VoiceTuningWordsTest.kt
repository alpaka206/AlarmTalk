package com.alarmtalk.app.ui.voices

import com.alarmtalk.app.R
import com.alarmtalk.app.pitchWordRes
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 목소리 높이를 **말로** 쓰는 경계(시안 A, 2026-11-15) — 0 은 `원래 높이`, ±2 까지 `조금`, ±4 까지 그냥, 그 너머는 `많이`.
 * iOS `VoicePreviewConfirmView.pitchWord` 와 같은 경계여야 한다(iOS `VoiceTonePreviewTests.test_pitchWord_경계가_안드로이드와_같다`).
 */
class VoiceTuningWordsTest {
    @Test
    fun wordsFollowTheSameBoundariesAsIos() {
        assertEquals(R.string.voices_tuning_word_original, pitchWordRes(0f))
        assertEquals(R.string.voices_tuning_word_slightly_higher, pitchWordRes(0.5f))
        assertEquals(R.string.voices_tuning_word_slightly_higher, pitchWordRes(2f))
        assertEquals(R.string.voices_tuning_word_higher, pitchWordRes(2.5f))
        assertEquals(R.string.voices_tuning_word_higher, pitchWordRes(4f))
        assertEquals(R.string.voices_tuning_word_much_higher, pitchWordRes(4.5f))
        assertEquals(R.string.voices_tuning_word_much_higher, pitchWordRes(6f))
        assertEquals(R.string.voices_tuning_word_slightly_lower, pitchWordRes(-0.5f))
        assertEquals(R.string.voices_tuning_word_slightly_lower, pitchWordRes(-2f))
        assertEquals(R.string.voices_tuning_word_lower, pitchWordRes(-2.5f))
        assertEquals(R.string.voices_tuning_word_lower, pitchWordRes(-4f))
        assertEquals(R.string.voices_tuning_word_much_lower, pitchWordRes(-4.5f))
        assertEquals(R.string.voices_tuning_word_much_lower, pitchWordRes(-10f))
    }
}
