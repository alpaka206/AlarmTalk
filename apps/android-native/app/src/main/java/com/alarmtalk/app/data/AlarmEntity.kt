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
    // 알람음(기상 톤) on/off. false 면 알람은 울리되(화면·진동·음성) 톤만 재생하지 않는다. 로컬 전용.
    val alarmSoundEnabled: Boolean = true,
    val enabled: Boolean,
    val state: String,
    val createdAtMillis: Long,
    val updatedAtMillis: Long,
    // 무료 전환 시 유료 목소리 알람을 삭제하지 않고 사운드온리로 '잠글' 때, 원래 재생모드를
    // 여기에 저장한다(playMode 는 ALARM_ONLY 로 내림). 다시 유료가 되면 이 값으로 복원하고 null 로 되돌린다.
    // null = 잠기지 않은 정상 알람.
    val preLockPlayMode: String? = null,
    // 알람을 만든 계정(로그인 user id, 생성 시 1회 기록·불변). 로컬 알람은 로그아웃 후에도 남으므로,
    // 잠금/복원은 현재 세션이 이 알람의 소유자일 때만 수행한다 — 다른 계정으로 로그인해 무료/유료가 돼도
    // 남의 목소리 알람을 잠그거나(→소유자가 복원 못하는 영구 잠금) 복원하지(→남의 목소리 재생) 못하게 한다.
    val ownerUserId: String? = null,
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
    // 이번 저장에서 서버로부터 새로 받아 온 조건인지. 편집기에서 그대로 실려 온 옛 스냅샷과
    // 구분하려고 둔다 — 스냅샷이 저장된 최신 값을 덮어쓰면 안 된다.
    val contextResolvedNow: Boolean = false,
    val alarmVolumePercent: Int = 100,
    val alarmSoundUri: String? = null,
    val alarmSoundLabel: String? = null,
    val alarmSoundEnabled: Boolean = true,
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
 * 날씨 클론 버킷의 '완전한' 클립 수 = 조건 8(CLONE_WEATHER_CONDITIONS) + '미해결 안내' 1(마지막).
 * hasCompleteCloneBucket(완전 판정)과 발사 시 미해결 폴백(마지막=안내 클립)이 공유하는 단일 상수.
 * 백엔드 CLONE_CLIP_SEEDS weather 개수와 일치해야 한다(개수 계약 테스트가 동기화 강제).
 */
const val WEATHER_CLONE_CLIP_COUNT = 9

/**
 * 이 버킷 알람이 발사 시 재생/표시할 variant 인덱스(0..N-1). 오디오(resolveBucketClipLocalUri)와
 * 잠금화면 문구(RingingActivity)가 같은 이 인덱스를 써야 음성=문구가 일치한다.
 * 운세=사주+발사일자 결정적 계산, 날씨=준비창 스냅샷 조건 인덱스, 그 외=순차 회전.
 */
fun AlarmEntity.bucketVariantIndex(): Int? {
    val size = bucketClipKeys().size
    if (size <= 0) return null
    val raw = when (bucketId) {
        "fortune" -> fortuneThemeIndex(
            gender = voiceFortuneGender,
            birthDate = voiceFortuneBirthDate,
            birthTime = voiceFortuneBirthTime,
            date = java.time.Instant.ofEpochMilli(fireAtMillis)
                .atZone(java.time.ZoneId.systemDefault())
                .toLocalDate()
                .toString(),
            count = size,
        )
        // 날씨 미해결(준비창에서 인터넷이 안 돼 조건을 못 받아옴)이면 마지막 클립(=서버가 마지막 seed 로
        // 넣은 '인터넷이 안 돼서 날씨를 못 알아봤어요' 안내)으로 폴백한다. 무음/오재생(맑음=0) 대신 정직한
        // 안내. 단 안내 클립이 실제로 있는 새 버킷(size == WEATHER_CLONE_CLIP_COUNT)에서만 — 이 변경 전
        // 저장된 옛 버킷은 조건 클립만 있어(size < 9) size-1 이 마지막 '조건'(cold)을 가리키므로, 폴백하지
        // 않고 null(대표)로 둔다. 재바인딩(재저장/매니페스트 갱신)되면 안내 클립이 채워져 정상 폴백된다.
        "weather" -> {
            val resolved = contextVariantIndex
            when {
                resolved != null -> resolved
                size >= WEATHER_CLONE_CLIP_COUNT -> size - 1
                else -> return null
            }
        }
        else -> bucketRotationIndex
    }
    return ((raw % size) + size) % size
}
