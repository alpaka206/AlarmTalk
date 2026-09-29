package com.alarmtalk.app

import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/**
 * 날씨 지역 프리셋 목록 — **보이는 이름은 로케일마다, 보내는 값은 하나**.
 *
 * 지키는 것:
 *  1. **모든 로케일이 같은 개수다.** 행 i 의 이름과 저장 값 `WeatherPresetCityKeys[i]` 가 짝이라,
 *     개수가 어긋나면 이름과 값이 엇갈린다. 2026-09-29 까지 영어 배열은 **비어** 있었고(영어
 *     기기에서 도시 목록이 안 보였다), 일본어는 일본 도시 8개였다(나라는 대한민국으로 보냈다).
 *  2. **한국어 이름이 곧 저장 값이다.** iOS `WeatherCityPickerSheet.presetCities` 가 같은 글자를
 *     보내므로 두 앱·두 로케일이 같은 값을 계정에 남긴다.
 *  3. **기본 나라는 번역하지 않는다.** 보내는 값이라서다(서버 `resolveWeatherLocation` 이 한국어
 *     나라 이름과 대조한다).
 *
 * 소스 XML 을 읽는 부분은 `ShareCodeTextTest` 와 같은 형태 — 세 벌을 한 번에 본다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "ko")
class WeatherPresetCitiesResourceTest {

    private val localeDirs = listOf("values", "values-en", "values-ja")

    private fun stringsXml(dir: String): String {
        // 테스트는 app/ 에서 돈다. 모듈 루트 기준 상대 경로.
        val file = File("src/main/res/$dir/strings.xml")
        assertTrue("$dir/strings.xml 을 못 찾았다(경로: ${file.absolutePath})", file.exists())
        return file.readText()
    }

    private fun presetItems(dir: String): List<String> {
        val body = Regex(
            """<string-array name="hs_weather_preset_cities"\s*(/>|>(.*?)</string-array>)""",
            RegexOption.DOT_MATCHES_ALL,
        ).find(stringsXml(dir))?.groupValues?.get(2)
            ?: error("$dir/strings.xml 에 hs_weather_preset_cities 가 없다")
        return Regex("""<item>(.*?)</item>""").findAll(body).map { it.groupValues[1].trim() }.toList()
    }

    @Test
    fun `모든 로케일의 도시 목록이 저장 값과 같은 개수다`() {
        for (dir in localeDirs) {
            val items = presetItems(dir)
            assertEquals("$dir 의 도시 개수", WeatherPresetCityKeys.size, items.size)
            assertTrue("$dir 에 빈 이름이 있다: $items", items.none { it.isBlank() })
            assertEquals("$dir 에 같은 이름이 둘 있다: $items", items.size, items.toSet().size)
        }
    }

    @Test
    fun `한국어 이름이 곧 저장 값이다`() {
        assertEquals(WeatherPresetCityKeys, presetItems("values"))
    }

    @Test
    fun `기본 나라는 번역하지 않는다`() {
        assertTrue(
            Regex("""<string name="hs_weather_default_country" translatable="false">대한민국</string>""")
                .containsMatchIn(stringsXml("values")),
        )
        for (dir in listOf("values-en", "values-ja")) {
            assertFalse("$dir 에 번역된 기본 나라가 있다", stringsXml(dir).contains("\"hs_weather_default_country\""))
        }
    }

    @Test
    @Config(qualifiers = "en")
    fun `영어 기기는 영어 이름을 보이고 한국어 값을 보낸다`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        assertEquals("Seoul", weatherCityDisplayName(context, "서울"))
        assertEquals("Busan", weatherCityDisplayName(context, " 부산 "))
        // 목록 밖 도시(직접 입력)는 적힌 그대로다.
        assertEquals("미국 뉴욕", weatherCityDisplayName(context, "미국 뉴욕"))
        // 보내는 나라는 로케일과 무관하다.
        assertEquals("대한민국", defaultWeatherCountry(context))
        assertEquals("대한민국" to "Sokcho", parseWeatherLocation(context, "Sokcho"))
    }

    @Test
    @Config(qualifiers = "ja")
    fun `일본어 기기도 같은 값을 보낸다`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        assertEquals("ソウル", weatherCityDisplayName(context, "서울"))
        assertEquals("済州", weatherCityDisplayName(context, "제주"))
        assertEquals("대한민국", defaultWeatherCountry(context))
    }

    @Test
    fun `한국어 기기는 저장 값을 그대로 보인다`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        for (key in WeatherPresetCityKeys) assertEquals(key, weatherCityDisplayName(context, key))
    }
}
