package com.voicealarm.nativeapp

import android.Manifest
import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Message
import androidx.compose.material.icons.outlined.People
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.voicealarm.nativeapp.core.VoiceAlarmLog.TAG
import com.voicealarm.nativeapp.data.CharacterEventStates
import com.voicealarm.nativeapp.data.AlarmOrigins
import com.voicealarm.nativeapp.network.AuthSession
import com.voicealarm.nativeapp.network.CharacterResponse
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.tasks.Task
import java.util.concurrent.CancellationException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

@Composable
internal fun VoiceAlarmApp(viewModel: MainViewModel = viewModel()) {
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
    val isPlanOwner = familyGroup?.role == "owner" &&
        familyGroup.group != null &&
        subscriptionResponse?.plan?.planType == "family"
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
            viewModel.preloadVoiceProfiles()
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

    LaunchedEffect(
        currentTab,
        authSession?.user?.id,
        subscriptionResponse?.subscription?.id,
        subscriptionResponse?.subscription?.status,
        subscriptionResponse?.plan?.key,
        subscriptionResponse?.plan?.planType,
    ) {
        if (
            currentTab == NativeTab.Voices &&
            authSession != null &&
            subscriptionResponse != null &&
            !hasPaidVoiceAccess(subscriptionResponse)
        ) {
            planGateDialog = PlanGateDialogState(
                message = "유료 이용권에서 사용할 수 있어요.",
            )
            navController.navigateTopLevelTab(NativeTab.Home)
        }
    }

    LaunchedEffect(authSession?.token, pendingCharacterEventCount, characterBusy) {
        if (authSession != null && pendingCharacterEventCount > 0 && !characterBusy) {
            viewModel.syncPendingCharacterEventsSilently()
        }
    }

    LaunchedEffect(currentTab, authSession?.token) {
        if (authSession == null) return@LaunchedEffect
        when (currentTab) {
            NativeTab.Home -> {
                viewModel.refreshCharacterAndBilling()
                viewModel.refreshSocial()
            }
            NativeTab.Voices -> {
                viewModel.preloadVoiceProfiles()
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
            null -> Unit
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
        viewModel.deleteAccount {
            revokeGoogleAccountAccess(context)
        }
    }

    fun navigateToTab(tab: NativeTab) {
        if (
            tab == NativeTab.Voices &&
            authSession != null &&
            subscriptionResponse != null &&
            !hasPaidVoiceAccess(subscriptionResponse)
        ) {
            planGateDialog = PlanGateDialogState(
                message = "유료 이용권에서 사용할 수 있어요.",
            )
            return
        }
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

    Scaffold(
        bottomBar = {
            if (authSession != null && !viewModel.showOnboarding && currentTab != null) {
                VoiceAlarmBottomBar(
                    selectedTab = selectedTab,
                    unreadAlarmCount = if (selectedTab == NativeTab.Alarms) 0 else unreadAlarmCount,
                    unreadMessageCount = receivedNotes.count { it.readAt.isNullOrBlank() },
                    onSelectTab = ::navigateToTab,
                )
            }
        },
    ) { padding ->
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
                          onCancelSubscription = viewModel::cancelSubscription,
                          onChangePlan = viewModel::changePlan,
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
                                      isPlanOwner = isPlanOwner,
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
                      onCancel = ::goBackInApp,
                      onOpenBilling = { navController.navigateTopLevelTab(NativeTab.Billing) },
                      onCreateVoiceProfile = { navController.navigateTopLevelTab(NativeTab.Voices) },
                      onGenerateTts = viewModel::generateTtsAudio,
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
                          onCancel = ::goBackInApp,
                          onOpenBilling = { navController.navigateTopLevelTab(NativeTab.Billing) },
                          onCreateVoiceProfile = { navController.navigateTopLevelTab(NativeTab.Voices) },
                          onGenerateTts = viewModel::generateTtsAudio,
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
                      themeMode = themeMode,
                      permissions = permissions,
                      onBack = ::goBackInApp,
                      onChangeTheme = viewModel::setThemeMode,
                      onRequestPermission = ::requestPermission,
                      onRequestAllPermissions = ::requestAllMissingPermissions,
                      onEditNickname = viewModel::requestEditNickname,
                      onChangeFamilyAlarmSettings = viewModel::updateFamilyAlarmSettings,
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
                      currentUserId = authSession?.user?.id,
                      socialBusy = socialBusy,
                      billingBusy = billingBusy,
                      onBack = ::goBackInApp,
                      onRemoveFamilyMember = viewModel::removeFamilyMember,
                      onEnsureFamilyShareCode = viewModel::ensureFamilyShareCode,
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
                          isPlanOwner = isPlanOwner,
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

private fun buildGoogleSignInOptions(requestIdToken: Boolean = false): GoogleSignInOptions {
    val builder = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
        .requestEmail()
    if (requestIdToken) {
        val clientId = BuildConfig.VOICE_ALARM_GOOGLE_WEB_CLIENT_ID
        if (clientId.isNotBlank()) {
            builder.requestIdToken(clientId)
        }
    }
    return builder.build()
}

private object AppRoute {
    const val Settings = "settings"
    const val MemberManagement = "members"
    const val FamilyTargetModeArg = "familyTargetMode"
    const val AlarmCreate = "alarm/create/{$FamilyTargetModeArg}"
    const val AlarmIdArg = "alarmId"
    const val AlarmEdit = "alarm/edit/{$AlarmIdArg}"

    fun alarmCreate(familyTargetMode: Boolean): String = "alarm/create/$familyTargetMode"
    fun alarmEdit(alarmId: String): String = "alarm/edit/${Uri.encode(alarmId)}"
}

private val NativeTab.route: String
    get() = when (this) {
        NativeTab.Home -> "home"
        NativeTab.Voices -> "voices"
        NativeTab.Alarms -> "alarms"
        NativeTab.People -> "people"
        NativeTab.Messages -> "messages"
        NativeTab.Growth -> "growth"
        NativeTab.Billing -> "billing"
    }

private fun String?.toNativeTab(): NativeTab? =
    NativeTab.values().firstOrNull { it.route == this }

private fun alarmPermissionRequiredMessage(target: PermissionTarget): String = when (target) {
    PermissionTarget.Notifications -> "알람 화면과 종료 버튼을 표시하려면 알림 권한이 필요해요."
    PermissionTarget.ExactAlarms -> "정해진 시간에 울리려면 정확한 알람 권한이 필요해요."
    PermissionTarget.FullScreenIntent -> "잠금화면 위에 알람 화면을 띄우려면 전체 화면 알람 권한을 켜 주세요."
    PermissionTarget.RecordAudio -> "음성을 녹음하려면 마이크 권한이 필요해요."
}

private fun NavHostController.navigateTopLevelTab(tab: NativeTab) {
    navigate(tab.route) {
        popUpTo(NativeTab.Home.route) {
            saveState = true
        }
        launchSingleTop = true
        restoreState = true
    }
}

private fun NavHostController.navigateHomeClearingStack() {
    if (currentDestination == null) return
    navigate(NativeTab.Home.route) {
        popUpTo(NativeTab.Home.route)
        launchSingleTop = true
    }
}

private fun NavHostController.popBackStackOrHome() {
    if (!popBackStack()) {
        navigateHomeClearingStack()
    }
}

private suspend fun signOutGoogleAccount(context: Context) {
    GoogleSignIn
        .getClient(context.applicationContext, buildGoogleSignInOptions())
        .signOut()
        .awaitCompletion()
}

private suspend fun revokeGoogleAccountAccess(context: Context) {
    GoogleSignIn
        .getClient(context.applicationContext, buildGoogleSignInOptions())
        .revokeAccess()
        .awaitCompletion()
}

private suspend fun Task<Void>.awaitCompletion() {
    suspendCancellableCoroutine { continuation ->
        addOnCompleteListener { task ->
            if (!continuation.isActive) return@addOnCompleteListener
            when {
                task.isCanceled -> continuation.resumeWithException(
                    CancellationException("Google task was cancelled"),
                )
                task.isSuccessful -> continuation.resume(Unit)
                else -> continuation.resumeWithException(
                    task.exception ?: IllegalStateException("Google task failed"),
                )
            }
        }
    }
}

private sealed interface AuthRoute {
    data object Landing : AuthRoute
    data class Auth(val mode: AuthMode) : AuthRoute
}

private enum class MessageSeverity { Success, Error, Info }

private data class PlanGateDialogState(
    val message: String,
    val confirmLabel: String = "이용권 보기",
)

private fun messageSeverity(text: String): MessageSeverity = when {
    "실패" in text || "못했어요" in text || "오류" in text -> MessageSeverity.Error
    "했어요" in text || "었어요" in text || "완료" in text -> MessageSeverity.Success
    else -> MessageSeverity.Info
}

@Composable
private fun PrettySnackbar(message: String) {
    val severity = messageSeverity(message)
    val scheme = MaterialTheme.colorScheme
    val containerColor = when (severity) {
        MessageSeverity.Error -> scheme.error
        MessageSeverity.Success -> scheme.tertiary
        MessageSeverity.Info -> scheme.secondaryContainer
    }
    val contentColor = when (severity) {
        MessageSeverity.Error -> scheme.onError
        MessageSeverity.Success -> scheme.onTertiary
        MessageSeverity.Info -> scheme.onSecondaryContainer
    }
    val iconVector = when (severity) {
        MessageSeverity.Error -> Icons.Outlined.ErrorOutline
        MessageSeverity.Success -> Icons.Outlined.CheckCircle
        MessageSeverity.Info -> Icons.Outlined.Info
    }
    Snackbar(
        modifier = Modifier
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .shadow(elevation = 12.dp, shape = RoundedCornerShape(20.dp), clip = false),
        shape = RoundedCornerShape(20.dp),
        containerColor = containerColor,
        contentColor = contentColor,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                imageVector = iconVector,
                contentDescription = null,
                tint = contentColor,
                modifier = Modifier.size(22.dp),
            )
            Spacer(Modifier.width(12.dp))
            Text(
                text = message,
                fontWeight = FontWeight.Medium,
            )
        }
    }
}
