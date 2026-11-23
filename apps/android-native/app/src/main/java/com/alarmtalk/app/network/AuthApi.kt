package com.alarmtalk.app.network

import com.google.gson.annotations.SerializedName
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Query

data class DynamicPromptSettings(
    val weather: DynamicPromptWeatherSettings = DynamicPromptWeatherSettings(),
    val fortune: DynamicPromptFortuneSettings = DynamicPromptFortuneSettings(),
)

data class DynamicPromptWeatherSettings(
    /** 옛 앱이 읽는 나라 글자(`대한민국`·`일본`·`미국`). 서버가 [region] 에서 다시 적는다. */
    val country: String? = null,
    /** 옛 앱이 읽는 지역 글자(한국어 이름). 서버가 [region] 에서 다시 적는다. */
    val city: String? = null,
    /**
     * 목록의 지역 키(`kr-seoul`) — docs/spec/voice-and-message.md 「날씨 지역은 목록에서만 고른다」.
     * 옛 서버·옛 행이면 null 이고, 그때는 위 글자를 되짚는다(`resolvedRegion`). 옛 서버는 모르는
     * 칸을 무시하므로 보내도 저장이 깨지지 않는다.
     */
    val region: String? = null,
)

data class DynamicPromptFortuneSettings(
    val gender: String? = null,
    @SerializedName("birth_date") val birthDate: String? = null,
    @SerializedName("birth_time") val birthTime: String? = null,
)

data class AuthUser(
    val id: String,
    val email: String,
    val name: String = "",
    /** 서버에 저장된 `users.plan` 그대로다(계산값이 아니다). 유료 판정은 `resolvePaidVoiceAccess` 가 한다. */
    val plan: String = "free",
    @SerializedName("dynamic_prompt_settings") val dynamicPromptSettings: DynamicPromptSettings =
        DynamicPromptSettings(),
    @SerializedName("deletion_status") val deletionStatus: String = "active",
)

data class AuthTokenResponse(
    val token: String,
    val user: AuthUser,
)

data class AuthMeResponse(
    val user: AuthUser,
    /**
     * 서버가 굴려 준 새 토큰(rolling refresh). 앱을 열 때마다 만료가 뒤로 밀린다.
     *
     * nullable 인 이유는 두 가지다: 이 필드를 내려주기 전 배포된 서버와, 재발급에 실패해도
     * 200 을 유지하는 서버. 둘 다 "쓰던 토큰을 그대로 쓰고 다음 기회에 다시" 가 맞는 동작이라
     * 없으면 조용히 넘어간다.
     */
    val token: String? = null,
)

data class LoginRequest(
    val email: String,
    val password: String,
)

// 닉네임은 받지 않는다(2026-10-29 오너 — 혼자 쓰는 앱이라 부를 이름이 필요 없다). 서버는 옛 앱이 보낸 이름만 받아 둔다.
data class RegisterRequest(
    val email: String,
    val password: String,
    @SerializedName("email_verification_code") val emailVerificationCode: String,
)

data class EmailVerificationRequest(
    val email: String,
)

data class EmailVerificationResponse(
    val success: Boolean,
    @SerializedName("debug_code") val debugCode: String? = null,
)

data class EmailVerificationConfirmRequest(
    val email: String,
    val code: String,
)

data class EmailVerificationConfirmResponse(
    val success: Boolean,
)

data class PasswordResetRequest(
    val email: String,
)

data class PasswordResetConfirmRequest(
    val email: String,
    val code: String,
    val password: String,
)

data class GoogleLoginRequest(
    @SerializedName("id_token") val idToken: String,
)

/** 카카오 로그인 — 카카오 SDK 가 준 **액세스 토큰**(ID 토큰이 아니다). 서버가 카카오에 직접 묻는다. */
data class KakaoLoginRequest(
    @SerializedName("access_token") val accessToken: String,
)

data class UpdateProfileRequest(
    val name: String? = null,
    @SerializedName("dynamic_prompt_settings") val dynamicPromptSettings: DynamicPromptSettings? = null,
)

data class UpdateProfileResponse(
    val success: Boolean,
    val name: String? = null,
    @SerializedName("dynamic_prompt_settings") val dynamicPromptSettings: DynamicPromptSettings? = null,
)

data class LogoutResponse(
    val success: Boolean = false,
)

data class AccountDeletionResponse(
    val success: Boolean = false,
    val status: String = "pending_deletion",
    @SerializedName("purge_at") val purgeAt: String? = null,
    @SerializedName("grace_days") val graceDays: Int = 30,
)

data class ConsentItemRequest(
    val type: String,
    val agreed: Boolean,
    val version: String? = null,
)

data class RecordConsentsRequest(
    val consents: List<ConsentItemRequest>,
    /**
     * **이 앱이 실제로 띄운 법무 문서의 정책 버전**(APK 에 실린 docs/legal 원문에서 읽는다).
     * 서버는 이 값이 지금 게시된 버전과 다르면 409(POLICY_VERSION_MISMATCH)로 기록을
     * 거부한다 — 구버전 앱이 옛 본문을 보여주면서 새 버전 동의 기록을 만드는 것을 막는다.
     */
    @SerializedName("document_version") val documentVersion: String?,
)

data class RecordConsentsResponse(
    val success: Boolean = false,
)

data class ConsentRecord(
    @SerializedName("consent_type") val consentType: String = "",
    @SerializedName("policy_version") val policyVersion: String = "1",
    val agreed: Boolean = false,
    @SerializedName("agreed_at") val agreedAt: String? = null,
)

data class ConsentListResponse(
    val consents: List<ConsentRecord> = emptyList(),
)

data class ConsentStatusResponse(
    @SerializedName("needs_consent") val needsConsent: Boolean = false,
    val missing: List<String> = emptyList(),
    /**
     * 이번 동의 화면에서 **실제로 받아야 하는** 유형. 서버가 유형별 최소 정책 버전으로 계산한다.
     * 화면은 이 목록만 그리고 이 목록만 제출한다 — 이미 유효한 동의는 건드리지 않아야
     * 정책 개정 때 마케팅 수신 설정 같은 기존 선택이 조용히 초기화되지 않는다.
     */
    val collect: List<String> = emptyList(),
    /**
     * [collect] 중 **체크하지 않아도 통과시켜야 하는** 유형(기능 동의 + 선택 동의).
     * 화면은 이 목록에 든 항목만 '선택' 으로 그리고, 나머지는 필수로 강제한다.
     */
    val optional: List<String> = emptyList(),
    /**
     * [collect] 중 **이미 동의해 둔** 유형. 화면의 **초기 체크 상태**로 쓴다.
     *
     * 선택 동의는 체크 없이도 CTA 가 통과되므로, 초기 상태를 항상 미체크로 두면 이미 동의한
     * 사용자가 화면을 그냥 지나가는 순간 그 동의가 agreed=false 로 제출돼 사라진다.
     * **가진 것을 보여주는 것**이지 미리 눌러 주는 게 아니다(필수 유형은 서버가 담지 않는다).
     */
    val prechecked: List<String> = emptyList(),
    /**
     * 음성 라우트가 요구하는 민감 동의 중 아직 없는 것.
     *
     * `overseas_transfer` 는 가입 필수라 보통 비어 있고, 가입 화면에서 `voice_biometric`
     * (선택)을 거절한 사람만 여기에 남는다. 목소리 등록 화면이 이 값으로 인라인 동의 항목을
     * 띄운다 — 한 번 동의하면 비게 되어 다시 묻지 않는다.
     */
    @SerializedName("sensitive_missing") val sensitiveMissing: List<String> = emptyList(),
    /**
     * 화면을 띄워 물어봐야 하는가(= collect 가 비어 있지 않은가). `needsConsent` 와 의미가 다르다 —
     * 그쪽은 '앱을 막는 게이트' 신호라 필수 유형만 보고, 이쪽은 선택 동의 재수집까지 포함한다.
     */
    @SerializedName("needs_collection") val needsCollection: Boolean = false,
    /** 이 계정에 동의 기록이 하나라도 있으면 개정에 따른 재동의다 — 화면 문구가 달라진다. */
    @SerializedName("has_prior_consent") val hasPriorConsent: Boolean = false,
    @SerializedName("policy_version") val policyVersion: String = "1",
)

data class AppVersionResponse(
    val platform: String = "android",
    @SerializedName("min_supported_version") val minSupportedVersion: Int = 1,
    @SerializedName("latest_version") val latestVersion: Int = 1,
    @SerializedName("store_url") val storeUrl: String = "",
    /**
     * 날씨 출처 줄(약관 및 개인정보 처리 동의 화면)을 켜는 서버 신호(불투명 토큰). 정확히 `"kma_jma_nws"` 일 때만 줄을 그린다
     * (`showsWeatherAttribution`, `ui/editor/AlarmRandomPromptSettings.kt`). 필드가 없는 옛 서버는 null 이다.
     */
    @SerializedName("weather_attribution") val weatherAttribution: String? = null,
)

interface AuthApi {
    @POST("auth/email-code")
    suspend fun requestEmailVerification(@Body request: EmailVerificationRequest): EmailVerificationResponse

    @POST("auth/email-code/verify")
    suspend fun confirmEmailVerification(
        @Body request: EmailVerificationConfirmRequest,
    ): EmailVerificationConfirmResponse

    @POST("auth/password-reset")
    suspend fun requestPasswordReset(@Body request: PasswordResetRequest): EmailVerificationResponse

    // 재설정 코드 확인 — 코드를 쓰지 않는다(소모는 확정). 2026-11-16 서버에 생겼다: 이 호출을 싣은 앱은 서버 배포 뒤에 낸다.
    @POST("auth/password-reset/verify")
    suspend fun verifyPasswordResetCode(
        @Body request: EmailVerificationConfirmRequest,
    ): EmailVerificationConfirmResponse

    @POST("auth/password-reset/confirm")
    suspend fun confirmPasswordReset(
        @Body request: PasswordResetConfirmRequest,
    ): EmailVerificationConfirmResponse

    @POST("auth/register")
    suspend fun register(@Body request: RegisterRequest): AuthTokenResponse

    @POST("auth/login")
    suspend fun login(@Body request: LoginRequest): AuthTokenResponse

    @POST("auth/google")
    suspend fun loginGoogle(@Body request: GoogleLoginRequest): AuthTokenResponse

    @POST("auth/kakao")
    suspend fun loginKakao(@Body request: KakaoLoginRequest): AuthTokenResponse

    @POST("auth/logout")
    suspend fun logout(@Header("Authorization") authorization: String): LogoutResponse

    @GET("auth/me")
    suspend fun me(@Header("Authorization") authorization: String): AuthMeResponse

    @PATCH("user/me")
    suspend fun updateProfile(
        @Header("Authorization") authorization: String,
        @Body request: UpdateProfileRequest,
    ): UpdateProfileResponse


    @POST("user/me/deletion")
    suspend fun requestAccountDeletion(
        @Header("Authorization") authorization: String,
    ): AccountDeletionResponse

    @GET("user/consents/status")
    suspend fun consentStatus(@Header("Authorization") authorization: String): ConsentStatusResponse

    @GET("user/consents")
    suspend fun listConsents(@Header("Authorization") authorization: String): ConsentListResponse

    @POST("user/consents")
    suspend fun recordConsents(
        @Header("Authorization") authorization: String,
        @Body request: RecordConsentsRequest,
    ): RecordConsentsResponse

    @GET("app/version")
    suspend fun appVersion(@Query("platform") platform: String = "android"): AppVersionResponse
}
