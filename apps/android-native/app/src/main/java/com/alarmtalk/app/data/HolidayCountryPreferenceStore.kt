package com.alarmtalk.app.data

import android.content.Context
import java.util.Locale
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * 앱 전역 공휴일 달력 국가 설정(알람별 아님). KR/JP/US 만 지원하며, 기본값은
 * 기기 로케일 국가가 지원 목록에 있으면 그 값, 아니면 KR.
 *
 * ⚠ **이 값을 고르는 화면은 없다**(2026-09-30). 공휴일 국가는 **날씨 지역의 나라**다 —
 * 쓰는 쪽은 [WeatherRegionHolidaySync] 하나다(docs/spec/alarm-lifecycle.md
 * 「공휴일 국가는 지역의 나라다」). 설정 화면의 '공휴일 달력' 행은 지웠다.
 *
 * 코드베이스에 DataStore 가 없으므로(다른 설정도 SharedPreferences 사용) SharedPreferences 를
 * 그대로 쓰되, 화면이 변경을 관찰할 수 있도록 [Flow] 로 노출한다. SharedPreferences 가
 * 프로세스 전역으로 공유되도록 단일 [MutableStateFlow] 를 companion 캐시에 둔다.
 */
class HolidayCountryPreferenceStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private val state: MutableStateFlow<String> = stateFor(prefs)

    val countryCode: Flow<String> = state.asStateFlow()

    fun read(): String = normalize(prefs.getString(KEY_COUNTRY, null))

    /** 적고, **알람이 보는 값**([countryCode])이 실제로 바뀌었는지 돌려준다. */
    suspend fun setCountry(code: String): Boolean {
        val normalized = normalize(code)
        val before = state.value
        prefs.edit().putString(KEY_COUNTRY, normalized).apply()
        state.value = normalized
        return before != normalized
    }

    /** 이 기기에 적힌 값이 있는가(없으면 기기 로케일 기본값으로 읽힌다). */
    fun hasSavedCountry(): Boolean = prefs.contains(KEY_COUNTRY)

    /**
     * 업데이트 뒤 이 기기가 **처음 계정 설정을 받은 계정** — 옛 '공휴일 달력' 행에서 고른 나라를 지킬 기회는 이
     * 계정 하나에만 있다([WeatherRegionHolidaySync.onAccountRegionReceived] 전용). ⚠ 지역이 없는 계정이어도 적는다 —
     * 안 적으면 다음에 들어온 **다른 계정**의 첫 지역이 그 기회로 읽혀 앞 계정 때 고른 나라를 물려받는다(Codex #837).
     */
    fun legacyCountryAccountId(): String? =
        prefs.getString(KEY_LEGACY_COUNTRY_ACCOUNT, null)?.trim()?.ifEmpty { null }

    fun rememberLegacyCountryAccount(userId: String) {
        prefs.edit().putString(KEY_LEGACY_COUNTRY_ACCOUNT, userId).apply()
    }

    /** 옛 행에서 고른 나라를 지킬지 이미 정했다(그 계정의 첫 지역을 받았거나, 지역을 따라 나라를 적었다). */
    fun isLegacyCountryDecided(): Boolean = prefs.getBoolean(KEY_LEGACY_COUNTRY_DECIDED, false)

    fun markLegacyCountryDecided() {
        prefs.edit().putBoolean(KEY_LEGACY_COUNTRY_DECIDED, true).apply()
    }

    /**
     * 옛 '공휴일 달력' 행에서 **직접 고른** 나라를 지키고 있는 계정 지역 키
     * ([WeatherRegionHolidaySync.onAccountRegionReceived] 전용). iOS `HolidayStore.keptCountryAccountWeatherRegionDefaultsKey`.
     */
    fun keptCountryAccountRegionKey(): String? =
        prefs.getString(KEY_KEPT_COUNTRY_ACCOUNT_REGION, null)?.trim()?.ifEmpty { null }

    /**
     * 그 나라를 지키고 있는 **계정**. ⚠ 지역 키만으로 가르지 말 것 — 이 값은 기기 전역이라, 같은
     * 지역(서울)의 **다른 계정**이 이 기기에 들어와도 앞 계정 때 지켜 둔 나라(JP)를 물려받는다
     * (Codex #837). iOS `HolidayStore.keptCountryAccountUserDefaultsKey`.
     */
    fun keptCountryAccountUserId(): String? =
        prefs.getString(KEY_KEPT_COUNTRY_ACCOUNT_USER, null)?.trim()?.ifEmpty { null }

    fun keepCountryForAccountRegion(userId: String, key: String) {
        prefs.edit()
            .putString(KEY_KEPT_COUNTRY_ACCOUNT_REGION, key)
            .putString(KEY_KEPT_COUNTRY_ACCOUNT_USER, userId)
            .apply()
    }

    fun clearKeptCountry() {
        prefs.edit()
            .remove(KEY_KEPT_COUNTRY_ACCOUNT_REGION)
            .remove(KEY_KEPT_COUNTRY_ACCOUNT_USER)
            .apply()
    }

    companion object {
        // ⚠ **베트남·중국은 뺐다(2026-08-10).** 목록에서만 감추는 것이라, 이미 그 값을
        // 고른 계정은 저장된 코드를 그대로 들고 있을 수 있다 — 이름 풀이는 계속 되고
        // 선택 UI 에만 안 나온다. iOS `HolidayStore.supportedCountryCodes` 와 같이 고칠 것.
        val SUPPORTED = listOf("KR", "JP", "US")

        private const val PREFS_NAME = "holiday_country_preferences"
        private const val KEY_COUNTRY = "country_code"
        private const val KEY_LEGACY_COUNTRY_ACCOUNT = "legacy_country_account"
        private const val KEY_LEGACY_COUNTRY_DECIDED = "legacy_country_decided"
        private const val KEY_KEPT_COUNTRY_ACCOUNT_REGION = "kept_country_for_account_weather_region"
        private const val KEY_KEPT_COUNTRY_ACCOUNT_USER = "kept_country_for_account_user"
        private const val FALLBACK_COUNTRY = "KR"

        @Volatile
        private var cachedState: MutableStateFlow<String>? = null

        /** 기기 로케일 국가가 지원되면 그 값, 아니면 KR. */
        fun deviceDefaultCountry(): String {
            val locale = Locale.getDefault().country.uppercase(Locale.ROOT)
            return if (locale in SUPPORTED) locale else FALLBACK_COUNTRY
        }

        private fun normalize(code: String?): String {
            val upper = code?.trim()?.uppercase(Locale.ROOT).orEmpty()
            return if (upper in SUPPORTED) upper else deviceDefaultCountry()
        }

        private fun stateFor(prefs: android.content.SharedPreferences): MutableStateFlow<String> {
            cachedState?.let { return it }
            return synchronized(this) {
                cachedState ?: MutableStateFlow(normalize(prefs.getString(KEY_COUNTRY, null)))
                    .also { cachedState = it }
            }
        }
    }
}
