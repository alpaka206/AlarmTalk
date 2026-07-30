package com.alarmtalk.app

import android.app.Application
import android.util.Log
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Message
import androidx.compose.material3.Text
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.alarmtalk.app.R
import com.alarmtalk.app.billing.PlayBillingManager
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.data.AlarmAppContainer
import com.alarmtalk.app.data.AlarmDraft
import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.CachedAlarmAudio
import com.alarmtalk.app.network.AuthTokenResponse
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.CheckoutRequest
import com.alarmtalk.app.network.CodeRegisterRequest
import com.alarmtalk.app.network.FamilyGroupCurrentResponse
import com.alarmtalk.app.network.FamilyVoiceProfile
import com.alarmtalk.app.network.VoiceDraftQuotaResponse
import com.alarmtalk.app.network.LoginRequest
import com.alarmtalk.app.network.RegisterRequest
import com.alarmtalk.app.network.TtsGenerateRequest
import com.alarmtalk.app.network.TtsGenerateResponse
import com.alarmtalk.app.network.TtsMessage
import com.alarmtalk.app.network.TtsMessageAudioResponse
import com.alarmtalk.app.network.AlarmTalkApiClient
import com.alarmtalk.app.network.VoiceProfile
import com.alarmtalk.app.network.VoiceProfileUpdateRequest
import com.alarmtalk.app.network.VoucherItem
import com.alarmtalk.app.sync.RemoteAlarmSyncScheduler
import java.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import com.alarmtalk.app.data.VoiceProfileCreationDraft
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue

/**
 * 서버가 '기능 사용 시점'에만 요구하는 민감 동의(백엔드 `SENSITIVE_REQUIRED_CONSENTS`).
 * 가입 게이트에서는 받지 않는다 — 목소리를 등록하지 않을 사용자에게까지 생체정보 처리
 * 동의를 요구하면 별도 동의를 서비스 이용 조건으로 강제하는 셈이 된다.
 */
internal val SENSITIVE_CONSENT_TYPES = listOf("voice_biometric", "overseas_transfer")

class MainViewModel(application: Application) : AndroidViewModel(application) {
    internal val repository = AlarmAppContainer.repository(application)
    internal val authSessionStore = AuthSessionStore(application)
    internal val accessSnapshotStore = AccessSnapshotStore(application)
    private val initialAuthSession = authSessionStore.read()
    private val initialAccessSnapshot = initialAuthSession
        ?.user
        ?.id
        ?.takeIf { it.isNotBlank() }
        ?.let(accessSnapshotStore::read)
        ?: AccessSnapshot()
    // 현재 설치된 앱의 versionCode. 모든 요청 헤더(X-App-Version)와 강제 업데이트 판단에 사용.
    internal val appVersionCode: Int = runCatching {
        val info = application.packageManager.getPackageInfo(application.packageName, 0)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
            info.longVersionCode.toInt()
        } else {
            @Suppress("DEPRECATION") info.versionCode
        }
    }.getOrDefault(0)

    internal val api = AlarmTalkApiClient.create(
        unauthorizedHandler = object : AlarmTalkApiClient.UnauthorizedHandler {
            override fun onUnauthorized() {
                // 백엔드에 refresh 엔드포인트가 없어 같은 토큰으로 재시도해도 의미가 없다.
                // 401(TOKEN_REVOKED 포함) 이면 세션을 비우고 화면에 재로그인을 안내한다.
                handleUnauthorized()
            }

            override fun onConsentRequired(consent: String?) {
                // 데이터 라우트가 403 CONSENT_REQUIRED 를 반환 → 동의 플로우로 유도한다.
                handleConsentRequired(consent)
            }
        },
        appVersionCode = appVersionCode,
    )

    // Google Play 결제 매니저. 구매 완료/보류 콜백을 받아 백엔드 검증으로 잇는다.
    // 콜백은 빌링 라이브러리 스레드에서 올 수 있어 viewModelScope(Main)로 옮겨 상태를 갱신한다.
    internal val playBilling = PlayBillingManager(
        application,
        listener = object : PlayBillingManager.Listener {
            override fun onPurchaseReady(purchaseToken: String, productId: String) {
                viewModelScope.launch { confirmGooglePurchase(purchaseToken, productId) }
            }

            override fun onPurchasePending(productId: String) {
                viewModelScope.launch {
                    billingBusy = false
                    message = getApplication<android.app.Application>().getString(R.string.r3misc_billing_purchase_pending)
                }
            }

            override fun onPurchaseFailed(userMessage: String?) {
                viewModelScope.launch {
                    billingBusy = false
                    if (userMessage != null) message = userMessage
                }
            }
        },
    )

    /**
     * okhttp Authenticator 에서 호출되는 401 처리.
     * 다른 스레드(non-main) 에서 호출될 수 있어 UI 스레드로 옮긴 뒤 세션을 클리어한다.
     */
    private fun handleUnauthorized() {
        viewModelScope.launch {
            if (authSession == null) return@launch
            // 알람 예약은 건드리지 않는다. 토큰 만료나 우발적 401 은 '같은 사람이 다시
            // 로그인하면 되는' 상황인데, 여기서 예약을 취소하면 사용자가 안내를 못 본 사이
            // 알람이 조용히 안 울린다 — 알람 전달이 서버 인증 상태에 묶여선 안 된다.
            // 다른 계정으로 갈아타는 경우는 로그인 시점에 onSignedIn 이 정리한다.
            //
            // 다만 소유자 미기록(레거시 null) 행에는 떠나는 계정을 새겨 두고 비운다. 그러지
            // 않으면 다음에 들어온 다른 계정이 null 을 자기 것으로 보고(reschedulePendingAlarms·
            // observeAlarms 규칙) 앞 계정 알람을 되살려 울린다 — onSignedIn 의
            // cancelAlarmsNotOwnedBy 는 소유자 없는 행을 건너뛰므로 그것만으론 못 막는다.
            //
            // 여기서 실패해도(디스크 가득참 등) 예약은 취소하지 않는다 — 취소해 봐야 다음
            // 로그인의 reschedulePendingAlarms 가 그대로 되살리므로 아무것도 못 막고, 대신
            // 본인이 다시 로그인할 때까지 알람만 조용히 안 울린다. 대신 다음 로그인에서
            // 예약 경로가 authSessionStore.pendingOwnerUserId 로 이 계정을 알아내 마저 새긴다.
            runCatching {
                repository.claimUnownedAlarmsFor(authSession?.user?.id?.takeIf { it.isNotBlank() })
            }.onFailure { error ->
                Log.w(TAG, "Failed to stamp ownerless alarms on session expiry", error)
            }
            clearSessionKeepingAlarms()
            message = getApplication<android.app.Application>().getString(R.string.r3misc_session_expired)
        }
    }

    /**
     * 사용자가 명시적으로 계정을 끝낼 때(로그아웃·탈퇴 신청·즉시 탈퇴). 세션 정리에 더해
     * 이 기기의 알람 예약을 내리고 소유자를 새긴다.
     *
     * 알람 분리가 필요한 이유: 세션이 끊기면 observeAlarms 의 소유자 필터가 그 계정 알람을
     * 목록에서 감추는데, OS 예약은 그대로 남아 AlarmReceiver 가 Room 에서 바로 읽어 울린다.
     * 사용자에게는 '보이지도 않고 끌 수도 없는 알람이 울리는' 상태가 된다.
     */
    internal suspend fun clearSignedInSession() {
        val signedOutUserId = authSession?.user?.id?.takeIf { it.isNotBlank() }
        runCatching { repository.detachAlarmsOnSignOut(signedOutUserId) }
            .onFailure { error -> Log.w(TAG, "Failed to detach device alarms on session clear", error) }
        // 기본 목소리 취향(마지막 쓴 목소리·'나중에 받기' 선택)은 계정을 명시적으로 끝낼 때만
        // 지운다. 자동 401 은 같은 사람이 다시 로그인하는 경우가 대부분이라, 거기서 지우면
        // 편집기가 쓰던 목소리를 잊고 기본 목소리 다운로드 안내를 다시 밟게 한다.
        // (저장소가 계정별 키라 남겨 둬도 다음 계정에 새지 않는다.)
        clearCurrentDefaultVoicePreferences()
        clearSessionKeepingAlarms()
    }

    /**
     * 세션만 정리한다(알람 예약·기기 취향은 그대로). 자동 401 처럼 사용자의 의도가 아닌
     * 종료에 쓴다 — 여기서 지우는 것은 '이 계정으로서의 세션 상태'까지다.
     */
    private fun clearSessionKeepingAlarms() {
        runCatching { authSessionStore.clear() }
        clearUserScopedRemoteState()
        authSession = null
    }

    /**
     * 데이터 라우트의 403 CONSENT_REQUIRED 처리. okhttp 인터셉터(non-main)에서 호출될 수 있어
     * UI 스레드로 옮긴 뒤 동의 플로우를 연다.
     *
     * 민감 동의(voice_biometric·overseas_transfer)는 **가입 게이트에 체크박스가 없다** — 목소리
     * 등록 시점에 전용 시트로 받는다. 그러니 여기서 가입 게이트를 열면 사용자가 통과할 방법이
     * 없어 갇힌다. 서버가 지목한 유형이 민감 동의면 상태만 갱신하고 게이트는 열지 않는다.
     */
    private fun handleConsentRequired(consent: String?) {
        viewModelScope.launch {
            if (authSession == null) return@launch
            if (consent != null && consent in SENSITIVE_CONSENT_TYPES) {
                if (consent !in sensitiveConsentMissing) {
                    sensitiveConsentMissing = sensitiveConsentMissing + consent
                }
                // 서버가 지목한 그 동의만 받는 시트를 연다. 여기서 그냥 안내만 하고 끝내면
                // 목소리를 등록하지 않는 사용자(무료 = 시스템 목소리 전용)는 동의할 방법이
                // 없어 같은 403 을 무한 반복한다.
                if (pendingSensitiveConsent == null) {
                    pendingSensitiveConsent = SensitiveConsentRequest(types = listOf(consent))
                }
                return@launch
            }
            needsConsent = true
            consentChecked = true
            message = getApplication<android.app.Application>().getString(R.string.r3misc_consent_required)
        }
    }

    // Room 첫 방출이 오기 전(콜드 스타트 첫 프레임)의 '빈 리스트'는 실제 빈 상태가 아니다 —
    // 이 플래그가 false 인 동안 알람 탭은 빈 상태 히어로를 그리지 않아, 알람이 있는데도
    // '알람이 없습니다'가 번쩍였다 바뀌는 문제를 막는다. 한 번 true 가 되면 유지.
    var alarmsLoaded by mutableStateOf(false)
        internal set

    val alarms: StateFlow<List<AlarmEntity>> = repository.observeAlarms()
        .onEach { alarmsLoaded = true }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    var authSession by mutableStateOf<AuthSession?>(initialAuthSession)
        internal set

    var authBusy by mutableStateOf(false)
        internal set

    var registerEmailVerificationSentTo by mutableStateOf<String?>(null)
        internal set

    var registerEmailVerified by mutableStateOf<String?>(null)
        internal set

    // 비밀번호 재설정 코드를 보낸 이메일. 입력 이메일과 같으면 코드+새 비밀번호 입력을 노출한다.
    var passwordResetCodeSentTo by mutableStateOf<String?>(null)
        internal set

    // 가입 시도 이메일이 이미 가입돼 있을 때(AUTH_EMAIL_TAKEN) 로그인 화면으로 전환하라는 신호.
    var authRedirectToLogin by mutableStateOf(false)
        internal set

    // 이메일 로그인 실패 안내 — 전역 스낵바 대신 로그인 화면 안 인라인으로 보여준다.
    // (스낵바는 하단이라 로그인 직후 열려 있는 키보드에 가려 아무 피드백도 없는 것처럼 보인다.)
    var loginError by mutableStateOf<String?>(null)
        internal set

    // 회원가입 흐름(인증 요청·코드 확인·가입) 실패 안내 — 같은 이유로 회원가입 화면 인라인.
    var registerError by mutableStateOf<String?>(null)
        internal set

    // 회원가입 → 로그인 자동 전환(AUTH_EMAIL_TAKEN) 때 로그인 화면에 남기는 이유 안내.
    // 전환 '후' 화면에 보여야 하므로 화면 전환 시 정리되는 loginError/registerError 와 분리한다.
    var authNotice by mutableStateOf<String?>(null)
        internal set

    var syncBusy by mutableStateOf(false)
        internal set

    var voiceProfiles by mutableStateOf<List<VoiceProfile>>(emptyList())
        internal set

    var pendingVoiceDraft by mutableStateOf<VoiceProfile?>(null)
        internal set

    // 이번 달 목소리 초안 생성 쿼터(삭제 전 '이번 달 재생성 가능 여부' 판정용). null=미조회.
    var voiceDraftQuota by mutableStateOf<VoiceDraftQuotaResponse?>(null)
        internal set

    var voiceProfileBusy by mutableStateOf(false)
        internal set

    var voiceProfileLoadFinished by mutableStateOf(false)
        internal set

    var ttsMessages by mutableStateOf<List<TtsMessage>>(emptyList())
        internal set

    var stockClips by mutableStateOf<List<com.alarmtalk.app.network.StockClip>>(emptyList())
        internal set

    var ttsMessageBusy by mutableStateOf(false)
        internal set

    var socialBusy by mutableStateOf(false)
        internal set

    var familyGroup by mutableStateOf<FamilyGroupCurrentResponse?>(initialAccessSnapshot.familyGroup)
        internal set

    var familyVoices by mutableStateOf<List<FamilyVoiceProfile>>(emptyList())

    // 공유 목소리 목록이 API 로 '신선하게' 로드됐는지. 접근권 잃은 목소리 알람 강등 판단은
    // 이 신선 로드 + voiceProfiles 로드가 모두 확보됐을 때만 수행한다(reconcileInaccessibleVoiceAlarms).
    internal var familyVoicesLoadedFresh: Boolean = false
        internal set

    // 내 음성 목록이 API 로 '성공적으로' 로드됐는지(빈 목록도 유효한 신선 로드로 취급). voiceProfiles.isEmpty()
    // 를 '미로드'로 쓰면 마지막 목소리를 삭제·접근상실한 사용자의 알람 강등이 스킵되므로 별도 플래그로 추적(PR #536 P2).
    internal var voiceProfilesLoadedFresh: Boolean = false
        internal set

    var billingBusy by mutableStateOf(false)

    // 서버가 Play 구독을 직접 해지하지 못했을 때(PLAY_CANCEL_FAILED 등) 띄우는
    // "Google Play에서 직접 관리" 안내 다이얼로그의 구독 관리 URL. null 이면 숨김.
    var billingPlayManageUrl by mutableStateOf<String?>(null)

    // planKey("personal"/"couple"/"family") → Play 실제 표시가격(formattedPrice). preloadProducts
    // 성공 시 채워지며, 비면 UI 가 문자열 리소스로 폴백한다. 하드코딩 대신 청구 통화·금액을 정확히 표기.
    var billingPlanPrices by mutableStateOf<Map<String, String>>(emptyMap())
        internal set

    // 이용권 패널 진입 시의 read-only 새로고침 플래그. billingBusy(구매·해지 등
    // 뮤테이션)와 분리해, 새로고침 중에도 구매 버튼이 즉시 눌리게 한다 —
    // 구독 상태는 AccessSnapshotStore 캐시로 이미 알고 있다.
    var billingRefreshing by mutableStateOf(false)
        internal set

    var subscriptionResponse by mutableStateOf<BillingSubscriptionResponse?>(initialAccessSnapshot.subscriptionResponse)
        internal set

    var vouchers by mutableStateOf<List<VoucherItem>>(emptyList())
        internal set

    var message by mutableStateOf<String?>(null)
        internal set

    private val receivedAlarmBadgeStore = ReceivedAlarmBadgeStore(application)
    var receivedAlarmSeenAtMillis by mutableStateOf(
        authSession?.user?.id?.let(receivedAlarmBadgeStore::readSeenAtMillis) ?: 0L,
    )
        internal set

    private val themePrefs = application.getSharedPreferences("voice_alarm_theme", android.content.Context.MODE_PRIVATE)
    var themeMode by mutableStateOf(loadInitialThemeMode(themePrefs))
        internal set

    var nicknameEditDialogOpen by mutableStateOf(false)
        internal set

    var deleteAccountConfirmOpen by mutableStateOf(false)
        internal set

    private val defaultVoiceStore = com.alarmtalk.app.data.DefaultVoicePreferenceStore(application)

    // 첫 로그인 "목소리 고르기" 스텝 표시 여부. 기본 목소리를 아직 안 고른 사용자에게만 1회.
    var showVoiceSetup by mutableStateOf(false)
        internal set

    // 사용자가 고른 기본 목소리 id(시스템 보이스). 새 알람 에디터 미리선택 + 목소리 탭 표시에 사용.
    // 알람에 마지막으로 쓴 목소리 — 편집기가 처음 고르는 값(목소리 탭엔 표시하지 않는다).
    var lastUsedVoiceId by mutableStateOf<String?>(null)
        internal set

    // 기본 목소리 무료 버킷 프리페치 진행(다운로드 완료 수 to 전체). null = 진행 중 아님.
    // 목소리 탭의 기본 목소리 행 아래에 "알람 음성 준비 중 n/전체"로 표시된다.
    var voicePrefetchProgress by mutableStateOf<Pair<Int, Int>?>(null)
        internal set

    // 진행 중인 프리페치 잡 — 목소리를 연달아 바꾸면 이전 잡을 취소하고 마지막 선택만 받는다.
    internal var voicePrefetchJob: kotlinx.coroutines.Job? = null

    // promote 직후 사전렌더 드라이브(즉시 생성→기기 다운로드) 진행 상태. 화면(다이얼로그)이
    // 아니라 viewModelScope 에서 돌아, '목소리 생성 중' 화면을 닫아도 같은 속도로 계속된다.
    // 앱 프로세스가 죽으면 서버 cron 드레인이 이어받는다. null = 진행 중 아님.
    var prerenderDrive by mutableStateOf<PrerenderDriveState?>(null)
        internal set

    internal var prerenderDriveJob: kotlinx.coroutines.Job? = null

    // 목소리 공유 토글의 프로필별 워커 — PATCH 를 목소리별로 직렬화해 항상 마지막 값으로
    // 수렴시킨다(전역 voiceProfileBusy 로 스위치를 잠그지 않는다). desired 는 워커가 다음에
    // 보내야 할 목표값(연타 시 중간값은 건너뛰고 최신값만 전송).
    internal val shareToggleJobs = mutableMapOf<String, kotlinx.coroutines.Job>()
    internal val shareToggleDesired = mutableMapOf<String, Boolean>()

    // setDefaultVoice 시점에 매니페스트(stockClips)가 아직 안 왔으면 프리페치가 빈손으로 끝난다.
    // 대상 목소리를 여기 담아 두고 loadStockClips 성공 시 1회 재시도한다(재시도 후 클리어).
    internal var pendingPrefetchVoiceId: String? = null

    private val consentPrefs = application.getSharedPreferences("voice_alarm_consent", android.content.Context.MODE_PRIVATE)

    // 필수 개인정보/약관 동의가 아직 안 된 경우 true → 로그인 후 동의 화면을 띄운다.
    var needsConsent by mutableStateOf(false)
        internal set

    // 동의 확인이 끝났는지(서버 응답 또는 로컬 캐시로 확정). false 동안엔 온보딩·홈을 막아
    // 동의 화면이 다른 화면보다 항상 먼저 뜨도록 한다.
    var consentChecked by mutableStateOf(false)
        internal set

    // 이번 동의 화면에서 받아야 하는 유형(서버 계산). 화면은 이것만 그리고 이것만 제출한다.
    // 비어 있으면 화면이 열리기 전이거나 받을 게 없는 상태다.
    var consentCollect by mutableStateOf<List<String>>(emptyList())
        internal set

    // 아직 없는 민감 동의(voice_biometric·overseas_transfer). 목소리 등록을 누른 시점에
    // 이게 비어 있지 않으면 전용 동의 시트를 먼저 띄운다.
    var sensitiveConsentMissing by mutableStateOf<List<String>>(emptyList())
        internal set

    // 개정에 따른 재동의인지(=이 계정에 이미 동의 기록이 있는지). 동의 화면 문구가 갈린다.
    var consentIsReconsent by mutableStateOf(false)
        internal set

    /**
     * 동의 화면을 띄워야 하는가.
     *
     * `needsConsent`(필수 미충족)만 보면, 개정이 **선택 동의(마케팅)의 최소 버전만** 올린 경우
     * collect 에는 marketing 이 들어가는데 화면은 뜨지 않아 약속한 재수집이 영영 일어나지
     * 않는다(Codex #660). 받을 게 하나라도 있으면 띄우되, 선택 항목은 체크 없이 통과할 수 있다.
     *
     * 오버레이(권한·프로모)도 이 값을 봐야 한다 — needsConsent 만 보면 마케팅만 묻는 화면 위에
     * 권한 모달이 겹친다.
     */
    val showConsentScreen: Boolean
        get() = needsConsent || consentNeedsCollection || consentCollect.isNotEmpty()

    // 서버가 계산해 준 '받을 게 있는가'. 필드가 없는 구버전 서버에서는 위의 collect 항이 받는다.
    var consentNeedsCollection by mutableStateOf(false)
        internal set

    /**
     * 지금 받아야 하는 민감 동의 요청.
     *
     * 두 갈래로 열린다:
     *  - **목소리 등록**: [types] 는 음성 생체정보+국외 이전, [resumeVoiceDrafts] 에 등록 요청을
     *    붙들어 둔다. 동의를 마치면 그대로 이어서 만든다(사용자는 한 번만 누르면 된다).
     *  - **국외 이전만**: 시스템(기본) 목소리로 TTS 를 만들 때 서버가 요구하는 건 국외 이전
     *    하나뿐이다(tts.ts 의 isSystemVoice 분기). 무료 사용자는 목소리를 등록할 수 없어
     *    등록 경로로는 이 동의를 받을 방법이 아예 없다 — 이 갈래가 없으면 무료 사용자의
     *    기본 알람 생성이 영구 403 이 된다(Codex #660).
     */
    internal data class SensitiveConsentRequest(
        val types: List<String>,
        val resumeVoiceDrafts: List<VoiceProfileCreationDraft>? = null,
    )

    internal var pendingSensitiveConsent by mutableStateOf<SensitiveConsentRequest?>(null)

    val showVoiceConsentSheet: Boolean get() = pendingSensitiveConsent != null

    // 첫 진입 웰컴 코드 안내가 떠 있는지. 계정당 1회, 무료 플랜에게만.
    var showWelcomePromo by mutableStateOf(false)
        internal set

    internal val promoPromptStore = PromoPromptStore(application)

    /**
     * 웰컴 코드 안내를 띄울지 판정한다. 조건이 하나라도 어긋나면 조용히 넘어간다.
     *  - 무료 플랜일 것(이미 유료면 보여줄 이유가 없다)
     *  - 이 계정에 아직 안 띄웠을 것
     * 노출과 동시에 '봤음'을 기록한다 — 닫든 등록하든 다시 뜨지 않는다.
     */
    internal fun maybeShowWelcomePromo() {
        val userId = authSession?.user?.id?.takeIf { it.isNotBlank() } ?: return
        if (showWelcomePromo) return
        if (authSession?.user?.plan?.lowercase() != "free") return
        if (promoPromptStore.hasPrompted(userId)) return
        promoPromptStore.markPrompted(userId)
        showWelcomePromo = true
    }

    internal fun dismissWelcomePromo() {
        showWelcomePromo = false
    }

    // 설정의 '광고성 정보 수신' 토글 상태. null = 아직 서버에서 못 읽음(로딩 전).
    var marketingConsentAgreed by mutableStateOf<Boolean?>(null)
        internal set

    // loadMarketingConsent 요청 세대(generation). 토글(updateMarketingConsent)이나 계정 전환
    // (clearUserScopedRemoteState)이 일어나면 증가시켜, 그 전에 시작된 GET 응답이 뒤늦게 도착해
    // 최신 상태를 덮어쓰지 못하게 한다(레이스 가드).
    internal var marketingConsentLoadGeneration: Int = 0

    // 마케팅 동의 POST 진행 중 여부. true 동안엔 토글을 비활성화해 동시/연속 쓰기를 막는다.
    // (늦게 도착한 옛 POST 가 최신 의도 뒤에 INSERT 되어 opt-out 이 유실되는 것 방지)
    var marketingConsentWriteInFlight by mutableStateOf(false)
        internal set

    // 직전 마케팅 동의 로드(GET)가 실패했는지. marketingConsentAgreed 가 null 인 동안 '로딩 중'과
    // '로드 실패(다시 시도)'를 구분해, 미로드 상태를 'off'로 오인하지 않게 한다.
    var marketingConsentLoadFailed by mutableStateOf(false)
        internal set

    // 탈퇴 유예(pending_deletion) 상태로 로그인하면 true → 복구/로그아웃만 가능한 화면을 띄운다.
    var pendingDeletion by mutableStateOf(false)
        internal set

    // 설치 버전이 백엔드 최소지원버전 미만이면 true → 로그인 전부터 업데이트 차단 화면을 띄운다.
    // (In-App Update IMMEDIATE 트리거 조건이자, 그 취소/미가용 시의 최종 폴백 게이트)
    var updateRequired by mutableStateOf(false)
        internal set
    // 설치 버전이 백엔드 최신버전 미만이면 true → 권장(FLEXIBLE) In-App Update 대상.
    // 강제(updateRequired)와 달리 앱 사용은 막지 않는다.
    var updateRecommended by mutableStateOf(false)
        internal set
    var updateStoreUrl by mutableStateOf("")
        internal set
    // FLEXIBLE In-App Update 다운로드가 끝나면 InAppUpdateManager 가 true 로 세팅 →
    // AlarmTalkApp 이 '재시작' 스낵바를 띄우고, 액션 시 completeUpdate() 를 호출한다.
    var flexibleUpdateDownloaded by mutableStateOf(false)
        internal set
    // 권장(FLEXIBLE) 업데이트를 사용자가 취소하면 true → 이 세션(프로세스)에서는 onResume
    // 재조회가 FLEXIBLE 플로우를 다시 띄우지 않는다(취소 무시하고 매번 되묻는 루프 방지).
    // 강제(IMMEDIATE)는 영향 없음. ViewModel 에 두는 이유: 화면 회전 등 액티비티 재생성에도 유지.
    var flexibleUpdateDeclined by mutableStateOf(false)
        internal set
    // 마지막으로 시작한 In-App Update 플로우가 FLEXIBLE 인지. 런처 결과 콜백은 플로우 타입을
    // 알려주지 않으므로 취소가 FLEXIBLE 거절인지 판별하는 근거 — Play 다이얼로그 표시 중
    // 액티비티가 재생성(다크모드 전환 등)돼도 유지되도록 매니저 필드가 아닌 여기에 둔다.
    var flexibleUpdateFlowLaunched by mutableStateOf(false)
        internal set

    var permissionGateRequest by mutableStateOf<PermissionTarget?>(null)
        internal set

    // 같은 시각 알람 충돌 시 교체 확인 모달 상태(null 이면 닫힘).
    var duplicateAlarmPrompt by mutableStateOf<DuplicateAlarmPrompt?>(null)
        internal set

    var navigateHomeTick by mutableStateOf(0)
        internal set

    var navigateSharedPassTick by mutableStateOf(0)
        internal set

    fun requestPermissionGate(target: PermissionTarget) {
        permissionGateRequest = target
    }

    fun dismissPermissionGate() {
        permissionGateRequest = null
    }

    fun dismissDuplicateAlarmPrompt() {
        duplicateAlarmPrompt = null
    }

    /**
     * 기본 목소리 준비 화면을 띄울지 판정한다.
     *
     * 예전에는 '온보딩에서 목소리를 골랐는가'(계정 플래그)로 봤다. 이제 목소리를 고르지 않고
     * 4개를 모두 받으므로, **기기에 클립 파일이 있는가**로 본다. 캐시는 계정이 아니라 기기에
     * 종속되므로 로그아웃 후 재로그인은 다시 받지 않고, 다른 기기로 로그인하면 그 기기가
     * 새로 받는다. 일부만 받다 끊긴 경우엔 화면을 다시 띄우지 않고 워커가 조용히 마저 채운다.
     *
     * 단, '나중에 받기'를 누른 기록이 있으면 파일이 0개라도 다시 막지 않는다. 오프라인에서
     * 건너뛴 사용자는 클립이 하나도 없는 상태로 남는데, 파일 개수만 보면 켤 때마다 같은
     * 차단 화면이 돌아와 사용자의 선택이 무시된다. 다운로드는 어차피 워커가 계속하고,
     * 그래도 비어 있으면 알람 편집기가 쓰려는 순간 받아 온다.
     *
     * hasChosen(기본 목소리 저장)은 보지 않는다 — 이 브랜치에서 그 값의 뜻이 '마지막에 쓴
     * 목소리'로 바뀌어 다운로드 완료 여부와 무관해졌다.
     */
    fun checkVoiceSetupFor(userId: String) {
        if (userId.isBlank()) return
        lastUsedVoiceId = defaultVoiceStore.read(userId)
        val cachedStockClips = com.alarmtalk.app.data.AlarmAudioStore(getApplication())
            .cachedStockClipCount()
        showVoiceSetup = cachedStockClips == 0 && !defaultVoiceStore.hasSkipped(userId)
        // 화면을 띄우든 말든 부족분은 항상 채운다(언어 변경·중단 복구 포함).
        com.alarmtalk.app.sync.StockClipPrefetchWorker.enqueue(getApplication())
    }

    /**
     * 사용자가 '나중에 받기'를 눌렀을 때만. 이 선택을 기기에 남겨 다음 실행에 다시 막지 않는다.
     * 다운로드는 워커가 계속하고, 그래도 비어 있으면 편집기가 쓰려는 순간 받아 온다.
     */
    fun skipVoiceSetup() {
        defaultVoiceStore.markSkipped(authSession?.user?.id?.takeIf { it.isNotBlank() })
        showVoiceSetup = false
    }

    /**
     * 다운로드가 끝나 화면을 닫을 때. '나중에 받기'로 기록하지 않는다 —
     * 워커는 받을 게 없거나(매니페스트 비어 있음) 세션이 없으면 한 개도 받지 않고도
     * 성공을 낸다. 그걸 사용자의 선택으로 기록하면, 클립이 0개인데 준비 화면이 영영
     * 다시 뜨지 않게 된다. 그래서 '실제로 파일이 생겼는가'로만 닫는다.
     */
    fun completeVoiceSetupIfDownloaded() {
        val cached = com.alarmtalk.app.data.AlarmAudioStore(getApplication()).cachedStockClipCount()
        if (cached > 0) showVoiceSetup = false
    }

    /**
     * 알람에 마지막으로 쓴 목소리를 기억한다 — 알람 편집기가 처음 고르는 목소리가 된다.
     *
     * 예전에는 목소리 탭에서 '기본 목소리'를 직접 고르게 했다. 고를 게 하나 더 있는 것보다
     * 마지막에 쓴 것이 그대로 다음 기본이 되는 편이 손이 덜 간다(대부분 같은 목소리를 계속 쓴다).
     * 무료 버킷 클립도 함께 챙겨 둔다 — 그 목소리로 다음 알람을 만들 때 바로 쓰인다.
     */
    fun rememberVoiceUsed(voiceId: String?) {
        val resolved = voiceId?.takeIf { it.isNotBlank() } ?: return
        if (resolved == lastUsedVoiceId) return
        val userId = authSession?.user?.id?.takeIf { it.isNotBlank() }
        defaultVoiceStore.set(userId, resolved)
        lastUsedVoiceId = resolved
        // 매니페스트가 아직 없으면 이번 프리페치는 빈손으로 끝난다 — 대상을 기억해 두고
        // loadStockClips 성공 시 재시도한다.
        if (stockClips.isEmpty()) pendingPrefetchVoiceId = resolved
        prefetchFreeBucketClips(resolved)
    }

    // 이 기기에서 "현재 정책 버전" 기준으로 필수 동의를 마친 사용자 캐시.
    // 재로그인/콜드스타트 시 서버 응답을 기다리는 로딩 없이 바로 통과시키되, 백그라운드
    // 서버 재확인은 그대로 진행한다. 정책 버전이 올라가면(개정) 옛 버전 동의 캐시는 폐기해,
    // 이미 동의했던 사용자라도 재동의가 필요할 땐 캐시로 게이트를 건너뛰지 않게 한다.
    internal fun isConsentCachedDone(userId: String): Boolean {
        if (userId.isBlank()) return false
        // 현재 정책 버전을 한 번도 확인한 적 없으면(=서버 확인 전) 캐시로 통과시키지 않는다.
        if (cachedPolicyVersion() == null) return false
        val done = consentPrefs.getStringSet("consented_users", emptySet()) ?: emptySet()
        return userId in done
    }

    // 직전에 서버에서 확인한 현재 정책 버전. 아직 확인 전이면 null.
    internal fun cachedPolicyVersion(): String? =
        consentPrefs.getString("current_policy_version", null)

    // done=true 면 userId 를 "policyVersion 동의 완료" 캐시에 넣고, false 면 뺀다.
    // policyVersion 이 캐시된 현재 버전과 다르면(정책 개정) 동의 캐시를 비우고 새 버전으로 시작한다.
    internal fun rememberConsentDone(userId: String, done: Boolean, policyVersion: String) {
        if (userId.isBlank()) return
        val editor = consentPrefs.edit()
        val set = if (cachedPolicyVersion() != policyVersion) {
            editor.putString("current_policy_version", policyVersion)
            mutableSetOf()
        } else {
            consentPrefs.getStringSet("consented_users", emptySet())?.toMutableSet() ?: mutableSetOf()
        }
        if (done) set += userId else set -= userId
        editor.putStringSet("consented_users", set).apply()
    }

    fun loadReceivedAlarmBadgeState() {
        val userId = authSession?.user?.id ?: run {
            receivedAlarmSeenAtMillis = 0L
            return
        }
        receivedAlarmSeenAtMillis = receivedAlarmBadgeStore.readSeenAtMillis(userId)
    }

    internal fun restoreAccessSnapshotForCurrentUser() {
        val snapshot = authSession
            ?.user
            ?.id
            ?.takeIf { it.isNotBlank() }
            ?.let(accessSnapshotStore::read)
            ?: AccessSnapshot()
        subscriptionResponse = snapshot.subscriptionResponse
        familyGroup = snapshot.familyGroup
    }

    internal fun saveSubscriptionSnapshot(response: BillingSubscriptionResponse?) {
        val userId = authSession?.user?.id?.takeIf { it.isNotBlank() } ?: return
        accessSnapshotStore.updateSubscription(userId, response)
    }

    internal fun saveFamilyGroupSnapshot(response: FamilyGroupCurrentResponse?) {
        val userId = authSession?.user?.id?.takeIf { it.isNotBlank() } ?: return
        accessSnapshotStore.updateFamilyGroup(userId, response)
    }

    internal fun clearCurrentAccessSnapshot() {
        val userId = authSession?.user?.id?.takeIf { it.isNotBlank() } ?: return
        accessSnapshotStore.clear(userId)
    }

    internal fun clearCurrentDefaultVoicePreferences() {
        val userId = authSession?.user?.id?.takeIf { it.isNotBlank() } ?: return
        defaultVoiceStore.clear(userId)
    }

    internal fun clearUserScopedRemoteState() {
        // 진행 중이던 목소리 프리페치 잡을 끊고 진행 표시를 지운다 — 다음 계정에 이전 계정의
        // 늦은 다운로드 응답/진행률이 섞이지 않게 한다. (클론 사전렌더 준비 폴링은 목소리 탭
        // 컴포저블 로컬 상태라 아래 voiceProfiles 초기화로 폴링 대상이 비면서 함께 멈춘다.)
        voicePrefetchJob?.cancel()
        voicePrefetchJob = null
        voicePrefetchProgress = null
        pendingPrefetchVoiceId = null
        prerenderDriveJob?.cancel()
        prerenderDriveJob = null
        shareToggleJobs.values.forEach { it.cancel() }
        shareToggleJobs.clear()
        shareToggleDesired.clear()
        prerenderDrive = null
        voiceProfiles = emptyList()
        pendingVoiceDraft = null
        voiceProfileLoadFinished = false
        voiceProfilesLoadedFresh = false
        showVoiceSetup = false
        lastUsedVoiceId = null
        ttsMessages = emptyList()
        familyGroup = null
        familyVoices = emptyList()
        // 공유 목소리 신선-로드 플래그도 함께 초기화 — 안 그러면 다음 세션에서 fetchVoiceProfiles 가
        // refreshSocial 전에 강등 판단해, 공유 목소리 쓰는 알람이 오강등될 수 있다(PR #536 P2).
        familyVoicesLoadedFresh = false
        subscriptionResponse = null
        vouchers = emptyList()
        billingPlayManageUrl = null
        receivedAlarmSeenAtMillis = 0L
        registerEmailVerificationSentTo = null
        registerEmailVerified = null
        // 세션이 비워지는 모든 경로(로그아웃/만료/탈퇴)에서 동의 게이트 상태도 함께 초기화한다.
        // 특히 consentChecked 가 옛 세션의 true 로 남으면, 다음 로그인에서 동의 확인 전에
        // 온보딩·홈·하단바가 먼저 뜰 수 있어 반드시 false 로 되돌린다.
        needsConsent = false
        consentChecked = false
        consentCollect = emptyList()
        consentNeedsCollection = false
        consentIsReconsent = false
        // 민감 동의 상태와 대기 중인 목소리 등록 요청은 **반드시** 함께 비운다.
        // pendingVoiceConsentDrafts 에는 직전 사용자가 녹음한 오디오가 들어 있다 — 남겨 두면
        // 401 로 세션이 끊긴 뒤에도 동의 시트가 로그아웃 화면 위에 계속 떠 있고, 다른 계정이
        // 로그인해 '동의' 를 누르는 순간 앞 사용자의 녹음이 그 계정으로 업로드된다(Codex #660).
        sensitiveConsentMissing = emptyList()
        pendingSensitiveConsent = null
        // 웰컴 코드 안내도 계정별 상태다. 계정이 바뀌면 새 계정 기준으로 다시 판정한다.
        showWelcomePromo = false
        pendingDeletion = false
        // 마케팅 수신 토글도 user-scoped — 옛 사용자의 동의값이 다음 사용자 화면에 잔존하지 않게
        // 비우고, 진행 중이던 로드는 generation 증가로 무효화한다.
        marketingConsentAgreed = null
        marketingConsentLoadGeneration++
        marketingConsentWriteInFlight = false
        marketingConsentLoadFailed = false
    }

    fun ensureReceivedAlarmBadgeBaseline(alarms: List<AlarmEntity>) {
        val userId = authSession?.user?.id ?: return
        if (receivedAlarmBadgeStore.hasBaseline(userId)) {
            receivedAlarmSeenAtMillis = receivedAlarmBadgeStore.readSeenAtMillis(userId)
            return
        }
        receivedAlarmSeenAtMillis = receivedAlarmBadgeStore.markSeen(userId, alarms)
    }

    fun markReceivedAlarmsSeen(alarms: List<AlarmEntity>) {
        val userId = authSession?.user?.id ?: return
        receivedAlarmSeenAtMillis = receivedAlarmBadgeStore.markSeen(userId, alarms)
    }

    fun setThemeMode(mode: ThemeMode) {
        themeMode = mode
        themePrefs.edit().putString("mode", mode.name).apply()
    }

    fun requestEditNickname() {
        if (authSession == null) {
            message = getApplication<android.app.Application>().getString(R.string.r3misc_login_required_generic)
            return
        }
        nicknameEditDialogOpen = true
    }

    fun dismissEditNickname() {
        nicknameEditDialogOpen = false
    }

    fun requestDeleteAccount() {
        if (authSession == null) {
            message = getApplication<android.app.Application>().getString(R.string.r3misc_login_required_generic)
            return
        }
        deleteAccountConfirmOpen = true
    }

    fun dismissDeleteAccount() {
        deleteAccountConfirmOpen = false
    }

    init {
        RemoteAlarmSyncScheduler.ensurePeriodic(application)
        if (authSession != null) {
            RemoteAlarmSyncScheduler.runOnce(application)
        }
        viewModelScope.launch {
            runCatching {
                repository.reschedulePendingAlarms()
            }.onSuccess { scheduled ->
                Log.i(TAG, "Startup alarm sync complete scheduled=$scheduled")
            }.onFailure { error ->
                AlarmTalkLog.reportError("Startup alarm sync failed", error)
            }
        }
        // 결제 직후 앱 종료 등으로 서버 검증이 누락된 Play 구매를 앱 시작 시 재전송.
        if (authSession != null) {
            viewModelScope.launch {
                runCatching { playBilling.resendUnconfirmedPurchases() }
                    .onFailure { error -> Log.w(TAG, "Failed to resend unconfirmed Play purchases", error) }
            }
        }
        // BillingClient 연결 + 상품 정보 선로드 — 이용권 패널의 구매 시트가 즉시 뜨게 한다.
        viewModelScope.launch {
            runCatching { playBilling.preloadProducts() }
                .onSuccess {
                    billingPlanPrices = listOf("personal", "couple", "family")
                        .mapNotNull { key -> playBilling.formattedPriceForPlan(key)?.let { key to it } }
                        .toMap()
                }
                .onFailure { error -> Log.w(TAG, "Failed to preload Play products", error) }
        }
        refreshAppSession()
    }

    override fun onCleared() {
        playBilling.release()
        super.onCleared()
    }
}

private fun loadInitialThemeMode(prefs: android.content.SharedPreferences): ThemeMode {
    val raw = prefs.getString("mode", ThemeMode.System.name) ?: return ThemeMode.System
    return runCatching { ThemeMode.valueOf(raw) }.getOrDefault(ThemeMode.System)
}

/** promote 직후 사전렌더 드라이브 진행 상태 — 생성(downloading=false) → 기기 다운로드(true). */
data class PrerenderDriveState(
    val voiceId: String,
    val generated: Int,
    val total: Int,
    val downloading: Boolean,
)
