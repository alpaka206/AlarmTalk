package com.alarmtalk.app

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
import com.alarmtalk.app.data.CharacterEventStates
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
    val characterEvents by viewModel.characterEvents.collectAsStateWithLifecycle()
    val characterBusy = viewModel.characterBusy
    val characterResponse = viewModel.characterResponse
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
    var authRoute by remember { mutableStateOf<AuthRoute>(AuthRoute.Landing) }
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
    val pendingCharacterEventCount = remember(characterEvents) {
        characterEvents.count { it.state == CharacterEventStates.PENDING }
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
        viewModel.message = alarmPermissionRequiredMessage(target)
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
        enabled = authSession != null && !viewModel.showOnboarding,
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
        authRoute = AuthRoute.Landing
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
            viewModel.preloadCharacterAndBilling()
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

    // 목소리 탭은 무료 플랜에도 연다 — 시스템 스톡 보이스(미리듣기·알람 사용)는 무료,
    // "내 목소리 만들기"만 탭 안에서 플랜 게이트를 거친다.
    LaunchedEffect(authSession?.token, pendingCharacterEventCount, characterBusy) {
        if (authSession != null && pendingCharacterEventCount > 0 && !characterBusy) {
            viewModel.syncPendingCharacterEventsSilently()
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
                viewModel.refreshCharacterAndBilling()
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
                viewModel.refreshCharacterAndBilling()
            }
            NativeTab.Messages -> {
                viewModel.refreshSocial()
                viewModel.refreshNotes()
            }
            NativeTab.Growth,
            NativeTab.Billing -> viewModel.refreshCharacterAndBilling()
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
                viewModel.showGoogleSignInFailed(googleSignInErrorMessage(error.statusCode))
            } else {
                Log.e(TAG, "Google sign-in failed resultCode=${result.resultCode}", error)
                viewModel.showGoogleSignInFailed(userFacingError(error, "Google 로그인에 실패했어요"))
            }
        }.getOrNull()
        if (account == null) return@rememberLauncherForActivityResult

        val idToken = account?.idToken
        if (idToken.isNullOrBlank()) {
            viewModel.showGoogleSignInFailed("Google 로그인 정보를 받지 못했어요. 다시 시도해 주세요.")
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
                message = "메시지는 커플/가족 이용권에서 사용할 수 있어요.",
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
        BackHandler(enabled = authRoute !is AuthRoute.Landing) {
            authRoute = AuthRoute.Landing
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
            message = gate.message,
            confirmLabel = gate.confirmLabel,
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
            if (authSession != null && !viewModel.showOnboarding && !viewModel.updateRequired &&
                !viewModel.pendingDeletion && currentTab != null
            ) {
                AlarmTalkBottomBar(
                    selectedTab = selectedTab,
                    unreadAlarmCount = if (selectedTab == NativeTab.Alarms) 0 else unreadAlarmCount,
                    unreadMessageCount = receivedNotes.count { it.readAt.isNullOrBlank() },
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
                  busy = authBusy,
                  onGoToLogin = { authRoute = AuthRoute.Auth(AuthMode.Login) },
                  onGoToRegister = { authRoute = AuthRoute.Auth(AuthMode.Register) },
                  onGoogleSignIn = ::launchGoogleSignIn,
              )
              is AuthRoute.Auth -> AuthScreen(
                  contentPadding = padding,
                  mode = route.mode,
                  busy = authBusy,
                  emailVerificationSentTo = viewModel.registerEmailVerificationSentTo,
                  emailVerified = viewModel.registerEmailVerified,
                  onBack = { authRoute = AuthRoute.Landing },
                  onLogin = viewModel::login,
                  onRegister = viewModel::register,
                  onRequestEmailVerification = viewModel::requestEmailVerification,
                  onConfirmEmailVerification = viewModel::confirmEmailVerification,
                  onSwitchMode = {
                      val nextMode = if (route.mode == AuthMode.Login) AuthMode.Register else AuthMode.Login
                      authRoute = AuthRoute.Auth(nextMode)
                  },
                  onGoogleSignIn = ::launchGoogleSignIn,
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
                          characterEvents = characterEvents,
                          characterBusy = characterBusy,
                          characterResponse = characterResponse,
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
                          onRefreshSocial = viewModel::refreshSocial,
                          onLeaveFamilyGroup = viewModel::leaveFamilyGroup,
                          onRefreshCharacterBilling = viewModel::refreshCharacterAndBilling,
                          onSyncCharacterEvents = viewModel::syncCharacterEvents,
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
                      onBack = ::goBackInApp,
                      onChangeTheme = viewModel::setThemeMode,
                      onEditNickname = viewModel::requestEditNickname,
                      onUpdateDynamicPromptSettings = viewModel::updateDynamicPromptSettings,
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

