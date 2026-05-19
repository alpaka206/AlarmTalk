package com.voicealarm.nativeapp.data

import android.content.Context

data class DynamicPromptPreferences(
    val weatherCountry: String = "",
    val weatherCity: String = "",
)

class DynamicPromptPreferenceStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun read(): DynamicPromptPreferences =
        DynamicPromptPreferences(
            weatherCountry = prefs.getString(KEY_WEATHER_COUNTRY, "")?.trim().orEmpty(),
            weatherCity = prefs.getString(KEY_WEATHER_CITY, "")?.trim().orEmpty(),
        )

    fun saveWeatherLocation(country: String, city: String) {
        prefs.edit()
            .putString(KEY_WEATHER_COUNTRY, country.trim())
            .putString(KEY_WEATHER_CITY, city.trim())
            .apply()
    }

    companion object {
        private const val PREFS_NAME = "dynamic_prompt_preferences"
        private const val KEY_WEATHER_COUNTRY = "weather_country"
        private const val KEY_WEATHER_CITY = "weather_city"
    }
}
