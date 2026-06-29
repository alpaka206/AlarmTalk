package com.alarmtalk.app

import androidx.compose.ui.res.stringResource
import android.Manifest
import android.util.Log
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.People
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
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
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.data.AlarmOrigins
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.common.api.ApiException

@Composable
internal fun AlarmTalkApp(viewModel: MainViewModel = viewModel()) {
    val context = LocalContext.current
    val alarms by viewModel.alarms.collectAsStateWithLifecycle()
    val message = viewModel.message
    val authSession = viewModel.authSession
    val authBusy = viewModel.authBusy
    val syncBusy = viewModel.syncBusy
    val voiceProfiles = viewModel.voiceProfiles
    val voiceProfileBusy = viewModel.voiceProfileBusy
    val socialBusy = viewModel.socialBusy
    val familyGroup = viewModel.familyGroup
    val familyVoices = viewModel.familyVoices
    val billingBusy = viewModel.billingBusy
    val subscriptionResponse = viewModel.subscriptionResponse
    val vouchers = viewModel.vouchers
    val noteBusy = viewModel.noteBusy
    val receivedNotes = viewModel.receivedNotes
    val navController = rememberNavController()
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentTab = navBackStackEntry?.destination?.route.toNativeTab()
    val selectedTab = currentTab ?: NativeTab.Home
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
    // 읽지 않은 메시지 수도 receivedNotes 가 바뀔 때만 계산(매 리컴포지션 재계산 방지).
    val unreadMessageCount = remember(receivedNotes) {
        receivedNotes.count { it.readAt.isNullOrBlank() }
    }
    val permissionState = rememberPermissionStatusState()
    val permissions = permissionState.snapshot
    var bulkPermissionFlowActive by remember { mutableStateOf(false) }
    var bulkRuntimeRequested by remember { mutableStateOf(false) }
    var bulkOpenedSettingsTargets by remember { mutableStateOf<Set<PermissionTarget>>(emptySet()) }
    val runtimePermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestMultiplePermissions(),
    ) {
        permissionState.refresh()
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
        val target = PermissionSnapshot.read(context).firstMissingAlarmTarget() ?: return
        viewModel.message = alarmPermissionRequiredMessage(context, target)
        requestPermission(target)
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

    LaunchedEffect(Unit) {
        viewModel.checkAppVersion()
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

    LoginPermissionGate(
        authSession = authSession,
        enabled = authSession != null && viewModel.consentChecked && !viewModel.needsConsent &&
            !viewModel.showOnboarding && !viewModel.showVoiceSetup,
        permissions = permissions,
        onRequestPermission = ::requestPermission,
        onRequestAllPermissions = ::requestAllMissingPermissions,
    )

    LaunchedEffect(sessionRouteKey) {
        if (sessionRouteKey != null) {
            navController.navigateHomeClearingStack()
        }
        viewModel.loadReceivedAlarmBadgeState()
        planGateDialog = null
        authResetToLanding()
    }

    LaunchedEffect(sessionRouteKey, alarms) {
        if (sessionRouteKey != null) {
            viewModel.ensureReceivedAlarmBadgeBaseline(alarms)
        }
    }

    LaunchedEffect(authSession?.token) {
        if (authSession != null) {
            viewModel.checkOnboardingFor(authSession.user.id)
            viewModel.checkAccountStatus()
            viewModel.checkConsentStatus()
            viewModel.preloadVoiceProfiles()
            viewModel.loadStockClips()
            viewModel.preloadSocial()
            viewModel.preloadBilling()
            viewModel.preloadNotes()
        }
    }

    LaunchedEffect(
        authSession?.user?.id,
        subscriptionResponse?.subscription?.id,
        subscriptionResponse?.subscription?.status,
        subscriptionResponse?.plan?.key,
        subscriptionResponse?.plan?.planType,
    ) {
        if (authSession != null && subscriptionResponse != null && !hasPaidVoiceAccess(subscriptionResponse)) {
            viewModel.applyFreePlanVoiceLock()
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
            NativeTab.Home -> {
                viewModel.refreshBilling()
                viewModel.refreshSocial()
            }
            NativeTab.Voices -> {
                viewModel.preloadVoiceProfiles()
                viewModel.loadStockClips()
                viewModel.preloadSocial()
            }
            NativeTab.Alarms -> viewModel.syncNow()
            NativeTab.People -> {
                viewModel.refreshSocial()
                viewModel.refreshBilling()
            }
            NativeTab.Messages -> {
                viewModel.refreshSocial()
                viewModel.refreshNotes()
            }
            NativeTab.Billing -> viewModel.refreshBilling()
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
                Log.e(
                    TAG,
                    "Google sign-in failed resultCode=${result.resultCode} statusCode=${error.statusCode}",
                    error,
                )
                viewModel.showGoogleSignInFailed(googleSignInErrorMessage(context, error.statusCode))
            } else {
                Log.e(TAG, "Google sign-in failed resultCode=${result.resultCode}", error)
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
        if (
            tab == NativeTab.Messages &&
            authSession != null &&
            subscriptionResponse != null &&
            familyGroup != null &&
            !hasCoupleOrFamilyAccess(subscriptionResponse, familyGroup)
        ) {
            planGateDialog = PlanGateDialogState(
                title = context.getString(R.string.r3app_messages_plan_gate_title),
                message = context.getString(R.string.r3app_messages_plan_gate),
            )
            return
        }
        if (selectedTab == tab) return
        navController.navigateTopLevelTab(tab)
    }

    fun goBackInApp() {
        navController.popBackStackOrHome()
    }

    if (authSession == null) {
        BackHandler(enabled = authBackStack.size > 1) {
            authBack()
        }
    } else {
        BackHandler(
            enabled = currentTab != null && currentTab != NativeTab.Home,
            onBack = { navController.navigateTopLevelTab(NativeTab.Home) },
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

    viewModel.permissionGateRequest?.let { target ->
        PermissionGateDialog(
            target = target,
            onDismiss = viewModel::dismissPermissionGate,
            onOpenSettings = {
                requestPermission(target)
                viewModel.dismissPermissionGate()
            },
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
        )
    }

    viewModel.duplicateAlarmPrompt?.let { prompt ->
        DuplicateAlarmDialog(
            timeLabel = "%02d:%02d".format(prompt.hour, prompt.minute),
            existingLabel = prompt.existingLabel,
            onConfirm = prompt.onConfirmReplace,
            onDismiss = viewModel::dismissDuplicateAlarmPrompt,
        )
    }

    Scaffold(
        bottomBar = {
            if (authSession != null && viewModel.consentChecked && !viewModel.needsConsent &&
                !viewModel.showOnboarding && !viewModel.updateRequired &&
                !viewModel.pendingDeletion && currentTab != null
            ) {
                AlarmTalkBottomBar(
                    selectedTab = selectedTab,
                    unreadAlarmCount = if (selectedTab == NativeTab.Alarms) 0 else unreadAlarmCount,
                    unreadMessageCount = unreadMessageCount,
                    // 메시지는 커플/가족 전용 — 무료·개인 플랜은 잠금 표시.
                    messagesLocked = !hasCoupleOrFamilyAccess(subscriptionResponse, familyGroup),
                    onSelectTab = ::navigateToTab,
                )
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
                  onLogin = { authNavigate(AuthRoute.Auth(AuthMode.Login)) },
                  onRegister = { authNavigate(AuthRoute.Auth(AuthMode.Register)) },
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
              onAgree = { marketingAgreed -> viewModel.submitConsents(marketingAgreed) },
              onOpenTerms = { context.openWebUrl("https://alarm-talk.com/ko/terms") },
              onOpenPrivacy = { context.openWebUrl("https://alarm-talk.com/ko/privacy") },
          )
          return@Scaffold
      }
      if (viewModel.showOnboarding) {
          OnboardingScreen(
              contentPadding = padding,
              onComplete = viewModel::completeOnboarding,
          )
          return@Scaffold
      }
      // 온보딩 직후 "목소리 고르기" — 기본 목소리 4개를 다 펼치는 대신 1개를 미리듣고 고른다.
      if (viewModel.showVoiceSetup) {
          // 시스템 음성이 비어 있으면(무료 플랜 lock 등으로) 다시 받아와 빈 로딩 화면에 갇히지 않게 한다.
          LaunchedEffect(Unit) { viewModel.preloadVoiceProfiles() }
          VoiceOnboardingScreen(
              contentPadding = padding,
              systemVoices = viewModel.voiceProfiles.filter { it.isSystem == true },
              voiceProfileBusy = voiceProfileBusy,
              voiceProfileLoadFinished = viewModel.voiceProfileLoadFinished,
              stockClips = viewModel.stockClips,
              onDownloadStockAudio = { messageId -> viewModel.downloadTtsMessageAudio(messageId) },
              onChoose = { voiceId, listenerTitle -> viewModel.completeVoiceSetup(voiceId, listenerTitle) },
              onSkip = viewModel::skipVoiceSetup,
          )
          return@Scaffold
      }
      Box(modifier = Modifier.fillMaxSize()) {
          NavHost(
              navController = navController,
              startDestination = NativeTab.Home.route,
              modifier = Modifier.fillMaxSize(),
          ) {
              NativeTab.values().forEach { tab ->
                  composable(tab.route) {
                      AlarmListScreen(
                          contentPadding = padding,
                          selectedTab = tab,
                          onSelectTab = ::navigateToTab,
                          alarms = alarms,
                          authSession = authSession,
                          authBusy = authBusy,
                          syncBusy = syncBusy,
                          voiceProfiles = voiceProfiles,
                          voiceProfileBusy = voiceProfileBusy,
                          socialBusy = socialBusy,
                          familyGroup = familyGroup,
                          familyVoices = familyVoices,
                          billingBusy = billingBusy,
                          subscriptionResponse = subscriptionResponse,
                          vouchers = vouchers,
                          noteBusy = noteBusy,
                          receivedNotes = receivedNotes,
                          onLogin = viewModel::login,
                          onRegister = viewModel::register,
                          onGoogleSignIn = ::launchGoogleSignIn,
                          onSyncNow = viewModel::syncNow,
                          onLogout = ::logout,
                          onCreateVoiceProfile = viewModel::createVoiceProfile,
                          onCreateVoiceProfiles = viewModel::createVoiceProfiles,
                          onSeparateVoiceSpeakers = viewModel::separateVoiceSpeakers,
                          onCloneSpeakerDraft = viewModel::cloneSpeakerDraft,
                          onPromoteDraftVoice = { profileId ->
                              viewModel.promoteDraftVoice(profileId)
                              viewModel.loadVoiceProfiles()
                          },
                          onDeleteDraftVoice = viewModel::deleteDraftVoice,
                          onGenerateTts = viewModel::generateTtsAudio,
                          stockClips = viewModel.stockClips,
                          onDownloadStockAudio = { messageId -> viewModel.downloadTtsMessageAudio(messageId) },
                          onRenameVoiceProfile = viewModel::renameVoiceProfile,
                          onShareVoiceProfile = viewModel::setVoiceProfileShared,
                          onUpdateSharedVoiceInfo = { id, relationship, listener ->
                              viewModel.updateSharedVoiceViewerInfo(id, relationship, listener)
                          },
                          onDeleteVoiceProfile = viewModel::deleteVoiceProfile,
                          defaultVoiceId = viewModel.defaultVoiceId,
                          onSetDefaultVoice = viewModel::setDefaultVoice,
                          defaultListenerTitle = viewModel.defaultListenerTitle,
                          onSetListenerTitle = viewModel::setDefaultListenerTitle,
                          onRefreshSocial = viewModel::refreshSocial,
                          onLeaveFamilyGroup = viewModel::leaveFamilyGroup,
                          onRegisterCode = viewModel::registerCode,
                          onEnsureFamilyShareCode = viewModel::ensureFamilyShareCode,
                          onRefreshNotes = viewModel::refreshNotes,
                          onSendNote = viewModel::sendNote,
                          onSendTtsNote = viewModel::sendTtsNote,
                          onDownloadNoteAudio = viewModel::downloadNoteAudio,
                          onMarkNoteRead = viewModel::markNoteRead,
                          onCheckoutPlan = viewModel::checkoutPlan,
                          onPurchasePlay = viewModel::startPlayPurchase,
                          onCancelSubscription = viewModel::cancelSubscription,
                          onChangePlan = viewModel::changePlan,
                          onRefreshShareCodeData = viewModel::refreshShareCodeData,
                          permissions = permissions,
                          onCreateAlarm = {
                              if (!permissions.alarmReady) {
                                  requestFirstMissingAlarmPermission()
                              } else {
                                  navController.navigate(AppRoute.alarmCreate(familyTargetMode = false))
                              }
                          },
                          onCreateFamilyAlarm = {
                              if (!permissions.alarmReady) {
                                  requestFirstMissingAlarmPermission()
                              } else {
                                  navController.navigate(AppRoute.alarmCreate(familyTargetMode = true))
                              }
                          },
                          onToggleEnabled = { id, enabled ->
                              if (enabled && !permissions.alarmReady) {
                                  requestFirstMissingAlarmPermission()
                              } else {
                                  viewModel.setAlarmEnabled(id, enabled)
                              }
                          },
                          onEditAlarm = { navController.navigate(AppRoute.alarmEdit(it.id)) },
                          onDeleteAlarm = viewModel::deleteAlarm,
                          onRequestPermissionGate = ::requestPermission,
                          onRequestAllPermissions = ::requestAllMissingPermissions,
                          profileMenu = if (tab == NativeTab.Alarms) {
                              {
                                  ProfileMenu(
                                      hasSharedPass = hasSharedPass,
                                      onSelectTab = ::navigateToTab,
                                      onOpenSettings = { navController.navigate(AppRoute.Settings) },
                                      onOpenMemberManagement = { navController.navigate(AppRoute.MemberManagement) },
                                  )
                              }
                          } else {
                              null
                          },
                      )
                  }
              }
              composable(
                  route = AppRoute.AlarmCreate,
                  arguments = listOf(navArgument(AppRoute.FamilyTargetModeArg) { type = NavType.BoolType }),
              ) { entry ->
                  val familyTargetMode = entry.arguments?.getBoolean(AppRoute.FamilyTargetModeArg) ?: false
                  AlarmEditorScreen(
                      contentPadding = padding,
                      alarm = null,
                      authSession = authSession,
                      subscriptionResponse = subscriptionResponse,
                      familyGroup = familyGroup,
                      familyAlarmMode = familyTargetMode,
                      voiceProfiles = voiceProfiles,
                      familyVoices = familyVoices,
                      voiceProfileBusy = voiceProfileBusy,
                      stockClips = viewModel.stockClips,
                      defaultVoiceId = viewModel.defaultVoiceId,
                      defaultListenerTitle = viewModel.defaultListenerTitle,
                      onCancel = ::goBackInApp,
                      onOpenBilling = { navController.navigateTopLevelTab(NativeTab.Billing) },
                      onCreateVoiceProfile = { navController.navigateTopLevelTab(NativeTab.Voices) },
                      onGenerateTts = viewModel::generateTtsAudio,
                      onDownloadStockAudio = { messageId -> viewModel.downloadTtsMessageAudio(messageId) },
                      onUpdateDynamicPromptSettings = viewModel::updateDynamicPromptSettings,
                      onUpdateSharedVoiceInfo = { id, relationship, listener, onSuccess ->
                          viewModel.updateSharedVoiceViewerInfo(id, relationship, listener, onSuccess)
                      },
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
                          alarm = currentAlarm,
                          authSession = authSession,
                          subscriptionResponse = subscriptionResponse,
                          familyGroup = familyGroup,
                          familyAlarmMode = false,
                          voiceProfiles = voiceProfiles,
                          familyVoices = familyVoices,
                          voiceProfileBusy = voiceProfileBusy,
                          stockClips = viewModel.stockClips,
                          defaultVoiceId = viewModel.defaultVoiceId,
                          defaultListenerTitle = viewModel.defaultListenerTitle,
                          onCancel = ::goBackInApp,
                          onOpenBilling = { navController.navigateTopLevelTab(NativeTab.Billing) },
                          onCreateVoiceProfile = { navController.navigateTopLevelTab(NativeTab.Voices) },
                          onGenerateTts = viewModel::generateTtsAudio,
                          onDownloadStockAudio = { messageId -> viewModel.downloadTtsMessageAudio(messageId) },
                          onUpdateDynamicPromptSettings = viewModel::updateDynamicPromptSettings,
                          onUpdateSharedVoiceInfo = { id, relationship, listener, onSuccess ->
                              viewModel.updateSharedVoiceViewerInfo(id, relationship, listener, onSuccess)
                          },
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
                      themeMode = themeMode,
                      marketingConsentAgreed = viewModel.marketingConsentAgreed,
                      marketingConsentBusy = viewModel.marketingConsentWriteInFlight,
                      marketingConsentLoadFailed = viewModel.marketingConsentLoadFailed,
                      onBack = ::goBackInApp,
                      onChangeTheme = viewModel::setThemeMode,
                      onEditNickname = viewModel::requestEditNickname,
                      onUpdateDynamicPromptSettings = viewModel::updateDynamicPromptSettings,
                      onLoadMarketingConsent = viewModel::loadMarketingConsent,
                      onChangeMarketingConsent = viewModel::updateMarketingConsent,
                      onLogout = ::logout,
                      onDeleteAccount = viewModel::requestDeleteAccount,
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
          if (currentTab != null) {
              if (currentTab != NativeTab.Alarms) {
                  Box(
                      modifier = Modifier
                          .align(Alignment.TopEnd)
                          .padding(
                              top = padding.calculateTopPadding() + 24.dp,
                              end = 24.dp,
                          ),
                  ) {
                      ProfileMenu(
                          hasSharedPass = hasSharedPass,
                          onSelectTab = ::navigateToTab,
                          onOpenSettings = { navController.navigate(AppRoute.Settings) },
                          onOpenMemberManagement = { navController.navigate(AppRoute.MemberManagement) },
                      )
                  }
              }
          }
          SnackbarHost(
              hostState = snackbarHostState,
              modifier = Modifier
                  .align(Alignment.TopCenter)
                  .padding(top = padding.calculateTopPadding() + 8.dp),
          ) { data ->
              PrettySnackbar(message = data.visuals.message)
          }
      }
    }
}

