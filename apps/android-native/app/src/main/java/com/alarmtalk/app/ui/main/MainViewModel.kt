package com.alarmtalk.app

import android.app.Application
import android.util.Log
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
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
import com.alarmtalk.app.data.bundledSystemVoiceProfiles
import com.alarmtalk.app.network.AuthTokenResponse
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.network.observeSession
import com.alarmtalk.app.network.shouldAbsorbStoredSession
import com.alarmtalk.app.network.BillingSubscriptionResponse
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

/**
 * 서버의 일반 동의 게이트가 요구하는 필수 동의(백엔드 `GENERAL_REQUIRED_CONSENTS`).
 * 상태 조회 결과가 아직 없을 때의 폴백 목록이기도 하다.
 */
internal val GENERAL_REQUIRED_CONSENT_TYPES = listOf("terms", "privacy", "age14")

/**
 * 가입 게이트가 실제로 요구하는 필수 동의 — 서버 `REQUIRED_CONSENT_TYPES` 와 같은 목록이다.
 *
 * 일반 데이터 라우트의 하드 게이트는 3종만 보지만(`GENERAL_REQUIRED_CONSENT_TYPES`),
 * `needs_consent` 판정에는 `overseas_transfer` 가 들어간다. 서버 목록을 못 받았을 때 3종으로만
 * 채우면 그 화면을 통과해도 국외 이전이 안 기록돼, 게이트만 닫히고 사용자는 나중에 TTS 를
 * 쓰려다 다른 시트를 또 만난다(Codex #660). 이 화면은 overseas 체크박스를 그릴 수 있다.
 */
internal val SIGNUP_REQUIRED_CONSENT_TYPES = GENERAL_REQUIRED_CONSENT_TYPES + "overseas_transfer"

/**
 * **이 앱 버전이 화면에 그릴 수 있는** 동의 유형 전부.
 *
 * 서버가 새 유형을 먼저 추가하고 구버전 앱이 아직 살아 있는 구간이 존재한다. 그때 화면이
 * 그리지 못한 유형을 '체크됨'으로 취급하면, 사용자가 본 적 없는 동의가 기록된다 — 동의
 * 기록의 신뢰성이 통째로 무너지는 종류의 버그다. 그래서 모르는 유형은
 *  - 필수면 **통과를 막고** 앱 업데이트를 안내하고(ConsentScreen),
 *  - 어느 쪽이든 **제출 목록에서 뺀다**(submitConsents).
 */
internal val KNOWN_CONSENT_TYPES =
    listOf("terms", "privacy", "age14", "marketing", "voice_biometric", "overseas_transfer")

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
            override fun onUnauthorized(failedToken: String?) {
                // 같은 토큰으로 재시도해도 의미가 없다(그 토큰이 거부된 것이다).
                // 401(TOKEN_REVOKED 포함) 이면 세션을 비우고 화면에 재로그인을 안내한다.
                handleUnauthorized(failedToken)
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
    /**
     * 명시적 로그아웃·탈퇴가 진행 중인가.
     *
     * 로그아웃은 서버 `token_epoch` 를 올리므로 **그 순간 진행 중이던 다른 요청이 401 로
     * 돌아오는 게 정상 경로다.** 그 401 을 '자동 만료' 로 처리하면 방금 지운 복원 표시를 다시
     * 켜서, 떼어낸 알람이 다음 주기(15분)에 전부 되살아난다 — 로그인 화면 뒤라 끌 수 없다.
     */
    @Volatile
    internal var signingOut = false

    /**
     * 저장소에만 반영된 세션 갱신을 메모리로 끌어온다.
     *
     * 백그라운드 워커는 `GET /auth/me` 로 받은 새 토큰을 **저장소에만** 쓴다. 이 ViewModel 은
     * 생성 시점 말고는 저장소를 읽지 않아 옛 토큰을 계속 들고 있고, 그 토큰이 만료되면
     * 이후 요청이 전부 401 로 실패한다. 그런데 401 처리기는 '저장소에 더 새 토큰이 있다' 는
     * 이유로 그 401 을 **무시**하고, okhttp 인증기도 재발급 수단이 없어 재시도하지 않는다 —
     * 멀쩡한 토큰을 두고 요청만 조용히 실패한다(Codex #665 P2).
     *
     * 401 을 맞은 **뒤에** 흡수하는 것으로는 부족하다. 그 요청은 이미 실패했고 아무도 다시
     * 보내 주지 않아, 사용자는 이유도 모른 채 같은 동작을 다시 해야 한다. 저장소가 바뀌는
     * 즉시 맞춰야 그 실패 자체가 생기지 않는다.
     *
     * `bearerOrMessage` 한 곳만 고치는 방법도 있었지만, 토큰을 쓰는 자리가 그 헬퍼를 거치지
     * 않는 곳까지 마흔 곳 가까이 된다. 세션 자체를 수렴시켜 한 곳에서 끝낸다.
     *
     * **덮어쓰지 않는 경우** — 셋 다 '저장소가 지금 메모리보다 낫다' 가 성립하지 않는다:
     *  - 저장소가 비었다(로그아웃 직후). 여기서 되살리면 세션 정리를 되돌리는 셈이다.
     *  - 로그아웃이 진행 중이다([signingOut]).
     *  - 계정이 다르다. 계정 전환은 로그인 경로가 정리와 함께 처리한다.
     */
    private fun absorbStoredSession(stored: AuthSession?) {
        if (!shouldAbsorbStoredSession(stored, authSession, signingOut)) return
        authSession = stored
        Log.i(TAG, "Absorbed a session update written by a background worker")
    }

    private fun handleUnauthorized(failedToken: String?) {
        viewModelScope.launch {
            val session = authSession ?: return@launch
            if (signingOut) {
                Log.i(TAG, "Ignoring 401 during explicit sign-out")
                return@launch
            }
            // **옛 토큰의 뒤늦은 401 은 무시한다.** GET /auth/me 가 세션을 굴린 직후
            // (rolling refresh), 그 전에 옛 토큰으로 이미 날아간 요청이 만료돼 401 로 돌아올 수
            // 있다. 어느 토큰이 거부됐는지 안 보고 지우면 **방금 갱신한 세션을 스스로 날린다**
            // — 사용자는 갱신됐는데도 로그아웃된다(Codex #665 P2).
            //
            // 토큰을 못 읽은 경우(null)는 예전처럼 처리한다 — 판단할 근거가 없으면 안전하게
            // 세션을 정리하는 쪽이 맞다(진짜 폐기를 놓치면 안 된다).
            // 메모리(authSession)만 보면 안 된다. 백그라운드 워커가 저장소에 새 토큰을 심어도
            // 이 ViewModel 은 그걸 관찰하지 않아 옛 토큰을 들고 있다. 그 옛 토큰이 만료돼 401 이
            // 오면 '지금 세션의 토큰' 으로 보여 가드를 통과하고, **저장소의 멀쩡한 새 토큰까지
            // 지운다**(Codex #665 P2). 저장소 값도 함께 본다.
            val stored = runCatching { authSessionStore.read() }.getOrNull()
            val storedToken = stored?.token
            val isCurrentToken = failedToken == null ||
                failedToken == session.token ||
                failedToken == storedToken
            val supersededByStore = failedToken != null &&
                storedToken != null &&
                failedToken != storedToken
            if (!isCurrentToken || supersededByStore) {
                // **무시만 하면 좀비 세션이 된다.** 여기서 걸렀다는 건 메모리 토큰과 저장소
                // 토큰이 갈렸다는 뜻이다. 그대로 두면 이후 모든 요청이 메모리의 옛 토큰으로
                // 나가 계속 401 을 맞는데, 그 401 은 또 여기서 무시된다 — 화면은 '로그인됨'
                // 인데 서버 호출은 전부 실패하고 안내조차 없는 상태가 된다(Codex #665 P1).
                //
                // 갈라지는 것 자체는 [absorbStoredSession] 이 저장소 변경을 관찰해 막는다.
                // 여기는 그 관찰이 아직 도착하지 않은 찰나를 위한 마지막 방어다 — 같은 계정
                // 이면 지금 읽은 저장소 세션을 그대로 흡수한다. 저장소 토큰이 살아 있으면
                // 복구되고, 그것마저 폐기됐으면 다음 401 은 `failedToken == storedToken` 이
                // 되어 정상적으로 만료 처리로 떨어진다 — 어느 쪽이든 올바른 종착점이다.
                if (stored != null &&
                    stored.user.id == session.user.id &&
                    authSession?.token == session.token
                ) {
                    authSession = stored
                    Log.i(TAG, "Absorbed the stored session after a superseded 401")
                }
                Log.i(TAG, "Ignoring 401 from a superseded token")
                return@launch
            }
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
                repository.claimUnownedAlarmsFor(session.user.id.takeIf { it.isNotBlank() })
            }.onFailure { error ->
                Log.w(TAG, "Failed to stamp ownerless alarms on session expiry", error)
            }
            // **suspend 지점을 지난 뒤 다시 확인한다.** 위 Room 쓰기 동안 세션이 바뀔 수 있다:
            //  - GET /auth/me 가 새 토큰을 심었다(rolling refresh) → 지금 살아 있는 세션을
            //    이 옛 401 로 지우면 안 된다(Codex #665 P2).
            //  - 사용자가 로그아웃을 눌렀다 → 그건 '자동 만료' 가 아니다. 여기서 만료 표시를
            //    남기면 방금 떼어낸 알람이 15분 뒤 워커에 의해 전부 되살아난다.
            //    (로그아웃은 서버 token_epoch 를 올리므로, 진행 중이던 다른 요청이 401 로
            //     돌아와 이 경로를 타는 게 예외가 아니라 정상 경로다.)
            val stillSame = authSession?.token == session.token
            if (!stillSame || signingOut) {
                Log.i(TAG, "Skipping session-expiry bookkeeping: session changed or signing out")
                return@launch
            }
            // **자동으로** 끊긴 계정을 남긴다 — 비로그인 상태에서 되살려도 되는 알람의 주인이다.
            // 세션을 비우기 전에 해야 id 를 알 수 있다. 명시적 로그아웃은 이 값을 지우므로,
            // 여러 계정이 오간 기기에서도 방금 만료된 계정의 알람만 되살아난다(Codex #665 P1).
            runCatching { authSessionStore.markSessionExpired(session.user.id) }
                .onFailure { error -> Log.w(TAG, "Failed to mark session expired owner", error) }
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
    /**
     * @param departingUserId 떠나는 계정. 호출부가 **네트워크 왕복을 시작하기 전에** 잡아
     *   넘긴다.
     *
     * ⚠ **여기서 [authSession] 을 읽는 것만으로는 부족하다**(2026-08-19 감사 P2).
     * 로그아웃은 `api.logout()` 으로 `token_epoch` 를 먼저 올리는데, 그러면 진행 중이던
     * 다른 요청이 401 로 돌아와 `handleSessionExpired` 가 세션을 비운다. 그 뒤 여기서 읽으면
     * **null** 이고, null 은 '누구인지 모름' 이라 [detachAlarmsOnSignOut] 이 **켜진 알람을
     * 전부** 끈다 — 자동 401 로 세션만 잃고 기다리던 **다른 계정의 알람까지 영구히 꺼진다.**
     * 로그아웃 버튼 연타로도 같은 상태가 된다.
     */
    internal suspend fun clearSignedInSession(departingUserId: String? = null) {
        // 로그아웃이 끝날 때까지 401 처리기를 잠근다 — 이유는 [signingOut] 주석 참고.
        signingOut = true
        val signedOutUserId = departingUserId?.takeIf { it.isNotBlank() }
            ?: authSession?.user?.id?.takeIf { it.isNotBlank() }
        // 표시를 **먼저** 지운다. 떼어내기가 중간에 실패하거나 프로세스가 죽어도 "명시적
        // 로그아웃이었다" 는 사실이 남아야, 다음 재예약이 이 계정 알람을 되살리지 않는다.
        // (앞서 자동 만료로 남아 있던 값이 있으면 그게 이 계정을 되살려 버린다.)
        runCatching { authSessionStore.clearSessionExpiredOwner() }
            .onFailure { error -> Log.w(TAG, "Failed to clear expired-session owner on sign-out", error) }
        // 세션 저장소 비우기를 **떼어내기와 같은 임계구역 안에서** 끝낸다. 락을 놓은 뒤에
        // 비우면, 그 틈에 락을 잡은 복원(주기 워커 등)이 prefs 를 아직 '로그인됨' 으로 읽어
        // 방금 취소한 예약을 전부 되살린다(Codex #666 P1).
        runCatching {
            repository.detachAlarmsOnSignOut(signedOutUserId) {
                authSessionStore.clear()
            }
        }.onFailure { error -> Log.w(TAG, "Failed to detach device alarms on session clear", error) }
        // 기본 목소리 취향(마지막 쓴 목소리·'나중에 받기' 선택)은 계정을 명시적으로 끝낼 때만
        // 지운다. 자동 401 은 같은 사람이 다시 로그인하는 경우가 대부분이라, 거기서 지우면
        // 편집기가 쓰던 목소리를 잊고 기본 목소리 다운로드 안내를 다시 밟게 한다.
        // (저장소가 계정별 키라 남겨 둬도 다음 계정에 새지 않는다.)
        clearCurrentDefaultVoicePreferences()
        // 매니페스트 디스크 사본도 여기서만 지운다. 안에 **그 계정의 클론 클립**이 들어
        // 있어 계정이 바뀌면 남의 목록을 시드하게 된다. 위와 같은 이유로 자동 401 에서는
        // 지우지 않는다 — 같은 사람이 다시 로그인하는 경우가 대부분이고, 지우면 그 사람이
        // 오프라인에서 알람을 못 만드는 상태로 되돌아간다.
        // ⚠ **지우기와 표 무효화는 한 번에**(Codex #703 P1). 둘로 나누면 그 사이에 앞 계정의
        // 저장이 끼어들어 지운 파일을 되살리고, 계정 B 가 A 의 클론 매니페스트(목소리 이름·
        // 문구 포함)를 시드로 읽는다. WorkManager 요청은 세션과 무관하게 살아 있어 취소로는
        // 못 막으므로, 표를 죽이는 것과 파일을 지우는 것이 같은 잠금 안이어야 한다.
        com.alarmtalk.app.data.StockClipManifestStore.clearAndInvalidate(getApplication())
        stockClipManifestFetched = false
        // 저장소는 위 임계구역에서 이미 비웠다. 여기서 다시 불러도 무해하고(clear 는 멱등,
        // 임자 표시도 보존된다), 화면 상태(authSession·유저 스코프 캐시)를 마저 정리해야 한다.
        clearSessionKeepingAlarms()
    }

    /**
     * 세션만 정리한다(알람 예약·기기 취향은 그대로). 자동 401 처럼 사용자의 의도가 아닌
     * 종료에 쓴다 — 여기서 지우는 것은 '이 계정으로서의 세션 상태'까지다.
     */
    private fun clearSessionKeepingAlarms() {
        // ⚠ **떠 있는 매니페스트 조회의 표는 여기서도 죽인다**(Codex #703 P1). 파일은 일부러
        // 남기지만(위 주석 — 같은 사람 재로그인 시 오프라인 사용), 세션이 끝난 뒤 도착한
        // 앞 계정의 응답이 그 파일을 **다시 공개하는 것**은 막아야 한다. WorkManager 요청은
        // 세션과 무관하게 살아 있어 취소로는 못 막는다.
        com.alarmtalk.app.data.StockClipManifestStore.invalidateOutstandingTickets()
        runCatching { authSessionStore.clear() }
        clearUserScopedRemoteState()
        authSession = null
    }

    /**
     * 데이터 라우트의 403 CONSENT_REQUIRED 처리. okhttp 인터셉터(non-main)에서 호출될 수 있어
     * UI 스레드로 옮긴 뒤 동의 플로우를 연다.
     *
     * 서버가 유형을 **지목한** 민감 동의 403(voice_biometric·overseas_transfer)은 기능 시점에
     * 온 것이라 가입 게이트를 열면 안 된다 — 그 자리에서 받아야 할 것만 전용 시트로 받는다.
     * (가입 게이트 자체는 overseas 체크박스를 그릴 수 있다. 아래 폴백이 그 경로다.)
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
            // 무엇을 받아야 하는지 모르는 채로 게이트를 열면 안 된다. 상태 조회가 늦거나
            // 실패한 상태에서 이 403(일반 게이트, consent 필드 없음)이 먼저 오면 collect 가
            // 비어 화면에 항목이 하나도 안 그려지는데, 그 화면은 '필수 다 체크됨'으로 판정돼
            // 버튼이 활성화된다 → 사용자가 보지도 않은 동의가 기록된다(Codex #660).
            // 채울 목록은 **가입 게이트가 요구하는 전부**여야 한다. 이 403 을 낸 미들웨어는
            // 일반 3종만 보지만, 3종만 받고 닫으면 국외 이전이 안 기록된 채 통과된다.
            if (consentCollect.isEmpty()) consentCollect = SIGNUP_REQUIRED_CONSENT_TYPES
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

    /**
     * 알람 생성·수정이 **실제로 진행 중**인지. 편집기가 저장/취소 버튼을 잠그고 스피너를 돌린다.
     *
     * 편집기 로컬 플래그만으로는 부족하다 — 음성 생성 없이 바로 저장하는 빠른 경로(알람 전용·
     * 녹음·오디오 재사용)는 편집기 입장에선 '순식간' 이지만, 여기서는 Room 쓰기와 날씨 변형
     * 조회(네트워크)까지 남아 있다. 그 사이 버튼이 살아 있으면 저장이 두 번 돌고, 완료 콜백이
     * 백스택을 두 번 팝해 검은 화면이 된다([popBackStackOrHome] 주석 참고).
     *
     * **성공·실패 모두에서 내려야 한다.** 실패로 편집기가 남았는데 켜진 채면 다시 저장할 길이
     * 없다.
     */
    var alarmSaving by mutableStateOf(false)
        internal set

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

    /**
     * 지금 회차가 도는 동안 sync 요청이 또 들어왔는가. 겹쳐 돌리면 서버에 같은 알람이 두 개
     * 생기지만(`syncNow` 주석), 그렇다고 버리면 앞 회차가 목록을 스냅샷한 뒤 저장된 알람이
     * 다음 트리거까지 안 올라간다. 그래서 표시만 남기고 회차가 끝난 뒤 한 번 더 돈다.
     */
    internal var syncRequestedWhileBusy = false

    var syncBusy by mutableStateOf(false)
        internal set

    /**
     * 교체 정리(강등·재예약)가 끝나지 않아 **아직 고를 수 없는** 목소리들.
     *
     * ⚠ **목록에서 빼는 것이 아니다**(2026-08-25 지시). 감추면 사용자에게는 목소리가
     * 사라진 것으로 보여 고장으로 읽힌다 — 자리에 두고 흐리게 그린 뒤 이유를 말한다.
     * 고를 수 있게 두면 그 사이 만든 새 알람을 다음 회차가 함께 벗긴다(강등 대상은
     * 프로필 id 로만 고른다). iOS `VoiceStudioViewModel.replacementSuppressedProfileIDs`.
     */
    var settlingVoiceProfileIds by mutableStateOf<Set<String>>(emptySet())
        internal set

    /**
     * 디스크에 **못 남긴** '정리 중' 표시들. 디스크를 다시 읽어 올 때 합집합으로 얹는다.
     *
     * ⚠ 없으면 디스크 재조회가 **맞는 메모리 값을 덮는다**(Codex #703 P1) — 쓰기에 실패한
     * 표시는 디스크에 없으므로, 목록을 새로 받는 순간 그 목소리가 다시 고를 수 있게 된다.
     */
    internal var settlingUnpersistedIds: Set<String> = emptySet()

    var voiceProfiles by mutableStateOf(bundledSystemVoiceProfiles())
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

    var stockClips by mutableStateOf<List<com.alarmtalk.app.network.StockClip>>(emptyList())

    /**
     * 카테고리별 **완전한 세트의 클립 수**(서버가 내려준다).
     *
     * ⚠ **앱에 개수를 박지 않는다.** 운영이 시드를 늘리면 앱 업데이트 없이 따라와야 한다.
     * 기본 목소리와 등록 목소리는 개수가 다르므로 목소리 종류로 갈라 본다.
     */
    var expectedVariants by mutableStateOf<com.alarmtalk.app.network.ExpectedVariantCounts?>(null)

    /** 목소리별 준비도(생성+다운로드). 준비 페이지와 편집기 관문이 함께 본다. */
    var clipReadiness by mutableStateOf<List<com.alarmtalk.app.data.ClipReadiness.VoiceProgress>>(emptyList())
        internal set

    /**
     * 공유받은 목소리인데 **소유자 쪽 생성이 아직 안 끝난** 것.
     *
     * 받는 사람이 할 수 있는 일이 없으므로 진행률에 넣지 않는다(넣으면 영원히 안 차는
     * 몫이 되고, '다시 시도' 도 소유자 큐라 누를 수 없다). 준비 화면이 다른 문구로 말한다.
     */
    var clipReadinessAwaitingOwner by mutableStateOf<Set<String>>(emptySet())
        internal set

    /**
     * 이번 실행에서 서버 매니페스트를 받았는가. **디스크 시드와 구분하기 위한 값이다** —
     * `stockClips.isEmpty()` 로 판정하면 디스크에서 채운 순간 재조회가 막혀, 운영이 추가한
     * 프리셋이 영영 안 들어온다(`StockClipManifestStore` 주석).
     */
    internal var stockClipManifestFetched = false

    /**
     * 매니페스트 조회의 **세대**. 늦게 도착한 앞선 응답이 새 매니페스트를 덮는 것을 막는다.
     *
     * ⚠ 이 값이 없으면 권위 자체가 뒤로 간다(Codex #703 P1). `loadStockClips` 는
     * `viewModelScope.launch` 라 겹칠 수 있는데, 교체 **전에** 시작한 요청이 나중에 끝나면
     * `stockClips` 와 디스크 매니페스트를 옛 것으로 되돌린다. 그러면 캐시 쓰기 경로의
     * '지나간 응답인가' 대조가 **되살아난 옛 주소**를 기준으로 삼아, 서버의 현재 음원을
     * 지나간 것으로 판정해 회수된 목소리를 그대로 남긴다.
     */
    internal var stockClipManifestRevision: Int = 0

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

    /**
     * **스토어가 확인해 준 등급**(plan key). null 이면 '무료' 가 아니라 **아직 확인 못 함**이다.
     *
     * 「스토어가 권위다」(`docs/spec/billing-lifecycle.md`)를 판정에 실제로 반영하는 값이다.
     * 예전에는 앱이 보는 구독 상태가 100% 서버 응답이라, Play 가 자동갱신했는데 서버 반영이
     * 늦으면 **돈을 내는 사용자가 잠겼다**(2026-08-31). iOS 는 `SubscriptionManager.currentTier`
     * 로 이미 하던 일이다.
     *
     * ⚠ Play 에는 iOS `Transaction.updates` 같은 **푸시가 없다** — 실시간 신호는 서버로 가는
     * RTDN 이다. 그래서 여기서는 **폴링**한다(앱 시작·전경 진입).
     */
    var storePlanKey by mutableStateOf<String?>(null)
        internal set

    /** [storePlanKey] 의 유효기한(epoch millis). 지나면 없는 것으로 본다. */
    var storeEntitlementUntilMillis by mutableStateOf<Long?>(null)
        internal set

    /**
     * **스토어에 한 번이라도 물어봤는가.** 되돌릴 수 없는 잠금은 이게 참이 되기 전에는 하지 않는다.
     *
     * ⚠ BillingClient 조회는 **비동기**다. 앱 시작 직후에는 `storePlanKey` 가 아직 null 인데,
     * 그 순간을 '무료 확정' 으로 읽으면 Play 가 갱신을 알려 주기 **전에** 알람이 영구 강등된다
     * (2026-08-31 리뷰). 그 변환은 되돌릴 수 없다.
     */
    var storeEntitlementChecked by mutableStateOf(false)
        internal set

    /**
     * **유료 목소리 판정 — 앱 전체가 이걸 쓴다**(2026-08-31). 우선순위는
     * `resolvePaidVoiceAccess` 주석 참고: 스토어 → 서버 구독(만료) → users.plan → 그룹.
     */
    internal fun paidVoiceAccess(nowMillis: Long = System.currentTimeMillis()): PaidVoiceAccess =
        resolvePaidVoiceAccess(
            subscriptionResponse = subscriptionResponse,
            familyGroup = familyGroup,
            userPlan = authSession?.user?.plan,
            storeEntitled = isStoreEntitledNow(nowMillis),
            nowMillis = nowMillis,
        )

    /**
     * 스토어 신호가 **지금** 유효한가 — 화면에 넘길 때는 언제나 이 값을 쓴다.
     * 원시 `storePlanKey` 를 넘기면 기한이 지난 키를 그대로 믿게 된다(2026-08-31 리뷰).
     */
    internal fun isStoreEntitledNow(nowMillis: Long = System.currentTimeMillis()): Boolean =
        storePlanKey != null && (storeEntitlementUntilMillis ?: 0L) > nowMillis

    /** 모르면 잠그지 않는다 — 표시·저장·생성 게이트용. */
    internal fun isPaidVoiceEntitledOptimistic(): Boolean = paidVoiceAccess().isEntitledOptimistic()

    /**
     * 확실히 무료일 때만 참 — 되돌리기 어려운 잠금·강등용.
     *
     * ⚠ **스토어 확인 전에는 절대 참이 아니다.** 조회가 비동기라 시작 직후의 null 을
     * '무료' 로 읽으면 갱신을 확인하기 전에 영구 변환이 걸린다.
     */
    internal fun isDefinitelyFreePlan(): Boolean =
        storeEntitlementChecked && paidVoiceAccess().isDefinitelyFree()

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
    private val dynamicPromptStore = com.alarmtalk.app.data.DynamicPromptPreferenceStore(application)

    // 첫 로그인 "목소리 고르기" 스텝 표시 여부. 기본 목소리를 아직 안 고른 사용자에게만 1회.
    var showVoiceSetup by mutableStateOf(false)
        internal set

    // 알람에 마지막으로 쓴 목소리 — 새 알람 편집기가 처음 고르는 값(목소리 탭엔 표시하지 않는다).
    // 어느 그룹(내 클론·공유받은·기본)이든 이 값이 최우선이다: 그룹을 먼저 보면 클론을 가진
    // 사람이 기본 목소리를 골라 저장해도 매번 클론으로 되돌아가 '유지가 안 된다'가 된다.
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

    // consentCollect 중 '선택'(체크 없이 통과) 인 유형. 서버가 내려준다 — 화면이 목록을 따로
    // 들고 있으면 서버가 필수/선택을 바꿀 때 조용히 어긋난다.
    var consentOptional by mutableStateOf<List<String>>(emptyList())

    // collect 중 **이미 동의해 둔** 유형 — 동의 화면의 초기 체크 상태.
    // 이걸 안 쓰면 이미 동의한 사용자가 화면을 그냥 지나가는 순간 그 동의가 agreed=false 로
    // 제출돼 조용히 사라진다(목소리 기능 차단 + 마케팅 수신 동의 소멸).
    var consentPrechecked by mutableStateOf<List<String>>(emptyList())
        internal set

    // 아직 없는 민감 동의(voice_biometric·overseas_transfer).
    //
    // overseas_transfer 는 가입 필수라 보통 비어 있고, 가입 화면에서 voice_biometric(선택)을
    // 거절한 사람만 남는다. 목소리 등록 화면이 이 값으로 인라인 동의 항목을 그린다 — 한 번
    // 동의하면 비게 되어 다시 묻지 않는다. 시스템 목소리 TTS 처럼 등록 화면이 없는 경로에서
    // 403 이 오면 여전히 전용 시트로 받는다.
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

    /**
     * 쓰기가 도는 동안 사용자가 또 토글했을 때의 **마지막 값**.
     *
     * 스위치를 상시 활성으로 둔 뒤로는(쓰기 중 비활성이면 색이 두 단계로 보인다) 연속
     * 토글이 실제로 들어온다. 그때 새 요청을 그냥 버리면 **화면과 서버가 갈라진다** —
     * 여기 담아 두고 지금 쓰기가 끝나면 이어서 보낸다.
     */
    var pendingMarketingConsent: Boolean? = null
        internal set

    // 직전 마케팅 동의 로드(GET)가 실패했는지. marketingConsentAgreed 가 null 인 동안 '로딩 중'과
    // '로드 실패(다시 시도)'를 구분해, 미로드 상태를 'off'로 오인하지 않게 한다.
    var marketingConsentLoadFailed by mutableStateOf(false)
        internal set

    // 탈퇴 유예(pending_deletion) 상태로 로그인하면 true → 복구/로그아웃만 가능한 화면을 띄운다.
    var pendingDeletion by mutableStateOf(false)
        internal set

    /**
     * `/consents/status` **응답이 실제로 도착했는지**(성공·실패 무관).
     *
     * `consentChecked` 로는 대신할 수 없다 — 그 값은 이 기기의 '동의 완료' 캐시로도 켜진다.
     * 정책이 개정된 뒤 처음 켠 경우 캐시는 아직 옛 버전 기준이라 `consentChecked` 가 즉시
     * true 가 되는데, 서버는 재동의를 요구한다. 그 틈에 1회성 오버레이가 소진되고 뒤늦게
     * 동의 화면이 깔린다(Codex #660). 소진되는 플래그는 **캐시가 아니라 응답**을 기다려야
     * 한다(CLAUDE.md 「1회성 오버레이는 확인이 끝난 뒤에만 판단한다」).
     */
    var consentStatusChecked by mutableStateOf(false)

    /**
     * 동의 상태 조회의 **세대**. 늦게 도착한 앞선 응답이 최신 상태를 덮는 것을 막는다.
     *
     * ⚠ 계정만 보는 것으로는 부족하다(Codex #703 P2). 같은 계정에서 조회가 겹치는 경로가
     * 있다 — `checkConsentStatus` 는 `viewModelScope.launch` 로 도는데 그건 토큰이 갱신돼
     * `LaunchedEffect` 가 다시 걸려도 **취소되지 않는다.** 동의 제출과 경합하는 경우도 같다.
     * 먼저 떠난 요청이 '아직 받을 게 있다' 를 읽고 뒤늦게 돌아오면 이미 다 받은 상태를 덮어
     * **동의 화면이 다시 열리거나 이미 기록한 생체정보 동의를 또 묻는다.**
     * iOS 짝은 `AuthViewModel.consentStatusRevision`.
     */
    var consentStatusRevision: Int = 0
        internal set

    // 계정 상태 조회가 끝났는지(성공·실패 무관). versionChecked 와 같은 이유로 필요하다 —
    // 이게 false 인 동안 pendingDeletion 은 '아직 모른다' 는 뜻의 기본값 false 라, 이 값을
    // 안 보면 탈퇴 유예 계정에서도 1회성 오버레이가 먼저 떠 플래그를 태운다(Codex #660).
    var accountStatusChecked by mutableStateOf(false)
        internal set

    // 설치 버전이 백엔드 최소지원버전 미만이면 true → 로그인 전부터 업데이트 차단 화면을 띄운다.
    // (In-App Update IMMEDIATE 트리거 조건이자, 그 취소/미가용 시의 최종 폴백 게이트)
    var updateRequired by mutableStateOf(false)
        internal set

    // 앱 버전 정책 조회가 끝났는지(성공·실패 무관). 이게 false 인 동안 updateRequired 는
    // '아직 모른다' 는 뜻의 기본값 false 라, 이 값을 안 보면 강제 업데이트 대상 계정에서도
    // 1회성 오버레이가 먼저 떠 버리고 플래그까지 태운다.
    var versionChecked by mutableStateOf(false)
        internal set

    /**
     * 서버가 **이 앱 버전이 그릴 줄 모르는 필수 동의**를 요구하면 true → 업데이트 차단 화면.
     *
     * 그 상태에서 할 수 있는 일이 업데이트뿐이다. 동의 화면을 반쯤 그려 놓고 CTA 만 막으면
     * 사용자는 왜 못 넘어가는지 모른 채 갇히고, 통과시키면 본 적 없는 동의가 기록된다.
     * updateRequired 와 따로 두는 이유: checkAppVersion 이 onResume 마다 그 값을 덮어써서
     * (최소지원버전은 충족하므로 false) 차단이 풀려 버린다.
     */
    var consentUnsupported by mutableStateOf(false)
        internal set

    /**
     * APK 에 실린 법무 문서의 정책 버전. 동의를 기록할 때 '내가 실제로 보여준 문서' 로 함께
     * 보낸다. 서버 버전과 다르면 서버가 거부하고, 그때 [consentUnsupported] 로 넘어간다.
     *
     * 값은 빌드 시 docs/legal 원문에서 뽑는다(build.gradle.kts). 런타임에 파싱하지 않는
     * 이유: 파싱이 어긋나면 모든 동의 기록이 거부돼 신규 가입이 통째로 막힌다 — 그런 실패는
     * 빌드에서 나야 한다.
     */
    internal val bundledPolicyVersion: String get() = BuildConfig.LEGAL_POLICY_VERSION
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
    }

    /**
     * 부족한 기본 목소리 클립을 채운다. 화면을 띄우든 말든 항상 부른다
     * (언어 변경·중단 복구 포함) — 목소리 탭에 들르지 않아도 채워져야 한다.
     *
     * **동의가 끝난 뒤에** 불러야 한다. 동의 전에는 서버가 403 으로 막는데, 워커의
     * enqueue 정책이 KEEP 이라 그때 한 번 걸린 작업이 재시도 백오프(30초→60초…)에 들어가
     * 앉아 버린다. 그 뒤에 다시 enqueue 해도 무시되므로, 사용자는 동의를 마치고도 백오프가
     * 끝날 때까지 준비 화면에 붙잡힌다.
     */
    fun prefetchStockClips() {
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

    /**
     * 알람에 마지막으로 쓴 **문구 선택**을 기억한다 — 다음 새 알람의 기본값이 된다.
     * 목소리(rememberVoiceUsed)와 한 쌍이라 기록 시점도 같다: **알람 저장 성공 시.**
     *
     * 편집기에서 문구를 눌러만 보고 취소한 것까지 기억하면, 만들지도 않은 알람의 선택이 다음
     * 알람에 남는다.
     *
     * **직접 입력은 문구까지 기억한다**(2026-08-06 변경. 그전에는 '빈 직접입력으로 열려 저장이
     * 막힌다' 는 이유로 아예 기억하지 않았다). 문구를 함께 이어받으면 글자가 같아
     * `AlarmAudioStore` 입력 캐시에 걸려 서버 호출도 월 한도 차감도 없이 저장되므로,
     * 그 근거가 사라졌다.
     *
     * 이어받는 것은 '종류'(+직접 입력이면 그 문구)뿐이고 회전 인덱스·클립 키 같은 알람별
     * 상태는 절대 따라가지 않는다.
     */
    internal fun rememberMessageChoiceUsed(draft: AlarmDraft) {
        val userId = authSession?.user?.id?.takeIf { it.isNotBlank() } ?: return
        // 가족(수신자) 알람의 선택은 기억하지 않는다 — 수신자를 위해 고른 값이고, 문구는
        // 수신자의 dynamic prompt 기준으로 만들어진다. 생성 경로는 이미 앞에서 갈라지지만,
        // 어느 호출부로 들어와도 같은 규칙이 되도록 여기서도 막는다.
        if (!draft.targetUserId.isNullOrBlank()) return
        if (draft.playMode == com.alarmtalk.app.data.AlarmPlayModes.ALARM_ONLY) return
        val rememberContext = {
            // 버킷 알람의 종류는 draft 가 실어 온다(AlarmEditorState.toDraft). 그래도 버킷에서
            // 한 번 더 되짚는 이유: 종류가 비면 여기서 **조용히 아무 일도 일어나지 않고**,
            // 그 증상은 한참 뒤 '새 알람이 매번 기본 인사말로 열린다'로만 드러난다.
            (draft.voiceRandomContext ?: randomPromptContextForBucket(draft.bucketId))
                ?.takeIf { it.isNotBlank() }
                ?.let { dynamicPromptStore.saveLastMessageContext(userId, it) }
            Unit
        }
        val bucket = draft.bucketId?.takeIf { it.isNotBlank() }
        when {
            // 무료·기본 목소리 경로: 사용자가 고른 것이 '테마(버킷)' 그 자체다.
            bucket != null && com.alarmtalk.app.data.isSystemVoiceId(draft.voiceProfileId) ->
                dynamicPromptStore.saveLastFreeBucket(userId, bucket)
            // 유료 클론의 사전렌더 버킷. 여기서도 bucketId 가 차고 voiceRandomPrompt 는 꺼지지만
            // (setBucketAudio), 사용자가 고른 것은 **문구 종류**이고 버킷은 그 결과다
            // (love→love, wake_fortune→fortune, preset→greeting …).
            // 이걸 테마로 저장하면 두 가지가 깨진다(Codex #660):
            //  - greeting·love·fortune 은 FreeBucketOrder 밖이라 읽을 때 걸러지는데, 그 전에
            //    이미 저장돼 있던 유효한 테마(weather)를 덮어써 다음 기본 목소리 알람이 '약' 으로 되돌아간다.
            //  - 정작 문구 종류는 기록되지 않아 다음 클론 알람이 옛 문구로 열린다.
            bucket != null -> rememberContext()
            draft.voiceRandomPrompt -> rememberContext()
            // 직접 입력: **문구까지** 기억한다. 종류만 기억하면 새 알람이 빈 직접입력으로 열려
            // 저장이 막히고, 문구를 함께 이어받으면 글자가 같아 오디오 캐시에 걸려 서버 호출도
            // 월 한도 차감도 없이 곧바로 저장된다. 녹음·알람전용은 문구 개념이 없어 걸러진다.
            draft.voiceSource == com.alarmtalk.app.data.VoiceSources.TTS_PROFILE ->
                draft.voiceText
                    ?.takeIf { it.isNotBlank() }
                    ?.let { dynamicPromptStore.saveLastManualText(userId, it) }
                    ?: Unit
            else -> Unit
        }
    }

    /** 편집기가 새 알람의 기본값으로 쓸 '마지막 선택'. 로그인 전이면 둘 다 null 이다. */
    internal fun lastMessageContext(): String? =
        dynamicPromptStore.readLastMessageContext(authSession?.user?.id)

    internal fun lastFreeBucket(): String? =
        dynamicPromptStore.readLastFreeBucket(authSession?.user?.id)

    /** 마지막에 쓴 직접 입력 문구. 차 있으면 마지막 선택이 '직접 입력' 이었다는 뜻이다. */
    internal fun lastManualText(): String? =
        dynamicPromptStore.readLastManualText(authSession?.user?.id)

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
        // ⚠ **스토어 신호도 계정에 묶인다**(2026-08-31 리뷰). 여기서 복원하지 않으면 계정을
        // 바꿔도 앞 사람의 값이 메모리에 남아, 무료 계정이 유료로 취급된다.
        storePlanKey = snapshot.storePlanKey
        storeEntitlementUntilMillis = snapshot.storeEntitlementUntilMillis
        // 새 계정으로는 아직 물어본 적이 없다 — 확인 전에는 영구 잠금을 하지 않는다.
        storeEntitlementChecked = false
    }

    internal fun saveSubscriptionSnapshot(response: BillingSubscriptionResponse?) {
        val userId = authSession?.user?.id?.takeIf { it.isNotBlank() } ?: return
        accessSnapshotStore.updateSubscription(userId, response)
        // ⚠ **여기서 `users.plan` 을 같이 쓰지 않는다**(2026-09-01 리뷰). 이 자리가 아는
        // plan 은 **마지막으로 `/auth/me` 를 받았을 때의 값**이라, 앱을 닫아 둔 사이 강등된
        // 계정이 `plan_changed` 를 놓치면 옛 유료 값이다. 보류에서는 `/billing/subscription`
        // 이 남아 있는 행을 그대로 돌려주므로 이 경로가 그대로 돌아 **판정에 옛 유료 plan 을
        // 심고**, 잠금 이펙트의 `billingNotEntitled` 갈래도 (행이 살아 있어) 안 타서
        // `refreshAppSession()` 이 불리지 않는다.
        //
        // 그래서 plan 은 **방금 받아 온 경로만** 적는다 — `refreshAppSession`(시작 시·
        // plan_changed 시) 과 `PlanChangeSyncWorker`. 안 적혀 있으면 판정기가 구독·그룹으로
        // 답하고(예전 동작), 그건 옛 값을 심는 것보다 낫다.
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
        // 마지막에 고른 문구 종류·무료 테마도 같은 성격의 취향이라 함께 정리한다.
        // (이 함수는 명시적 로그아웃·탈퇴에서만 불린다 — 자동 401 경로는 부르지 않는다.)
        dynamicPromptStore.clearLastSelections(userId)
        // ⚠ **목소리 교체 표식(`VoiceReplacementMarkerStore`)은 여기서 지우지 않는다.**
        // 취향은 계정과 함께 떠나도 되지만 그 표식은 **남아 있는 로컬 알람의 안전 기준**이다
        // — 로그아웃은 알람을 끄기만 하고 지우지 않으므로, 표식을 지우면 그 사이의 교체를
        // 다시 로그인한 기기가 '처음 봤다' 로 읽어 영영 강등하지 않는다.
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
        voiceProfiles = bundledSystemVoiceProfiles()
        pendingVoiceDraft = null
        voiceDraftQuota = null
        voiceProfileLoadFinished = false
        voiceProfilesLoadedFresh = false
        showVoiceSetup = false
        lastUsedVoiceId = null
        familyGroup = null
        familyVoices = emptyList()
        // 공유 목소리 신선-로드 플래그도 함께 초기화 — 안 그러면 다음 세션에서 fetchVoiceProfiles 가
        // refreshSocial 전에 강등 판단해, 공유 목소리 쓰는 알람이 오강등될 수 있다(PR #536 P2).
        familyVoicesLoadedFresh = false
        subscriptionResponse = null
        // ⚠ **스토어 신호는 계정 것이다.** 안 지우면 유료 A 가 로그아웃한 뒤 무료 B 가
        // 로그인했을 때(액티비티 재생성 없이) B 가 A 의 등급을 물려받아 모든 게이트를 통과한다.
        storePlanKey = null
        storeEntitlementUntilMillis = null
        storeEntitlementChecked = false
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
        consentOptional = emptyList()
        consentPrechecked = emptyList()
        consentUnsupported = false
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
        accountStatusChecked = false
        consentStatusChecked = false
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
        // 저장소에만 반영된 세션 갱신을 메모리로 계속 끌어온다 — 이유는
        // [absorbStoredSession] 과 AuthSessionStore.observeSession 주석 참고.
        viewModelScope.launch {
            authSessionStore.observeSession().collect(::absorbStoredSession)
        }
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
                refreshStoreEntitlement()
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
