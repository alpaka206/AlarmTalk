package com.alarmtalk.app.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.alarm.AlarmScheduler
import com.alarmtalk.app.network.AlarmTalkApi
import com.alarmtalk.app.network.PrerenderVariantResponse
import java.lang.reflect.Proxy
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * `GET /tts/prerender-variant` 가 **지역 키를 함께 싣는가**의 회귀 가드.
 *
 * 서버는 `region` 이 알맞은 키면 미리 계산해 둔 행을 준다(docs/spec/voice-and-message.md
 * 「서버가 미리 계산해 둔다」). 알람 행에는 키 칸이 없고 옛 앱용 글자만 있으므로 키는 그 글자에서
 * 되짚는다 — 그래서 저장 시 조회와 준비창 갱신 **두 자리 모두** 같은 되짚기를 거쳐야 한다.
 * 글자(`country`·`city`)는 **계속 함께** 간다 — 새 서버가 배포되기 전 창과 옛 서버 호환.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class WeatherRegionRequestTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var db: AlarmDatabase
    private lateinit var dao: AlarmDao
    private lateinit var repository: AlarmRepository

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(context, AlarmDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        dao = db.alarmDao()
        repository = AlarmRepository(
            alarmDao = dao,
            holidayCalendarStore = HolidayCalendarStore(db.holidayDao()),
            holidayCountryPreferenceStore = HolidayCountryPreferenceStore(context),
            alarmScheduler = AlarmScheduler(context),
            alarmAudioStore = AlarmAudioStore(context),
            context = context,
            currentUserIdProvider = { "owner" },
        )
    }

    @After
    fun tearDown() {
        db.close()
    }

    private data class Sent(val country: String?, val city: String?, val region: String?)

    /** 받은 쿼리를 적어 두고 곧바로 답하는 API. 날씨 조회 말고 다른 API 를 부르면 실패다. */
    private class RecordingApi(private val index: Int? = 3) : AlarmTalkApi by unusedRegionApi {
        val sent = mutableListOf<Sent>()

        override suspend fun getPrerenderVariant(
            authorization: String,
            context: String,
            country: String?,
            city: String?,
            region: String?,
            targetDate: String?,
            timezone: String?,
        ): PrerenderVariantResponse {
            sent += Sent(country, city, region)
            return PrerenderVariantResponse(context = context, variantIndex = index)
        }
    }

    private fun weatherDraft(country: String?, city: String?): AlarmDraft {
        // 12시간 뒤 — 준비창(48h) 안이고 테스트 도중 발사 날짜가 넘어가지 않는다.
        val fireAt = java.time.ZonedDateTime.now(java.time.ZoneId.systemDefault()).plusHours(12)
        return AlarmDraft(
            label = "weather",
            hour = fireAt.hour,
            minute = fireAt.minute,
            repeatDaysMask = 0,
            snoozeMinutes = 5,
            vibrationPattern = VibrationPatterns.DEFAULT,
            playMode = AlarmPlayModes.VOICE_ONLY,
            localAudioUri = "file:///cache/weather-0.mp3",
            audioCacheKey = "stock_weather-0",
            voiceSource = VoiceSources.TTS_PROFILE,
            voiceProfileId = "70000000-0000-4000-9000-000000000001",
            voiceLanguage = "ko",
            voiceWeatherCountry = country,
            voiceWeatherCity = city,
            bucketId = "weather",
        )
    }

    @Test
    fun 저장_시_조회는_옛_앱용_글자와_지역_키를_함께_보낸다() = runTest {
        val api = RecordingApi()
        val tokyo = requireNotNull(WeatherRegions.canonicalLabels("jp-tokyo"))

        val index = repository.resolveWeatherVariantForDraft(api, "token", weatherDraft(tokyo.country, tokyo.city))

        assertEquals(3, index)
        assertEquals(listOf(Sent("일본", "도쿄", "jp-tokyo")), api.sent)
    }

    @Test
    fun 되짚히는_옛_글자도_키를_붙이고_못_되짚은_글자는_키_없이_글자만_보낸다() = runTest {
        val api = RecordingApi()

        repository.resolveWeatherVariantForDraft(api, "token", weatherDraft("South Korea", "Seoul"))
        repository.resolveWeatherVariantForDraft(api, "token", weatherDraft("대한민국", "속초"))

        assertEquals(Sent("South Korea", "Seoul", "kr-seoul"), api.sent[0])
        // 서버의 엄격한 옛 경로로 간다 — 글자는 그대로 싣는다.
        assertEquals(Sent("대한민국", "속초", null), api.sent[1])
    }

    @Test
    fun 준비창_갱신도_지역_키를_함께_보낸다() = runTest {
        val newYork = requireNotNull(WeatherRegions.canonicalLabels("us-new-york"))
        // 미해결로 저장된 날씨 알람 — 준비창 워커가 받을 대상이다.
        val saved = repository.createAlarm(weatherDraft(newYork.country, newYork.city))
        assertNull(requireNotNull(dao.getById(saved.id)).contextVariantIndex)

        val api = RecordingApi(index = 1)
        repository.resolveDueCloneBucketVariants(api, "token")

        assertEquals(listOf(Sent("미국", "뉴욕", "us-new-york")), api.sent)
        assertEquals(1, requireNotNull(dao.getById(saved.id)).contextVariantIndex)
    }
}

private val unusedRegionApi: AlarmTalkApi = Proxy.newProxyInstance(
    AlarmTalkApi::class.java.classLoader,
    arrayOf(AlarmTalkApi::class.java),
) { _, method, _ -> error("unexpected API call: ${method.name}") } as AlarmTalkApi
