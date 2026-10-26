package com.alarmtalk.app

import android.app.Application
import com.alarmtalk.app.network.AlarmTalkApiClient
import com.alarmtalk.app.network.BriefingCompany
import com.alarmtalk.app.network.BriefingInterest
import com.alarmtalk.app.network.BriefingInterestsPutRequest
import com.alarmtalk.app.network.BriefingTodayResponse
import com.alarmtalk.app.network.TtsGenerateRequest
import com.alarmtalk.app.network.TtsGenerateResponse

/**
 * 아침 소식 화면의 요청들(`docs/spec/morning-briefing.md` §8). 화면이 **열릴 때와 사용자가 누를 때만** 부른다 — 알람 울림·예약
 * 경로에서 부르지 않는다. 상태는 화면이 들고, 여기는 세션을 붙여 보내기만 한다.
 */
private fun MainViewModel.briefingBearer(): String {
    val session = authSession
        ?: throw UserFacingException(getApplication<Application>().getString(R.string.briefing_login_required))
    return AlarmTalkApiClient.bearer(session.token)
}

internal suspend fun MainViewModel.searchBriefingCompanies(query: String): List<BriefingCompany> =
    api.searchBriefingCompanies(briefingBearer(), query).companies.orEmpty()

internal suspend fun MainViewModel.loadBriefingInterests(): List<BriefingInterest> =
    api.getBriefingInterests(briefingBearer()).interests.orEmpty()

/** 관심 기업을 **통째 교체**한다. 응답의 목록이 곧 화면의 목록이다(앱이 먼저 바꿔 두지 않는다). */
internal suspend fun MainViewModel.saveBriefingInterests(corpCodes: List<String>): List<BriefingInterest> =
    api.putBriefingInterests(briefingBearer(), BriefingInterestsPutRequest(corpCodes)).interests.orEmpty()

internal suspend fun MainViewModel.loadBriefingToday(): BriefingTodayResponse = api.getBriefingToday(briefingBearer())

/**
 * 소식 문장으로 음성을 만든다 — **직접 입력과 같은 요청**이다(`category: custom`, `language: ko`, `random: false`).
 * 차감·광고 보상·429 는 서버의 직접 입력 장부가 정한다(새 차감 경로가 아니다). 목소리 권한도 같은 문([generateTtsAudio])을
 * 지난다 — 무료는 기본 목소리만.
 */
internal suspend fun MainViewModel.generateBriefingSpeech(
    voiceProfileId: String,
    text: String,
    requestId: String,
): TtsGenerateResponse = generateTtsAudio(
    TtsGenerateRequest(
        voiceProfileId = voiceProfileId,
        text = text,
        category = "custom",
        language = "ko",
        translate = false,
        random = false,
        randomContext = null,
        requestId = requestId,
    ),
)
