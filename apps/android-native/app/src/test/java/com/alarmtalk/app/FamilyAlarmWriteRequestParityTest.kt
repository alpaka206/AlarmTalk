package com.alarmtalk.app

import com.alarmtalk.app.data.AlarmDraft
import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.AlarmOrigins
import com.alarmtalk.app.data.AlarmStates
import com.alarmtalk.app.data.AlarmSyncStates
import com.alarmtalk.app.data.DefaultAlarmSounds
import com.alarmtalk.app.data.SnoozeRepeatLimits
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.VoiceSources
import com.alarmtalk.app.network.RemoteAlarmMapper
import com.alarmtalk.app.network.RemoteAlarmWriteRequest
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * **같은 와이어 타입에 빌더가 두 벌이다** — 자기 알람은 `RemoteAlarmMapper.toWriteRequest`,
 * 가족(상대) 알람은 `AlarmDraft.toRemoteAlarmWriteRequest`.
 *
 * ⚠ `RemoteAlarmWriteRequest` 의 필드가 **전부 기본값을 가져서**, 한쪽 빌더가 필드를
 * 빠뜨려도 컴파일이 통과한다. 실제로 `bucketId` 가 자기 알람 쪽에만 추가돼 **테마를 고른
 * 가족 알람이 테마 없이 수신자에게 도착했다**(2026-08-18). 클립 키 목록은 보낸 사람 기기의
 * 캐시를 가리켜 뜻이 없으므로, 테마 정체성은 `bucket_id` 하나로만 건너간다 — 그게 비면
 * 받는 쪽은 무엇을 틀어야 할지 알 방법이 아예 없다.
 *
 * 그래서 **필드 단위로 비교**한다. 새 필드가 생기면 한쪽에만 넣는 순간 여기서 깨진다.
 */
class FamilyAlarmWriteRequestParityTest {

    private val hour = 7
    private val minute = 5
    private val repeatMask = 0b0111110
    private val messageId = "msg-123"
    private val profileId = "voice-456"
    private val bucket = "weather"

    private fun draft() = AlarmDraft(
        label = "테스트",
        hour = hour,
        minute = minute,
        repeatDaysMask = repeatMask,
        snoozeMinutes = 9,
        playMode = AlarmPlayModes.VOICE_ONLY,
        vibrationPattern = "default",
        voiceSource = VoiceSources.SERVER_TTS,
        voiceProfileId = profileId,
        ttsMessageId = messageId,
        bucketId = bucket,
        targetUserId = "recipient-789",
    )

    private fun entity() = AlarmEntity(
        id = "alarm-1",
        label = "테스트",
        hour = hour,
        minute = minute,
        fireAtMillis = 0L,
        repeatDaysMask = repeatMask,
        holidayOff = false,
        snoozeEnabled = true,
        snoozeMinutes = 9,
        snoozeRepeatLimit = SnoozeRepeatLimits.THREE,
        snoozeCount = 0,
        vibrationPattern = "default",
        playMode = AlarmPlayModes.VOICE_ONLY,
        defaultAlarmSoundId = DefaultAlarmSounds.BUNDLED_DEFAULT,
        localAudioUri = "file://clip0.mp3",
        audioCacheKey = "stock_clip-0",
        rawAudioUri = null,
        voiceSource = VoiceSources.SERVER_TTS,
        voiceProfileId = profileId,
        voiceListenerTitle = null,
        voiceText = "문구",
        voiceCategory = "custom",
        voiceLanguage = "ko",
        voiceRandomPrompt = false,
        voiceRandomContext = null,
        voiceWeatherCountry = null,
        voiceWeatherCity = null,
        voiceFortuneGender = null,
        voiceFortuneBirthDate = null,
        voiceFortuneBirthTime = null,
        dynamicVoicePreparedForFireAtMillis = null,
        voiceRepeat = true,
        voiceVolumePercent = 100,
        ttsMessageId = messageId,
        bucketId = bucket,
        remoteAlarmId = null,
        lastSyncedAtMillis = null,
        syncState = AlarmSyncStates.LOCAL_ONLY,
        origin = AlarmOrigins.LOCAL_OWNED,
        alarmVolumePercent = 100,
        alarmSoundUri = null,
        alarmSoundLabel = null,
        enabled = true,
        state = AlarmStates.SCHEDULED,
        createdAtMillis = 0L,
        updatedAtMillis = 0L,
    )

    @Test
    fun `두 빌더가 같은 필드를 채운다`() {
        val fromDraft = draft().toRemoteAlarmWriteRequest()
        val fromEntity = RemoteAlarmMapper.toWriteRequest(entity())

        // 의도된 차이만 같은 값으로 눌러 두고 **통째로** 비교한다. data class 의 equals 가
        // 모든 필드를 보므로 **앞으로 생길 필드까지** 자동으로 대상이 된다 — 리플렉션으로
        // 필드를 훑을 필요도, 새 필드를 이 테스트에 등록할 필요도 없다.
        assertEquals(
            "빌더 두 벌이 갈라졌다. 한쪽에만 추가한 필드가 있는지 볼 것. 정말 달라야 하면 " +
                "docs/spec/alarm-lifecycle.md와 family-alarm.md에 이유를 적고 아래 copy에 넣을 것.",
            fromEntity.copy(isActive = true, targetUserId = "recipient-789", clientAlarmId = null),
            fromDraft,
        )
    }

    @Test
    fun `가족 알람도 테마를 싣는다`() {
        // 이 한 줄이 회귀의 본체다 — 비면 받는 사람은 무엇을 틀어야 할지 알 수 없다.
        assertEquals(bucket, draft().toRemoteAlarmWriteRequest().bucketId)
    }

    @Test
    fun `의도된 차이는 그대로 다르다`() {
        val fromDraft = draft().toRemoteAlarmWriteRequest()
        val fromEntity = RemoteAlarmMapper.toWriteRequest(entity())
        // 자기 알람은 상대를 지정하지 않는다(보낸 사람이 가족 알람을 PATCH 하지 못하게).
        assertEquals(null, fromEntity.targetUserId)
        assertEquals("recipient-789", fromDraft.targetUserId)
        assertEquals("alarm-1", fromEntity.clientAlarmId)
        assertEquals(null, fromDraft.clientAlarmId)
    }
}
