package com.alarmtalk.app.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.alarm.AlarmScheduler
import com.alarmtalk.app.network.AlarmTalkApi
import com.alarmtalk.app.network.PrerenderVariantResponse
import java.lang.reflect.Proxy
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 날씨 테마 알람을 저장할 때 조건 조회를 **얼마나 기다리는가**의 회귀 가드.
 *
 * 저장 버튼은 `AlarmRepository.resolveWeatherVariantForDraft` 의 응답을 동기로 기다린다
 * (`MainViewModelAlarmActions.withResolvedWeatherVariant`). 상한이 없던 때는 서버(Open-Meteo)
 * 가 멈추면 OkHttp 읽기 타임아웃(60초)까지 저장이 통째로 붙잡혔다 — "인터넷이 느려도
 * 괜찮도록" 의 앱 쪽 몫이 [WEATHER_RESOLVE_TIMEOUT_MILLIS] 다.
 *
 * 상한을 넘긴 결과는 **실패와 같아야 한다**: 미해결(null)로 저장되고, 저장 경로가 거는
 * `DynamicVoiceRefreshScheduler.runOnce` → `DynamicVoiceRefreshWorker` → `hasFailedWeatherRefresh`
 * → `scheduleRetryUntilFire` 사슬이 뒤에서 채운다. WorkManager 는 유닛 테스트에서 띄우지
 * 않으므로(`robolectric.properties` 주석) 여기서는 그 사슬이 보는 술어
 * ([AlarmRepository.hasFailedWeatherRefresh])까지를 확인한다.
 *
 * 시간은 `runTest` 의 가상 시계다 — 8초를 실제로 기다리지 않고, 상한만큼만 흘렀는지를
 * `currentTime` 으로 잰다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class WeatherResolveTimeoutTest {
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

    /**
     * 응답을 영영 주지 않는 API. Retrofit 의 suspend 호출과 같은 모양으로 매달린다 —
     * `suspendCancellableCoroutine` 이라 바깥이 취소하면 그때 깨어난다(Retrofit 은 이 자리에서
     * OkHttp 요청을 끊는다). 취소에 협조하지 않는 가짜로는 이 상한을 검증할 수 없다.
     */
    private class HangingApi(private val onCancelled: () -> Unit) : AlarmTalkApi by unusedApi {
        var calls = 0

        override suspend fun getPrerenderVariant(
            authorization: String,
            context: String,
            country: String?,
            city: String?,
            targetDate: String?,
            timezone: String?,
        ): PrerenderVariantResponse {
            calls += 1
            suspendCancellableCoroutine<Nothing> { continuation ->
                continuation.invokeOnCancellation { onCancelled() }
            }
        }
    }

    /** 즉시 답하는 API — '기존 값 유지' 를 보려면 먼저 해결된 행이 있어야 한다. */
    private class AnsweringApi(private val index: Int) : AlarmTalkApi by unusedApi {
        override suspend fun getPrerenderVariant(
            authorization: String,
            context: String,
            country: String?,
            city: String?,
            targetDate: String?,
            timezone: String?,
        ): PrerenderVariantResponse = PrerenderVariantResponse(context = context, variantIndex = index)
    }

    /**
     * 지금부터 12시간 뒤에 울리는 날씨 알람. 발사가 48시간 안이라야 재시도 술어의 대상이고,
     * 지금과 멀어야 테스트 도중 발사 날짜가 넘어가 `shouldResetWeatherVariant` 가 끼어들지 않는다.
     * 한 테스트 안에서는 **한 번만** 만들어 쓴다 — 분이 바뀌면 다른 알람이 된다.
     */
    private fun weatherDraft(): AlarmDraft {
        val fireAt = java.time.ZonedDateTime.now(java.time.ZoneId.systemDefault()).plusHours(12)
        return weatherDraft(hour = fireAt.hour, minute = fireAt.minute)
    }

    private fun weatherDraft(hour: Int, minute: Int) = AlarmDraft(
        label = "weather",
        hour = hour,
        minute = minute,
        repeatDaysMask = 0,
        snoozeMinutes = 5,
        vibrationPattern = VibrationPatterns.DEFAULT,
        playMode = AlarmPlayModes.VOICE_ONLY,
        localAudioUri = "file:///cache/weather-0.mp3",
        audioCacheKey = "stock_weather-0",
        voiceSource = VoiceSources.TTS_PROFILE,
        voiceProfileId = "70000000-0000-4000-9000-000000000001",
        voiceLanguage = "ko",
        voiceWeatherCountry = "KR",
        voiceWeatherCity = "서울",
        bucketId = "weather",
    )

    /** `MainViewModelAlarmActions.withResolvedWeatherVariant` 와 같은 조립 — null 이면 드래프트 그대로. */
    private suspend fun resolvedForSave(api: AlarmTalkApi, draft: AlarmDraft): AlarmDraft {
        val resolved = repository.resolveWeatherVariantForDraft(api, "token", draft) ?: return draft
        return draft.copy(contextVariantIndex = resolved, contextResolvedNow = true)
    }

    @Test
    fun 응답이_안_오면_상한에서_미해결로_돌아오고_요청은_취소된다() = runTest {
        var cancelled = false
        val api = HangingApi(onCancelled = { cancelled = true })

        val resolved = repository.resolveWeatherVariantForDraft(api, "token", weatherDraft())

        assertNull("상한을 넘기면 실패와 같은 null 이어야 한다", resolved)
        assertEquals(1, api.calls)
        // 상한을 넘긴 요청이 뒤에서 살아남아 값을 덮어쓰면 안 된다 — 취소가 요청까지 닿아야 한다.
        assertTrue("타임아웃 취소가 진행 중인 요청을 끊어야 한다", cancelled)
        // 실제로 기다린 게 아니라 상한이 끝낸 것이다: 가상 시계가 정확히 상한만큼만 흘렀다.
        assertEquals(WEATHER_RESOLVE_TIMEOUT_MILLIS, currentTime)
    }

    @Test
    fun 상한을_넘긴_저장은_미해결로_남고_재시도_대상에_오른다() = runTest {
        val api = HangingApi(onCancelled = {})

        val saved = repository.createAlarm(resolvedForSave(api, weatherDraft()))

        val row = requireNotNull(dao.getById(saved.id))
        assertEquals("weather", row.bucketId)
        assertNull("미해결로 저장돼야 한다 — 0(맑음)으로 때우지 않는다", row.contextVariantIndex)
        assertNull(row.contextResolvedAtMillis)
        // 워커가 `scheduleRetryUntilFire` 를 걸지 정하는 바로 그 술어에 이 행이 걸려야 한다.
        assertTrue("재시도 대상이어야 한다", repository.hasFailedWeatherRefresh())
        assertEquals(WEATHER_RESOLVE_TIMEOUT_MILLIS, currentTime)
    }

    @Test
    fun 수정할_때_상한을_넘기면_받아_둔_값을_그대로_둔다() = runTest {
        // 먼저 정상 응답으로 해결된 행을 만든다.
        val draft = weatherDraft()
        val created = repository.createAlarm(resolvedForSave(AnsweringApi(index = 2), draft))
        assertEquals(2, requireNotNull(dao.getById(created.id)).contextVariantIndex)

        // 같은 시각·같은 도시·같은 목소리로 다시 저장하는데 이번엔 응답이 안 온다.
        val relabelled = draft.copy(label = "weather (edited)")
        repository.updateAlarm(created.id, resolvedForSave(HangingApi(onCancelled = {}), relabelled))

        val row = requireNotNull(dao.getById(created.id))
        assertEquals("weather (edited)", row.label)
        // 실패 규약과 같다: 이미 받아 둔 조건을 null 로 지우지 않는다(nextWeatherVariantState).
        assertEquals(2, row.contextVariantIndex)
    }
}

/**
 * 위 가짜들이 물려받는 바탕 — 날씨 조회 말고 다른 API 를 부르면 그 자체가 실패다.
 * (`AlarmSyncServiceTest` 의 Proxy 방식과 같다.)
 */
private val unusedApi: AlarmTalkApi = Proxy.newProxyInstance(
    AlarmTalkApi::class.java.classLoader,
    arrayOf(AlarmTalkApi::class.java),
) { _, method, _ -> error("unexpected API call: ${method.name}") } as AlarmTalkApi
