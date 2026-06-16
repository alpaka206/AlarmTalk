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
import com.alarmtalk.app.billing.PlayBillingManager
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.data.AlarmAppContainer
import com.alarmtalk.app.data.AlarmDraft
import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.CachedAlarmAudio
import com.alarmtalk.app.data.CharacterEventEntity
import com.alarmtalk.app.network.AuthTokenResponse
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.CharacterResponse
import com.alarmtalk.app.network.CheckoutRequest
import com.alarmtalk.app.network.CodeRegisterRequest
import com.alarmtalk.app.network.FamilyGroupCurrentResponse
import com.alarmtalk.app.network.FamilyVoiceProfile
import com.alarmtalk.app.network.LoginRequest
import com.alarmtalk.app.network.ReceivedNote
import com.alarmtalk.app.network.RegisterRequest
import com.alarmtalk.app.network.SendNoteRequest
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
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue

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
                // 세션을 비우고 화면에 재로그인을 안내한다.
                handleUnauthorized()
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
                    message = "결제가 보류 중이에요. 결제 수단 승인이 끝나면 자동으로 적용돼요."
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
            runCatching { authSessionStore.clear() }
            clearUserScopedRemoteState()
            authSession = null
            message = "로그인이 만료되었어요. 다시 로그인해 주세요."
        }
    }

    val alarms: StateFlow<List<AlarmEntity>> = repository.observeAlarms()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val characterEvents: StateFlow<List<CharacterEventEntity>> = repository.observeCharacterEvents()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    var authSession by mutableStateOf<AuthSession?>(initialAuthSession)
        internal set

    var authBusy by mutableStateOf(false)
        internal set

    var registerEmailVerificationSentTo by mutableStateOf<String?>(null)
        internal set

    var registerEmailVerified by mutableStateOf<String?>(null)
        internal set

    var syncBusy by mutableStateOf(false)
        internal set

    var voiceProfiles by mutableStateOf<List<VoiceProfile>>(emptyList())
        internal set

    var voiceProfileBusy by mutableStateOf(false)
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
        internal set

    var characterBusy by mutableStateOf(false)
        internal set

    var characterResponse by mutableStateOf<CharacterResponse?>(null)
        internal set

    var billingBusy by mutableStateOf(false)
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

    var noteBusy by mutableStateOf(false)
        internal set

    var receivedNotes by mutableStateOf<List<ReceivedNote>>(emptyList())
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

    private val onboardingPrefs = application.getSharedPreferences("voice_alarm_onboarding", android.content.Context.MODE_PRIVATE)
    var showOnboarding by mutableStateOf(false)
        internal set

    private val consentPrefs = application.getSharedPreferences("voice_alarm_consent", android.content.Context.MODE_PRIVATE)

    // 필수 개인정보/약관 동의가 아직 안 된 경우 true → 로그인 후 동의 화면을 띄운다.
    var needsConsent by mutableStateOf(false)
        internal set

    // 동의 확인이 끝났는지(서버 응답 또는 로컬 캐시로 확정). false 동안엔 온보딩·홈을 막아
    // 동의 화면이 다른 화면보다 항상 먼저 뜨도록 한다.
    var consentChecked by mutableStateOf(false)
        internal set

    // 탈퇴 유예(pending_deletion) 상태로 로그인하면 true → 복구/로그아웃만 가능한 화면을 띄운다.
    var pendingDeletion by mutableStateOf(false)
        internal set

    // 설치 버전이 백엔드 최소지원버전 미만이면 true → 로그인 전부터 업데이트 차단 화면을 띄운다.
    var updateRequired by mutableStateOf(false)
        internal set
    var updateStoreUrl by mutableStateOf("")
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

    fun checkOnboardingFor(userId: String) {
        if (userId.isBlank()) return
        val seen = onboardingPrefs.getStringSet("seen_users", emptySet()) ?: emptySet()
        showOnboarding = userId !in seen
    }

    fun completeOnboarding() {
        val userId = authSession?.user?.id?.takeIf { it.isNotBlank() }
        if (userId != null) {
            val seen = onboardingPrefs.getStringSet("seen_users", emptySet())?.toMutableSet() ?: mutableSetOf()
            seen += userId
            onboardingPrefs.edit().putStringSet("seen_users", seen).apply()
        }
        showOnboarding = false
    }

    // 이 기기에서 필수 동의를 마친 사용자 캐시. 재로그인/콜드스타트 시 서버 응답을 기다리는
    // 로딩 없이 바로 통과시키되, 백그라운드 서버 재확인은 그대로 진행한다.
    internal fun isConsentCachedDone(userId: String): Boolean {
        if (userId.isBlank()) return false
        val done = consentPrefs.getStringSet("consented_users", emptySet()) ?: emptySet()
        return userId in done
    }

    internal fun rememberConsentDone(userId: String, done: Boolean) {
        if (userId.isBlank()) return
        val set = consentPrefs.getStringSet("consented_users", emptySet())?.toMutableSet() ?: mutableSetOf()
        if (done) set += userId else set -= userId
        consentPrefs.edit().putStringSet("consented_users", set).apply()
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

    internal fun clearUserScopedRemoteState() {
        voiceProfiles = emptyList()
        ttsMessages = emptyList()
        familyGroup = null
        familyVoices = emptyList()
        characterResponse = null
        subscriptionResponse = null
        vouchers = emptyList()
        receivedNotes = emptyList()
        receivedAlarmSeenAtMillis = 0L
        registerEmailVerificationSentTo = null
        registerEmailVerified = null
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
            message = "로그인 후 사용할 수 있어요"
            return
        }
        nicknameEditDialogOpen = true
    }

    fun dismissEditNickname() {
        nicknameEditDialogOpen = false
    }

    fun requestDeleteAccount() {
        if (authSession == null) {
            message = "로그인 후 사용할 수 있어요"
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
                Log.e(TAG, "Startup alarm sync failed", error)
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
