package com.alarmtalk.app.network

import com.google.gson.annotations.SerializedName
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.PUT
import retrofit2.http.Query

/**
 * **아침 소식**(관심 기업 공시 + 정책브리핑 정책뉴스) 계약. 원본은 `packages/shared/src/schemas/briefing.ts` 이고 규칙은
 * `docs/spec/morning-briefing.md` 다. iOS 짝은 `BriefingModels.swift`.
 *
 * ⚠ Gson 은 코틀린 기본 인자를 적용하지 않는다 — 없을 수 있는 필드는 nullable 로 두고 읽는 쪽이 기본값을 고른다.
 * ⚠ 이 화면은 **열 때만** 부른다. 알람 울림 경로에서 부르지 않는다(`docs/spec/morning-briefing.md` §8).
 */
data class BriefingCompany(
    @SerializedName("corp_code") val corpCode: String,
    @SerializedName("corp_name") val corpName: String = "",
    @SerializedName("stock_code") val stockCode: String? = null,
)

data class BriefingCompanySearchResponse(
    val companies: List<BriefingCompany>? = null,
)

data class BriefingInterest(
    @SerializedName("corp_code") val corpCode: String,
    /** 기업 캐시에서 빠진 기업(상장 폐지 등)이면 null — 고른 기록은 남는다. */
    @SerializedName("corp_name") val corpName: String? = null,
    @SerializedName("stock_code") val stockCode: String? = null,
)

data class BriefingInterestsResponse(
    val interests: List<BriefingInterest>? = null,
)

data class BriefingInterestsPutRequest(
    @SerializedName("corp_codes") val corpCodes: List<String>,
)

data class BriefingDisclosureFlags(
    @SerializedName("amended_report") val amendedReport: Boolean = false,
    @SerializedName("corrected_later") val correctedLater: Boolean = false,
    val withdrawn: Boolean = false,
)

data class BriefingDisclosure(
    val id: String,
    @SerializedName("corp_code") val corpCode: String,
    @SerializedName("corp_name") val corpName: String = "",
    @SerializedName("report_name") val reportName: String = "",
    /** 접수 **날짜**(`YYYY-MM-DD`). 시각은 원천이 주지 않는다 — 지어 붙이지 않는다. */
    @SerializedName("receipt_date") val receiptDate: String = "",
    val flags: BriefingDisclosureFlags? = null,
    val url: String = "",
    /** 이 내용으로 처음 받아 둔 시각(ISO). 낭독 문단의 '확인한 날' 이 이 값이다. */
    @SerializedName("fetched_at") val fetchedAt: String = "",
)

data class BriefingPolicyNews(
    val id: String,
    val title: String = "",
    val summary: String = "",
    val organization: String? = null,
    @SerializedName("published_date") val publishedDate: String = "",
    val url: String = "",
    @SerializedName("fetched_at") val fetchedAt: String = "",
)

data class BriefingCompanyStatus(
    @SerializedName("corp_code") val corpCode: String,
    @SerializedName("corp_name") val corpName: String? = null,
    /** `ok` · `stale` · `unavailable`. 모르는 값은 `unavailable` 로 읽는다(`BriefingPresentation`). */
    val status: String? = null,
    @SerializedName("fetched_at") val fetchedAt: String? = null,
)

data class BriefingSourceError(
    /** `opendart` · `policy_news`. */
    val source: String = "",
    val code: String = "",
    @SerializedName("corp_code") val corpCode: String? = null,
    @SerializedName("retry_after_seconds") val retryAfterSeconds: Int? = null,
)

/** 공시를 찾은 범위(한국 날짜, 양끝 포함). */
data class BriefingWindow(
    val from: String? = null,
    val to: String? = null,
)

data class BriefingTodayResponse(
    val window: BriefingWindow? = null,
    val companies: List<BriefingCompanyStatus>? = null,
    val disclosures: List<BriefingDisclosure>? = null,
    @SerializedName("policy_news") val policyNews: List<BriefingPolicyNews>? = null,
    @SerializedName("fetched_at") val fetchedAt: String? = null,
    val stale: Boolean = false,
    val complete: Boolean = false,
    val errors: List<BriefingSourceError>? = null,
)

interface BriefingApi {
    @GET("briefing/companies/search")
    suspend fun searchBriefingCompanies(
        @Header("Authorization") authorization: String,
        @Query("q") query: String,
        @Query("limit") limit: Int = 20,
    ): BriefingCompanySearchResponse

    @GET("briefing/interests")
    suspend fun getBriefingInterests(@Header("Authorization") authorization: String): BriefingInterestsResponse

    @PUT("briefing/interests")
    suspend fun putBriefingInterests(
        @Header("Authorization") authorization: String,
        @Body request: BriefingInterestsPutRequest,
    ): BriefingInterestsResponse

    @GET("briefing/today")
    suspend fun getBriefingToday(@Header("Authorization") authorization: String): BriefingTodayResponse
}
