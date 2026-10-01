package com.alarmtalk.app.data

import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.network.DynamicPromptSettings
import com.alarmtalk.app.network.DynamicPromptWeatherSettings

// 날씨 지역을 **값으로** 다루는 손으로 쓴 도우미. 목록·되짚기 규칙은 생성 파일
// `WeatherRegions.kt` 에 있고(손으로 고치지 말 것), 여기는 그걸 앱의 저장 모양
// (알람 행의 나라·도시 글자, 계정 설정의 `weather.region`)에 잇는 자리다.
// 규칙: docs/spec/voice-and-message.md 「날씨 지역은 목록에서만 고른다」.

/**
 * 저장된 (나라, 도시) 글자 → 목록의 지역. 못 되짚으면 null.
 *
 * 알람 행은 지역 키 칸이 따로 없다 — 옛 앱이 읽는 한국어 글자(`WeatherRegions.canonicalLabels`)를
 * 나라·도시 칸에 적고, 키는 **언제나 그 글자에서 되짚는다.** 옛 앱용 글자는 자기 지역으로
 * 정확히 돌아온다(회귀 `WeatherRegionsAliasTest`). 옛 글자(직접 입력 시절)도 같은 함수로
 * 되짚히고, 못 되짚는 값은 null 이라 서버의 엄격한 옛 경로로 돈다.
 */
fun weatherRegionFor(country: String?, city: String?): WeatherRegion? =
    WeatherRegions.resolveAlias(country, city)

/** 계정 설정의 날씨 → 지역. 알맞은 `region` 키가 먼저, 없으면 옛 글자를 되짚는다(서버 `normalizeSetting` 과 같은 순서). */
fun DynamicPromptWeatherSettings.resolvedRegion(): WeatherRegion? =
    WeatherRegions.byKey(region) ?: weatherRegionFor(country, city)

/**
 * 공휴일 국가 = **지역의 나라**(docs/spec/alarm-lifecycle.md 「공휴일 국가는 지역의 나라다」).
 *
 * 설정 화면의 '공휴일 달력' 행(옛 `HolidayCountryPickerDialog`)은 없앴다. 공휴일 엔진은 그대로
 * [HolidayCountryPreferenceStore] 를 읽고, 바뀌는 것은 **누가 그 값을 쓰느냐**뿐이다.
 *
 * 지역이 없거나 되짚지 못한 옛 글자뿐이면 **건드리지 않는다** — 지금 값(없으면 기기 로케일이
 * KR·JP·US 면 그 나라, 아니면 KR)이 그대로다.
 */
object WeatherRegionHolidaySync {
    // 두 함수 모두 **공휴일 국가가 실제로 바뀌었는가**를 돌려준다. 바뀌었으면 이미 잡힌
    // '공휴일엔 끄기' 알람을 새 달력으로 다시 잡아야 한다 — 그 일은 호출부가 아니라 국가 값의
    // 흐름을 보는 한 곳(`MainViewModel` → `AlarmRepository.refreshHolidayOffAlarms`)이 한다.
    // 반환값은 테스트와 로그용이다.

    /**
     * 사용자가 **이 기기에서** 자기 계정의 지역을 저장했다(설정 '지역' 행, 편집기 문구 화면).
     *
     * ⚠ **가족 알람에서 고른 지역으로 부르지 말 것.** 그건 받는 사람의 지역이지 이 기기의
     * 지역이 아니다 — 부르면 남의 나라 공휴일로 내 알람이 꺼진다.
     */
    suspend fun onRegionSaved(store: HolidayCountryPreferenceStore, region: WeatherRegion?): Boolean {
        region ?: return false
        // 사용자가 지역을 골랐다 — 옛 '공휴일 달력' 행에서 고른 나라는 더 지키지 않는다
        // ([onAccountRegionReceived]). 남기면 그 판정이 이 고름을 가린다.
        store.clearKeptCountry()
        store.markLegacyCountryDecided()
        return store.setCountry(region.country.code)
    }

    /**
     * 서버에서 계정 설정을 받았고 **이 기기가 받아들였다**([adoptAccountPromptSettings] 가
     * [AccountSettingsAdoption.Accepted] 일 때만 부른다 — 로그인·`/auth/me`·설정 저장 응답).
     *
     * 계정 설정은 계정에, 공휴일 국가는 기기에 있다. 받아 올 때 맞추지 않으면 **두 번째 기기**는
     * 설정 행도 없이 옛 나라에 남는다. 그래서 받아들일 때마다 지역의 나라로 맞춘다. 예외는 하나다:
     *
     *  - ⚠ **업데이트 뒤 처음 계정 설정을 받은 계정의 첫 지역**인데 이 기기에 옛 '공휴일 달력' 행에서 **직접 고른**
     *    나라가 있고 그게 지역의 나라와 다르면, **그 계정의 지역이 바뀌기 전까지** 그 나라를 둔다. 그 기회는
     *    처음 받은 계정 하나의 것이다 — 지역이 없는 계정이어도 가져가고, 다른 계정의 지역을 따라 나라를 적거나
     *    지역을 고르면([onRegionSaved]) 끝난다.
     *    행이 사라졌다고 사용자가 고른 달력을 말없이 바꾸면 공휴일에 꺼지는 날이 조용히 달라진다.
     *    지역을 다시 고르면([onRegionSaved]) 곧바로 지역의 나라가 된다.
     *    ⚠ 지키는 것은 **그 계정**([userId])에 대해서뿐이다 — 다른 계정이 들어오면(지역이 같아도) 그
     *    계정의 지역의 나라를 따른다. 이 기기 전역의 표시를 지역 키로만 가르면 다음 계정이 앞 계정 때
     *    지켜 둔 나라를 물려받는데, 그 계정에게는 그 나라를 바꿀 행이 없다(Codex #837).
     *
     * "지난번에 받은 지역과 같으면 건너뛴다" 를 두지 않는다(2026-09-30 iOS 와 통일). 이 기기에서 고른
     * 지역의 저장이 실패한 경우는 여기까지 오지 않는다 — 받아 적기가 [AccountSettingsAdoption.LocalPending]
     * 이다. 건너뛰기를 두면 로그아웃(값·표시를 지운다) 뒤 같은 계정으로 다시 들어왔을 때 화면의 지역과
     * 달력의 나라가 갈라진 채 남는다. iOS `HolidayStore.countryForAccountRegion` 과 같은 판정이다.
     */
    suspend fun onAccountRegionReceived(
        store: HolidayCountryPreferenceStore,
        userId: String,
        region: WeatherRegion?,
    ): Boolean {
        // 옛 행에서 고른 나라를 지킬 기회는 **업데이트 뒤 처음 받은 계정** 하나의 것이다 — 지역이 없는 계정이어도
        // 그 계정이 기회를 가져간다(Codex #837). 안 그러면 지역 없는 A 뒤에 들어온 B 의 첫 지역이 그 기회가 되어
        // A 때 고른 나라를 B 가 물려받는다.
        val legacyAccount = store.legacyCountryAccountId() ?: userId.also { store.rememberLegacyCountryAccount(it) }
        region ?: return false
        val code = region.country.code
        val firstReceipt = legacyAccount == userId && !store.isLegacyCountryDecided()
        store.markLegacyCountryDecided()
        if (firstReceipt && store.hasSavedCountry() && store.read() != code) {
            store.keepCountryForAccountRegion(userId, region.key)
            return false
        }
        if (store.keptCountryAccountRegionKey() == region.key && store.keptCountryAccountUserId() == userId) {
            return false
        }
        store.clearKeptCountry()
        return store.setCountry(code)
    }
}

/**
 * 계정 설정을 **받았다는 사건** 하나 — 누구의(`userId`) 어떤 값(`settings`)을 몇 번째 저장으로 받았는가(`answerSeq`).
 *
 * 받아 적기(`MainViewModel.onAccountPromptSettingsReceived`)를 다시 돌릴 축이다(`AlarmTalkApp`).
 * ⚠ **응답마다 다른 순번이 축에 있어야 한다**(Codex #837). 값만 축으로 두면, 이 기기의 변경을 올리다 실패한 뒤
 * 서버가 **같은 옛 값**을 다시 줄 때(다음 `/auth/me`) 다시 돌지 않는다 — 그 변경은 '안 올라간 변경' 으로
 * 남은 채 프로세스가 다시 뜰 때까지 올라가지 않고, 그 사이 다른 기기·받는 가족은 옛 지역을 본다.
 * ⚠ 받은 시각([AuthSession.userFetchedAtMillis])은 순번이 아니다 — 개인 프로모 계정은 서버 계산 시각(초 단위)
 * 으로 바뀌어 같은 초의 두 응답이 같은 값이 된다. 순번은 세션 저장소가 저장마다 올린다
 * ([AuthSession.accountAnswerSeq]). 받아 적기는 멱등이라 프로필만 고친 저장으로 한 번 더 돌아도 해가 없다.
 */
data class AccountSettingsReceipt(
    val userId: String,
    val settings: DynamicPromptSettings,
    val answerSeq: Long,
)

/**
 * `/auth/me` 응답의 계정 설정 대신 쓸 값 — **계정 설정 올리기가 끝나기 전에 보낸 요청**(`requestSeq <= fenceSeq`)이면
 * 지금 세션의 값([current]), 아니면 null(응답의 값을 그대로 쓴다, Codex #837). 그 응답은 올리기 전의 설정을 읽었을 수 있는데, 올리기가
 * 끝나 '안 올라간 변경' 표시를 이미 내렸으므로 그대로 쓰면 받아 적기가 옛 값을 이 기기에 적는다(방금 고른 지역이
 * 되돌아가고 공휴일 국가도 따라 흔들린다). 올리기가 끝난 뒤 보낸 요청은 서버의 지금 값이라 그대로 쓴다.
 * iOS `AuthViewModel.promptSettingsAnswerFence` 와 같다.
 */
fun fencedAccountSettings(
    requestSeq: Long,
    fenceSeq: Long,
    current: DynamicPromptSettings?,
): DynamicPromptSettings? = if (requestSeq <= fenceSeq) current else null

/** 세션 → 받아 적을 사건. 계정이나 설정이 없으면 null(받아 적을 것이 없다). */
fun accountSettingsReceipt(session: AuthSession?): AccountSettingsReceipt? {
    val user = session?.user ?: return null
    // 타입은 non-null 이지만 Gson 이 옛 세션·응답에서 null 을 넣을 수 있다 — 받아 적을 것이 없다.
    val settings: DynamicPromptSettings? = user.dynamicPromptSettings
    if (settings == null || user.id.isBlank()) return null
    return AccountSettingsReceipt(user.id, settings, session.accountAnswerSeq)
}

/**
 * 서버의 계정 설정(`dynamic_prompt_settings`)을 받았다 — 로그인·`/auth/me`·설정 저장 응답.
 * 이 기기의 **지역·사주**와 **공휴일 국가**를 한 번에 맞춘다(호출부: `MainViewModel.onAccountPromptSettingsReceived`,
 * 받아 적기만 하는 설정 화면은 [DynamicPromptPreferenceStore.adoptAccountSettings] 를 직접 부른다).
 *
 *  1. 지역·사주: [DynamicPromptPreferenceStore.adoptAccountSettings] — 이 기기에 아직 안 올라간
 *     변경이 있으면 덮지 않는다.
 *  2. 공휴일 국가: 로컬이 서버 값을 **받아들였을 때만** 서버 지역을 따른다(채택 규칙은
 *     [WeatherRegionHolidaySync.onAccountRegionReceived] 그대로). 로컬 변경이 밀려 있으면 따르지
 *     않는다 — 그 지역을 고를 때([WeatherRegionHolidaySync.onRegionSaved]) 이미 맞췄고, 여기서
 *     서버의 옛 지역을 따르면 설정 화면의 지역과 달력의 나라가 갈라진다.
 *
 * 멱등이다. [AccountSettingsAdoption.LocalPending] 이면 호출부가 로컬 값을 서버로 다시 올린다.
 */
suspend fun adoptAccountPromptSettings(
    promptStore: DynamicPromptPreferenceStore,
    holidayStore: HolidayCountryPreferenceStore,
    userId: String,
    settings: DynamicPromptSettings,
): AccountSettingsAdoption {
    val adoption = promptStore.adoptAccountSettings(userId, settings)
    // 날씨 묶음을 받아들였으면(사주만 밀렸어도) 공휴일 국가도 그 지역을 따른다(Codex #837).
    val weatherAccepted = adoption == AccountSettingsAdoption.Accepted ||
        (adoption as? AccountSettingsAdoption.LocalPending)?.weatherAccepted == true
    if (weatherAccepted) {
        // ⚠ **받아 적은 뒤의 이 기기 값**으로 맞춘다 — 서버 값이 아니다(Codex #837). 서버의 날씨 묶음이 비어 있으면
        //   '아직 안 올라갔다' 로 보고 이 기기의 지역을 그대로 두는데, 서버 값으로 맞추면 지역이 없다고 보고 달력을
        //   기기 기본값(KR)에 둔다 — 화면은 도쿄, 공휴일은 한국이 된다.
        WeatherRegionHolidaySync.onAccountRegionReceived(holidayStore, userId, promptStore.read(userId).weatherRegion)
    }
    return adoption
}
