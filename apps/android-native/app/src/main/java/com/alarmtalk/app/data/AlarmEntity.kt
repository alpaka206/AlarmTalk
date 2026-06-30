package com.alarmtalk.app.data

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "alarms")
data class AlarmEntity(
    @PrimaryKey val id: String,
    val label: String,
    val hour: Int,
    val minute: Int,
    val fireAtMillis: Long,
    val repeatDaysMask: Int,
    val holidayOff: Boolean,
    val snoozeEnabled: Boolean,
    val snoozeMinutes: Int,
    val snoozeRepeatLimit: Int,
    val snoozeCount: Int,
    val vibrationPattern: String,
    val playMode: String,
    val defaultAlarmSoundId: String,
    val localAudioUri: String?,
    val audioCacheKey: String?,
    val rawAudioUri: String?,
    val voiceSource: String,
    val voiceProfileId: String?,
    val voiceListenerTitle: String?,
    val voiceText: String?,
    val voiceCategory: String?,
    val voiceLanguage: String?,
    val voiceRandomPrompt: Boolean,
    val voiceRandomContext: String?,
    val voiceWeatherCountry: String?,
    val voiceWeatherCity: String?,
    val voiceFortuneGender: String?,
    val voiceFortuneBirthDate: String?,
    val voiceFortuneBirthTime: String?,
    val dynamicVoicePreparedForFireAtMillis: Long?,
    val voiceRepeat: Boolean,
    val voiceVolumePercent: Int,
    val ttsMessageId: String?,
    // 무료 버킷 회전 알람: 가리키는 버킷 카테고리(예: 'morning'·'medication')와, 매 울림마다
    // +1 되는 순차 회전 인덱스. bucketId 가 null 이면 기존 단일 클립 알람.
    // bucketClipKeysJson: 해당 버킷·보이스·설정언어로 미리 캐시해 둔 N개 클립의 audioCacheKey
    // 목록(JSON 배열, variant 순). RingingService 가 이 목록에서 index 로 골라 오프라인 재생한다.
    val bucketId: String? = null,
    val bucketRotationIndex: Int = 0,
    val bucketClipKeysJson: String? = null,
    val remoteAlarmId: String?,
    val lastSyncedAtMillis: Long?,
    val syncState: String,
    val origin: String,
    val alarmVolumePercent: Int,
    val alarmSoundUri: String?,
    val alarmSoundLabel: String?,
    val enabled: Boolean,
    val state: String,
    val createdAtMillis: Long,
    val updatedAtMillis: Long,
)

data class AlarmDraft(
    val label: String,
    val hour: Int,
    val minute: Int,
    val targetUserId: String? = null,
    val targetUserName: String? = null,
    val repeatDaysMask: Int,
    val holidayOff: Boolean = false,
    val snoozeEnabled: Boolean = true,
    val snoozeMinutes: Int,
    val snoozeRepeatLimit: Int = SnoozeRepeatLimits.THREE,
    val vibrationPattern: String,
    val playMode: String,
    val defaultAlarmSoundId: String = DefaultAlarmSounds.BUNDLED_DEFAULT,
    val localAudioUri: String? = null,
    val audioCacheKey: String? = null,
    val rawAudioUri: String? = null,
    val voiceSource: String = VoiceSources.LOCAL_AUDIO,
    val voiceProfileId: String? = null,
    val voiceListenerTitle: String? = null,
    val voiceText: String? = null,
    val voiceCategory: String? = null,
    val voiceLanguage: String? = null,
    val voiceRandomPrompt: Boolean = false,
    val voiceRandomContext: String? = null,
    val voiceWeatherCountry: String? = null,
    val voiceWeatherCity: String? = null,
    val voiceFortuneGender: String? = null,
    val voiceFortuneBirthDate: String? = null,
    val voiceFortuneBirthTime: String? = null,
    val dynamicVoicePreparedForFireAtMillis: Long? = null,
    val voiceRepeat: Boolean = true,
    val voiceVolumePercent: Int = 100,
    val ttsMessageId: String? = null,
    val bucketId: String? = null,
    val bucketClipKeysJson: String? = null,
    val alarmVolumePercent: Int = 100,
    val alarmSoundUri: String? = null,
    val alarmSoundLabel: String? = null,
)

/** bucketClipKeysJson(JSON 문자열 배열) ↔ List<String> 변환 유틸. */
fun encodeBucketClipKeys(keys: List<String>): String? =
    if (keys.isEmpty()) null else org.json.JSONArray(keys).toString()

fun decodeBucketClipKeys(json: String?): List<String> =
    if (json.isNullOrBlank()) {
        emptyList()
    } else {
        runCatching {
            val array = org.json.JSONArray(json)
            buildList { for (i in 0 until array.length()) add(array.getString(i)) }
        }.getOrDefault(emptyList())
    }

/** 이 알람이 버킷 회전에 쓸, 미리 캐시된 N개 클립의 audioCacheKey 목록(variant 순). */
fun AlarmEntity.bucketClipKeys(): List<String> = decodeBucketClipKeys(bucketClipKeysJson)
