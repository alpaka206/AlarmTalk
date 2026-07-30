package com.alarmtalk.app

import androidx.compose.ui.res.stringResource
import android.Manifest
import android.util.Log
import androidx.activity.compose.BackHandler
import androidx.core.app.ActivityCompat
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.data.AlarmOrigins
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.common.api.ApiException

@Composable
internal fun AlarmTalkApp(
    viewModel: MainViewModel = viewModel(),
    // Play In-App Update 훅. 프리뷰/테스트에선 no-op 기본값. 실제 트리거는 MainActivity 가
    // InAppUpdateManager 에 연결한다.
    onCheckInAppUpdate: () -> Unit = {},
    onCompleteInAppUpdate: () -> Unit = {},
) {
    val context = LocalContext.current
    val alarms by viewModel.alarms.collectAsStateWithLifecycle()
    val message = viewModel.message
    val authSession = viewModel.authSession
    val authBusy = viewModel.authBusy
    val voiceProfiles = viewModel.voiceProfiles
    val pendingVoiceDraft = viewModel.pendingVoiceDraft
    val voiceProfileBusy = viewModel.voiceProfileBusy
    val socialBusy = viewModel.socialBusy
    val familyGroup = viewModel.familyGroup
    val familyVoices = viewModel.familyVoices
    val billingBusy = viewModel.billingBusy
    val subscriptionResponse = viewModel.subscriptionResponse
    val vouchers = viewModel.vouchers
    val navController = rememberNavController()
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentTab = navBackStackEntry?.destination?.route.toNativeTab()
    val selectedTab = currentTab ?: NativeTab.Alarms
    var planGateDialog by remember { mutableStateOf<PlanGateDialogState?>(null) }
    // 인증 화면 백스택 — 로그인↔회원가입 전환 히스토리를 보존해 뒤로가기가 한 단계씩 돌아가게 한다.
    var authBackStack by remember { mutableStateOf(listOf<AuthRoute>(AuthRoute.Landing)) }
    val authRoute = authBackStack.last()
    fun authNavigate(route: AuthRoute) {
        if (route == authRoute) return
        // 직전 화면으로 되돌아가는 전환(예: 회원가입→로그인 토글)은 push 대신 pop 해 스택이 무한정 늘지 않게.
        val prev = authBackStack.getOrNull(authBackStack.size - 2)
        authBackStack = if (route == prev) authBackStack.dropLast(1) else authBackStack + route
    }
    fun authBack() {
        if (authBackStack.size > 1) authBackStack = authBackStack.dropLast(1)
    }
    fun authResetToLanding() {
        authBackStack = listOf(AuthRoute.Landing)
    }
    // 인증 화면 전환 시 이전 실패 안내가 새 화면까지 따라오지 않게 정리한다.
    // authNotice 는 '회원가입→로그인 전환 이유' 안내라 로그인 화면으로 가는 전환에서는 남기고,
    // 그 외 화면으로 벗어날 때만 지운다.
    LaunchedEffect(authRoute) {
        viewModel.loginError = null
        viewModel.registerError = null
        val route = authRoute
        if (!(route is AuthRoute.Auth && route.mode == AuthMode.Login)) {
            viewModel.authNotice = null
        }
    }
    // 회원가입 시도 이메일이 이미 가입돼 있으면(AUTH_EMAIL_TAKEN) 로그인 화면으로 전환한다.
    // 입력한 이메일은 AuthScreen 의 remember 상태로 유지되므로 다시 입력할 필요가 없다.
    LaunchedEffect(viewModel.authRedirectToLogin) {
        if (viewModel.authRedirectToLogin) {
            authNavigate(AuthRoute.Auth(AuthMode.Login))
            viewModel.authRedirectToLogin = false
        }
    }
    val themeMode = viewModel.themeMode
    val snackbarHostState = remember { SnackbarHostState() }
    val sessionRouteKey = authSession?.user?.id
    val hasSharedPass = familyGroup?.group != null
    val unreadAlarmCount = remember(alarms, viewModel.receivedAlarmSeenAtMillis) {
        alarms.count { alarm ->
            alarm.origin == AlarmOrigins.RECEIVED_REMOTE &&
                alarm.createdAtMillis > viewModel.receivedAlarmSeenAtMillis
        }
    }
    val permissionState = rememberPermissionStatusState()
    val permissions = permissionState.snapshot
    val initialPermissionPromptStore = remember(context) { InitialPermissionPromptStore(context) }
    var bulkPermissionFlowActive by remember { mutableStateOf(false) }
    var bulkRuntimeRequested by remember { mutableStateOf(false) }
    var bulkOpenedSettingsTargets by remember { mutableStateOf<Set<PermissionTarget>>(emptySet()) }
    val runtimePermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestMultiplePermissions(),
    ) { results ->
        permissionState.refresh()
        // 영구 거부(사용자가 이전에 거부해 시스템이 다이얼로그를 더 이상 띄우지 않는 상태) 감지.
        // 이 경우 launch() 는 다이얼로그 없이 즉시 거부로 돌아온다 → 모달의 '허용하기' 만으론
        // 권한을 켤 수 없으므로 앱 설정으로 유도한다. shouldShowRequestPermissionRationale 가
        // false + 미허용이면(다이얼로그를 거친 콜백 시점 기준) 영구 거부로 판정한다.
        // 일괄 권한 플로우는 자체 설정 라우팅(아래 LaunchedEffect)이 있으므로 단일 요청일 때만.
        if (!bulkPermissionFlowActive) {
            val activity = context.findHostActivity()
            val permanentlyDeniedPerm = if (activity == null) {
                null
            } else {
                results.entries.firstOrNull { (perm, granted) ->
                    !granted && !ActivityCompat.shouldShowRequestPermissionRationale(activity, perm)
                }?.key
            }
            when (permanentlyDeniedPerm) {
                Manifest.permission.POST_NOTIFICATIONS -> context.openNotificationSettings()
                Manifest.permission.RECORD_AUDIO -> context.openAppDetailsSettings()
            }
        }
    }

    fun missingRuntimePermissions(snapshot: PermissionSnapshot): List<String> = buildList {
        if (context.shouldRequestNotificationRuntimePermission()) {
            add(Manifest.permission.POST_NOTIFICATIONS)
        }
        if (!snapshot.recordAudio) {
            add(Manifest.permission.RECORD_AUDIO)
        }
    }

    fun nextSettingsPermissionTarget(
        snapshot: PermissionSnapshot,
        openedTargets: Set<PermissionTarget>,
    ): PermissionTarget? = listOfNotNull(
        PermissionTarget.Notifications.takeIf { !snapshot.notifications },
        PermissionTarget.ExactAlarms.takeIf { !snapshot.exactAlarms },
        PermissionTarget.FullScreenIntent.takeIf { !snapshot.fullScreenIntent },
        PermissionTarget.RecordAudio.takeIf { !snapshot.recordAudio },
    ).firstOrNull { it !in openedTargets }

    fun openPermissionSettings(target: PermissionTarget) {
        when (target) {
            PermissionTarget.Notifications -> context.openNotificationSettings()
            PermissionTarget.ExactAlarms -> context.openExactAlarmSettings()
            PermissionTarget.FullScreenIntent -> context.openFullScreenIntentSettings()
            PermissionTarget.RecordAudio -> context.openAppDetailsSettings()
        }
    }

    fun requestPermission(target: PermissionTarget) {
        when (target) {
            PermissionTarget.Notifications -> {
                if (context.shouldRequestNotificationRuntimePermission()) {
                    runtimePermissionLauncher.launch(arrayOf(Manifest.permission.POST_NOTIFICATIONS))
                } else {
                    context.openNotificationSettings()
                }
            }
            PermissionTarget.ExactAlarms -> context.openExactAlarmSettings()
            PermissionTarget.FullScreenIntent -> context.openFullScreenIntentSettings()
            PermissionTarget.RecordAudio -> {
                runtimePermissionLauncher.launch(arrayOf(Manifest.permission.RECORD_AUDIO))
            }
        }
        permissionState.refresh()
    }

    fun requestAllMissingPermissions() {
        bulkPermissionFlowActive = true
        bulkRuntimeRequested = false
        bulkOpenedSettingsTargets = emptySet()
        permissionState.refresh()
    }

    fun requestFirstMissingAlarmPermission() {
        // 토스트 대신 권한 게이트 모달을 띄운다. 모달의 '허용하기'가 실제 권한 요청을 실행하고,
        // 필요한 권한이 모두 채워질 때까지 모달이 유지돼 알람 생성을 막는다(권한 없으면 생성 차단).
        val target = PermissionSnapshot.read(context).firstMissingAlarmTarget() ?: return
        viewModel.requestPermissionGate(target)
    }

    LaunchedEffect(permissionState.refreshTick, bulkPermissionFlowActive) {
        if (!bulkPermissionFlowActive) return@LaunchedEffect

        val current = PermissionSnapshot.read(context)
        if (!bulkRuntimeRequested) {
            val runtimePermissions = missingRuntimePermissions(current)
            if (runtimePermissions.isNotEmpty()) {
                bulkRuntimeRequested = true
                runtimePermissionLauncher.launch(runtimePermissions.toTypedArray())
                return@LaunchedEffect
            }
            bulkRuntimeRequested = true
        }

        val settingsTarget = nextSettingsPermissionTarget(current, bulkOpenedSettingsTargets)
        if (settingsTarget != null) {
            bulkOpenedSettingsTargets = bulkOpenedSettingsTargets + settingsTarget
            openPermissionSettings(settingsTarget)
            return@LaunchedEffect
        }

        bulkPermissionFlowActive = false
        bulkRuntimeRequested = false
        bulkOpenedSettingsTargets = emptySet()
    }

    // '알람 추가' 흐름에서 권한 게이트로 넘어온 요청. 권한을 모두 허용하면 이어서 알람 편집
    // 페이지로 진입한다(familyTargetMode·targetUserId 보존). 사용자가 모달을 닫으면 취소로 보고 비운다.
    var pendingCreateAlarmAfterPermission by remember { mutableStateOf<Pair<Boolean, String?>?>(null) }

    // 권한 게이트 모달이 열린 동안 권한 상태를 추적한다: 현재 대상 권한이 채워지면 다음 미허용
    // 알람 권한으로 넘기고, 알람에 필요한 권한이 모두 채워지면 모달을 자동으로 닫는다.
    // (RecordAudio 는 알람 게이트가 아니라 목소리 녹음 온디맨드용이므로 여기서 관리하지 않는다.)
    LaunchedEffect(permissions, viewModel.permissionGateRequest) {
        val current = viewModel.permissionGateRequest ?: return@LaunchedEffect
        if (current == PermissionTarget.RecordAudio) return@LaunchedEffect
        when (val nextMissing = permissions.firstMissingAlarmTarget()) {
            null -> viewModel.dismissPermissionGate()
            current -> Unit // 아직 현재 권한 미충족 → 모달 유지
            else -> viewModel.requestPermissionGate(nextMissing)
        }
    }

    // 알람 추가 흐름에서 필요한 권한을 모두 허용하면 이어서 알람 설정(편집) 페이지로 진입한다.
    // 모달을 닫아 취소하면 pending 이 비워져 진입하지 않는다.
    LaunchedEffect(permissions.alarmReady, pendingCreateAlarmAfterPermission) {
        val pending = pendingCreateAlarmAfterPermission
        if (pending != null && permissions.alarmReady) {
            pendingCreateAlarmAfterPermission = null
            viewModel.dismissPermissionGate()
            navController.navigate(
                AppRoute.alarmCreate(familyTargetMode = pending.first, targetUserId = pending.second),
            )
        }
    }

    LaunchedEffect(Unit) {
        viewModel.checkAppVersion()
    }

    // 서버 정책(강제/권장) 확정 후 In-App Update 를 조회·시작한다. 콜드스타트에서 onResume
    // 시점엔 아직 정책이 로드 전일 수 있어, 플래그가 확정될 때 한 번 더 트리거한다(중복은 무해).
    LaunchedEffect(viewModel.updateRequired, viewModel.updateRecommended) {
        if (viewModel.updateRequired || viewModel.updateRecommended) {
            onCheckInAppUpdate()
        }
    }

    // FLEXIBLE 업데이트 다운로드 완료 → 재시작 안내 스낵바. 액션 시 completeUpdate() 로 설치 마무리.
    LaunchedEffect(viewModel.flexibleUpdateDownloaded) {
        if (!viewModel.flexibleUpdateDownloaded) return@LaunchedEffect
        val result = snackbarHostState.showSnackbar(
            message = context.getString(R.string.r3app_update_downloaded),
            actionLabel = context.getString(R.string.r3app_update_restart),
            duration = SnackbarDuration.Indefinite,
        )
        if (result == SnackbarResult.ActionPerformed) {
            onCompleteInAppUpdate()
        }
    }

    LaunchedEffect(message) {
        val currentMessage = message ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(currentMessage)
        viewModel.clearMessage()
    }

    LaunchedEffect(viewModel.navigateHomeTick) {
        if (viewModel.navigateHomeTick > 0) {
            navController.navigateHomeClearingStack()
        }
    }

    LaunchedEffect(viewModel.navigateSharedPassTick) {
        if (viewModel.navigateSharedPassTick > 0) {
            navController.navigate(AppRoute.MemberManagement) {
                launchSingleTop = true
            }
        }
    }

    // 첫 로그인 시 메인에서 뜨던 일괄 권한 팝업(LoginPermissionGate)은 제거했다.
    // 권한은 실제로 필요한 시점에만 요청한다: 알람 만들기(startCreateAlarm → 권한 없으면
    // '필요' 안내+요청+생성 차단), 목소리 녹음(RECORD_AUDIO 온디맨드). 알람이 이미 있는데
    // 권한이 없어 조용히 안 울리는 경우만 알람 홈에 경고 패널을 남긴다(AlarmListScreen).

    LaunchedEffect(sessionRouteKey) {
        if (sessionRouteKey != null) {
            navController.navigateHomeClearingStack()
        }
        viewModel.loadReceivedAlarmBadgeState()
        planGateDialog = null
        authResetToLanding()
    }

    // 첫 진입 1회: 최초 로그인 직후 알림 등 알람 권한이 없으면 권한 게이트 모달을 자동으로 한 번
    // 띄운다(알람 앱 핵심 권한이라 선제 요청). 기기 단위 플래그로 재노출을 막고, 이후 미허용 상태는
    // 알람 만들기 모달·홈 슬림 배너가 처리한다. (정확알람·전체화면은 알람 앱이라 자동 부여되고
    // 실제 시스템 다이얼로그가 뜨는 건 알림 권한뿐이다.)
    //
    // 동의·목소리 준비를 **다 지난 뒤에** 띄운다. 이 모달은 게이트 체인이 아니라 Scaffold 밖
    // 오버레이라, 조건을 걸지 않으면 약관 동의 화면 위에 겹쳐 뜬다 — 아직 약관에 동의하지도
    // 않은 사람에게 알림 권한부터 묻는 꼴이고, 그 순간 '이미 물어봤음' 플래그까지 태워
    // 정작 홈에 도착한 뒤에는 다시 묻지 못한다.
    LaunchedEffect(sessionRouteKey, viewModel.consentChecked, viewModel.needsConsent, viewModel.showVoiceSetup) {
        if (sessionRouteKey == null) return@LaunchedEffect
        if (!viewModel.consentChecked || viewModel.needsConsent) return@LaunchedEffect
        if (viewModel.showVoiceSetup) return@LaunchedEffect
        if (initialPermissionPromptStore.hasPrompted()) return@LaunchedEffect
        initialPermissionPromptStore.markPrompted()
        if (!PermissionSnapshot.read(context).alarmReady) {
            requestFirstMissingAlarmPermission()
        }
    }

    // 웰컴 코드 안내(계정 1회, 무료 플랜 한정). 권한 게이트와 같은 레이어에 쌓이면 하나가
    // 다른 하나를 가리므로 **권한 모달이 없을 때만** 띄운다. 권한 모달이 닫히면 이 효과가
    // 다시 돌아 그때 뜬다. 동의·목소리 준비 화면을 다 지난 뒤라야 홈 위에서 보인다.
    LaunchedEffect(sessionRouteKey, viewModel.permissionGateRequest, viewModel.showVoiceSetup, viewModel.needsConsent) {
        if (sessionRouteKey == null) return@LaunchedEffect
        if (viewModel.permissionGateRequest != null) return@LaunchedEffect
        if (viewModel.showVoiceSetup || viewModel.needsConsent) return@LaunchedEffect
        viewModel.maybeShowWelcomePromo()
    }

    LaunchedEffect(sessionRouteKey, alarms) {
        if (sessionRouteKey != null) {
            viewModel.ensureReceivedAlarmBadgeBaseline(alarms)
        }
    }

    LaunchedEffect(authSession?.token) {
        if (authSession != null) {
            viewModel.checkVoiceSetupFor(authSession.user.id)
            viewModel.checkAccountStatus()
            viewModel.checkConsentStatus()
            viewModel.preloadVoiceProfiles()
            viewModel.loadStockClips()
            viewModel.preloadSocial()
            viewModel.preloadBilling()
        }
    }
    // 상대가 목소리 공유를 켜면(voice_share_changed push) 공유 목록·클립 매니페스트를
    // 즉시 새로고침한다 — 가족 알람 push→pull 과 같은 즉시성.
    LaunchedEffect(authSession?.token) {
        if (authSession == null) return@LaunchedEffect
        com.alarmtalk.app.core.AppSignals.voiceShareChanged.collect {
            viewModel.refreshSocial()
            viewModel.loadStockClips(forceReload = true)
        }
    }
    // 플랜 변경(plan_changed push) — 앱이 살아 있는 채로 구독이 만료·강등되면 워커는 SharedPreferences
    // 만 갱신하므로 live state(구독/플랜/가족)는 그대로다. 즉시 재조회해, 아래 강등 이펙트가 새 state
    // 로 재평가되어 UI 가 만료된 유료 플랜/유료 컨트롤을 계속 보여주지 않게 한다(서버 거부 액션 유도 방지).
    LaunchedEffect(authSession?.token) {
        if (authSession == null) return@LaunchedEffect
        com.alarmtalk.app.core.AppSignals.planChanged.collect {
            viewModel.preloadBilling()   // 구독 state
            viewModel.preloadSocial()    // 가족 state(+ 접근 잃은 공유 목소리 알람 강등)
            viewModel.refreshAppSession() // auth/me → users.plan
        }
    }

    LaunchedEffect(
        authSession?.user?.id,
        // 서버 users.plan(만료 확정 시 cron 이 'free' 로 세팅)이 바뀌면 재평가하도록 키에 포함.
        authSession?.user?.plan,
        subscriptionResponse?.subscription?.id,
        subscriptionResponse?.subscription?.status,
        subscriptionResponse?.plan?.key,
        subscriptionResponse?.plan?.planType,
    ) {
        // 유료 목소리 알람을 기본 알람(사운드온리)으로 '영구' 변환하는 건 서버가 무료로 '확정'한
        // 신호에서만 한다(다시 유료가 돼도 되돌리지 않는 사용자 정책이라, 오변환이 곧 영구 피해다).
        // 세 조건을 모두 만족해야 변환: (a) billing 에 유료 구독 없음, (b) 가족/커플 접근도 없음,
        // (c) 서버 users.plan 이 무료. 이래야 갱신 지연·읽기리플리카 지연으로 subscription 이 잠깐
        // null 인 유료 사용자가 영구 오변환되지 않는다. 만료~반영 전 창의 '울림'은 RingingService 게이트가 방어.
        val plan = authSession?.user?.plan
        val billingNotEntitled = authSession != null && subscriptionResponse != null &&
            !hasPaidVoiceAccess(subscriptionResponse) &&
            !hasCoupleOrFamilyAccess(subscriptionResponse, familyGroup)
        val planIsFree = plan.isNullOrBlank() || plan == "free"
        when {
            billingNotEntitled && planIsFree -> viewModel.applyFreePlanVoiceLock()
            // billing 은 무권한인데 user.plan 이 아직 유료 → stale 가능(앱 살아있는 중 만료 시
            // refreshBilling 은 구독만 갱신하고 plan 은 안 갱신). auth/me 로 plan 을 갱신해 진짜
            // 무료인지 확정한다 — 갱신되면 이 이펙트가 user.plan 키 변화로 재실행돼 변환을 재판정.
            // 진짜 무료면 plan=free 로 바뀌어 변환되고, 일시적 stale 이면 plan=유료 그대로라 변환 안 함.
            billingNotEntitled -> viewModel.refreshAppSession()
        }
    }

    // 탭을 왔다갔다 할 때마다 네트워크 새로고침이 다시 나가면 응답이 올 때 화면이 갱신되며
    // 살짝 버벅인다. 탭별로 마지막 새로고침 시각을 기억해, 일정 시간 안에 다시 들른
    // 경우엔 재요청을 건너뛴다. (로그인 토큰이 바뀌면 키가 달라져 자연히 새로 받는다.)
    val tabRefreshThrottleMs = 60_000L
    val lastTabRefreshAt = remember { mutableMapOf<Pair<NativeTab, String?>, Long>() }
    LaunchedEffect(currentTab, authSession?.token) {
        if (authSession == null) return@LaunchedEffect
        val tab = currentTab ?: return@LaunchedEffect
        val throttleKey = tab to authSession?.token
        val now = System.currentTimeMillis()
        val last = lastTabRefreshAt[throttleKey]
        // 탭에 필요한 데이터가 비어 있으면(예: 무료 플랜 정리로 목소리 목록이 비워진 직후)
        // 스로틀을 무시하고 즉시 다시 불러와, 빈 화면이 남지 않게 한다.
        val tabDataEmpty = when (tab) {
            NativeTab.Voices -> voiceProfiles.isEmpty()
            else -> false
        }
        if (!tabDataEmpty && last != null && now - last < tabRefreshThrottleMs) return@LaunchedEffect
        lastTabRefreshAt[throttleKey] = now
        when (tab) {
            NativeTab.Voices -> {
                viewModel.preloadVoiceProfiles()
                // 유료 클론 확정 후 cron 이 세션 중 새로 만든 사전렌더 클립을 반영하려면 강제 재조회.
                viewModel.loadStockClips(forceReload = true)
                viewModel.preloadSocial()
            }
            // 알람 홈: 히어로와 '누구를 깨울까요?' 시트가 구독/가족 데이터를 쓰므로 함께 갱신한다.
            NativeTab.Alarms -> {
                viewModel.syncNow()
                viewModel.refreshBilling()
                viewModel.refreshSocial()
                // 편집기가 이 탭에서 열리고, cron 이 세션 중 만든 클론 클립을 오프라인 버킷 판정
                // (hasCompleteCloneBucket)에 반영하려면 매니페스트를 새로 받아야 한다.
                viewModel.loadStockClips(forceReload = true)
            }
            NativeTab.People -> {
                viewModel.refreshSocial()
                viewModel.refreshBilling()
            }
            NativeTab.Billing -> viewModel.refreshBilling()
            // 전체 탭: 공유 이용권/가족 여부에 따라 노출 항목이 달라지므로 함께 갱신.
            NativeTab.Menu -> {
                viewModel.refreshBilling()
                viewModel.refreshSocial()
            }
        }
    }

    LaunchedEffect(currentTab, alarms, authSession?.user?.id) {
        if (currentTab == NativeTab.Alarms && authSession != null) {
            viewModel.markReceivedAlarmsSeen(alarms)
        }
    }

    val googleSignInLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val account = runCatching {
            GoogleSignIn.getSignedInAccountFromIntent(result.data).getResult(ApiException::class.java)
        }.onFailure { error ->
            if (error is ApiException) {
                AlarmTalkLog.reportError("Google sign-in failed resultCode=${result.resultCode} statusCode=${error.statusCode}",
                    error,
                )
                viewModel.showGoogleSignInFailed(googleSignInErrorMessage(context, error.statusCode))
            } else {
                AlarmTalkLog.reportError("Google sign-in failed resultCode=${result.resultCode}", error)
                viewModel.showGoogleSignInFailed(
                    userFacingError(error, context.getString(R.string.r3app_google_signin_failed)),
                )
            }
        }.getOrNull()
        if (account == null) return@rememberLauncherForActivityResult

        val idToken = account?.idToken
        if (idToken.isNullOrBlank()) {
            viewModel.showGoogleSignInFailed(context.getString(R.string.r3app_google_signin_no_info))
        } else {
            viewModel.finishGoogleLogin(idToken)
        }
    }

    fun launchGoogleSignIn() {
        val clientId = BuildConfig.VOICE_ALARM_GOOGLE_WEB_CLIENT_ID
        if (clientId.isBlank()) {
            viewModel.showGoogleSetupRequired()
            return
        }
        val options = buildGoogleSignInOptions(requestIdToken = true)
        googleSignInLauncher.launch(GoogleSignIn.getClient(context, options).signInIntent)
    }

    fun logout() {
        viewModel.logout {
            signOutGoogleAccount(context)
        }
    }

    fun deleteAccount() {
        // 즉시 삭제가 아니라 30일 유예(POST /me/deletion) 신청. 구글은 revoke 하지 않고
        // 로컬 세션만 정리(유예 중 다시 로그인해 철회 가능해야 하므로).
        viewModel.requestAccountDeletion {
            signOutGoogleAccount(context)
        }
    }

    fun navigateToTab(tab: NativeTab) {
        if (selectedTab == tab) return
        navController.navigateTopLevelTab(tab)
    }

    fun goBackInApp() {
        navController.popBackStackOrHome()
    }

    // 알람 생성 진입 일원화 — 하단바 ➕와 히어로 카드가 모두 이 경로를 탄다.
    // 가족 알람 자격이 있으면 '누구를 깨울까요?' 시트에서 대상을 먼저 고른다.
    val alarmTargetRecipients = familyAlarmRecipients(familyGroup, authSession)
    val canCreateFamilyAlarm = authSession != null &&
        hasCoupleOrFamilyAccess(subscriptionResponse, familyGroup) &&
        alarmTargetRecipients.isNotEmpty()
    var alarmTargetSheetVisible by remember { mutableStateOf(false) }
    fun startCreateAlarm(familyTargetMode: Boolean, targetUserId: String? = null) {
        if (!permissions.alarmReady) {
            // 권한 게이트로 넘어가되, 허용 완료 후 이 알람 추가를 이어서 편집 페이지로 진입시킨다.
            pendingCreateAlarmAfterPermission = familyTargetMode to targetUserId
            requestFirstMissingAlarmPermission()
        } else {
            navController.navigate(
                AppRoute.alarmCreate(familyTargetMode = familyTargetMode, targetUserId = targetUserId),
            )
        }
    }
    fun requestCreateAlarm() {
        if (canCreateFamilyAlarm) {
            alarmTargetSheetVisible = true
        } else {
            startCreateAlarm(familyTargetMode = false)
        }
    }

    if (authSession == null) {
        BackHandler(enabled = authBackStack.size > 1) {
            authBack()
        }
    } else {
        BackHandler(
            enabled = currentTab != null && currentTab != NativeTab.Alarms,
            onBack = {
                // 이용권·코드 등록은 전체 탭의 하위 목적지 — 뒤로가기가 홈이 아니라 전체로 돌아간다.
                val backTarget = when (currentTab) {
                    NativeTab.Billing, NativeTab.People -> NativeTab.Menu
                    else -> NativeTab.Alarms
                }
                navController.navigateTopLevelTab(backTarget)
            },
        )
    }

    if (viewModel.nicknameEditDialogOpen) {
        NicknameEditDialog(
            initial = authSession?.user?.name.orEmpty(),
            busy = authBusy,
            onDismiss = viewModel::dismissEditNickname,
            onConfirm = viewModel::updateNickname,
        )
    }

    if (viewModel.deleteAccountConfirmOpen) {
        DeleteAccountConfirmDialog(
            busy = authBusy,
            onDismiss = viewModel::dismissDeleteAccount,
            onConfirm = ::deleteAccount,
        )
    }

    // 동의 화면이 떠 있는 동안에는 그리지 않는다 — 위 트리거가 막지만, 다른 경로로 요청이
    // 세워졌을 때도 약관 화면 위에 권한 모달이 겹치는 일은 없어야 한다.
    viewModel.permissionGateRequest?.takeIf { viewModel.consentChecked && !viewModel.needsConsent }?.let { target ->
        PermissionGateDialog(
            target = target,
            onDismiss = {
                // 사용자가 모달을 닫으면 취소 — 대기 중인 알람 추가도 비워 편집 페이지로 넘어가지 않게 한다.
                pendingCreateAlarmAfterPermission = null
                viewModel.dismissPermissionGate()
            },
            onOpenSettings = {
                // '허용하기': 실제 권한 요청을 실행한다(런타임 권한이면 시스템 다이얼로그,
                // 정확 알람·전체화면이면 설정 화면, 영구거부면 런처 콜백이 앱 설정으로 유도).
                // 모달은 닫지 않는다 — 권한이 채워지면 아래 LaunchedEffect 가 다음 미허용 권한으로
                // 넘기거나 모두 충족 시 자동으로 닫는다(권한 없으면 계속 막힘).
                requestPermission(target)
            },
        )
    }

    if (viewModel.showWelcomePromo) {
        WelcomePromoDialog(
            busy = billingBusy,
            onSubmitCode = { code ->
                viewModel.registerCode(code)
                viewModel.dismissWelcomePromo()
            },
            onDismiss = viewModel::dismissWelcomePromo,
            onOpenInstagram = {
                // 코드를 어디서 받는지 알려주는 자리. 앱 안에 코드를 박아 두지 않는다
                // (레포가 공개라 실코드가 소스에 들어가면 안 된다).
                viewModel.message = context.getString(R.string.welcome_promo_instagram_hint)
                context.openWebUrl("https://instagram.com/alarmtalk.app")
            },
        )
    }

    // 목소리 등록을 누른 순간에만 뜨는 음성 처리 동의. 가입 게이트에는 이 항목이 없다.
    if (viewModel.showVoiceConsentSheet) {
        VoiceConsentSheet(
            busy = authBusy,
            onAgree = viewModel::submitVoiceConsents,
            onDismiss = { viewModel.pendingVoiceConsentDrafts = null },
        )
    }

    planGateDialog?.let { gate ->
        PlanGateDialog(
            title = gate.title ?: stringResource(R.string.r3dlg_plan_gate_title),
            message = gate.message,
            confirmLabel = gate.confirmLabel ?: stringResource(R.string.r3app_plan_gate_confirm),
            onConfirm = {
                planGateDialog = null
                navController.navigateTopLevelTab(NativeTab.Billing)
            },
            onDismiss = { planGateDialog = null },
            onRedeemCode = viewModel::registerCode,
            redeemBusy = viewModel.socialBusy,
        )
    }

    viewModel.duplicateAlarmPrompt?.let { prompt ->
        DuplicateAlarmDialog(
            timeLabel = "%02d:%02d".format(prompt.hour, prompt.minute),
            onConfirm = prompt.onConfirmReplace,
            onDismiss = viewModel::dismissDuplicateAlarmPrompt,
        )
    }

    if (alarmTargetSheetVisible) {
        WakerSelectionSheet(
            title = stringResource(R.string.alarms_target_sheet_title),
            onDismiss = { alarmTargetSheetVisible = false },
        ) { dismiss ->
            WakerSheetOptionGroup {
                // 아이콘 배지 없이 텍스트만 — 제목이 이미 대상을 다 말해주고, 같은 사람 아이콘이 행마다
                // 반복되면 장식일 뿐이다(기본 아이콘 남용 금지). 다른 선택 시트(테마/국가/목소리)와 동일 문법.
                WakerSheetOptionRow(
                    title = stringResource(R.string.alarms_target_self_title),
                    selected = false,
                    onClick = {
                        dismiss()
                        startCreateAlarm(familyTargetMode = false)
                    },
                    divider = alarmTargetRecipients.isNotEmpty(),
                )
                // 가족 알람: 대상을 사람별로 바로 고른다. 각 행에 그 사람의 '받지 않는 시간'을 함께 보여줘
                // 자동선택으로 엉뚱한 사람에게 알람이 가는 일을 막는다.
                alarmTargetRecipients.forEachIndexed { index, recipient ->
                    WakerSheetOptionRow(
                        title = familyMemberLabel(context, recipient),
                        description = stringResource(
                            R.string.editor_quiet_hours_label,
                            familyAlarmQuietScheduleLabel(context, recipient),
                        ),
                        selected = false,
                        onClick = {
                            dismiss()
                            startCreateAlarm(familyTargetMode = true, targetUserId = recipient.userId)
                        },
                        divider = index != alarmTargetRecipients.lastIndex,
                    )
                }
            }
        }
    }

    // 하단바·FAB 등 앱 크롬 노출 조건(로그인·동의 완료, 업데이트 강제/삭제 대기 아님).
    // 온보딩 목소리 고르기 중에는 하단 탭·알람 추가 FAB 를 감춘다 — 선택을 끝내기 전에
    // 다른 화면으로 샐 수 있는 출구를 두지 않는다.
    // 알람 다중 선택(길게 누르기) 중인지 — 이때는 ＋ FAB 를 감춘다.
    var alarmSelectionActive by remember { mutableStateOf(false) }
    val showAppChrome = authSession != null && viewModel.consentChecked && !viewModel.needsConsent &&
        !viewModel.updateRequired && !viewModel.pendingDeletion && !viewModel.showVoiceSetup && currentTab != null

    Scaffold(
        bottomBar = {
            // 편집기 등 풀스크린 목적지로 갈 때 하단바가 '먼저 툭' 사라지는 하드컷 대신,
            // 페이지 슬라이드와 같은 박자로 아래로 미끄러져 하나의 페이지 이동으로 읽히게 한다.
            AnimatedVisibility(
                visible = showAppChrome,
                enter = slideInVertically(
                    initialOffsetY = { it },
                    animationSpec = tween(220),
                ) + fadeIn(animationSpec = tween(220)),
                exit = slideOutVertically(
                    targetOffsetY = { it },
                    animationSpec = tween(220),
                ) + fadeOut(animationSpec = tween(220)),
            ) {
                AlarmTalkBottomBar(
                    selectedTab = selectedTab,
                    unreadAlarmCount = if (selectedTab == NativeTab.Alarms) 0 else unreadAlarmCount,
                    onSelectTab = ::navigateToTab,
                )
            }
        },
        floatingActionButton = {
            // 빈 상태↔리스트 전환 때 하드컷 대신 스케일+페이드. scale 0 에서 시작하지 않고
            // (무에서 튀어나오는 느낌 방지) 퇴장은 진입보다 빠르게 끊는다.
            AnimatedVisibility(
                // 선택 모드에선 숨긴다 — 지우려고 고르는 중에 '추가'가 같이 떠 있으면
                // 오른쪽 아래에서 손가락이 노리는 게 뭔지 애매해진다.
                visible = showAppChrome && selectedTab == NativeTab.Alarms &&
                    alarms.isNotEmpty() && !alarmSelectionActive,
                enter = scaleIn(initialScale = 0.85f) + fadeIn(),
                exit = scaleOut(targetScale = 0.85f, animationSpec = tween(120)) +
                    fadeOut(animationSpec = tween(120)),
            ) {
                FloatingActionButton(
                    onClick = ::requestCreateAlarm,
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                    shape = CircleShape,
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Add,
                        contentDescription = stringResource(R.string.r3app_bottom_create_alarm_desc),
                    )
                }
            }
        },
    ) { padding ->
      if (viewModel.updateRequired) {
          UpdateRequiredScreen(
              contentPadding = padding,
              onUpdate = {
                  val url = viewModel.updateStoreUrl.ifBlank {
                      "https://play.google.com/store/apps/details?id=com.alarmtalk.app"
                  }
                  context.openWebUrl(url)
              },
          )
          return@Scaffold
      }
      if (authSession == null) {
          when (val route = authRoute) {
              AuthRoute.Landing -> LandingScreen(
                  contentPadding = padding,
                  onStart = { authNavigate(AuthRoute.Auth(AuthMode.Login)) },
              )
              AuthRoute.ResetPassword -> PasswordResetScreen(
                  contentPadding = padding,
                  busy = authBusy,
                  codeSentTo = viewModel.passwordResetCodeSentTo,
                  onBack = { authBack() },
                  onRequestCode = viewModel::requestPasswordReset,
                  onConfirm = { resetEmail, resetCode, newPassword ->
                      viewModel.confirmPasswordReset(resetEmail, resetCode, newPassword) { authBack() }
                  },
              )
              is AuthRoute.Auth -> AuthScreen(
                  contentPadding = padding,
                  mode = route.mode,
                  busy = authBusy,
                  emailVerificationSentTo = viewModel.registerEmailVerificationSentTo,
                  emailVerified = viewModel.registerEmailVerified,
                  loginError = viewModel.loginError,
                  registerError = viewModel.registerError,
                  authNotice = viewModel.authNotice,
                  onClearLoginError = {
                      viewModel.loginError = null
                      viewModel.registerError = null
                      viewModel.authNotice = null
                  },
                  onBack = { authBack() },
                  onLogin = viewModel::login,
                  onRegister = viewModel::register,
                  onRequestEmailVerification = viewModel::requestEmailVerification,
                  onConfirmEmailVerification = viewModel::confirmEmailVerification,
                  onSwitchMode = {
                      val nextMode = if (route.mode == AuthMode.Login) AuthMode.Register else AuthMode.Login
                      authNavigate(AuthRoute.Auth(nextMode))
                  },
                  onGoogleSignIn = ::launchGoogleSignIn,
                  onFindPassword = { authNavigate(AuthRoute.ResetPassword) },
              )
          }
          return@Scaffold
      }
      if (viewModel.pendingDeletion) {
          AccountPendingDeletionScreen(
              contentPadding = padding,
              busy = authBusy,
              onRecover = viewModel::cancelAccountDeletion,
              onLogout = ::logout,
          )
          return@Scaffold
      }
      // 동의 확인이 끝나기 전엔 온보딩·홈을 띄우지 않고 로딩으로 잡아둬, 동의가 필요한
      // 사용자에게 다른 화면이 먼저 깜빡였다가 동의 화면이 끼어드는 일을 막는다.
      if (!viewModel.consentChecked) {
          ConsentCheckLoadingScreen(contentPadding = padding)
          return@Scaffold
      }
      if (viewModel.needsConsent) {
          ConsentScreen(
              contentPadding = padding,
              busy = authBusy,
              collect = viewModel.consentCollect,
              isReconsent = viewModel.consentIsReconsent,
              onAgree = { marketingAgreed -> viewModel.submitConsents(marketingAgreed) },
              onOpenTerms = { context.openWebUrl("https://alarm-talk.com/ko/terms") },
              onOpenPrivacy = { context.openWebUrl("https://alarm-talk.com/ko/privacy") },
          )
          return@Scaffold
      }
      // 첫 로그인 "목소리 고르기" — 기본 목소리 4개를 다 펼치는 대신 1개를 미리듣고 고른다.
      if (viewModel.showVoiceSetup) {
          // 다운로드는 WorkManager 가 하므로 화면은 진행 상황만 구독한다 — 나가도 이어진다.
          // observe() 가 유니크 작업 이력에서 '지금 볼 것' 하나를 이미 골라 준다
          // (재시도가 도는 동안 끝난 옛 FAILED 를 붙잡지 않도록).
          val prefetchInfo by com.alarmtalk.app.sync.StockClipPrefetchWorker
              .observe(context)
              .collectAsState(initial = null)
          val prefetchDone = prefetchInfo?.progress
              ?.getInt(com.alarmtalk.app.sync.StockClipPrefetchWorker.KEY_DONE, 0) ?: 0
          val prefetchTotal = prefetchInfo?.progress
              ?.getInt(com.alarmtalk.app.sync.StockClipPrefetchWorker.KEY_TOTAL, 0) ?: 0
          // 성공하면 화면을 닫는다. 실패(FAILED)만 재시도를 노출한다 — 재시도 대기(ENQUEUED)는
          // 워커가 알아서 하므로 사용자에게 실패로 보이면 안 된다.
          // 단 '성공'만으로 닫지 않는다: 워커는 받을 게 없거나 세션이 없으면 한 개도 받지
          // 않고 성공을 내므로, 실제로 파일이 생겼는지 다시 확인한다.
          LaunchedEffect(prefetchInfo?.state) {
              if (prefetchInfo?.state == androidx.work.WorkInfo.State.SUCCEEDED) {
                  viewModel.completeVoiceSetupIfDownloaded()
              }
          }
          VoiceOnboardingScreen(
              contentPadding = padding,
              done = prefetchDone,
              total = prefetchTotal,
              failed = prefetchInfo?.state == androidx.work.WorkInfo.State.FAILED,
              onRetry = { com.alarmtalk.app.sync.StockClipPrefetchWorker.enqueue(context) },
              onSkip = viewModel::skipVoiceSetup,
          )
          return@Scaffold
      }
      // 목소리 선택 후에는 홈(알람 탭)으로 바로 들어간다 — 첫 알람 에디터 자동 진입/코치마크 없앰.
      Box(modifier = Modifier.fillMaxSize()) {
          NavHost(
              navController = navController,
              startDestination = NativeTab.Alarms.route,
              modifier = Modifier.fillMaxSize(),
          ) {
              NativeTab.values().forEach { tab ->
                  composable(tab.route) {
                      AlarmListScreen(
                          contentPadding = padding,
                          onAlarmSelectionModeChange = { alarmSelectionActive = it },
                          selectedTab = tab,
                          onSelectTab = ::navigateToTab,
                          alarms = alarms,
                          alarmsLoaded = viewModel.alarmsLoaded,
                          authSession = authSession,
                          voiceProfiles = voiceProfiles,
                          pendingVoiceDraft = pendingVoiceDraft,
                          voiceProfileBusy = voiceProfileBusy,
                          socialBusy = socialBusy,
                          familyGroup = familyGroup,
                          familyVoices = familyVoices,
                          billingBusy = billingBusy,
                          subscriptionResponse = subscriptionResponse,
                          // 삭제 경고('지금 지우면 이번 달엔 못 만들어요')는 초안 시도 쿼터가 아니라
                          // 정식 등록 쿼터로 판정해야 한다. 초안 쿼터의 remaining 은 제한 해제 후
                          // 호환용으로 0 고정이라, 그대로 쓰면 이번 달 등록이 남아 있어도 경고가 뜬다.
                          voiceDraftQuotaExhausted =
                              viewModel.voiceDraftQuota?.let { it.registrationRemaining <= 0 } == true,
                          voiceDraftQuota = viewModel.voiceDraftQuota,
                          vouchers = vouchers,
                          onCreateVoiceProfile = viewModel::createVoiceProfile,
                          onCreateVoiceProfiles = viewModel::createVoiceProfiles,
                          onGenerateTts = viewModel::generateTtsAudio,
                          stockClips = viewModel.stockClips,
                          onDownloadStockAudio = { messageId -> viewModel.downloadTtsMessageAudio(messageId) },
                          onRenameVoiceProfile = viewModel::renameVoiceProfile,
                          onShareVoiceProfile = viewModel::setVoiceProfileShared,
                          onDeleteVoiceProfile = viewModel::deleteVoiceProfile,
                          onConfirmVoicePreviewPlayed = viewModel::confirmVoicePreviewPlayed,
                          onUpdateVoicePreviewText = viewModel::updateVoicePreviewText,
                          onPromoteVoiceDraft = viewModel::promoteVoiceDraft,
                          onDeleteVoiceDraft = viewModel::deleteVoiceDraft,
                          lastUsedVoiceId = viewModel.lastUsedVoiceId,
                          voicePrefetchProgress = viewModel.voicePrefetchProgress,
                          onGetVoicePrerenderStatus = viewModel::fetchVoicePrerenderStatus,
                          onRetryVoicePrerender = viewModel::retryVoicePrerender,
                          prerenderDrive = viewModel.prerenderDrive,
                          onStartPrerenderDrive = viewModel::startPrerenderDrive,
                          onRetryVoiceSpeechStyle = viewModel::retryVoiceSpeechStyleAnalysis,
                          onReloadStockClips = { viewModel.loadStockClips(forceReload = true) },
                          onRefreshSocial = viewModel::refreshSocial,
                          onLeaveFamilyGroup = viewModel::leaveFamilyGroup,
                          onRegisterCode = viewModel::registerCode,
                          onEnsureFamilyShareCode = viewModel::ensureFamilyShareCode,
                          onCheckoutPlan = viewModel::checkoutPlan,
                          planPrices = viewModel.billingPlanPrices,
                          onPurchasePlay = viewModel::startPlayPurchase,
                          onCancelSubscription = viewModel::cancelSubscription,
                          onChangePlan = viewModel::changePlan,
                          onRefreshShareCodeData = viewModel::refreshShareCodeData,
                          permissions = permissions,
                          onCreateAlarm = ::requestCreateAlarm,
                          onOpenSettings = { navController.navigate(AppRoute.Settings) },
                          onOpenMemberManagement = { navController.navigate(AppRoute.MemberManagement) },
                          onDeleteAccount = viewModel::requestDeleteAccount,
                          themeMode = themeMode,
                          onChangeTheme = viewModel::setThemeMode,
                          onToggleEnabled = { id, enabled ->
                              if (enabled && !permissions.alarmReady) {
                                  requestFirstMissingAlarmPermission()
                              } else {
                                  viewModel.setAlarmEnabled(id, enabled)
                              }
                          },
                          onEditAlarm = { navController.navigate(AppRoute.alarmEdit(it.id)) },
                          onDeleteAlarm = viewModel::deleteAlarm,
                          onRequestAlarmPermissions = ::requestFirstMissingAlarmPermission,
                      )
                  }
              }
              composable(
                  route = AppRoute.AlarmCreate,
                  arguments = listOf(
                      navArgument(AppRoute.FamilyTargetModeArg) { type = NavType.BoolType },
                      navArgument(AppRoute.TargetUserIdArg) {
                          type = NavType.StringType
                          nullable = true
                          defaultValue = null
                      },
                  ),
                  // 편집기는 우측에서 페이지가 밀고 들어오는 표준 push 전환 — 하단바 슬라이드(220ms)와
                  // 같은 박자로 묶어 '크롬 사라짐 → 화면 전환' 두 박자가 아니라 한 번의 이동으로 보이게.
                  enterTransition = { slideInHorizontally(animationSpec = tween(220)) { it } },
                  popExitTransition = { slideOutHorizontally(animationSpec = tween(220)) { it } },
              ) { entry ->
                  val familyTargetMode = entry.arguments?.getBoolean(AppRoute.FamilyTargetModeArg) ?: false
                  val targetUserId = entry.arguments?.getString(AppRoute.TargetUserIdArg)
                  AlarmEditorScreen(
                      contentPadding = padding,
                      onRegisterCode = viewModel::registerCode,
                      redeemBusy = viewModel.socialBusy,
                      alarm = null,
                      authSession = authSession,
                      subscriptionResponse = subscriptionResponse,
                      familyGroup = familyGroup,
                      familyAlarmMode = familyTargetMode,
                      initialFamilyRecipientId = targetUserId,
                      voiceProfiles = voiceProfiles,
                      familyVoices = familyVoices,
                      voiceProfileBusy = voiceProfileBusy,
                      stockClips = viewModel.stockClips,
                      lastUsedVoiceId = viewModel.lastUsedVoiceId,
                      onCancel = ::goBackInApp,
                      onOpenBilling = { navController.navigateTopLevelTab(NativeTab.Billing) },
                      onCreateVoiceProfile = { navController.navigateTopLevelTab(NativeTab.Voices) },
                      onGenerateTts = viewModel::generateTtsAudio,
                      onLoadManualQuota = viewModel::loadManualQuota,
                      onDownloadStockAudio = { messageId -> viewModel.downloadTtsMessageAudio(messageId) },
                      onPrefetchRestrictedVoiceClips = viewModel::prefetchFreeBucketClips,
                      onUpdateDynamicPromptSettings = viewModel::updateDynamicPromptSettings,
                      onSave = { draft ->
                          if (!permissions.alarmReady) {
                              requestFirstMissingAlarmPermission()
                          } else {
                              viewModel.createAlarm(draft) { navController.popBackStackOrHome() }
                          }
                      },
                  )
              }
              composable(
                  route = AppRoute.AlarmEdit,
                  arguments = listOf(navArgument(AppRoute.AlarmIdArg) { type = NavType.StringType }),
                  // AlarmCreate 와 동일한 push 전환(하단바 슬라이드와 동박자).
                  enterTransition = { slideInHorizontally(animationSpec = tween(220)) { it } },
                  popExitTransition = { slideOutHorizontally(animationSpec = tween(220)) { it } },
              ) { entry ->
                  val alarmId = entry.arguments?.getString(AppRoute.AlarmIdArg)
                  val currentAlarm = alarms.firstOrNull { it.id == alarmId }
                  if (currentAlarm == null) {
                      LaunchedEffect(alarmId) {
                          navController.popBackStackOrHome()
                      }
                  } else {
                      AlarmEditorScreen(
                          contentPadding = padding,
                          onRegisterCode = viewModel::registerCode,
                          redeemBusy = viewModel.socialBusy,
                          alarm = currentAlarm,
                          authSession = authSession,
                          subscriptionResponse = subscriptionResponse,
                          familyGroup = familyGroup,
                          familyAlarmMode = false,
                          voiceProfiles = voiceProfiles,
                          familyVoices = familyVoices,
                          voiceProfileBusy = voiceProfileBusy,
                          stockClips = viewModel.stockClips,
                          lastUsedVoiceId = viewModel.lastUsedVoiceId,
                          onCancel = ::goBackInApp,
                          onOpenBilling = { navController.navigateTopLevelTab(NativeTab.Billing) },
                          onCreateVoiceProfile = { navController.navigateTopLevelTab(NativeTab.Voices) },
                          onGenerateTts = viewModel::generateTtsAudio,
                          onLoadManualQuota = viewModel::loadManualQuota,
                          onDownloadStockAudio = { messageId -> viewModel.downloadTtsMessageAudio(messageId) },
                          onPrefetchRestrictedVoiceClips = viewModel::prefetchFreeBucketClips,
                          onUpdateDynamicPromptSettings = viewModel::updateDynamicPromptSettings,
                          onSave = { draft ->
                              if (!permissions.alarmReady) {
                                  requestFirstMissingAlarmPermission()
                              } else {
                                  viewModel.updateAlarm(currentAlarm.id, draft) {
                                      navController.popBackStackOrHome()
                                  }
                              }
                          },
                      )
                  }
              }
              composable(AppRoute.Settings) {
                  SettingsScreen(
                      contentPadding = padding,
                      authSession = authSession,
                      onBack = ::goBackInApp,
                      onEditNickname = viewModel::requestEditNickname,
                      onUpdateDynamicPromptSettings = viewModel::updateDynamicPromptSettings,
                      onOpenConsentHistory = { navController.navigate(AppRoute.ConsentHistory) },
                      onOpenOssLicenses = { navController.navigate(AppRoute.OssLicenses) },
                      onLogout = ::logout,
                  )
              }
              composable(AppRoute.OssLicenses) {
                  OssLicensesScreen(
                      contentPadding = padding,
                      onBack = ::goBackInApp,
                  )
              }
              composable(AppRoute.ConsentHistory) {
                  ConsentHistoryScreen(
                      contentPadding = padding,
                      onBack = ::goBackInApp,
                      onLoadConsents = { viewModel.loadConsentRecords() },
                      onOpenTerms = { navController.navigate(AppRoute.legalDoc("terms")) },
                      onOpenPrivacy = { navController.navigate(AppRoute.legalDoc("privacy")) },
                      marketingConsentAgreed = viewModel.marketingConsentAgreed,
                      marketingConsentBusy = viewModel.marketingConsentWriteInFlight,
                      marketingConsentLoadFailed = viewModel.marketingConsentLoadFailed,
                      onLoadMarketingConsent = viewModel::loadMarketingConsent,
                      onChangeMarketingConsent = viewModel::updateMarketingConsent,
                  )
              }
              composable(AppRoute.LegalDoc) { entry ->
                  val docType = entry.arguments?.getString(AppRoute.LegalDocTypeArg) ?: "terms"
                  LegalDocumentScreen(
                      contentPadding = padding,
                      title = if (docType == "privacy") {
                          stringResource(R.string.hs_settings_privacy_policy)
                      } else {
                          stringResource(R.string.hs_settings_terms_of_service)
                      },
                      url = if (docType == "privacy") {
                          "https://alarm-talk.com/ko/privacy"
                      } else {
                          "https://alarm-talk.com/ko/terms"
                      },
                      onBack = ::goBackInApp,
                  )
              }
              composable(AppRoute.MemberManagement) {
                  MemberManagementScreen(
                      contentPadding = padding,
                      familyGroup = familyGroup,
                      subscriptionResponse = subscriptionResponse,
                      vouchers = vouchers,
                      authSession = authSession,
                      currentUserId = authSession?.user?.id,
                      socialBusy = socialBusy,
                      billingBusy = billingBusy,
                      onBack = ::goBackInApp,
                      onRemoveFamilyMember = viewModel::removeFamilyMember,
                      onEnsureFamilyShareCode = viewModel::ensureFamilyShareCode,
                      onRegenerateFamilyShareCode = viewModel::regenerateFamilyShareCode,
                      onChangeFamilyAlarmSettings = viewModel::updateFamilyAlarmSettings,
                  )
              }
          }
          SnackbarHost(
              hostState = snackbarHostState,
              modifier = Modifier
                  .align(Alignment.TopCenter)
                  .padding(top = padding.calculateTopPadding() + 8.dp),
          ) { data ->
              // actionLabel 을 함께 렌더링해야 FLEXIBLE 업데이트 '재시작' 등
              // 액션 대기(showSnackbar → ActionPerformed) 스낵바가 동작한다.
              PrettySnackbar(
                  message = data.visuals.message,
                  actionLabel = data.visuals.actionLabel,
                  onAction = { data.performAction() },
              )
          }
          // 서버가 Play 구독을 직접 해지하지 못한 경우(PLAY_CANCEL_FAILED 등) —
          // 어느 화면에 있든 Google Play 구독 관리로 보내는 안내 다이얼로그를 띄운다.
          viewModel.billingPlayManageUrl?.let { manageUrl ->
              PlayStoreManageDialog(
                  manageUrl = manageUrl,
                  onDismiss = { viewModel.billingPlayManageUrl = null },
              )
          }
      }
    }
}

