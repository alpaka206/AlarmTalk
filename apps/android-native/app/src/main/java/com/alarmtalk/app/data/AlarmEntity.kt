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
    // bucketClipKeysJson 과 같은 순서(variant 순)의 표시 문구 목록. 매칭형 버킷은 발사 시 고른
    // variant 의 클립을 재생하므로, 잠금화면 문구도 같은 인덱스의 이 목록에서 골라야 음성과 일치한다.
    val bucketClipTextsJson: String? = null,
    // 매칭형 버킷(날씨/운세)에서 '어느 variant 를 틀지'의 인덱스. 발사 전날 준비창에 서버
    // /tts/prerender-variant 가 resolve 한 값을 스냅샷한다(발사는 오프라인 lookup). null 이면
    // 회전(사랑·약·기상 등) 또는 미해결(→ variant0 폴백).
    val contextVariantIndex: Int? = null,
    // contextVariantIndex 를 마지막으로 resolve 한 시각. 준비창 워커의 12h 게이트 전용(범용 updatedAtMillis
    // 재사용 시: 인덱스 불변이면 갱신 누락→매시간 재호출, 무관 편집이 시계 리셋 두 버그 발생). 날씨 resolve
    // 마다 무조건 갱신하고, 이 값만으로 staleness 판정한다.
    val contextResolvedAtMillis: Long? = null,
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
    val bucketClipTextsJson: String? = null,
    val contextVariantIndex: Int? = null,
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

/**
 * 운세 버킷의 테마 인덱스(0..count-1)를 사주+날짜로 결정적으로 고른다. 발사 시점 기기에서 계산해
 * 매일 신선한 테마를 완전 오프라인으로 선택한다(네트워크·서버 불필요). 같은 사람·같은 날은 항상 같은 테마.
 */
internal fun fortuneThemeIndex(
    gender: String?,
    birthDate: String?,
    birthTime: String?,
    date: String,
    count: Int,
): Int {
    if (count <= 0) return 0
    val seed = "${gender?.trim().orEmpty()}|${birthDate?.trim().orEmpty()}|" +
        "${birthTime?.trim().orEmpty()}|${date.trim()}"
    var hash = 0L
    for (ch in seed) {
        hash = (hash * 31 + ch.code) and 0xFFFFFFFFL
    }
    return (hash % count).toInt()
}

/** bucketClipTextsJson(JSON 배열) → 표시 문구 목록(variant 순, bucketClipKeys 와 동일 인덱스). */
fun AlarmEntity.bucketClipTexts(): List<String> = decodeBucketClipKeys(bucketClipTextsJson)

/**
 * 앱 로케일 언어 → 사전렌더/버킷이 지원하는 언어(en/ja/else→ko)의 단일 출처. 편집기(클립 필터)와
 * MainViewModel(클론 생성 시 서버 전송 언어)이 반드시 같은 매핑을 써야 서버 렌더 언어와 편집기 필터
 * 언어가 어긋나지 않는다(어긋나면 오프라인 버킷이 영영 안 붙음). 그래서 data 패키지에 두어 양쪽이 공유한다.
 */
fun appVoiceLanguageOf(language: String?): String = when (language) {
    "en" -> "en"
    "ja" -> "ja"
    else -> "ko"
}

/**
 * 이 버킷 알람이 발사 시 재생/표시할 variant 인덱스(0..N-1). 오디오(resolveBucketClipLocalUri)와
 * 잠금화면 문구(RingingActivity)가 같은 이 인덱스를 써야 음성=문구가 일치한다.
 * 운세=사주+발사일자 결정적 계산, 날씨=준비창 스냅샷 조건 인덱스, 그 외=순차 회전.
 */
fun AlarmEntity.bucketVariantIndex(): Int {
    val size = bucketClipKeys().size
    if (size <= 0) return 0
    val raw = when (bucketId) {
        "fortune" -> fortuneThemeIndex(
            gender = voiceFortuneGender,
            birthDate = voiceFortuneBirthDate,
            birthTime = voiceFortuneBirthTime,
            date = java.time.LocalDate.now().toString(),
            count = size,
        )
        "weather" -> contextVariantIndex ?: 0
        else -> bucketRotationIndex
    }
    return ((raw % size) + size) % size
}
