package com.alarmtalk.app.data

import android.content.Context
import java.util.Locale
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * 앱 전역 공휴일 달력 국가 설정(알람별 아님). KR/JP/US/VN/CN 만 지원하며, 기본값은
 * 기기 로케일 국가가 지원 목록에 있으면 그 값, 아니면 KR.
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

    suspend fun setCountry(code: String) {
        val normalized = normalize(code)
        prefs.edit().putString(KEY_COUNTRY, normalized).apply()
        state.value = normalized
    }

    companion object {
        // ⚠ **베트남·중국은 뺐다(2026-08-10).** 목록에서만 감추는 것이라, 이미 그 값을
        // 고른 계정은 저장된 코드를 그대로 들고 있을 수 있다 — 이름 풀이는 계속 되고
        // 선택 UI 에만 안 나온다. iOS `HolidayStore.supportedCountryCodes` 와 같이 고칠 것.
        val SUPPORTED = listOf("KR", "JP", "US")

        private const val PREFS_NAME = "holiday_country_preferences"
        private const val KEY_COUNTRY = "country_code"
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

/** ISO 3166-1 alpha-2 국가코드를 리저널 인디케이터 심볼(국기 이모지)로 변환한다. */
fun holidayCountryFlagEmoji(countryCode: String): String {
    val code = countryCode.trim().uppercase(Locale.ROOT)
    if (code.length != 2 || !code.all { it in 'A'..'Z' }) return ""
    val base = 0x1F1E6 - 'A'.code
    val first = base + code[0].code
    val second = base + code[1].code
    return String(Character.toChars(first)) + String(Character.toChars(second))
}

/** 현재 로케일 기준 국가 표시 이름(예: KR -> "대한민국"). 비면 코드 그대로. */
fun holidayCountryDisplayName(countryCode: String, locale: Locale = Locale.getDefault()): String {
    val code = countryCode.trim().uppercase(Locale.ROOT)
    if (code.isEmpty()) return countryCode
    val name = Locale("", code).getDisplayCountry(locale)
    return name.ifBlank { code }
}
