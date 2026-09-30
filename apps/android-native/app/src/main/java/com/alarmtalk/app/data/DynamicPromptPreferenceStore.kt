package com.alarmtalk.app.data

import android.content.Context
import com.alarmtalk.app.network.DynamicPromptFortuneSettings
import com.alarmtalk.app.network.DynamicPromptSettings
import com.alarmtalk.app.network.DynamicPromptWeatherSettings
import com.alarmtalk.app.network.trimmedOrNull

data class DynamicPromptPreferences(
    /**
     * 날씨 지역은 **옛 앱이 읽는 글자**로 둔다(나라 `대한민국`/`일본`/`미국` + 한국어 지역 이름,
     * `WeatherRegions.canonicalLabels`). 지역 키는 따로 적지 않고 [weatherRegion] 이 글자에서
     * 되짚는다 — 알람 행(`AlarmEntity.voiceWeatherCountry`/`City`)과 같은 모양이라, 둘 사이를
     * 오가는 복사(`withRecipientConditions`·편집기 프리필)가 그대로 돈다.
     * 되짚지 못하는 값은 직접 입력 시절의 옛 글자다 — 바꾸기 전까지 서버의 옛 경로로 돈다.
     */
    val weatherCountry: String = "",
    val weatherCity: String = "",
    val fortuneGender: String = "",
    val fortuneBirthDate: String = "",
    val fortuneBirthTime: String = "",
) {
    /** 저장된 글자가 가리키는 목록의 지역. 비었거나 되짚지 못하면 null. */
    val weatherRegion: WeatherRegion? get() = weatherRegionFor(weatherCountry, weatherCity)

    internal fun hasWeather(): Boolean = weatherCountry.isNotEmpty() || weatherCity.isNotEmpty()

    internal fun hasFortune(): Boolean =
        fortuneGender.isNotEmpty() || fortuneBirthDate.isNotEmpty() || fortuneBirthTime.isNotEmpty()

    internal fun hasSameWeather(other: DynamicPromptPreferences): Boolean =
        weatherCountry == other.weatherCountry && weatherCity == other.weatherCity

    internal fun hasSameFortune(other: DynamicPromptPreferences): Boolean =
        fortuneGender == other.fortuneGender &&
            fortuneBirthDate == other.fortuneBirthDate &&
            fortuneBirthTime == other.fortuneBirthTime
}

fun DynamicPromptPreferences.toDynamicPromptSettings(): DynamicPromptSettings =
    DynamicPromptSettings(
        weather = DynamicPromptWeatherSettings(
            country = weatherCountry.trimmedOrNull(),
            city = weatherCity.trimmedOrNull(),
            // 새 서버는 이 키로 저장하고 글자를 다시 적는다. 옛 서버는 모르는 칸을 무시한다.
            region = weatherRegion?.key,
        ),
        fortune = DynamicPromptFortuneSettings(
            gender = fortuneGender.trimmedOrNull(),
            birthDate = fortuneBirthDate.trimmedOrNull(),
            birthTime = fortuneBirthTime.trimmedOrNull(),
        ),
    )

/**
 * 서버가 들고 있는 조건 설정 → 로컬 표현. 바로 위 `toDynamicPromptSettings` 의 **역**이다.
 *
 * ⚠ 짝을 떨어뜨려 두지 말 것. 예전에는 이쪽만 `ui/editor` 에 있어서, 편집기 밖에서
 * (예: 선다운로드 워커) 서버 값을 쓰려면 UI 패키지를 가져와야 했다 — 그래서 실제로
 * **로컬만 보고 서버를 버리는 코드**가 생겼다(2026-09-03 리뷰 16차).
 */
fun DynamicPromptSettings.toPromptPreferences(): DynamicPromptPreferences {
    // 알맞은 지역 키가 있으면 **그 지역의 옛 앱용 글자**가 이긴다 — 서버도 저장할 때 그렇게
    // 덮는다(`normalizeSetting`). 키가 없거나 모르는 키면 글자를 그대로 둔다.
    val labels = WeatherRegions.canonicalLabels(weather.region)
    return DynamicPromptPreferences(
        weatherCountry = labels?.country ?: weather.country?.trim().orEmpty(),
        weatherCity = labels?.city ?: weather.city?.trim().orEmpty(),
        fortuneGender = fortune.gender?.trim().orEmpty(),
        fortuneBirthDate = fortune.birthDate?.trim().orEmpty(),
        fortuneBirthTime = fortune.birthTime?.trim().orEmpty(),
    )
}

/** [DynamicPromptPreferenceStore.adoptAccountSettings] 의 결과. */
sealed interface AccountSettingsAdoption {
    /** 서버 값을 받아들였다(바뀐 게 없었을 수도 있다). 공휴일 국가도 서버 지역을 따라도 된다. */
    data object Accepted : AccountSettingsAdoption

    /**
     * 이 기기에 서버보다 새 변경이 있어 **덮지 않았다**(밀린 묶음). 호출부는 [settings] 를 다시 올린다.
     *
     * [weatherAccepted] 는 **날씨 묶음은 밀리지 않아 서버 값을 받아들였는가**다(사주만 밀린 경우). 그러면 공휴일
     * 국가도 서버 지역을 따른다 — 안 따르면 화면의 지역과 달력의 나라가 갈라진다(Codex #837). 날씨 묶음이
     * 밀렸으면 따르지 않는다 — 이 기기에서 고를 때 이미 맞췄다.
     */
    data class LocalPending(
        val settings: DynamicPromptSettings,
        val weatherAccepted: Boolean = false,
    ) : AccountSettingsAdoption
}

class DynamicPromptPreferenceStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /**
     * ⚠ **계정별이다.** 예전에는 날씨·사주만 기기 전역 키를 썼고, 주석에도 "날씨/사주와
     * 달리" 라고 적혀 있었다. 그런데 성별·생년월일·태어난 시간은 **기기 취향이 아니라
     * 특정 사람의 개인정보**다 — 로그아웃하고 다른 계정으로 들어오면 앞 사람의 사주가
     * 새 사용자의 '내 정보' 로 채워져 보였고, 그대로 저장하면 남의 생년월일로 운세를
     * 받게 된다. 서버(`users.dynamic_prompt_settings_json`)도 계정별로 들고 있으므로
     * 로컬만 전역인 것은 계약과도 어긋났다.
     *
     * 로그인 전(`userId == null`)에는 읽지도 쓰지도 않는다 — 그 값을 누구 것으로
     * 새길지 알 수 없다.
     */
    fun read(userId: String?): DynamicPromptPreferences {
        claimLegacyPromptInputs(userId)
        return DynamicPromptPreferences(
            weatherCountry = readScoped(KEY_WEATHER_COUNTRY, userId).orEmpty(),
            weatherCity = readScoped(KEY_WEATHER_CITY, userId).orEmpty(),
            fortuneGender = readScoped(KEY_FORTUNE_GENDER, userId).orEmpty(),
            fortuneBirthDate = readScoped(KEY_FORTUNE_BIRTH_DATE, userId).orEmpty(),
            fortuneBirthTime = readScoped(KEY_FORTUNE_BIRTH_TIME, userId).orEmpty(),
        )
    }

    /**
     * 사용자가 **이 기기에서** 고른 지역. 서버로 올리기 전까지는 '아직 안 올라간 변경' 으로
     * 표시한다([adoptAccountSettings] 가 서버의 옛 값으로 덮지 않게). 호출부는 곧바로 서버에
     * 올리고(`updateDynamicPromptSettings`), 성공하면 [markPushed] 가 표시를 내린다.
     *
     * ⚠ 표시는 **묶음(날씨·사주)마다**다(Codex #837). 한 칸으로 두면, 이 기기에서 지역만 고쳐 밀려 있는 사이
     * 다른 기기가 사주를 고쳤을 때 이 기기가 **옛 사주까지** 다시 올려 그 변경을 지운다 — 서버는 설정 전체를
     * 갈아 끼운다(`PATCH /user/me`).
     */
    fun saveWeatherLocation(userId: String?, country: String, city: String) {
        saveScoped(KEY_WEATHER_COUNTRY, userId, country)
        saveScoped(KEY_WEATHER_CITY, userId, city)
        markUnsynced(userId, KEY_WEATHER_SYNC_PENDING)
    }

    /** [saveWeatherLocation] 의 사주 짝 — 사주 묶음에 '안 올라간 변경' 표시를 남긴다. */
    fun saveFortuneInfo(userId: String?, gender: String, birthDate: String, birthTime: String) {
        saveScoped(KEY_FORTUNE_GENDER, userId, gender)
        saveScoped(KEY_FORTUNE_BIRTH_DATE, userId, birthDate)
        saveScoped(KEY_FORTUNE_BIRTH_TIME, userId, birthTime)
        markUnsynced(userId, KEY_FORTUNE_SYNC_PENDING)
    }

    /**
     * 서버의 계정 설정(`dynamic_prompt_settings`)을 이 기기에 받아 적는다 — 로그인·`/auth/me`·
     * 설정 저장 응답이 올 때마다 부른다. **멱등이다**(같은 값을 몇 번 받아도 결과가 같다).
     *
     * 왜 필요한가: 설정의 '지역'·'운세 정보' 행과 편집기는 이 로컬 저장소를 읽는데, 예전에는
     * 여기를 채우는 길이 **이 기기에서 고를 때뿐**이었다. 그래서 두 번째 기기·새로 깐 기기는
     * 계정에 지역이 있는데도 '미설정' 으로 보였다. iOS 설정(`SettingsView.loadPromptPreferences`)은
     * 처음부터 서버 값을 먼저 본다.
     *
     * 규칙(**묶음 — 날씨·사주 — 마다** 따로 본다, Codex #837):
     *  - **그 묶음에 이 기기의 안 올라간 변경이 있으면 덮지 않는다**([saveWeatherLocation]·
     *    [saveFortuneInfo] 뒤 서버 저장이 실패한 경우). 서버가 준 값은 그 변경보다 **옛것**이다 —
     *    덮으면 방금 고른 지역이 조용히 되돌아간다. 서버 값이 로컬과 같아졌으면(올리기는
     *    성공했는데 응답을 못 받은 경우) 그 묶음의 표시만 내린다.
     *  - 안 올라간 변경이 없는 묶음은 **서버가 이긴다**(다른 기기에서 바꾼 값). 단 서버가 비어 있으면
     *    로컬을 그대로 둔다 — 비어 있는 것은 '지웠다' 가 아니라 '아직 안 올라갔다' 이다(서버에는 이
     *    값을 지우는 경로가 없다).
     *  - 밀린 묶음이 남았으면 [AccountSettingsAdoption.LocalPending] 을 돌려준다 — 실어 보낼 값은 **밀린
     *    묶음은 이 기기 값, 나머지는 방금 받은 서버 값**이다. 이 기기의 옛 사주를 함께 올려 다른 기기가
     *    고친 사주를 지우지 않는다.
     */
    fun adoptAccountSettings(userId: String?, server: DynamicPromptSettings): AccountSettingsAdoption {
        val weatherPendingKey = scopedKey(KEY_WEATHER_SYNC_PENDING, userId) ?: return AccountSettingsAdoption.Accepted
        val fortunePendingKey = scopedKey(KEY_FORTUNE_SYNC_PENDING, userId) ?: return AccountSettingsAdoption.Accepted
        val local = read(userId)
        val remote = server.toPromptPreferences()
        val editor = prefs.edit()
        var changed = false
        var pendingLeft = false

        val weatherPending = prefs.getBoolean(weatherPendingKey, false)
        var weatherPendingLeft = false
        if (weatherPending) {
            if (local.hasSameWeather(remote)) {
                editor.remove(weatherPendingKey)
                changed = true
            } else {
                pendingLeft = true
                weatherPendingLeft = true
            }
        } else if (remote.hasWeather() && !local.hasSameWeather(remote)) {
            putScoped(editor, KEY_WEATHER_COUNTRY, userId, remote.weatherCountry)
            putScoped(editor, KEY_WEATHER_CITY, userId, remote.weatherCity)
            changed = true
        }

        val fortunePending = prefs.getBoolean(fortunePendingKey, false)
        if (fortunePending) {
            if (local.hasSameFortune(remote)) {
                editor.remove(fortunePendingKey)
                changed = true
            } else {
                pendingLeft = true
            }
        } else if (remote.hasFortune() && !local.hasSameFortune(remote)) {
            putScoped(editor, KEY_FORTUNE_GENDER, userId, remote.fortuneGender)
            putScoped(editor, KEY_FORTUNE_BIRTH_DATE, userId, remote.fortuneBirthDate)
            putScoped(editor, KEY_FORTUNE_BIRTH_TIME, userId, remote.fortuneBirthTime)
            changed = true
        }

        if (changed) editor.apply()
        return if (pendingLeft) {
            AccountSettingsAdoption.LocalPending(
                settings = read(userId).toDynamicPromptSettings(),
                weatherAccepted = !weatherPendingLeft,
            )
        } else {
            AccountSettingsAdoption.Accepted
        }
    }

    /**
     * 서버 저장이 성공했다. 묶음마다, 올린 값이 **지금도** 로컬과 같을 때만 그 묶음의 '안 올라간 변경'
     * 표시를 내린다 — 올리는 사이에 또 고쳤으면 그 새 값은 아직 안 올라갔다.
     */
    fun markPushed(userId: String?, pushed: DynamicPromptSettings) {
        val weatherPendingKey = scopedKey(KEY_WEATHER_SYNC_PENDING, userId) ?: return
        val fortunePendingKey = scopedKey(KEY_FORTUNE_SYNC_PENDING, userId) ?: return
        // 올린 값은 이 기기 값에서 만든 것이다(`toDynamicPromptSettings`) — 같은 모양으로 묶음마다 비교한다.
        val local = read(userId).toDynamicPromptSettings()
        val editor = prefs.edit()
        if (local.weather == pushed.weather) editor.remove(weatherPendingKey)
        if (local.fortune == pushed.fortune) editor.remove(fortunePendingKey)
        editor.apply()
    }

    /** 이 기기에 아직 서버로 안 올라간 지역·사주 변경이 있는가(어느 묶음이든). */
    fun hasUnsyncedChange(userId: String?): Boolean {
        val weatherPendingKey = scopedKey(KEY_WEATHER_SYNC_PENDING, userId) ?: return false
        val fortunePendingKey = scopedKey(KEY_FORTUNE_SYNC_PENDING, userId) ?: return false
        return prefs.getBoolean(weatherPendingKey, false) || prefs.getBoolean(fortunePendingKey, false)
    }

    private fun markUnsynced(userId: String?, bundleKey: String) {
        val pendingKey = scopedKey(bundleKey, userId) ?: return
        prefs.edit().putBoolean(pendingKey, true).apply()
    }

    private fun putScoped(editor: android.content.SharedPreferences.Editor, key: String, userId: String?, value: String) {
        val scoped = scopedKey(key, userId) ?: return
        editor.putString(scoped, value.trim())
    }

    /**
     * 계정 스코프로 옮기기 전에 저장된 전역 값을 **처음 읽는 계정이 넘겨받는다.**
     * 안 하면 이미 사주를 등록해 둔 사용자가 앱 업데이트 후 값을 잃는다
     * ([claimLegacyLastMessageContext] 와 같은 규약).
     *
     * 넘겨받은 뒤 전역 키는 지운다 — 남겨 두면 다음 계정이 또 물려받아 애초의 누수가
     * 그대로 재현된다.
     */
    private fun claimLegacyPromptInputs(userId: String?) {
        if (userId?.trim().isNullOrEmpty()) return
        val legacyKeys = listOf(
            KEY_WEATHER_COUNTRY,
            KEY_WEATHER_CITY,
            KEY_FORTUNE_GENDER,
            KEY_FORTUNE_BIRTH_DATE,
            KEY_FORTUNE_BIRTH_TIME,
        )
        if (legacyKeys.none { prefs.contains(it) }) return
        val editor = prefs.edit()
        for (key in legacyKeys) {
            val scoped = scopedKey(key, userId) ?: continue
            val legacy = prefs.getString(key, null)?.trim().orEmpty()
            // 이미 이 계정 값이 있으면 옛 전역 값으로 덮지 않는다.
            if (legacy.isNotEmpty() && prefs.getString(scoped, null).isNullOrBlank()) {
                editor.putString(scoped, legacy)
            }
            editor.remove(key)
        }
        editor.apply()
    }

    /**
     * 마지막에 고른 문구 종류(랜덤 컨텍스트). **새 알람**의 기본값으로 이어받는다 — 없으면
     * 호출측이 '기본 인사말'(preset)로 폴백한다. 기록 시점은 **알람 저장 성공 시** —
     * 편집기에서 눌러만 보고 취소한 것은 기억하지 않는다(마지막에 쓴 목소리와 같은 규칙).
     *
     * '직접 입력'은 이 값이 아니라 [readLastManualText] 가 맡는다. 마지막 선택이 무엇이었는지는
     * **둘 중 어느 쪽이 차 있는가**로 정해진다 — 아래 [saveLastMessageContext] 주석 참고.
     */
    fun readLastMessageContext(userId: String?): String? =
        readScoped(KEY_LAST_MESSAGE_CONTEXT, userId) ?: claimLegacyLastMessageContext(userId)

    /**
     * 마지막에 쓴 **직접 입력 문구**. 차 있으면 마지막 선택이 '직접 입력'이었다는 뜻이고,
     * 새 알람은 그 문구를 그대로 얹어 연다.
     *
     * 문구까지 이어받는 이유: 종류만 이어받으면 새 알람이 **빈 직접입력**으로 열려 저장이
     * 막힌다. 반대로 문구를 함께 이어받으면 글자가 같아 [AlarmAudioStore] 의 입력 캐시에
     * 걸리므로 서버 호출도 월 한도 차감도 없이 곧바로 저장된다(오프라인에서도).
     *
     * 대신 **요약 행에 문구를 함께 보여줘야 한다**(MessageModeSummaryRow). 생성형 문구는
     * 내용이 매번 새로 만들어지지만 직접 입력은 글자가 그대로라, 안 보이면 어제 문구를
     * 물고 온 새 알람을 알아챌 방법이 없다.
     */
    fun readLastManualText(userId: String?): String? = readScoped(KEY_LAST_MANUAL_TEXT, userId)

    fun saveLastManualText(userId: String?, text: String) {
        saveScoped(KEY_LAST_MANUAL_TEXT, userId, text)
    }

    /**
     * 계정별 키를 도입하기 전, 이 값은 기기 전역 키 하나에 저장됐다. 그 값을 그대로 두면
     * **업데이트한 기존 사용자가 마지막 선택을 잃고** 새 알람이 '기본 인사말' 로 돌아간다 —
     * CLAUDE.md 의 「직전 선택 유지」 규약이 회귀라고 못 박은 바로 그 동작이다.
     *
     * 그래서 스코프된 값이 없을 때 한 번만 지금 계정 것으로 넘겨받고, 옛 키는 지운다.
     * 지우지 않으면 이 기기에 로그인하는 **다음 계정도** 같은 값을 물려받아, 계정별로 나눈
     * 의미가 사라진다(옛 키는 원래 누구 것인지 모르는 값이다).
     */
    private fun claimLegacyLastMessageContext(userId: String?): String? {
        val scoped = scopedKey(KEY_LAST_MESSAGE_CONTEXT, userId) ?: return null
        val legacy = prefs.getString(KEY_LAST_MESSAGE_CONTEXT, null)?.trim()?.ifEmpty { null }
            ?: return null
        prefs.edit().putString(scoped, legacy).remove(KEY_LAST_MESSAGE_CONTEXT).apply()
        return legacy
    }

    /**
     * 생성형 문구 종류를 기록한다. **직접 입력 기록은 함께 지운다** — 마지막 선택은 하나뿐이라
     * 둘 다 차 있으면 어느 쪽이 마지막인지 알 수 없다. 별도 '마지막은 어느 쪽' 플래그를 두는
     * 대신 이 규칙 하나로 단일 출처를 지킨다(플래그와 값이 어긋나는 상태 자체를 없앤다).
     */
    fun saveLastMessageContext(userId: String?, context: String) {
        saveScoped(KEY_LAST_MESSAGE_CONTEXT, userId, context)
        scopedKey(KEY_LAST_MANUAL_TEXT, userId)?.let { prefs.edit().remove(it).apply() }
    }

    /**
     * 마지막에 고른 무료/기본 목소리 테마(버킷). 무료 tier·기본(시스템) 목소리 경로에는 문구
     * 종류 대신 이 버킷이 문구를 정하므로, 이걸 기억하지 않으면 새 알람이 매번 [FreeBucketOrder]
     * 첫 값(=약)으로 돌아간다.
     */
    fun readLastFreeBucket(userId: String?): String? = readScoped(KEY_LAST_FREE_BUCKET, userId)

    fun saveLastFreeBucket(userId: String?, bucket: String) {
        saveScoped(KEY_LAST_FREE_BUCKET, userId, bucket)
    }

    /** 명시적 로그아웃·탈퇴에서만 부른다(자동 401 에서 지우면 같은 사람이 다시 로그인할 때 잃는다). */
    fun clearLastSelections(userId: String?) {
        val message = scopedKey(KEY_LAST_MESSAGE_CONTEXT, userId) ?: return
        val bucket = scopedKey(KEY_LAST_FREE_BUCKET, userId) ?: return
        // 직접 입력 문구는 **사용자가 친 글**이라 특히 남기면 안 된다 — 다음 계정의 새 알람에
        // 앞 사람이 쓴 문구가 그대로 얹힌다.
        val manual = scopedKey(KEY_LAST_MANUAL_TEXT, userId) ?: return
        // 옛 전역 키도 함께 지운다 — 아직 아무도 넘겨받지 않은 채 남아 있으면, 로그아웃 뒤
        // 로그인하는 다음 계정이 그걸 물려받는다.
        val editor = prefs.edit()
            .remove(message)
            .remove(bucket)
            .remove(manual)
            .remove(KEY_LAST_MESSAGE_CONTEXT)
        // ⚠ 사주·날씨도 함께 지운다. 성별·생년월일·태어난 시간은 **그 사람의 개인정보**라
        // 기기에 남겨 둘 이유가 없다 — 다음 계정의 운세 입력창에 앞 사람 값이 채워지면
        // 그대로 저장돼 남의 생년월일로 운세를 받게 된다.
        for (key in listOf(
            KEY_WEATHER_COUNTRY,
            KEY_WEATHER_CITY,
            KEY_FORTUNE_GENDER,
            KEY_FORTUNE_BIRTH_DATE,
            KEY_FORTUNE_BIRTH_TIME,
        )) {
            scopedKey(key, userId)?.let { editor.remove(it) }
            editor.remove(key) // 아직 아무도 안 넘겨받은 옛 전역 값
        }
        // 값을 지웠으니 '안 올라간 변경' 도 없다 — 남기면 다시 로그인했을 때 빈 로컬이 서버를
        // 이겨 계정 값을 받아 오지 못한다.
        scopedKey(KEY_WEATHER_SYNC_PENDING, userId)?.let { editor.remove(it) }
        scopedKey(KEY_FORTUNE_SYNC_PENDING, userId)?.let { editor.remove(it) }
        editor.apply()
    }

    private fun readScoped(key: String, userId: String?): String? {
        val scoped = scopedKey(key, userId) ?: return null
        return prefs.getString(scoped, null)?.trim()?.ifEmpty { null }
    }

    private fun saveScoped(key: String, userId: String?, value: String) {
        val scoped = scopedKey(key, userId) ?: return
        prefs.edit().putString(scoped, value.trim()).apply()
    }

    companion object {
        private const val PREFS_NAME = "dynamic_prompt_preferences"
        private const val KEY_WEATHER_COUNTRY = "weather_country"
        private const val KEY_WEATHER_CITY = "weather_city"
        private const val KEY_FORTUNE_GENDER = "fortune_gender"
        private const val KEY_FORTUNE_BIRTH_DATE = "fortune_birth_date"
        private const val KEY_FORTUNE_BIRTH_TIME = "fortune_birth_time"
        private const val KEY_LAST_MESSAGE_CONTEXT = "last_message_context"
        private const val KEY_LAST_FREE_BUCKET = "last_free_bucket"
        private const val KEY_LAST_MANUAL_TEXT = "last_manual_text"
        // 이 기기에서 고친 지역·사주가 아직 서버로 안 올라갔다([adoptAccountSettings]) — 묶음마다.
        private const val KEY_WEATHER_SYNC_PENDING = "account_weather_unsynced"
        private const val KEY_FORTUNE_SYNC_PENDING = "account_fortune_unsynced"

        // 마지막 선택은 계정별로 나눈다 — 날씨/사주와 달리 이건 '그 사람이 쓰던 것'이라
        // 기기 전역으로 두면 계정을 바꿨을 때 앞 사람 선택으로 첫 알람이 열린다.
        // (마지막에 쓴 목소리 `default_voice_<userId>` 와 같은 규약. 로그인 전이면 저장하지 않는다.)
        private fun scopedKey(key: String, userId: String?): String? {
            val id = userId?.trim().orEmpty()
            return if (id.isEmpty()) null else "${key}_$id"
        }
    }
}
