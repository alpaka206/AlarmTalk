package com.alarmtalk.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 생성 파일 `WeatherRegions.kt` 의 **옛 글자 되짚기** 회귀 가드 — 서버·iOS·생성 스크립트와
 * 글자 하나까지 같은 답이어야 한다(docs/spec/voice-and-message.md 「날씨 지역은 목록에서만 고른다」).
 *
 * ⚠ 아래 표는 `packages/shared/test/weather-regions.test.ts` 의 표를 **그대로** 옮긴 것이다.
 * 한쪽만 고치지 말 것 — 규칙을 바꾸려면 스크립트·TS·재생성·두 앱 테스트를 함께 고친다.
 */
class WeatherRegionsAliasTest {

    private fun key(country: String?, city: String?): String? = WeatherRegions.resolveAlias(country, city)?.key

    @Test
    fun 목록_크기와_나라별_순서() {
        assertEquals(17, WeatherRegions.byCountry(WeatherCountry.KR).size)
        assertEquals(47, WeatherRegions.byCountry(WeatherCountry.JP).size)
        assertEquals(69, WeatherRegions.byCountry(WeatherCountry.US).size)
        for (country in WeatherCountry.entries) {
            val orders = WeatherRegions.byCountry(country).map { it.order }
            assertEquals("$country 는 1..n 순서다", (1..orders.size).toList(), orders)
        }
    }

    @Test
    fun 옛_앱용_글자는_언제나_자기_지역으로_되짚힌다() {
        // 알람 행에는 키 칸이 없다 — 키는 **언제나** 이 글자에서 되짚는다(`weatherRegionFor`).
        // 이게 한 곳이라도 어긋나면 그 지역을 고른 알람이 `region` 없이 옛 경로로 간다.
        for (region in WeatherRegions.all) {
            val labels = requireNotNull(WeatherRegions.canonicalLabels(region.key)) { region.key }
            assertEquals(region.key, key(labels.country, labels.city))
            assertEquals(region.key, weatherRegionFor(labels.country, labels.city)?.key)
        }
        assertNull(WeatherRegions.canonicalLabels("kr-nowhere"))
        assertEquals(WeatherRegionLabels("대한민국", "경기"), WeatherRegions.canonicalLabels("kr-gyeonggi"))
        assertEquals(WeatherRegionLabels("일본", "도쿄"), WeatherRegions.canonicalLabels(" jp-tokyo "))
    }

    @Test
    fun 안드로이드30_develop_iOS1_2_10_의_프리셋은_전부_되짚힌다() {
        val ko = linkedMapOf(
            "서울" to "kr-seoul", "부산" to "kr-busan", "인천" to "kr-incheon", "대구" to "kr-daegu",
            "대전" to "kr-daejeon", "광주" to "kr-gwangju", "울산" to "kr-ulsan", "수원" to "kr-gyeonggi",
            "제주" to "kr-jeju",
        )
        for ((city, expected) in ko) assertEquals(city, expected, key("대한민국", city))
        // main 의 일본어 목록 — 일본 도시인데 나라는 大韓民国 으로 보냈다.
        val jaMain = mapOf(
            "東京" to "jp-tokyo", "大阪" to "jp-osaka", "名古屋" to "jp-aichi", "横浜" to "jp-kanagawa",
            "札幌" to "jp-hokkaido", "福岡" to "jp-fukuoka", "仙台" to "jp-miyagi", "那覇" to "jp-okinawa",
        )
        for ((city, expected) in jaMain) {
            assertEquals(city, expected, key("大韓民国", city))
            assertEquals(city, expected, key("대한민국", city))
        }
        // develop 의 일본어·영어 표시 이름.
        val jaDevelop = listOf("ソウル", "釜山", "仁川", "大邱", "大田", "光州", "蔚山", "水原", "済州")
        val enDevelop = listOf("Seoul", "Busan", "Incheon", "Daegu", "Daejeon", "Gwangju", "Ulsan", "Suwon", "Jeju")
        val expected = ko.values.toList()
        jaDevelop.forEachIndexed { i, city ->
            assertEquals(city, expected[i], key("大韓民国", city))
            assertEquals(enDevelop[i], expected[i], key("South Korea", enDevelop[i]))
        }
    }

    @Test
    fun 옛_나라_도시_글자_되짚기_표() {
        val table: List<Triple<String?, String?, String?>> = listOf(
            // 옛 입력칸은 첫 낱말을 나라로 떼었다 — 이어 붙여 찾는다.
            Triple("New", "York", "us-new-york"),
            Triple("Los", "Angeles", "us-los-angeles"),
            Triple("Salt", "Lake City", "us-salt-lake-city"),
            Triple("San", "Francisco", "us-san-francisco"),
            // 공백 없는 입력에는 나라가 자동으로 붙었다 — 나라가 어긋나도 도시로 찾는다.
            Triple("South Korea", "Tokyo", "jp-tokyo"),
            Triple("대한민국", "NYC", "us-new-york"),
            Triple("대한민국", "Portland", "us-portland-or"),
            // 한국식 주소 — 앞 낱말(넓은 쪽)로.
            Triple("경기도", "수원시", "kr-gyeonggi"),
            Triple("서울", "강남구", "kr-seoul"),
            Triple("부산광역시", "해운대구", "kr-busan"),
            // 아는 나라 + 여러 낱말 도시 — 첫 낱말로.
            Triple("미국", "뉴욕 맨해튼", "us-new-york"),
            Triple("대한민국", "서울 강남구", "kr-seoul"),
            // 행정 접미사·표기 흔들림.
            Triple("대한민국", " 서울특별시 ", "kr-seoul"),
            Triple("대한민국", "제주도", "kr-jeju"),
            Triple("大韓民国", "津市", "jp-mie"),
            Triple("일본", "東京都", "jp-tokyo"),
            Triple("日本", "名古屋市", "jp-aichi"),
            Triple("Japan", "Osaka-fu", "jp-osaka"),
            Triple("US", "Washington, D.C.", "us-washington-dc"),
            Triple("미국", "워싱턴DC", "us-washington-dc"),
            Triple("미국", "오클라호마 시티", "us-oklahoma-city"),
            Triple("USA", "St. Louis", "us-st-louis"),
            Triple("미국", "Portland, ME", "us-portland-me"),
            Triple("미국", "포틀랜드(메인)", "us-portland-me"),
            Triple("아메리카", "", null),
            Triple("", "ＳＥＯＵＬ", "kr-seoul"),
            Triple("대한민국", "　부산　", "kr-busan"),
            Triple("東京都", "新宿区", "jp-tokyo"),
            Triple("대한민국", "LA", "us-los-angeles"),
            // 되짚지 않는 것 — 옛 경로(엄격한 지오코딩)에 맡긴다.
            Triple("Birmingham", "England", null),
            Triple("La", "Paz", null),
            Triple("Jackson", "Hole", null),
            Triple("미국", "Columbus Georgia", null),
            Triple("Tokyo", "Shinjuku", null),
            // 일본·미국이라고 적었으면 그 나라 안에서만 찾는다.
            Triple("USA", "Seoul", null),
            Triple("미국", "광주", null),
            Triple("일본", "뉴욕", null),
            Triple("영국", "버밍엄", null),
            Triple("영국", "런던", null),
            Triple("대한민국", "속초", null),
            Triple("대한민국", "", null),
            Triple("", "", null),
            Triple(null, null, null),
        )
        for ((country, city, expected) in table) {
            assertEquals("($country, $city)", expected, key(country, city))
        }
    }

    @Test
    fun byKey_는_앞뒤_공백만_무시하고_모르는_키는_null() {
        assertEquals("kr-seoul", WeatherRegions.byKey(" kr-seoul ")?.key)
        assertNull(WeatherRegions.byKey("KR-SEOUL"))
        assertNull(WeatherRegions.byKey("kr-nowhere"))
        assertNull(WeatherRegions.byKey(null))
    }
}
