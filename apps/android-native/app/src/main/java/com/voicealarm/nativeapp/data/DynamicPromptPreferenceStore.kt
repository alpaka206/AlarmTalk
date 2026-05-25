package com.voicealarm.nativeapp.data

import android.content.Context
import com.voicealarm.nativeapp.network.DynamicPromptFortuneSettings
import com.voicealarm.nativeapp.network.DynamicPromptSettings
import com.voicealarm.nativeapp.network.DynamicPromptWeatherSettings
import com.voicealarm.nativeapp.network.trimmedOrNull

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

    companion object {
        private const val PREFS_NAME = "dynamic_prompt_preferences"
        private const val KEY_WEATHER_COUNTRY = "weather_country"
        private const val KEY_WEATHER_CITY = "weather_city"
        private const val KEY_FORTUNE_GENDER = "fortune_gender"
        private const val KEY_FORTUNE_BIRTH_DATE = "fortune_birth_date"
        private const val KEY_FORTUNE_BIRTH_TIME = "fortune_birth_time"
    }
}
