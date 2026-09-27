package com.alarmtalk.app.network

import com.google.gson.annotations.JsonAdapter
import com.google.gson.annotations.SerializedName
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Query

data class FamilyAlarmQuietWindow(
    val days: List<Int> = listOf(1, 2, 3, 4, 5),
    val start: String = "09:00",
    val end: String = "18:30",
)

data class DynamicPromptSettings(
    val weather: DynamicPromptWeatherSettings = DynamicPromptWeatherSettings(),
    val fortune: DynamicPromptFortuneSettings = DynamicPromptFortuneSettings(),
)

data class DynamicPromptWeatherSettings(
    val country: String? = null,
    val city: String? = null,
)

data class DynamicPromptFortuneSettings(
    val gender: String? = null,
    @SerializedName("birth_date") val birthDate: String? = null,
    @SerializedName("birth_time") val birthTime: String? = null,
)

data class DynamicPromptSettingsState(
    @SerializedName("weather_ready") val weatherReady: Boolean = false,
    @SerializedName("fortune_ready") val fortuneReady: Boolean = false,
)

/**
 * **기간 한정 개인 플랜**(`personal_promo`) — 서버가 원시 `users.plan = free` 인 계정을
 * 기간 동안 개인 플랜(`plus`)으로 **계산해서** 내려 줄 때만 붙는다. 그 밖에는 null 이다.
 *
 * - 날짜는 **서버 값만** 쓴다. 앱에 종료일을 박지 않는다 — 연장·조기 종료가 서버 배포만으로
 *   끝나야 한다(원본은 `packages/shared` 의 `PERSONAL_PROMO`).
 * - [endsAt] 은 **배타**다. 그 순간부터 무료다. 그래서 "…까지" 로 보여 줄 날은
 *   `endsAt − 1초` 의 기기 날짜다([personalPromoLastDay]).
 * - 필드가 없는 구버전 서버는 이 객체를 주지 않는다 — 그때는 표시만 안 한다.
 *
 * 전부 nullable 인 이유: 서버가 빠뜨리거나 모양이 틀린 필드는 없는 것으로 읽는다 — 쓰는
 * 쪽이 파싱에 실패하면 없는 것으로 본다.
 *
 * ⚠ **파싱은 [PersonalPromoJsonAdapter] 가 한다 — 관대하게.** 표시·안내에만 쓰는 필드 하나가
 *   객체가 아닌 값(문자열·배열)으로 오면 Gson 기본 어댑터는 예외를 던지고, 그러면 **로그인·
 *   `/auth/me`·구독 조회 응답 전체가** 실패한다. 그때는 이 값만 null 로 읽는다(iOS 의
 *   `PersonalPromo.init(from:)` 이 던지지 않는 것과 같은 규칙).
 */
@JsonAdapter(PersonalPromoJsonAdapter::class)
data class PersonalPromo(
    @SerializedName("ends_at") val endsAt: String? = null,
    @SerializedName("notice_from") val noticeFrom: String? = null,
    /**
     * 끝나는 순간 이 계정이 **종료 전환 대상**인가(원시 free · 활성 구독 행 없음) —
     * 대상이면 등록한 목소리가 3일 보관 후 삭제된다. 결제 보류(ON_HOLD·PAUSED)처럼 활성 행이
     * 남은 계정은 false 다.
     *
     * 종료 안내가 이 값으로 "등록한 목소리는 3일 보관 후 삭제돼요" 를 넣을지 가른다 — 대상이
     * 아닌 사람에게 삭제를 말하면 거짓 안내다. 이 키를 주지 않던 서버(null)는 예전 문구
     * 그대로 true 로 읽는다([personalPromoDeletesVoicesAtEnd]).
     */
    @SerializedName("deletes_voices_at_end") val deletesVoicesAtEnd: Boolean? = null,
)

data class AuthUser(
    val id: String,
    val email: String,
    val name: String = "",
    /**
     * 서버가 **계산한** plan. 기간 한정 개인 플랜 동안은 원시 free 도 `plus` 로 온다 —
     * 그때는 [personalPromo] 가 함께 온다. 종료 **전에** 받은 이 값을 종료 **뒤에** 캐시로
     * 읽으면 낡은 것이다(`resolvePaidVoiceAccess` 의 `userPlanPromo`).
     */
    val plan: String = "free",
    /**
     * 기간 한정 개인 플랜. **원시 plan 이 free 인 계정에는 기간 내내 붙는다** — 위 [plan] 이
     * 개인 플랜으로 계산됐다는 뜻이고, 앱은 이 값이 있으면 원시 plan 이 free 라고 안다.
     * 기간이 아니거나 결제자면 null.
     */
    @SerializedName("personal_promo") val personalPromo: PersonalPromo? = null,
    @SerializedName("allow_family_alarms") val allowFamilyAlarms: Boolean = false,
    @SerializedName("family_alarm_quiet_days") val familyAlarmQuietDays: List<Int> = listOf(1, 2, 3, 4, 5),
    @SerializedName("family_alarm_quiet_start") val familyAlarmQuietStart: String = "09:00",
    @SerializedName("family_alarm_quiet_end") val familyAlarmQuietEnd: String = "18:30",
    @SerializedName("family_alarm_quiet_windows") val familyAlarmQuietWindows: List<FamilyAlarmQuietWindow> =
        listOf(FamilyAlarmQuietWindow()),
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

data class RegisterRequest(
    val email: String,
    val password: String,
    val name: String,
    @SerializedName("email_verification_code") val emailVerificationCode: String,
)

data class EmailVerificationRequest(
    val email: String,
)

data class EmailVerificationResponse(
    val success: Boolean,
    @SerializedName("expires_in_seconds") val expiresInSeconds: Int? = null,
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

data class UpdateProfileRequest(
    val name: String? = null,
    @SerializedName("allow_family_alarms") val allowFamilyAlarms: Boolean? = null,
    @SerializedName("family_alarm_quiet_days") val familyAlarmQuietDays: List<Int>? = null,
    @SerializedName("family_alarm_quiet_start") val familyAlarmQuietStart: String? = null,
    @SerializedName("family_alarm_quiet_end") val familyAlarmQuietEnd: String? = null,
    @SerializedName("family_alarm_quiet_windows") val familyAlarmQuietWindows: List<FamilyAlarmQuietWindow>? = null,
    @SerializedName("dynamic_prompt_settings") val dynamicPromptSettings: DynamicPromptSettings? = null,
)

data class UpdateProfileResponse(
    val success: Boolean,
    val name: String? = null,
    @SerializedName("allow_family_alarms") val allowFamilyAlarms: Boolean? = null,
    @SerializedName("family_alarm_quiet_days") val familyAlarmQuietDays: List<Int>? = null,
    @SerializedName("family_alarm_quiet_start") val familyAlarmQuietStart: String? = null,
    @SerializedName("family_alarm_quiet_end") val familyAlarmQuietEnd: String? = null,
    @SerializedName("family_alarm_quiet_windows") val familyAlarmQuietWindows: List<FamilyAlarmQuietWindow>? = null,
    @SerializedName("dynamic_prompt_settings") val dynamicPromptSettings: DynamicPromptSettings? = null,
)

data class DeleteAccountResponse(
    val success: Boolean,
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

data class CancelDeletionResponse(
    val success: Boolean = false,
    val status: String = "active",
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
    val recorded: Int = 0,
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
    val required: List<String> = emptyList(),
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

    @POST("auth/logout")
    suspend fun logout(@Header("Authorization") authorization: String): LogoutResponse

    @GET("auth/me")
    suspend fun me(@Header("Authorization") authorization: String): AuthMeResponse

    @PATCH("user/me")
    suspend fun updateProfile(
        @Header("Authorization") authorization: String,
        @Body request: UpdateProfileRequest,
    ): UpdateProfileResponse

    @DELETE("user/me")
    suspend fun deleteAccount(@Header("Authorization") authorization: String): DeleteAccountResponse

    @POST("user/me/deletion")
    suspend fun requestAccountDeletion(
        @Header("Authorization") authorization: String,
    ): AccountDeletionResponse

    @DELETE("user/me/deletion")
    suspend fun cancelAccountDeletion(
        @Header("Authorization") authorization: String,
    ): CancelDeletionResponse

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
