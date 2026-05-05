package com.voicealarm.nativeapp

import android.content.Context
import android.os.Build
import android.util.Log
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Message
import androidx.compose.material.icons.outlined.People
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.voicealarm.nativeapp.core.VoiceAlarmLog.TAG
import com.voicealarm.nativeapp.network.AuthSession
import com.voicealarm.nativeapp.network.CharacterResponse
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.ApiException
import kotlinx.coroutines.launch

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
    val familyInvites = viewModel.familyInvites
    val familyVoices = viewModel.familyVoices
    val characterEvents by viewModel.characterEvents.collectAsStateWithLifecycle()
    val characterBusy = viewModel.characterBusy
    val characterResponse = viewModel.characterResponse
    val billingBusy = viewModel.billingBusy
    val subscriptionResponse = viewModel.subscriptionResponse
    val vouchers = viewModel.vouchers
    val noteBusy = viewModel.noteBusy
    val receivedNotes = viewModel.receivedNotes
    var screen by remember { mutableStateOf<AlarmScreen>(AlarmScreen.List) }
    var selectedTab by remember { mutableStateOf(NativeTab.Home) }
    var tabBackStack by remember { mutableStateOf<List<NativeTab>>(emptyList()) }

    LaunchedEffect(authSession?.token) {
        if (authSession != null) viewModel.preloadVoiceProfiles()
    }

    LaunchedEffect(selectedTab, authSession?.token) {
        if (authSession == null) return@LaunchedEffect
        when (selectedTab) {
            NativeTab.People -> viewModel.refreshSocial()
            NativeTab.Messages -> {
                viewModel.refreshSocial()
                viewModel.refreshNotes()
            }
            NativeTab.Growth,
            NativeTab.Billing -> viewModel.refreshCharacterAndBilling()
            else -> Unit
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
            viewModel.showGoogleSignInFailed("Google ID 토큰을 받지 못했어요")
        } else {
            viewModel.finishGoogleLogin(
                idToken = idToken,
                id = account.id ?: account.email.orEmpty(),
                email = account.email.orEmpty(),
                name = account.displayName.orEmpty(),
            )
        }
    }

    fun launchGoogleSignIn() {
        val clientId = BuildConfig.VOICE_ALARM_GOOGLE_WEB_CLIENT_ID
        if (clientId.isBlank()) {
            viewModel.showGoogleSetupRequired()
            return
        }
        val options = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestIdToken(clientId)
            .requestEmail()
            .build()
        googleSignInLauncher.launch(GoogleSignIn.getClient(context, options).signInIntent)
    }

    fun navigateToTab(tab: NativeTab) {
        if (selectedTab == tab) return
        tabBackStack = tabBackStack + selectedTab
        selectedTab = tab
    }

    fun goBackInApp() {
        if (screen !is AlarmScreen.List) {
            screen = AlarmScreen.List
            return
        }
        val previousTab = tabBackStack.lastOrNull()
        if (previousTab != null) {
            tabBackStack = tabBackStack.dropLast(1)
            selectedTab = previousTab
        }
    }

    BackHandler(
        enabled = screen !is AlarmScreen.List || tabBackStack.isNotEmpty(),
        onBack = ::goBackInApp,
    )

    Scaffold(
        bottomBar = {
            if (screen is AlarmScreen.List) {
                VoiceAlarmBottomBar(
                    selectedTab = selectedTab,
                    onSelectTab = ::navigateToTab,
                )
            }
        },
    ) { padding ->
        when (val current = screen) {
            AlarmScreen.List -> AlarmListScreen(
                contentPadding = padding,
                selectedTab = selectedTab,
                onSelectTab = ::navigateToTab,
                alarms = alarms,
                authSession = authSession,
                authBusy = authBusy,
                syncBusy = syncBusy,
                voiceProfiles = voiceProfiles,
                voiceProfileBusy = voiceProfileBusy,
                socialBusy = socialBusy,
                familyGroup = familyGroup,
                familyInvites = familyInvites,
                familyVoices = familyVoices,
                characterEvents = characterEvents,
                characterBusy = characterBusy,
                characterResponse = characterResponse,
                billingBusy = billingBusy,
                subscriptionResponse = subscriptionResponse,
                vouchers = vouchers,
                noteBusy = noteBusy,
                receivedNotes = receivedNotes,
                message = message,
                onClearMessage = viewModel::clearMessage,
                onLogin = viewModel::login,
                onRegister = viewModel::register,
                onGoogleSignIn = ::launchGoogleSignIn,
                onSyncNow = viewModel::syncNow,
                onLogout = viewModel::logout,
                onCreateVoiceProfile = viewModel::createVoiceProfile,
                onCreateVoiceProfiles = viewModel::createVoiceProfiles,
                onSeparateVoiceSpeakers = viewModel::separateVoiceSpeakers,
                onRenameVoiceProfile = viewModel::renameVoiceProfile,
                onDeleteVoiceProfile = viewModel::deleteVoiceProfile,
                onRefreshSocial = viewModel::refreshSocial,
                onCreateFamilyInvite = viewModel::createFamilyInvite,
                onAcceptFamilyInvite = viewModel::acceptFamilyInvite,
                onRevokeFamilyInvite = viewModel::revokeFamilyInvite,
                onRefreshCharacterBilling = viewModel::refreshCharacterAndBilling,
                onSyncCharacterEvents = viewModel::syncCharacterEvents,
                onRegisterCode = viewModel::registerCode,
                onRefreshNotes = viewModel::refreshNotes,
                onSendNote = viewModel::sendNote,
                onMarkNoteRead = viewModel::markNoteRead,
                onCheckoutPlan = viewModel::checkoutPlan,
                onCreateAlarm = { screen = AlarmScreen.Create },
                onToggleEnabled = viewModel::setAlarmEnabled,
                onEditAlarm = { screen = AlarmScreen.Edit(it) },
                onDeleteAlarm = viewModel::deleteAlarm,
            )

            AlarmScreen.Create -> AlarmEditorScreen(
                contentPadding = padding,
                alarm = null,
                authSession = authSession,
                voiceProfiles = voiceProfiles,
                voiceProfileBusy = voiceProfileBusy,
                onCancel = ::goBackInApp,
                onGenerateTts = viewModel::generateTtsAudio,
                onSave = { draft ->
                    viewModel.createAlarm(draft) { screen = AlarmScreen.List }
                },
            )

            is AlarmScreen.Edit -> AlarmEditorScreen(
                contentPadding = padding,
                alarm = current.alarm,
                authSession = authSession,
                voiceProfiles = voiceProfiles,
                voiceProfileBusy = voiceProfileBusy,
                onCancel = ::goBackInApp,
                onGenerateTts = viewModel::generateTtsAudio,
                onSave = { draft ->
                    viewModel.updateAlarm(current.alarm.id, draft) { screen = AlarmScreen.List }
                },
            )
        }
    }
}
