package com.alarmtalk.app.alarm

import com.alarmtalk.app.data.AlarmOrigins
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.TEST_SYSTEM_VOICE_ID
import com.alarmtalk.app.data.rehearsalCloneAlarm
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 울릴 때의 소리 판정 — **조용한 결과는 사용자가 고른 무음뿐이다**(alarm-ringing.md §4,
 * billing-lifecycle.md 「목소리를 못 쓰게 되면」).
 *
 * 2026-09-29 dev 리허설(SM-A325N): 기간 한정 개인 플랜 종료 뒤 클론 목소리 알람이 울릴 때 logcat 은
 * `Free plan at ring time — downgrading paid voice to alarm tone` → `Alarm tone off
 * (soundEnabled=false, volume=10)` → `Vibration disabled for ringing alarm` 이었고 **아무 소리도
 * 없었다.** 강등이 '알람' 모드로 내려가 목소리 알람 시절의 꺼진 알람음 스위치를 봤다.
 */
class RingSoundDecisionTest {
    private val stockClipUri = "file:///audio/stock_sys-weather-1.mp3"

    private fun decide(
        alarm: com.alarmtalk.app.data.AlarmEntity,
        ownVoiceUri: String? = alarm.localAudioUri,
        entitled: Boolean,
        defaultVoiceUri: String? = stockClipUri,
        onDefaultVoiceAsked: () -> Unit = {},
    ): RingSound {
        val facts = ringSoundFactsFor(alarm, ownVoiceUri) { entitled }
        return decideRingSound(facts) {
            onDefaultVoiceAsked()
            defaultVoiceUri
        }
    }

    @Test
    fun rehearsalAlarmRingsADefaultVoiceInsteadOfSilence() {
        // 목소리 모드 + 알람음 스위치 꺼짐 + 권한 없음 → 기본 목소리 클립. 알람음 스위치를 보지 않는다.
        val sound = decide(rehearsalCloneAlarm(), entitled = false)

        assertEquals(RingSound.DefaultVoice(stockClipUri), sound)
    }

    @Test
    fun withoutAnyDefaultVoiceAudioTheToneIsForcedAudible() {
        val alarm = rehearsalCloneAlarm()
        val sound = decide(alarm, entitled = false, defaultVoiceUri = null)

        assertEquals(RingSound.Tone(forced = true), sound)
        // 크기는 목소리 크기(80)와 숨은 알람음 크기(10) 중 큰 값 — 리허설 로그의 volume=10 이 아니다.
        assertEquals(80, forcedTonePercent(alarm))
    }

    @Test
    fun forcedToneNeverDropsBelowTheFloor() {
        assertEquals(10, forcedTonePercent(rehearsalCloneAlarm(voiceVolumePercent = 0, alarmVolumePercent = 0)))
    }

    @Test
    fun entitledOwnerKeepsTheirOwnVoice() {
        var asked = false
        val sound = decide(rehearsalCloneAlarm(), entitled = true) { asked = true }

        assertEquals(RingSound.OwnVoice("file:///clone/weather_0.mp3"), sound)
        assertFalse("권한이 있으면 기본 목소리를 찾지도 않는다", asked)
    }

    @Test
    fun receivedAlarmsAreNotJudgedByTheRecipientsPlan() {
        var entitlementRead = false
        val received = rehearsalCloneAlarm(origin = AlarmOrigins.RECEIVED_REMOTE)

        assertFalse(ringTimePaidVoiceUnusable(received) { entitlementRead = true; false })
        assertFalse("받은 알람은 권한을 읽지도 않는다", entitlementRead)
        assertEquals(RingSound.OwnVoice("file:///clone/weather_0.mp3"), decide(received, entitled = false))
    }

    @Test
    fun freeSystemVoiceAlarmsAreNotDowngraded() {
        val systemAlarm = rehearsalCloneAlarm(
            voiceProfileId = TEST_SYSTEM_VOICE_ID,
            audioCacheKey = "stock_sys-weather-0",
            localAudioUri = "file:///audio/stock_sys-weather-0.mp3",
        )

        assertFalse(ringTimePaidVoiceUnusable(systemAlarm) { false })
        assertEquals(RingSound.OwnVoice("file:///audio/stock_sys-weather-0.mp3"), decide(systemAlarm, entitled = false))
    }

    @Test
    fun alarmModeIsNotDowngradedAndHonoursTheUsersSilence() {
        // 사용자가 '알람' 모드 + 알람음 끔(진동만)을 고른 알람 — 목소리 참조가 남아 있어도 강등과 무관하다.
        val alarmOnly = rehearsalCloneAlarm(playMode = AlarmPlayModes.ALARM_ONLY)

        assertFalse(ringTimePaidVoiceUnusable(alarmOnly) { false })
        assertEquals(RingSound.Silent, decide(alarmOnly, entitled = false))
        assertEquals(
            RingSound.Tone(forced = false),
            decide(alarmOnly.copy(alarmSoundEnabled = true, alarmVolumePercent = 60), entitled = false),
        )
    }

    @Test
    fun alarmsLockedBeforeThisVersionRingADefaultVoice() {
        // 옛 모양 잠금: alarm_only + preLockPlayMode=목소리, 클론 참조 그대로, 알람음 스위치 꺼짐.
        val legacy = rehearsalCloneAlarm(
            playMode = AlarmPlayModes.ALARM_ONLY,
            preLockPlayMode = AlarmPlayModes.VOICE_ONLY,
        )

        assertEquals(RingSound.DefaultVoice(stockClipUri), decide(legacy, entitled = false))
        assertEquals(RingSound.Tone(forced = true), decide(legacy, entitled = false, defaultVoiceUri = null))
    }

    @Test
    fun systemConvertedAlarmModeIsNeverSilent() {
        // 목소리 삭제 강등이 남긴 모양: alarm_only + 표시(목소리), 목소리 참조는 비웠다.
        val degraded = rehearsalCloneAlarm(
            playMode = AlarmPlayModes.ALARM_ONLY,
            preLockPlayMode = AlarmPlayModes.VOICE_ONLY,
            voiceProfileId = null,
            localAudioUri = null,
            audioCacheKey = null,
            ttsMessageId = null,
        )

        assertEquals(RingSound.Tone(forced = true), decide(degraded, entitled = true))
    }

    @Test
    fun defaultVoiceAlarmWithoutAudioUsesItsOwnClipOrGreeting() {
        // 잠금이 테마 없이 묶은 행(기본 인사말·직접 입력 종류) — 오디오 없는 기본 목소리 알람.
        val locked = rehearsalCloneAlarm(
            voiceProfileId = TEST_SYSTEM_VOICE_ID,
            bucketId = null,
            voiceRandomContext = "preset",
            localAudioUri = null,
            audioCacheKey = null,
            ttsMessageId = null,
        )
        val greeting = "android.resource://com.alarmtalk.app/123"

        assertEquals(RingSound.DefaultVoice(greeting), decide(locked, entitled = false, defaultVoiceUri = greeting))
    }

    @Test
    fun aVoiceAlarmWhoseAudioIsGoneStillMakesSound() {
        // 권한은 있는데 캐시가 사라진 클론 알람 — 조용하지 않다.
        val sound = decide(rehearsalCloneAlarm(localAudioUri = null), ownVoiceUri = null, entitled = true)

        assertEquals(RingSound.Tone(forced = true), sound)
    }

    /**
     * 목소리 크기 0 인 옛 행은 사용자가 고른 무음이다 — 오디오가 사라졌거나 권한이 없어도, 오디오 없는
     * 기본 목소리 알람이어도 대체(기본 목소리·알람음 강제)로 넘어가지 않는다(Codex #820).
     */
    @Test
    fun zeroVoiceVolumeStaysSilentBeforeAnyFallback() {
        var asked = false
        val muted = listOf(
            decide(rehearsalCloneAlarm(voiceVolumePercent = 0, localAudioUri = null), ownVoiceUri = null, entitled = true),
            decide(rehearsalCloneAlarm(voiceVolumePercent = 0), entitled = false) { asked = true },
            decide(
                rehearsalCloneAlarm(voiceVolumePercent = 0, voiceProfileId = TEST_SYSTEM_VOICE_ID, localAudioUri = null),
                ownVoiceUri = null,
                entitled = false,
            ),
            decide(
                rehearsalCloneAlarm(
                    voiceVolumePercent = 0,
                    playMode = AlarmPlayModes.ALARM_ONLY,
                    preLockPlayMode = AlarmPlayModes.VOICE_ONLY,
                ),
                entitled = false,
            ),
        )

        assertTrue(muted.all { it == RingSound.Silent })
        assertFalse("대체 소리를 찾지도 않는다", asked)
    }

    @Test
    fun onlyTheUsersOwnChoicesAreSilent() {
        val silentChoices = listOf(
            rehearsalCloneAlarm(playMode = AlarmPlayModes.ALARM_ONLY),
            rehearsalCloneAlarm(voiceVolumePercent = 0),
        )
        silentChoices.forEach { alarm ->
            assertEquals(RingSound.Silent, decide(alarm, entitled = true))
        }
        // 시스템이 바꾼 것은 어떤 조합이어도 소리가 난다.
        val systemChanges = listOf(
            decide(rehearsalCloneAlarm(), entitled = false, defaultVoiceUri = null),
            decide(rehearsalCloneAlarm(), entitled = false),
            decide(
                rehearsalCloneAlarm(playMode = AlarmPlayModes.ALARM_ONLY, preLockPlayMode = AlarmPlayModes.VOICE_ONLY),
                entitled = false,
                defaultVoiceUri = null,
            ),
        )
        assertTrue(systemChanges.none { it == RingSound.Silent })
    }
}
