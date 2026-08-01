package com.alarmtalk.app.data

import android.content.Context
import com.alarmtalk.app.network.DynamicPromptFortuneSettings
import com.alarmtalk.app.network.DynamicPromptSettings
import com.alarmtalk.app.network.DynamicPromptWeatherSettings
import com.alarmtalk.app.network.trimmedOrNull

data class DynamicPromptPreferences(
    val weatherCountry: String = "",
    val weatherCity: String = "",
    val fortuneGender: String = "",
    val fortuneBirthDate: String = "",
    val fortuneBirthTime: String = "",
)

fun DynamicPromptPreferences.toDynamicPromptSettings(): DynamicPromptSettings =
    DynamicPromptSettings(
        weather = DynamicPromptWeatherSettings(
            country = weatherCountry.trimmedOrNull(),
            city = weatherCity.trimmedOrNull(),
        ),
        fortune = DynamicPromptFortuneSettings(
            gender = fortuneGender.trimmedOrNull(),
            birthDate = fortuneBirthDate.trimmedOrNull(),
            birthTime = fortuneBirthTime.trimmedOrNull(),
        ),
    )

class DynamicPromptPreferenceStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun read(): DynamicPromptPreferences =
        DynamicPromptPreferences(
            weatherCountry = prefs.getString(KEY_WEATHER_COUNTRY, "")?.trim().orEmpty(),
            weatherCity = prefs.getString(KEY_WEATHER_CITY, "")?.trim().orEmpty(),
            fortuneGender = prefs.getString(KEY_FORTUNE_GENDER, "")?.trim().orEmpty(),
            fortuneBirthDate = prefs.getString(KEY_FORTUNE_BIRTH_DATE, "")?.trim().orEmpty(),
            fortuneBirthTime = prefs.getString(KEY_FORTUNE_BIRTH_TIME, "")?.trim().orEmpty(),
        )

    fun saveWeatherLocation(country: String, city: String) {
        prefs.edit()
            .putString(KEY_WEATHER_COUNTRY, country.trim())
            .putString(KEY_WEATHER_CITY, city.trim())
            .apply()
    }

    fun saveFortuneInfo(gender: String, birthDate: String, birthTime: String) {
        prefs.edit()
            .putString(KEY_FORTUNE_GENDER, gender.trim())
            .putString(KEY_FORTUNE_BIRTH_DATE, birthDate.trim())
            .putString(KEY_FORTUNE_BIRTH_TIME, birthTime.trim())
            .apply()
    }

    /**
     * 마지막에 고른 문구 종류(랜덤 컨텍스트). **새 알람**의 기본값으로 이어받는다 — 없으면
     * 호출측이 '기본 인사말'(preset)로 폴백한다. '직접 입력'은 저장하지 않는다: 그 문구는 그
     * 알람의 것이라 다음 알람에 끌고 오면 안 되고(사용자 확정), 빈 직접입력으로 시작하면 저장이
     * 막힌다. 기록 시점은 **알람 저장 성공 시** — 편집기에서 눌러만 보고 취소한 것은 기억하지
     * 않는다(마지막에 쓴 목소리와 같은 규칙).
     */
    fun readLastMessageContext(userId: String?): String? =
        readScoped(KEY_LAST_MESSAGE_CONTEXT, userId) ?: claimLegacyLastMessageContext(userId)

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

    fun saveLastMessageContext(userId: String?, context: String) {
        saveScoped(KEY_LAST_MESSAGE_CONTEXT, userId, context)
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
        // 옛 전역 키도 함께 지운다 — 아직 아무도 넘겨받지 않은 채 남아 있으면, 로그아웃 뒤
        // 로그인하는 다음 계정이 그걸 물려받는다.
        prefs.edit().remove(message).remove(bucket).remove(KEY_LAST_MESSAGE_CONTEXT).apply()
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

        // 마지막 선택은 계정별로 나눈다 — 날씨/사주와 달리 이건 '그 사람이 쓰던 것'이라
        // 기기 전역으로 두면 계정을 바꿨을 때 앞 사람 선택으로 첫 알람이 열린다.
        // (마지막에 쓴 목소리 `default_voice_<userId>` 와 같은 규약. 로그인 전이면 저장하지 않는다.)
        private fun scopedKey(key: String, userId: String?): String? {
            val id = userId?.trim().orEmpty()
            return if (id.isEmpty()) null else "${key}_$id"
        }
    }
}
