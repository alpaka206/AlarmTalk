package com.alarmtalk.app

import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.VoiceSources
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * '직접 입력' 판별 회귀 가드.
 *
 * 버킷 회전 알람도 저장될 때 voiceRandomPrompt=false + voiceText=클립문구가 된다. 그래서
 * `!voiceRandomPrompt` 만으로 판별하면 버킷 알람이 '직접 입력'으로 오분류되고, 사용자가 쓴 적
 * 없는 클립 문구가 '내가 입력한 문구'처럼 노출된다. 그 오분류 때문에 문구 프리필 자체가 통째로
 * 제거됐던 이력이 있어(커밋 f907f89e·a079e2f4) 판별식을 고정한다.
 *
 * 버킷 키 파싱이 org.json 을 쓰므로 Robolectric 이 필요하다(순수 JUnit 에선 스텁이라 빈 목록).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "ko")
class AlarmEditorManualInputTest {
    @Test
    fun bucketAlarmIsNotClassifiedAsManualInput() {
        val editor = AlarmEditorState.from(alarm = null)
        editor.playMode = AlarmPlayModes.ALARM_VOICE
        editor.voiceSource = VoiceSources.SERVER_TTS
        editor.voiceRandomPrompt = false
        editor.voiceText = "오늘은 비가 올 수도 있대요."
        editor.selectedBucket = "weather"
        editor.bucketClipKeysJson = """["clip-a","clip-b"]"""
        editor.audioCacheKey = "clip-a"

        assertTrue("버킷 알람이 직접 입력으로 오분류된다", editor.isActiveBucketAlarm())
    }

    @Test
    fun manualInputAlarmIsClassifiedAsManual() {
        val editor = AlarmEditorState.from(alarm = null)
        editor.playMode = AlarmPlayModes.ALARM_VOICE
        editor.voiceSource = VoiceSources.SERVER_TTS
        editor.voiceRandomPrompt = false
        editor.voiceText = "일어나서 물 한 잔 마시기"
        editor.selectedBucket = null

        assertFalse(editor.isActiveBucketAlarm())
    }
}
