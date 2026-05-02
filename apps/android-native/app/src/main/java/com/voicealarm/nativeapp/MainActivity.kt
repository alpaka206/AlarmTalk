package com.voicealarm.nativeapp

import android.Manifest
import android.app.Activity
import android.app.AlarmManager
import android.app.Application
import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.AlarmAdd
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Fullscreen
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Message
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.Remove
import androidx.compose.material.icons.outlined.Save
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.getSystemService
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.voicealarm.nativeapp.core.VoiceAlarmLog.TAG
import com.voicealarm.nativeapp.data.AlarmAppContainer
import com.voicealarm.nativeapp.data.AlarmAudioLimits
import com.voicealarm.nativeapp.data.AlarmAudioStore
import com.voicealarm.nativeapp.data.AlarmDraft
import com.voicealarm.nativeapp.data.AlarmEntity
import com.voicealarm.nativeapp.data.AlarmPlayModes
import com.voicealarm.nativeapp.data.AlarmSyncStates
import com.voicealarm.nativeapp.data.AlarmVoiceRecorder
import com.voicealarm.nativeapp.data.CachedAlarmAudio
import com.voicealarm.nativeapp.data.CharacterEventEntity
import com.voicealarm.nativeapp.data.VibrationPatterns
import com.voicealarm.nativeapp.network.AuthTokenResponse
import com.voicealarm.nativeapp.network.AuthSession
import com.voicealarm.nativeapp.network.AuthSessionStore
import com.voicealarm.nativeapp.network.BillingSubscriptionResponse
import com.voicealarm.nativeapp.network.CharacterResponse
import com.voicealarm.nativeapp.network.CodeRegisterRequest
import com.voicealarm.nativeapp.network.FamilyGroupCurrentResponse
import com.voicealarm.nativeapp.network.FamilyInvite
import com.voicealarm.nativeapp.network.FamilyVoiceProfile
import com.voicealarm.nativeapp.network.Friend
import com.voicealarm.nativeapp.network.FriendRequestBody
import com.voicealarm.nativeapp.network.LoginRequest
import com.voicealarm.nativeapp.network.PendingFriendRequest
import com.voicealarm.nativeapp.network.RegisterRequest
import com.voicealarm.nativeapp.network.VoiceAlarmApiClient
import com.voicealarm.nativeapp.network.VoiceProfile
import com.voicealarm.nativeapp.network.VoucherItem
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.ApiException
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            VoiceAlarmTheme {
                VoiceAlarmApp()
            }
        }
    }
}

class MainViewModel(application: Application) : AndroidViewModel(application) {
    private val repository = AlarmAppContainer.repository(application)
    private val api = VoiceAlarmApiClient.create()
    private val authSessionStore = AuthSessionStore(application)

    val alarms: StateFlow<List<AlarmEntity>> = repository.observeAlarms()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val characterEvents: StateFlow<List<CharacterEventEntity>> = repository.observeCharacterEvents()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    var authSession by mutableStateOf<AuthSession?>(authSessionStore.read())
        private set

    var authBusy by mutableStateOf(false)
        private set

    var syncBusy by mutableStateOf(false)
        private set

    var voiceProfiles by mutableStateOf<List<VoiceProfile>>(emptyList())
        private set

    var voiceProfileBusy by mutableStateOf(false)
        private set

    var socialBusy by mutableStateOf(false)
        private set

    var friends by mutableStateOf<List<Friend>>(emptyList())
        private set

    var pendingFriends by mutableStateOf<List<PendingFriendRequest>>(emptyList())
        private set

    var familyGroup by mutableStateOf<FamilyGroupCurrentResponse?>(null)
        private set

    var familyInvites by mutableStateOf<List<FamilyInvite>>(emptyList())
        private set

    var familyVoices by mutableStateOf<List<FamilyVoiceProfile>>(emptyList())
        private set

    var characterBusy by mutableStateOf(false)
        private set

    var characterResponse by mutableStateOf<CharacterResponse?>(null)
        private set

    var billingBusy by mutableStateOf(false)
        private set

    var subscriptionResponse by mutableStateOf<BillingSubscriptionResponse?>(null)
        private set

    var vouchers by mutableStateOf<List<VoucherItem>>(emptyList())
        private set

    var message by mutableStateOf<String?>(null)
        private set

    init {
        viewModelScope.launch {
            runCatching {
                repository.reschedulePendingAlarms()
            }.onSuccess { scheduled ->
                Log.i(TAG, "Startup alarm sync complete scheduled=$scheduled")
            }.onFailure { error ->
                Log.e(TAG, "Startup alarm sync failed", error)
            }
        }
        refreshAppSession()
    }

    fun createAlarm(draft: AlarmDraft, onDone: () -> Unit) {
        viewModelScope.launch {
            runCatching {
                repository.createAlarm(draft)
            }.onSuccess { alarm ->
                message = "Scheduled ${alarm.label}"
                onDone()
            }.onFailure { error ->
                Log.e(TAG, "Failed to create alarm", error)
                message = error.message ?: "Failed to create alarm"
            }
        }
    }

    fun updateAlarm(alarmId: String, draft: AlarmDraft, onDone: () -> Unit) {
        viewModelScope.launch {
            runCatching {
                repository.updateAlarm(alarmId, draft)
            }.onSuccess { alarm ->
                message = "Updated ${alarm.label}"
                onDone()
            }.onFailure { error ->
                Log.e(TAG, "Failed to update alarm id=$alarmId", error)
                message = error.message ?: "Failed to update alarm"
            }
        }
    }

    fun setAlarmEnabled(alarmId: String, enabled: Boolean) {
        viewModelScope.launch {
            runCatching {
                repository.setEnabled(alarmId, enabled)
            }.onSuccess { alarm ->
                message = if (alarm.enabled) "Enabled ${alarm.label}" else "Disabled ${alarm.label}"
            }.onFailure { error ->
                Log.e(TAG, "Failed to change alarm enabled id=$alarmId", error)
                message = error.message ?: "Failed to update alarm"
            }
        }
    }

    fun deleteAlarm(alarmId: String) {
        viewModelScope.launch {
            runCatching {
                repository.deleteAlarm(alarmId)
            }.onSuccess {
                message = "Deleted alarm"
            }.onFailure { error ->
                Log.e(TAG, "Failed to delete alarm id=$alarmId", error)
                message = error.message ?: "Failed to delete alarm"
            }
        }
    }

    fun createTestAlarm(delayMinutes: Int) {
        viewModelScope.launch {
            runCatching {
                repository.createTestAlarm(delayMinutes)
            }.onSuccess { alarm ->
                message = "Scheduled ${alarm.label} in $delayMinutes min"
            }.onFailure { error ->
                Log.e(TAG, "Failed to create test alarm", error)
                message = error.message ?: "Failed to schedule alarm"
            }
        }
    }

    fun login(email: String, password: String) {
        viewModelScope.launch {
            authBusy = true
            runCatching {
                api.login(LoginRequest(email = email.trim(), password = password))
            }.onSuccess { response ->
                authSession = authSessionStore.saveAppSession(response)
                message = "Signed in as ${response.user.email}"
            }.onFailure { error ->
                Log.e(TAG, "Email login failed", error)
                message = error.message ?: "Sign in failed"
            }
            authBusy = false
        }
    }

    fun register(email: String, password: String, name: String) {
        viewModelScope.launch {
            authBusy = true
            runCatching {
                api.register(RegisterRequest(email = email.trim(), password = password, name = name.trim()))
            }.onSuccess { response ->
                authSession = authSessionStore.saveAppSession(response)
                message = "Registered ${response.user.email}"
            }.onFailure { error ->
                Log.e(TAG, "Email registration failed", error)
                message = error.message ?: "Registration failed"
            }
            authBusy = false
        }
    }

    fun finishGoogleLogin(idToken: String, id: String, email: String, name: String) {
        authSession = authSessionStore.saveGoogleSession(
            idToken = idToken,
            id = id,
            email = email,
            name = name,
        )
        message = "Signed in with Google"
    }

    fun logout() {
        authSessionStore.clear()
        authSession = null
        message = "Signed out"
    }

    fun syncNow() {
        val session = authSession
        if (session == null) {
            message = "Sign in before syncing"
            return
        }
        viewModelScope.launch {
            syncBusy = true
            runCatching {
                repository.syncWithBackend(api, session.token)
            }.onSuccess { result ->
                message = "Sync complete: ${result.created} created, ${result.updated} updated, ${result.failed} failed"
            }.onFailure { error ->
                Log.e(TAG, "Backend sync failed", error)
                message = error.message ?: "Sync failed"
            }
            syncBusy = false
        }
    }

    fun loadVoiceProfiles() {
        val session = authSession
        if (session == null) {
            message = "Sign in before loading voices"
            return
        }
        viewModelScope.launch {
            voiceProfileBusy = true
            runCatching {
                api.listVoiceProfiles(VoiceAlarmApiClient.bearer(session.token)).profiles
            }.onSuccess { profiles ->
                voiceProfiles = profiles
                message = "Loaded ${profiles.size} voice profiles"
            }.onFailure { error ->
                Log.e(TAG, "Failed to load voice profiles", error)
                message = error.message ?: "Failed to load voice profiles"
            }
            voiceProfileBusy = false
        }
    }

    fun refreshSocial() {
        val authorization = bearerOrMessage("Sign in before loading social data") ?: return
        viewModelScope.launch {
            socialBusy = true
            runCatching {
                val friendList = api.listFriends(authorization).friends
                val pendingList = api.listPendingFriends(authorization).pending
                val group = api.getFamilyGroup(authorization)
                val invites = api.listFamilyInvites(authorization).invites
                val sharedVoices = api.listFamilyVoiceProfiles(authorization).profiles
                SocialSnapshot(
                    friends = friendList,
                    pendingFriends = pendingList,
                    familyGroup = group,
                    familyInvites = invites,
                    familyVoices = sharedVoices,
                )
            }.onSuccess { snapshot ->
                friends = snapshot.friends
                pendingFriends = snapshot.pendingFriends
                familyGroup = snapshot.familyGroup
                familyInvites = snapshot.familyInvites
                familyVoices = snapshot.familyVoices
                message = "Social data loaded"
            }.onFailure { error ->
                Log.e(TAG, "Failed to refresh social data", error)
                message = error.message ?: "Failed to load social data"
            }
            socialBusy = false
        }
    }

    fun sendFriendRequest(email: String) {
        val authorization = bearerOrMessage("Sign in before sending friend requests") ?: return
        viewModelScope.launch {
            socialBusy = true
            runCatching {
                api.sendFriendRequest(authorization, FriendRequestBody(email.trim()))
            }.onSuccess {
                message = "Friend request sent"
                refreshSocial()
            }.onFailure { error ->
                Log.e(TAG, "Failed to send friend request", error)
                message = error.message ?: "Friend request failed"
            }
            socialBusy = false
        }
    }

    fun acceptFriendRequest(id: String) {
        val authorization = bearerOrMessage("Sign in before accepting requests") ?: return
        viewModelScope.launch {
            socialBusy = true
            runCatching {
                api.acceptFriendRequest(authorization, id)
            }.onSuccess {
                message = "Friend request accepted"
                refreshSocial()
            }.onFailure { error ->
                Log.e(TAG, "Failed to accept friend request id=$id", error)
                message = error.message ?: "Accept failed"
            }
            socialBusy = false
        }
    }

    fun createFamilyInvite() {
        val authorization = bearerOrMessage("Sign in before creating invites") ?: return
        viewModelScope.launch {
            socialBusy = true
            runCatching {
                api.createFamilyInvite(authorization, emptyMap()).invite
            }.onSuccess { invite ->
                familyInvites = listOf(invite) + familyInvites
                message = "Invite code ${invite.code} created"
            }.onFailure { error ->
                Log.e(TAG, "Failed to create family invite", error)
                message = error.message ?: "Invite creation failed"
            }
            socialBusy = false
        }
    }

    fun acceptFamilyInvite(code: String) {
        val authorization = bearerOrMessage("Sign in before accepting invites") ?: return
        viewModelScope.launch {
            socialBusy = true
            runCatching {
                api.acceptFamilyInvite(authorization, code.trim(), emptyMap())
            }.onSuccess {
                message = "Invite accepted"
                refreshSocial()
            }.onFailure { error ->
                Log.e(TAG, "Failed to accept family invite", error)
                message = error.message ?: "Invite accept failed"
            }
            socialBusy = false
        }
    }

    fun revokeFamilyInvite(code: String) {
        val authorization = bearerOrMessage("Sign in before revoking invites") ?: return
        viewModelScope.launch {
            socialBusy = true
            runCatching {
                api.revokeFamilyInvite(authorization, code, emptyMap())
            }.onSuccess {
                message = "Invite revoked"
                refreshSocial()
            }.onFailure { error ->
                Log.e(TAG, "Failed to revoke family invite code=$code", error)
                message = error.message ?: "Invite revoke failed"
            }
            socialBusy = false
        }
    }

    fun refreshCharacterAndBilling() {
        val authorization = bearerOrMessage("Sign in before loading character") ?: return
        viewModelScope.launch {
            characterBusy = true
            billingBusy = true
            runCatching {
                CharacterBillingSnapshot(
                    character = api.getCharacter(authorization),
                    subscription = api.getSubscription(authorization),
                    vouchers = api.listVouchers(authorization).vouchers,
                )
            }.onSuccess { snapshot ->
                characterResponse = snapshot.character
                subscriptionResponse = snapshot.subscription
                vouchers = snapshot.vouchers
                message = "Character and plan loaded"
            }.onFailure { error ->
                Log.e(TAG, "Failed to load character or billing", error)
                message = error.message ?: "Failed to load character"
            }
            characterBusy = false
            billingBusy = false
        }
    }

    fun syncCharacterEvents() {
        val session = authSession
        if (session == null) {
            message = "Sign in before syncing character events"
            return
        }
        viewModelScope.launch {
            characterBusy = true
            runCatching {
                repository.syncCharacterEvents(api, session.token)
            }.onSuccess { result ->
                message = "XP sync: ${result.synced} synced, ${result.failed} failed"
                refreshCharacterAndBilling()
            }.onFailure { error ->
                Log.e(TAG, "Character event sync failed", error)
                message = error.message ?: "XP sync failed"
            }
            characterBusy = false
        }
    }

    fun registerCode(code: String) {
        val authorization = bearerOrMessage("Sign in before registering codes") ?: return
        viewModelScope.launch {
            billingBusy = true
            runCatching {
                api.registerCode(authorization, CodeRegisterRequest(code.trim()))
            }.onSuccess { response ->
                message = "Code registered${response.type?.let { ": $it" } ?: ""}"
                refreshSocial()
                refreshCharacterAndBilling()
            }.onFailure { error ->
                Log.e(TAG, "Failed to register code", error)
                message = error.message ?: "Code registration failed"
            }
            billingBusy = false
        }
    }

    fun showGoogleSetupRequired() {
        message = "Set voiceAlarmGoogleWebClientId to enable Google sign-in."
    }

    fun showGoogleSignInFailed(reason: String? = null) {
        message = reason ?: "Google sign-in failed"
    }

    fun clearMessage() {
        message = null
    }

    private fun refreshAppSession() {
        val session = authSession ?: return
        if (session.provider != AuthSessionStore.PROVIDER_APP) return
        viewModelScope.launch {
            runCatching {
                api.me(VoiceAlarmApiClient.bearer(session.token)).user
            }.onSuccess { user ->
                authSession = authSessionStore.saveAppSession(
                    AuthTokenResponse(
                        token = session.token,
                        user = user,
                    ),
                )
            }.onFailure { error ->
                Log.w(TAG, "Auth refresh failed", error)
            }
        }
    }

    private fun bearerOrMessage(fallbackMessage: String): String? {
        val session = authSession
        if (session == null) {
            message = fallbackMessage
            return null
        }
        return VoiceAlarmApiClient.bearer(session.token)
    }
}

private data class SocialSnapshot(
    val friends: List<Friend>,
    val pendingFriends: List<PendingFriendRequest>,
    val familyGroup: FamilyGroupCurrentResponse,
    val familyInvites: List<FamilyInvite>,
    val familyVoices: List<FamilyVoiceProfile>,
)

private data class CharacterBillingSnapshot(
    val character: CharacterResponse,
    val subscription: BillingSubscriptionResponse,
    val vouchers: List<VoucherItem>,
)

private sealed interface AlarmScreen {
    data object List : AlarmScreen
    data object Create : AlarmScreen
    data class Edit(val alarm: AlarmEntity) : AlarmScreen
}

private enum class NativeTab {
    Home,
    Voices,
    Alarms,
    People,
    Growth,
}

private val VoiceAlarmFontFamily = FontFamily(
    Font(R.font.pretendard_regular, FontWeight.Normal),
    Font(R.font.pretendard_medium, FontWeight.Medium),
    Font(R.font.pretendard_semibold, FontWeight.SemiBold),
    Font(R.font.pretendard_bold, FontWeight.Bold),
)

private val VoiceAlarmTypography = Typography().let { base ->
    base.copy(
        displayLarge = base.displayLarge.copy(fontFamily = VoiceAlarmFontFamily),
        displayMedium = base.displayMedium.copy(fontFamily = VoiceAlarmFontFamily),
        displaySmall = base.displaySmall.copy(fontFamily = VoiceAlarmFontFamily),
        headlineLarge = base.headlineLarge.copy(fontFamily = VoiceAlarmFontFamily),
        headlineMedium = base.headlineMedium.copy(fontFamily = VoiceAlarmFontFamily),
        headlineSmall = base.headlineSmall.copy(fontFamily = VoiceAlarmFontFamily),
        titleLarge = base.titleLarge.copy(fontFamily = VoiceAlarmFontFamily),
        titleMedium = base.titleMedium.copy(fontFamily = VoiceAlarmFontFamily),
        titleSmall = base.titleSmall.copy(fontFamily = VoiceAlarmFontFamily),
        bodyLarge = base.bodyLarge.copy(fontFamily = VoiceAlarmFontFamily),
        bodyMedium = base.bodyMedium.copy(fontFamily = VoiceAlarmFontFamily),
        bodySmall = base.bodySmall.copy(fontFamily = VoiceAlarmFontFamily),
        labelLarge = base.labelLarge.copy(fontFamily = VoiceAlarmFontFamily),
        labelMedium = base.labelMedium.copy(fontFamily = VoiceAlarmFontFamily),
        labelSmall = base.labelSmall.copy(fontFamily = VoiceAlarmFontFamily),
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun VoiceAlarmApp(viewModel: MainViewModel = viewModel()) {
    val context = LocalContext.current
    val alarms by viewModel.alarms.collectAsStateWithLifecycle()
    val message = viewModel.message
    val authSession = viewModel.authSession
    val authBusy = viewModel.authBusy
    val syncBusy = viewModel.syncBusy
    val voiceProfiles = viewModel.voiceProfiles
    val voiceProfileBusy = viewModel.voiceProfileBusy
    val socialBusy = viewModel.socialBusy
    val friends = viewModel.friends
    val pendingFriends = viewModel.pendingFriends
    val familyGroup = viewModel.familyGroup
    val familyInvites = viewModel.familyInvites
    val familyVoices = viewModel.familyVoices
    val characterEvents by viewModel.characterEvents.collectAsStateWithLifecycle()
    val characterBusy = viewModel.characterBusy
    val characterResponse = viewModel.characterResponse
    val billingBusy = viewModel.billingBusy
    val subscriptionResponse = viewModel.subscriptionResponse
    val vouchers = viewModel.vouchers
    var screen by remember { mutableStateOf<AlarmScreen>(AlarmScreen.List) }
    var selectedTab by remember { mutableStateOf(NativeTab.Home) }
    var permissions by remember { mutableStateOf(PermissionSnapshot.read(context)) }

    val notificationPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
    ) {
        permissions = PermissionSnapshot.read(context)
    }
    val googleSignInLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        if (result.resultCode != Activity.RESULT_OK) {
            viewModel.showGoogleSignInFailed("Google sign-in cancelled")
            return@rememberLauncherForActivityResult
        }
        val account = runCatching {
            GoogleSignIn.getSignedInAccountFromIntent(result.data).getResult(ApiException::class.java)
        }.onFailure { error ->
            Log.e(TAG, "Google sign-in failed", error)
        }.getOrNull()
        val idToken = account?.idToken
        if (idToken.isNullOrBlank()) {
            viewModel.showGoogleSignInFailed("Google ID token was not returned")
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

    RefreshPermissionsOnResume {
        permissions = PermissionSnapshot.read(context)
    }

    Scaffold(
        topBar = {
            if (screen !is AlarmScreen.List) {
                TopAppBar(
                    title = {
                        Text(
                            text = when (screen) {
                                AlarmScreen.List -> "Voice Alarm"
                                AlarmScreen.Create -> "알람 설정"
                                is AlarmScreen.Edit -> "알람 편집"
                            },
                            fontWeight = FontWeight.SemiBold,
                        )
                    },
                    navigationIcon = {
                        IconButton(onClick = { screen = AlarmScreen.List }) {
                            Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back")
                        }
                    },
                )
            }
        },
        bottomBar = {
            if (screen is AlarmScreen.List) {
                VoiceAlarmBottomBar(
                    selectedTab = selectedTab,
                    onSelectTab = { selectedTab = it },
                )
            }
        },
        floatingActionButton = {
            if (screen is AlarmScreen.List && selectedTab == NativeTab.Alarms) {
                FloatingActionButton(onClick = { screen = AlarmScreen.Create }) {
                    Icon(Icons.Outlined.Add, contentDescription = "Create alarm")
                }
            }
        },
    ) { padding ->
        when (val current = screen) {
            AlarmScreen.List -> AlarmListScreen(
                contentPadding = padding,
                selectedTab = selectedTab,
                onSelectTab = { selectedTab = it },
                permissions = permissions,
                alarms = alarms,
                authSession = authSession,
                authBusy = authBusy,
                syncBusy = syncBusy,
                voiceProfiles = voiceProfiles,
                voiceProfileBusy = voiceProfileBusy,
                socialBusy = socialBusy,
                friends = friends,
                pendingFriends = pendingFriends,
                familyGroup = familyGroup,
                familyInvites = familyInvites,
                familyVoices = familyVoices,
                characterEvents = characterEvents,
                characterBusy = characterBusy,
                characterResponse = characterResponse,
                billingBusy = billingBusy,
                subscriptionResponse = subscriptionResponse,
                vouchers = vouchers,
                message = message,
                onClearMessage = viewModel::clearMessage,
                onLogin = viewModel::login,
                onRegister = viewModel::register,
                onGoogleSignIn = ::launchGoogleSignIn,
                onSyncNow = viewModel::syncNow,
                onLoadVoiceProfiles = viewModel::loadVoiceProfiles,
                onLogout = viewModel::logout,
                onRefreshSocial = viewModel::refreshSocial,
                onSendFriendRequest = viewModel::sendFriendRequest,
                onAcceptFriendRequest = viewModel::acceptFriendRequest,
                onCreateFamilyInvite = viewModel::createFamilyInvite,
                onAcceptFamilyInvite = viewModel::acceptFamilyInvite,
                onRevokeFamilyInvite = viewModel::revokeFamilyInvite,
                onRefreshCharacterBilling = viewModel::refreshCharacterAndBilling,
                onSyncCharacterEvents = viewModel::syncCharacterEvents,
                onRegisterCode = viewModel::registerCode,
                onCreateAlarm = { screen = AlarmScreen.Create },
                onQuickTest = { viewModel.createTestAlarm(1) },
                onToggleEnabled = viewModel::setAlarmEnabled,
                onEditAlarm = { screen = AlarmScreen.Edit(it) },
                onDeleteAlarm = viewModel::deleteAlarm,
                onRequestNotifications = {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                    }
                },
                onRequestExactAlarms = { context.openExactAlarmSettings() },
                onRequestFullScreen = { context.openFullScreenIntentSettings() },
            )

            AlarmScreen.Create -> AlarmEditorScreen(
                contentPadding = padding,
                alarm = null,
                onCancel = { screen = AlarmScreen.List },
                onSave = { draft ->
                    viewModel.createAlarm(draft) { screen = AlarmScreen.List }
                },
            )

            is AlarmScreen.Edit -> AlarmEditorScreen(
                contentPadding = padding,
                alarm = current.alarm,
                onCancel = { screen = AlarmScreen.List },
                onSave = { draft ->
                    viewModel.updateAlarm(current.alarm.id, draft) { screen = AlarmScreen.List }
                },
            )
        }
    }
}

@Composable
private fun VoiceAlarmBottomBar(
    selectedTab: NativeTab,
    onSelectTab: (NativeTab) -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 0.dp,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(76.dp)
                .padding(horizontal = 6.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            VoiceAlarmTabItem(
                tab = NativeTab.Home,
                selectedTab = selectedTab,
                icon = Icons.Outlined.Home,
                label = "홈",
                onSelectTab = onSelectTab,
                modifier = Modifier.weight(1f),
            )
            VoiceAlarmTabItem(
                tab = NativeTab.Voices,
                selectedTab = selectedTab,
                icon = Icons.Outlined.Mic,
                label = "음성",
                onSelectTab = onSelectTab,
                modifier = Modifier.weight(1f),
            )
            VoiceAlarmTabItem(
                tab = NativeTab.Alarms,
                selectedTab = selectedTab,
                icon = Icons.Outlined.Alarm,
                label = "알람",
                onSelectTab = onSelectTab,
                modifier = Modifier.weight(1f),
            )
            VoiceAlarmTabItem(
                tab = NativeTab.People,
                selectedTab = selectedTab,
                icon = Icons.Outlined.Message,
                label = "메시지",
                onSelectTab = onSelectTab,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun VoiceAlarmTabItem(
    tab: NativeTab,
    selectedTab: NativeTab,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    onSelectTab: (NativeTab) -> Unit,
    modifier: Modifier = Modifier,
) {
    val selected = selectedTab == tab
    TextButton(
        onClick = { onSelectTab(tab) },
        modifier = modifier,
        contentPadding = PaddingValues(vertical = 6.dp),
        shape = RoundedCornerShape(14.dp),
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(2.dp),
            modifier = Modifier
                .fillMaxWidth()
                .background(
                    color = if (selected) {
                        MaterialTheme.colorScheme.surfaceVariant
                    } else {
                        Color.Transparent
                    },
                    shape = RoundedCornerShape(14.dp),
                )
                .padding(vertical = 6.dp),
        ) {
            Icon(
                imageVector = icon,
                contentDescription = label,
                tint = if (selected) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
                modifier = Modifier.size(22.dp),
            )
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall,
                color = if (selected) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
            )
        }
    }
}

@Composable
private fun AlarmListScreen(
    contentPadding: PaddingValues,
    selectedTab: NativeTab,
    onSelectTab: (NativeTab) -> Unit,
    permissions: PermissionSnapshot,
    alarms: List<AlarmEntity>,
    authSession: AuthSession?,
    authBusy: Boolean,
    syncBusy: Boolean,
    voiceProfiles: List<VoiceProfile>,
    voiceProfileBusy: Boolean,
    socialBusy: Boolean,
    friends: List<Friend>,
    pendingFriends: List<PendingFriendRequest>,
    familyGroup: FamilyGroupCurrentResponse?,
    familyInvites: List<FamilyInvite>,
    familyVoices: List<FamilyVoiceProfile>,
    characterEvents: List<CharacterEventEntity>,
    characterBusy: Boolean,
    characterResponse: CharacterResponse?,
    billingBusy: Boolean,
    subscriptionResponse: BillingSubscriptionResponse?,
    vouchers: List<VoucherItem>,
    message: String?,
    onClearMessage: () -> Unit,
    onLogin: (String, String) -> Unit,
    onRegister: (String, String, String) -> Unit,
    onGoogleSignIn: () -> Unit,
    onSyncNow: () -> Unit,
    onLoadVoiceProfiles: () -> Unit,
    onLogout: () -> Unit,
    onRefreshSocial: () -> Unit,
    onSendFriendRequest: (String) -> Unit,
    onAcceptFriendRequest: (String) -> Unit,
    onCreateFamilyInvite: () -> Unit,
    onAcceptFamilyInvite: (String) -> Unit,
    onRevokeFamilyInvite: (String) -> Unit,
    onRefreshCharacterBilling: () -> Unit,
    onSyncCharacterEvents: () -> Unit,
    onRegisterCode: (String) -> Unit,
    onCreateAlarm: () -> Unit,
    onQuickTest: () -> Unit,
    onToggleEnabled: (String, Boolean) -> Unit,
    onEditAlarm: (AlarmEntity) -> Unit,
    onDeleteAlarm: (String) -> Unit,
    onRequestNotifications: () -> Unit,
    onRequestExactAlarms: () -> Unit,
    onRequestFullScreen: () -> Unit,
) {
    val sortedAlarms = remember(alarms) {
        alarms.sortedWith(
            compareByDescending<AlarmEntity> { it.enabled }
                .thenBy { it.fireAtMillis },
        )
    }
    val nextAlarm = remember(alarms) {
        alarms.filter { it.enabled }.minByOrNull { it.fireAtMillis }
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(contentPadding),
        contentPadding = PaddingValues(start = 24.dp, top = 24.dp, end = 24.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        when (selectedTab) {
            NativeTab.Home -> {
                item { HomeHeader(authSession = authSession) }
                item {
                    HomeStatsRow(
                        activeAlarms = alarms.count { it.enabled },
                        voiceCount = voiceProfiles.size,
                        friendCount = friends.size,
                    )
                }
                if (authSession != null && characterResponse != null) {
                    item {
                        CharacterMiniCard(
                            characterResponse = characterResponse,
                            pendingEvents = characterEvents.count { it.state != "synced" },
                            onClick = { onSelectTab(NativeTab.Growth) },
                        )
                    }
                }
                item {
                    NextAlarmHeroCard(
                        nextAlarm = nextAlarm,
                        onClick = {
                            if (nextAlarm == null) {
                                onCreateAlarm()
                            } else {
                                onEditAlarm(nextAlarm)
                            }
                        },
                    )
                }
                if (message != null) {
                    item { StatusChip(message = message, onClearMessage = onClearMessage) }
                }
                item {
                    QuickStartGrid(
                        onRecordVoice = onCreateAlarm,
                        onAddAlarm = onCreateAlarm,
                        onLoadVoices = {
                            onSelectTab(NativeTab.Voices)
                            onLoadVoiceProfiles()
                        },
                        onManagePeople = { onSelectTab(NativeTab.People) },
                    )
                }
                if (authSession == null) {
                    item {
                        AccountPanel(
                            authSession = authSession,
                            authBusy = authBusy,
                            syncBusy = syncBusy,
                            voiceProfiles = voiceProfiles,
                            voiceProfileBusy = voiceProfileBusy,
                            onLogin = onLogin,
                            onRegister = onRegister,
                            onGoogleSignIn = onGoogleSignIn,
                            onSyncNow = onSyncNow,
                            onLoadVoiceProfiles = onLoadVoiceProfiles,
                            onLogout = onLogout,
                        )
                    }
                }
            }

            NativeTab.Voices -> {
                item {
                    ScreenHeader(
                        title = "음성",
                        subtitle = "알람 전에 쓸 목소리를 로컬에 준비해요.",
                    )
                }
                item {
                    AccountPanel(
                        authSession = authSession,
                        authBusy = authBusy,
                        syncBusy = syncBusy,
                        voiceProfiles = voiceProfiles,
                        voiceProfileBusy = voiceProfileBusy,
                        onLogin = onLogin,
                        onRegister = onRegister,
                        onGoogleSignIn = onGoogleSignIn,
                        onSyncNow = onSyncNow,
                        onLoadVoiceProfiles = onLoadVoiceProfiles,
                        onLogout = onLogout,
                    )
                }
                item { VoiceMethodGrid(onCreateAlarm = onCreateAlarm) }
            }

            NativeTab.Alarms -> {
                item { AlarmsHeader(onCreateAlarm = onCreateAlarm) }
                if (nextAlarm != null) {
                    item { CountdownBanner(nextAlarm = nextAlarm) }
                }
                item {
                    PermissionPanel(
                        permissions = permissions,
                        onRequestNotifications = onRequestNotifications,
                        onRequestExactAlarms = onRequestExactAlarms,
                        onRequestFullScreen = onRequestFullScreen,
                    )
                }
                item {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Button(
                            onClick = onCreateAlarm,
                            modifier = Modifier.weight(1f),
                        ) {
                            Icon(Icons.Outlined.AlarmAdd, contentDescription = null)
                            Spacer(Modifier.width(8.dp))
                            Text("New alarm")
                        }
                        OutlinedButton(
                            onClick = onQuickTest,
                            modifier = Modifier.weight(1f),
                        ) {
                            Text("1 min test")
                        }
                    }
                }
                if (message != null) {
                    item { StatusChip(message = message, onClearMessage = onClearMessage) }
                }
                if (sortedAlarms.isEmpty()) {
                    item { EmptyAlarmCard(onCreateAlarm = onCreateAlarm) }
                } else {
                    items(sortedAlarms, key = { it.id }) { alarm ->
                        AlarmRow(
                            alarm = alarm,
                            onToggleEnabled = { enabled -> onToggleEnabled(alarm.id, enabled) },
                            onEditAlarm = { onEditAlarm(alarm) },
                            onDeleteAlarm = { onDeleteAlarm(alarm.id) },
                        )
                    }
                }
            }

            NativeTab.People -> {
                item {
                    ScreenHeader(
                        title = "메시지",
                        subtitle = "친구와 가족에게 알람과 목소리를 공유해요.",
                    )
                }
                if (authSession == null) {
                    item {
                        AccountPanel(
                            authSession = authSession,
                            authBusy = authBusy,
                            syncBusy = syncBusy,
                            voiceProfiles = voiceProfiles,
                            voiceProfileBusy = voiceProfileBusy,
                            onLogin = onLogin,
                            onRegister = onRegister,
                            onGoogleSignIn = onGoogleSignIn,
                            onSyncNow = onSyncNow,
                            onLoadVoiceProfiles = onLoadVoiceProfiles,
                            onLogout = onLogout,
                        )
                    }
                } else {
                    item {
                        SocialPanel(
                            socialBusy = socialBusy,
                            friends = friends,
                            pendingFriends = pendingFriends,
                            familyGroup = familyGroup,
                            familyInvites = familyInvites,
                            familyVoices = familyVoices,
                            onRefreshSocial = onRefreshSocial,
                            onSendFriendRequest = onSendFriendRequest,
                            onAcceptFriendRequest = onAcceptFriendRequest,
                            onCreateFamilyInvite = onCreateFamilyInvite,
                            onAcceptFamilyInvite = onAcceptFamilyInvite,
                            onRevokeFamilyInvite = onRevokeFamilyInvite,
                        )
                    }
                }
            }

            NativeTab.Growth -> {
                item {
                    ScreenHeader(
                        title = "성장",
                        subtitle = "알람을 끄고 다시 울릴 때마다 캐릭터가 자라요.",
                    )
                }
                if (authSession == null) {
                    item {
                        AccountPanel(
                            authSession = authSession,
                            authBusy = authBusy,
                            syncBusy = syncBusy,
                            voiceProfiles = voiceProfiles,
                            voiceProfileBusy = voiceProfileBusy,
                            onLogin = onLogin,
                            onRegister = onRegister,
                            onGoogleSignIn = onGoogleSignIn,
                            onSyncNow = onSyncNow,
                            onLoadVoiceProfiles = onLoadVoiceProfiles,
                            onLogout = onLogout,
                        )
                    }
                } else {
                    item {
                        CharacterBillingPanel(
                            characterEvents = characterEvents,
                            characterBusy = characterBusy,
                            characterResponse = characterResponse,
                            billingBusy = billingBusy,
                            subscriptionResponse = subscriptionResponse,
                            vouchers = vouchers,
                            onRefresh = onRefreshCharacterBilling,
                            onSyncEvents = onSyncCharacterEvents,
                            onRegisterCode = onRegisterCode,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun StatusChip(
    message: String,
    onClearMessage: () -> Unit,
) {
    AssistChip(
        onClick = onClearMessage,
        label = { Text(message) },
        leadingIcon = {
            Icon(
                imageVector = Icons.Outlined.CheckCircle,
                contentDescription = null,
                modifier = Modifier.size(18.dp),
            )
        },
    )
}

@Composable
private fun HomeHeader(authSession: AuthSession?) {
    val hour = java.time.LocalTime.now().hour
    val greeting = when {
        hour < 6 -> "좋은 밤이에요"
        hour < 12 -> "좋은 아침이에요"
        hour < 17 -> "좋은 오후예요"
        hour < 21 -> "좋은 저녁이에요"
        else -> "좋은 밤이에요"
    }
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = if (hour in 6..20) Icons.Outlined.Home else Icons.Outlined.Alarm,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.secondary,
                )
                Text(
                    text = greeting,
                    style = MaterialTheme.typography.displaySmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onBackground,
                )
            }
            Text(
                text = "소중한 사람의 목소리가 기다리고 있어요",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        AvatarBubble(label = authSession?.user?.name ?: authSession?.user?.email)
    }
}

@Composable
private fun AvatarBubble(label: String?) {
    Box(
        modifier = Modifier
            .size(42.dp)
            .background(MaterialTheme.colorScheme.surfaceVariant, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label?.firstOrNull()?.uppercaseChar()?.toString() ?: "V",
            color = MaterialTheme.colorScheme.primary,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
private fun ScreenHeader(
    title: String,
    subtitle: String,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            text = title,
            style = MaterialTheme.typography.displaySmall,
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = subtitle,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun HomeStatsRow(
    activeAlarms: Int,
    voiceCount: Int,
    friendCount: Int,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        StatPill(label = "활성 알람", count = activeAlarms, modifier = Modifier.weight(1f))
        StatPill(label = "음성", count = voiceCount, modifier = Modifier.weight(1f))
        StatPill(label = "친구", count = friendCount, modifier = Modifier.weight(1f))
    }
}

@Composable
private fun StatPill(
    label: String,
    count: Int,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = count.toString(),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary,
            )
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun CharacterMiniCard(
    characterResponse: CharacterResponse,
    pendingEvents: Int,
    onClick: () -> Unit,
) {
    val character = characterResponse.character
    Card(
        onClick = onClick,
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = stageEmoji(character.stage),
                style = MaterialTheme.typography.headlineMedium,
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = character.name,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = "Lv.${character.level} - ${stageLabel(character.stage)} - streak ${characterResponse.streak.current}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Box(
                    modifier = Modifier
                        .padding(top = 6.dp)
                        .fillMaxWidth()
                        .height(6.dp)
                        .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(999.dp)),
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth(
                                fraction = (
                                    characterResponse.progress.xpIntoLevel.toFloat() /
                                        characterResponse.progress.levelSpan.toFloat().coerceAtLeast(1f)
                                    ).coerceIn(0f, 1f),
                            )
                            .height(6.dp)
                            .background(MaterialTheme.colorScheme.primary, RoundedCornerShape(999.dp)),
                    )
                }
            }
            Text(
                text = if (pendingEvents > 0) "$pendingEvents sync" else ">",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

@Composable
private fun NextAlarmHeroCard(
    nextAlarm: AlarmEntity?,
    onClick: () -> Unit,
) {
    Card(
        onClick = onClick,
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primary),
        elevation = CardDefaults.cardElevation(defaultElevation = 6.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = "다음 알람",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.72f),
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = nextAlarm?.let { "%02d:%02d".format(it.hour, it.minute) } ?: "--:--",
                style = MaterialTheme.typography.displayLarge,
                color = MaterialTheme.colorScheme.onPrimary,
                fontWeight = FontWeight.Bold,
            )
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = Icons.Outlined.Alarm,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.8f),
                    modifier = Modifier.size(18.dp),
                )
                Text(
                    text = nextAlarm?.let { "${it.label} - ${playModeLabel(it.playMode)}" }
                        ?: "아직 설정된 알람이 없어요. 눌러서 만들어보세요.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.86f),
                )
            }
        }
    }
}

@Composable
private fun QuickStartGrid(
    onRecordVoice: () -> Unit,
    onAddAlarm: () -> Unit,
    onLoadVoices: () -> Unit,
    onManagePeople: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            text = "빠른 시작",
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            HomeActionCard(
                label = "음성 녹음",
                icon = Icons.Outlined.Mic,
                onClick = onRecordVoice,
                modifier = Modifier.weight(1f),
            )
            HomeActionCard(
                label = "알람 추가",
                icon = Icons.Outlined.Alarm,
                onClick = onAddAlarm,
                modifier = Modifier.weight(1f),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            HomeActionCard(
                label = "음성 불러오기",
                icon = Icons.Outlined.Message,
                onClick = onLoadVoices,
                modifier = Modifier.weight(1f),
            )
            HomeActionCard(
                label = "친구 관리",
                icon = Icons.Outlined.People,
                onClick = onManagePeople,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun HomeActionCard(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        onClick = onClick,
        modifier = modifier,
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 20.dp, horizontal = 14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.secondary,
                modifier = Modifier.size(30.dp),
            )
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

@Composable
private fun VoiceMethodGrid(onCreateAlarm: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            text = "등록 방법",
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            HomeActionCard(
                label = "녹음",
                icon = Icons.Outlined.Mic,
                onClick = onCreateAlarm,
                modifier = Modifier.weight(1f),
            )
            HomeActionCard(
                label = "파일 업로드",
                icon = Icons.Outlined.Message,
                onClick = onCreateAlarm,
                modifier = Modifier.weight(1f),
            )
        }
        MutedText("선택하거나 녹음한 오디오는 알람 예약 전에 로컬에 저장됩니다.")
    }
}

@Composable
private fun AlarmsHeader(onCreateAlarm: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = "알람",
            style = MaterialTheme.typography.displaySmall,
            fontWeight = FontWeight.Bold,
        )
        Button(
            onClick = onCreateAlarm,
            shape = RoundedCornerShape(999.dp),
            contentPadding = PaddingValues(horizontal = 18.dp, vertical = 8.dp),
        ) {
            Text("+ 추가")
        }
    }
}

@Composable
private fun CountdownBanner(nextAlarm: AlarmEntity) {
    Card(
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.34f),
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "다음 알람",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.width(8.dp))
            Text(
                text = formatFireTime(nextAlarm.fireAtMillis),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

@Composable
private fun EmptyAlarmCard(onCreateAlarm: () -> Unit) {
    Card(
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(
                imageVector = Icons.Outlined.Alarm,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.secondary,
                modifier = Modifier.size(56.dp),
            )
            Text(
                text = "알람이 없어요",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
            Text(
                text = "소중한 사람의 목소리로 하루를 시작해보세요.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Button(onClick = onCreateAlarm, shape = RoundedCornerShape(999.dp)) {
                Text("첫 알람 만들기")
            }
        }
    }
}

@Composable
private fun LegacyPanel(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            content = content,
        )
    }
}

@Composable
private fun AlarmEditorScreen(
    contentPadding: PaddingValues,
    alarm: AlarmEntity?,
    onCancel: () -> Unit,
    onSave: (AlarmDraft) -> Unit,
) {
    val editor = remember(alarm?.id) { AlarmEditorState.from(alarm) }
    val context = LocalContext.current
    val appContext = context.applicationContext
    val audioStore = remember(appContext) { AlarmAudioStore(appContext) }
    val recorder = remember(appContext) { AlarmVoiceRecorder(appContext, audioStore) }
    val scope = rememberCoroutineScope()
    var audioMessage by remember { mutableStateOf<String?>(null) }
    var isRecording by remember { mutableStateOf(false) }

    fun applyCachedAudio(audio: CachedAlarmAudio) {
        editor.setCachedAudio(audio)
        val seconds = audio.durationMillis?.let { " (${it / 1000}s)" } ?: ""
        audioMessage = "Voice audio ready$seconds"
    }

    fun cacheSelectedAudio(uri: Uri) {
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) { audioStore.cacheFromUri(uri) }
            }.onSuccess(::applyCachedAudio)
                .onFailure { error ->
                    Log.e(TAG, "Failed to cache selected audio", error)
                    audioMessage = error.message ?: "Unable to use selected audio"
                }
        }
    }

    fun stopRecording() {
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) { recorder.stop() }
            }.onSuccess { audio ->
                isRecording = false
                applyCachedAudio(audio)
            }.onFailure { error ->
                isRecording = false
                Log.e(TAG, "Failed to stop recording", error)
                audioMessage = error.message ?: "Recording failed"
            }
        }
    }

    fun startRecording() {
        runCatching {
            recorder.start()
            isRecording = true
            audioMessage = "Recording..."
        }.onFailure { error ->
            Log.e(TAG, "Failed to start recording", error)
            audioMessage = error.message ?: "Unable to start recording"
        }
    }

    val pickAudioLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) cacheSelectedAudio(uri)
    }
    val recordPermissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            startRecording()
        } else {
            audioMessage = "Microphone permission is required"
        }
    }

    LaunchedEffect(isRecording) {
        if (isRecording) {
            delay(AlarmAudioLimits.MAX_DURATION_MILLIS)
            if (isRecording) stopRecording()
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            if (recorder.isRecording) recorder.cancel()
        }
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(contentPadding),
        contentPadding = PaddingValues(start = 24.dp, top = 20.dp, end = 24.dp, bottom = 36.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        item {
            AlarmEditorIntro(alarm = alarm)
        }

        item {
            EditorSectionTitle("시간")
            AlarmTimePickerCard(
                hour = editor.hour,
                minute = editor.minute,
                onHourDown = { editor.hour = (editor.hour + 23) % 24 },
                onHourUp = { editor.hour = (editor.hour + 1) % 24 },
                onMinuteDown = { editor.minute = (editor.minute + 59) % 60 },
                onMinuteUp = { editor.minute = (editor.minute + 1) % 60 },
            )
        }

        item {
            EditorSectionTitle("반복")
            RepeatSelector(
                repeatDaysMask = editor.repeatDaysMask,
                onToggleDay = { dayIndex ->
                    editor.repeatDaysMask = editor.repeatDaysMask xor (1 shl dayIndex)
                },
                onQuickSelect = { mask -> editor.repeatDaysMask = mask },
            )
        }

        item {
            EditorSectionTitle("재생 모드")
            PlayModeSelector(
                selected = editor.playMode,
                onSelect = { editor.playMode = it },
            )
        }

        item {
            EditorSectionTitle("음성")
            VoiceAudioCard(
                localAudioUri = editor.localAudioUri,
                audioMessage = audioMessage,
                isRecording = isRecording,
                onPick = { pickAudioLauncher.launch("audio/*") },
                onRecord = {
                    if (isRecording) {
                        stopRecording()
                    } else if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) ==
                        PackageManager.PERMISSION_GRANTED
                    ) {
                        startRecording()
                    } else {
                        recordPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                    }
                },
                onClear = {
                    editor.clearAudio()
                    audioMessage = "음성 오디오를 지웠어요"
                },
            )
        }

        item {
            AlarmSettingsCard(
                snoozeMinutes = editor.snoozeMinutes,
                vibrationPattern = editor.vibrationPattern,
                onSnoozeDown = { editor.snoozeMinutes = (editor.snoozeMinutes - 1).coerceAtLeast(1) },
                onSnoozeUp = { editor.snoozeMinutes = (editor.snoozeMinutes + 1).coerceAtMost(30) },
                onVibrationSelect = { editor.vibrationPattern = it },
            )
        }

        item {
            EditorSectionTitle("알람 이름")
            OutlinedTextField(
                value = editor.label,
                onValueChange = { editor.label = it },
                label = { Text("이름") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        item {
            EditorActionButtons(
                isEditing = alarm != null,
                onCancel = onCancel,
                onSave = { onSave(editor.toDraft()) },
            )
        }
    }
}

@Composable
private fun AlarmEditorIntro(alarm: AlarmEntity?) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            text = if (alarm == null) "알람 설정" else "알람 편집",
            style = MaterialTheme.typography.displaySmall,
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = "울리는 순간에는 로컬에 저장된 시간과 오디오만 사용합니다.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun EditorSectionTitle(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleLarge,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onBackground,
    )
}

@Composable
private fun AlarmTimePickerCard(
    hour: Int,
    minute: Int,
    onHourDown: () -> Unit,
    onHourUp: () -> Unit,
    onMinuteDown: () -> Unit,
    onMinuteUp: () -> Unit,
) {
    Card(
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 18.dp, vertical = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Surface(
                shape = RoundedCornerShape(999.dp),
                color = MaterialTheme.colorScheme.surfaceVariant,
            ) {
                Text(
                    text = amPmLabel(hour),
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Row(
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TimeWheelColumn(
                    value = "%02d".format(hour12(hour)),
                    contentDescription = "시간",
                    onDecrease = onHourDown,
                    onIncrease = onHourUp,
                )
                Text(
                    text = ":",
                    style = MaterialTheme.typography.displayMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.padding(horizontal = 4.dp),
                )
                TimeWheelColumn(
                    value = "%02d".format(minute),
                    contentDescription = "분",
                    onDecrease = onMinuteDown,
                    onIncrease = onMinuteUp,
                )
            }
            Text(
                text = timeUntilAlarmLabel(hour, minute),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

@Composable
private fun TimeWheelColumn(
    value: String,
    contentDescription: String,
    onDecrease: () -> Unit,
    onIncrease: () -> Unit,
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        IconButton(onClick = onIncrease) {
            Icon(Icons.Outlined.Add, contentDescription = "$contentDescription 올리기")
        }
        Text(
            text = value,
            style = MaterialTheme.typography.displayLarge,
            fontWeight = FontWeight.Normal,
            color = MaterialTheme.colorScheme.onSurface,
        )
        IconButton(onClick = onDecrease) {
            Icon(Icons.Outlined.Remove, contentDescription = "$contentDescription 내리기")
        }
    }
}

@Composable
private fun RepeatSelector(
    repeatDaysMask: Int,
    onToggleDay: (Int) -> Unit,
    onQuickSelect: (Int) -> Unit,
) {
    val days = listOf("일", "월", "화", "수", "목", "금", "토")
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            days.forEachIndexed { index, label ->
                DayCircleChip(
                    label = label,
                    selected = repeatDaysMask and (1 shl index) != 0,
                    onClick = { onToggleDay(index) },
                )
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            QuickChip(label = "매일", onClick = { onQuickSelect(0b1111111) })
            QuickChip(label = "평일", onClick = { onQuickSelect(0b0111110) })
            QuickChip(label = "주말", onClick = { onQuickSelect(0b1000001) })
            QuickChip(label = "한 번", onClick = { onQuickSelect(0) })
        }
        MutedText(if (repeatDaysMask == 0) "한 번만 울려요" else repeatLabel(repeatDaysMask))
    }
}

@Composable
private fun DayCircleChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        modifier = Modifier.size(42.dp),
        shape = CircleShape,
        color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface,
        tonalElevation = 0.dp,
        shadowElevation = 0.dp,
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                color = if (selected) {
                    MaterialTheme.colorScheme.onPrimary
                } else {
                    MaterialTheme.colorScheme.onSurface
                },
            )
        }
    }
}

@Composable
private fun QuickChip(
    label: String,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(999.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Text(
            text = label,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 7.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun PlayModeSelector(
    selected: String,
    onSelect: (String) -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        PlayModeChip(
            label = "알람만",
            selected = selected == AlarmPlayModes.ALARM_ONLY,
            onClick = { onSelect(AlarmPlayModes.ALARM_ONLY) },
            modifier = Modifier.weight(1f),
        )
        PlayModeChip(
            label = "음성만",
            selected = selected == AlarmPlayModes.VOICE_ONLY,
            onClick = { onSelect(AlarmPlayModes.VOICE_ONLY) },
            modifier = Modifier.weight(1f),
        )
        PlayModeChip(
            label = "알람+음성",
            selected = selected == AlarmPlayModes.ALARM_VOICE,
            onClick = { onSelect(AlarmPlayModes.ALARM_VOICE) },
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun PlayModeChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        onClick = onClick,
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
        color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface,
    ) {
        Text(
            text = label,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 14.dp),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            color = if (selected) {
                MaterialTheme.colorScheme.onPrimary
            } else {
                MaterialTheme.colorScheme.onSurface
            },
        )
    }
}

@Composable
private fun VoiceAudioCard(
    localAudioUri: String?,
    audioMessage: String?,
    isRecording: Boolean,
    onPick: () -> Unit,
    onRecord: () -> Unit,
    onClear: () -> Unit,
) {
    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = localAudioUri?.let(::audioFileLabel) ?: "선택된 음성 오디오가 없어요",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedButton(
                    onClick = onPick,
                    modifier = Modifier.weight(1f),
                ) {
                    Text("파일 선택")
                }
                Button(
                    onClick = onRecord,
                    modifier = Modifier.weight(1f),
                ) {
                    Text(if (isRecording) "녹음 종료" else "녹음")
                }
            }
            if (localAudioUri != null) {
                OutlinedButton(onClick = onClear, modifier = Modifier.fillMaxWidth()) {
                    Text("음성 지우기")
                }
            }
            Text(
                text = "최대 ${AlarmAudioLimits.MAX_DURATION_MILLIS / 1000}초까지 사용할 수 있어요",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (audioMessage != null) {
                Text(
                    text = audioMessage,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (isRecording) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                )
            }
        }
    }
}

@Composable
private fun AlarmSettingsCard(
    snoozeMinutes: Int,
    vibrationPattern: String,
    onSnoozeDown: () -> Unit,
    onSnoozeUp: () -> Unit,
    onVibrationSelect: (String) -> Unit,
) {
    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(modifier = Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    Text("다시 울림", fontWeight = FontWeight.SemiBold)
                    MutedText("${snoozeMinutes}분")
                }
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    IconButton(onClick = onSnoozeDown) {
                        Icon(Icons.Outlined.Remove, contentDescription = "다시 울림 줄이기")
                    }
                    IconButton(onClick = onSnoozeUp) {
                        Icon(Icons.Outlined.Add, contentDescription = "다시 울림 늘리기")
                    }
                }
            }
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(1.dp)
                    .background(MaterialTheme.colorScheme.outlineVariant),
            )
            Text("진동", fontWeight = FontWeight.SemiBold)
            OptionChips(
                options = listOf(
                    VibrationPatterns.DEFAULT to "기본",
                    VibrationPatterns.STRONG to "강하게",
                    VibrationPatterns.NONE to "없음",
                ),
                selected = vibrationPattern,
                onSelect = onVibrationSelect,
            )
        }
    }
}

@Composable
private fun EditorActionButtons(
    isEditing: Boolean,
    onCancel: () -> Unit,
    onSave: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        OutlinedButton(
            onClick = onCancel,
            modifier = Modifier.weight(1f),
        ) {
            Text("취소")
        }
        Button(
            onClick = onSave,
            modifier = Modifier.weight(1f),
            shape = RoundedCornerShape(16.dp),
        ) {
            Icon(Icons.Outlined.Save, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(if (isEditing) "변경사항 저장" else "알람 설정하기")
        }
    }
}

private fun amPmLabel(hour: Int): String = if (hour < 12) "오전" else "오후"

private fun hour12(hour: Int): Int = when (val value = hour % 12) {
    0 -> 12
    else -> value
}

private fun timeUntilAlarmLabel(hour: Int, minute: Int): String {
    val now = java.time.LocalDateTime.now()
    var fireAt = now.withHour(hour).withMinute(minute).withSecond(0).withNano(0)
    if (!fireAt.isAfter(now)) fireAt = fireAt.plusDays(1)
    val duration = java.time.Duration.between(now, fireAt)
    val hours = duration.toHours()
    val minutes = duration.minusHours(hours).toMinutes()
    return when {
        hours == 0L -> "${minutes.coerceAtLeast(1)}분 후에 울려요"
        minutes == 0L -> "${hours}시간 후에 울려요"
        else -> "${hours}시간 ${minutes}분 후에 울려요"
    }
}

private class AlarmEditorState(
    label: String,
    hour: Int,
    minute: Int,
    repeatDaysMask: Int,
    snoozeMinutes: Int,
    vibrationPattern: String,
    playMode: String,
    localAudioUri: String?,
    rawAudioUri: String?,
) {
    var label by mutableStateOf(label)
    var hour by mutableIntStateOf(hour)
    var minute by mutableIntStateOf(minute)
    var repeatDaysMask by mutableIntStateOf(repeatDaysMask)
    var snoozeMinutes by mutableIntStateOf(snoozeMinutes)
    var vibrationPattern by mutableStateOf(vibrationPattern)
    var playMode by mutableStateOf(playMode)
    var localAudioUri by mutableStateOf(localAudioUri)
    var rawAudioUri by mutableStateOf(rawAudioUri)

    fun toDraft(): AlarmDraft = AlarmDraft(
        label = label,
        hour = hour,
        minute = minute,
        repeatDaysMask = repeatDaysMask,
        snoozeMinutes = snoozeMinutes,
        vibrationPattern = vibrationPattern,
        playMode = playMode,
        localAudioUri = localAudioUri,
        rawAudioUri = rawAudioUri,
    )

    fun setCachedAudio(audio: CachedAlarmAudio) {
        localAudioUri = audio.localAudioUri
        rawAudioUri = audio.rawAudioUri
    }

    fun clearAudio() {
        localAudioUri = null
        rawAudioUri = null
    }

    companion object {
        fun from(alarm: AlarmEntity?): AlarmEditorState {
            val defaultTime = java.time.LocalTime.now().plusMinutes(5)
            return AlarmEditorState(
                label = alarm?.label ?: "Morning alarm",
                hour = alarm?.hour ?: defaultTime.hour,
                minute = alarm?.minute ?: defaultTime.minute,
                repeatDaysMask = alarm?.repeatDaysMask ?: 0,
                snoozeMinutes = alarm?.snoozeMinutes ?: 5,
                vibrationPattern = alarm?.vibrationPattern ?: VibrationPatterns.DEFAULT,
                playMode = alarm?.playMode ?: AlarmPlayModes.ALARM_ONLY,
                localAudioUri = alarm?.localAudioUri,
                rawAudioUri = alarm?.rawAudioUri,
            )
        }
    }
}

@Composable
private fun StepperField(
    label: String,
    valueLabel: String,
    onDecrease: () -> Unit,
    onIncrease: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column {
            Text(text = label, fontWeight = FontWeight.Medium)
            Text(
                text = valueLabel,
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            IconButton(onClick = onDecrease) {
                Icon(Icons.Outlined.Remove, contentDescription = "Decrease $label")
            }
            IconButton(onClick = onIncrease) {
                Icon(Icons.Outlined.Add, contentDescription = "Increase $label")
            }
        }
    }
}

@Composable
private fun OptionSection(
    title: String,
    content: @Composable ColumnScope.() -> Unit,
) {
    OutlinedCard {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            content = {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                content()
            },
        )
    }
}

@Composable
private fun DayRows(
    repeatDaysMask: Int,
    onToggleDay: (Int) -> Unit,
) {
    val days = listOf(
        0 to "Sun",
        1 to "Mon",
        2 to "Tue",
        3 to "Wed",
        4 to "Thu",
        5 to "Fri",
        6 to "Sat",
    )
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            days.take(4).forEach { (index, label) ->
                DayChip(index, label, repeatDaysMask, onToggleDay)
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            days.drop(4).forEach { (index, label) ->
                DayChip(index, label, repeatDaysMask, onToggleDay)
            }
        }
        Text(
            text = if (repeatDaysMask == 0) "Once" else repeatLabel(repeatDaysMask),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun DayChip(
    dayIndex: Int,
    label: String,
    repeatDaysMask: Int,
    onToggleDay: (Int) -> Unit,
) {
    FilterChip(
        selected = repeatDaysMask and (1 shl dayIndex) != 0,
        onClick = { onToggleDay(dayIndex) },
        label = { Text(label) },
    )
}

@Composable
private fun OptionChips(
    options: List<Pair<String, String>>,
    selected: String,
    onSelect: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            options.forEach { (value, label) ->
                FilterChip(
                    selected = selected == value,
                    onClick = { onSelect(value) },
                    label = { Text(label) },
                )
            }
        }
    }
}

@Composable
private fun AccountPanel(
    authSession: AuthSession?,
    authBusy: Boolean,
    syncBusy: Boolean,
    voiceProfiles: List<VoiceProfile>,
    voiceProfileBusy: Boolean,
    onLogin: (String, String) -> Unit,
    onRegister: (String, String, String) -> Unit,
    onGoogleSignIn: () -> Unit,
    onSyncNow: () -> Unit,
    onLoadVoiceProfiles: () -> Unit,
    onLogout: () -> Unit,
) {
    var mode by remember { mutableStateOf("login") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }

    OutlinedCard {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = "계정",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )

            if (authSession != null) {
                Text(
                    text = authSession.user.email.ifBlank { authSession.user.name.ifBlank { authSession.provider } },
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = "Provider ${authSession.provider} - plan ${authSession.user.plan}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Button(
                        onClick = onSyncNow,
                        enabled = !syncBusy,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text(if (syncBusy) "동기화 중" else "지금 동기화")
                    }
                    OutlinedButton(
                        onClick = onLogout,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text("로그아웃")
                    }
                }
                OutlinedButton(
                    onClick = onLoadVoiceProfiles,
                    enabled = !voiceProfileBusy,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(if (voiceProfileBusy) "불러오는 중" else "음성 불러오기")
                }
                if (voiceProfiles.isNotEmpty()) {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        voiceProfiles.take(3).forEach { profile ->
                            Text(
                                text = "${profile.name} (${profile.status ?: "ready"})",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        if (voiceProfiles.size > 3) {
                            Text(
                                text = "+${voiceProfiles.size - 3} more",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            } else {
                OptionChips(
                    options = listOf(
                        "login" to "로그인",
                        "register" to "가입",
                    ),
                    selected = mode,
                    onSelect = { mode = it },
                )

                if (mode == "register") {
                    OutlinedTextField(
                        value = name,
                        onValueChange = { name = it },
                        label = { Text("이름") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Text,
                            imeAction = ImeAction.Next,
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("이메일") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Email,
                        imeAction = ImeAction.Next,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )

                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("비밀번호") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Password,
                        imeAction = ImeAction.Done,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    onClick = {
                        if (mode == "register") {
                            onRegister(email, password, name)
                        } else {
                            onLogin(email, password)
                        }
                    },
                    enabled = !authBusy,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        when {
                            authBusy -> "Working"
                            mode == "register" -> "계정 만들기"
                            else -> "로그인"
                        },
                    )
                }

                OutlinedButton(
                    onClick = onGoogleSignIn,
                    enabled = !authBusy,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Google로 계속하기")
                }
            }
        }
    }
}

@Composable
private fun SocialPanel(
    socialBusy: Boolean,
    friends: List<Friend>,
    pendingFriends: List<PendingFriendRequest>,
    familyGroup: FamilyGroupCurrentResponse?,
    familyInvites: List<FamilyInvite>,
    familyVoices: List<FamilyVoiceProfile>,
    onRefreshSocial: () -> Unit,
    onSendFriendRequest: (String) -> Unit,
    onAcceptFriendRequest: (String) -> Unit,
    onCreateFamilyInvite: () -> Unit,
    onAcceptFamilyInvite: (String) -> Unit,
    onRevokeFamilyInvite: (String) -> Unit,
) {
    var friendEmail by remember { mutableStateOf("") }
    var inviteCode by remember { mutableStateOf("") }

    OutlinedCard {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            PanelHeader(
                title = "People",
                actionLabel = if (socialBusy) "Loading" else "Refresh",
                enabled = !socialBusy,
                onAction = onRefreshSocial,
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedTextField(
                    value = friendEmail,
                    onValueChange = { friendEmail = it },
                    label = { Text("Friend email") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                    modifier = Modifier.weight(1f),
                )
                Button(
                    onClick = { onSendFriendRequest(friendEmail) },
                    enabled = friendEmail.isNotBlank() && !socialBusy,
                ) {
                    Text("Send")
                }
            }

            if (pendingFriends.isNotEmpty()) {
                Text("Pending requests", fontWeight = FontWeight.SemiBold)
                pendingFriends.take(3).forEach { request ->
                    CompactActionRow(
                        title = request.requesterName ?: request.requesterEmail ?: "Pending request",
                        subtitle = request.requesterEmail ?: request.createdAt.orEmpty(),
                        actionLabel = "Accept",
                        onAction = { onAcceptFriendRequest(request.id) },
                    )
                }
            }

            Text("Friends ${friends.size}", fontWeight = FontWeight.SemiBold)
            if (friends.isEmpty()) {
                MutedText("No accepted friends loaded")
            } else {
                friends.take(4).forEach { friend ->
                    MutedText(friend.friendName ?: friend.friendEmail ?: friend.id)
                }
            }

            Text("Family", fontWeight = FontWeight.SemiBold)
            val group = familyGroup
            if (group?.group == null) {
                MutedText("No family group loaded")
            } else {
                MutedText("${group.role ?: "member"} - ${group.members.size}/${group.group.maxMembers} members")
                group.members.take(4).forEach { member ->
                    MutedText("${member.name ?: member.email ?: member.userId} (${member.role})")
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedTextField(
                    value = inviteCode,
                    onValueChange = { inviteCode = it },
                    label = { Text("Invite code") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.weight(1f),
                )
                Button(
                    onClick = { onAcceptFamilyInvite(inviteCode) },
                    enabled = inviteCode.isNotBlank() && !socialBusy,
                ) {
                    Text("Join")
                }
            }

            OutlinedButton(
                onClick = onCreateFamilyInvite,
                enabled = !socialBusy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Create family invite")
            }

            familyInvites.take(3).forEach { invite ->
                CompactActionRow(
                    title = invite.code,
                    subtitle = "${invite.status} - expires ${invite.expiresAt ?: "unknown"}",
                    actionLabel = "Revoke",
                    enabled = invite.status == "pending" && !socialBusy,
                    onAction = { onRevokeFamilyInvite(invite.code) },
                )
            }

            Text("Shared voices ${familyVoices.size}", fontWeight = FontWeight.SemiBold)
            if (familyVoices.isEmpty()) {
                MutedText("No shared voices loaded")
            } else {
                familyVoices.take(4).forEach { voice ->
                    MutedText("${voice.name} - ${voice.ownerName ?: "family"} (${voice.status ?: "ready"})")
                }
            }

            MutedText("Shared-voice TTS generation is intentionally not called here.")
        }
    }
}

@Composable
private fun CharacterBillingPanel(
    characterEvents: List<CharacterEventEntity>,
    characterBusy: Boolean,
    characterResponse: CharacterResponse?,
    billingBusy: Boolean,
    subscriptionResponse: BillingSubscriptionResponse?,
    vouchers: List<VoucherItem>,
    onRefresh: () -> Unit,
    onSyncEvents: () -> Unit,
    onRegisterCode: (String) -> Unit,
) {
    var code by remember { mutableStateOf("") }
    val pendingEvents = characterEvents.count { it.state != "synced" }

    OutlinedCard {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            PanelHeader(
                title = "Growth",
                actionLabel = if (characterBusy || billingBusy) "Loading" else "Refresh",
                enabled = !characterBusy && !billingBusy,
                onAction = onRefresh,
            )

            if (characterResponse == null) {
                MutedText("Character data not loaded")
            } else {
                val character = characterResponse.character
                Text(
                    text = "${stageEmoji(character.stage)} ${character.name}",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                MutedText(
                    "Level ${character.level} - ${stageLabel(character.stage)} - XP ${character.xp} - affection ${character.affection}",
                )
                MutedText(
                    "Streak ${characterResponse.streak.current} days - longest ${characterResponse.streak.longest}",
                )
                MutedText(
                    "Progress ${characterResponse.progress.xpIntoLevel}/${characterResponse.progress.levelSpan}",
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Button(
                    onClick = onSyncEvents,
                    enabled = pendingEvents > 0 && !characterBusy,
                    modifier = Modifier.weight(1f),
                ) {
                    Text("Sync XP")
                }
                OutlinedButton(
                    onClick = onRefresh,
                    enabled = !characterBusy && !billingBusy,
                    modifier = Modifier.weight(1f),
                ) {
                    Text("$pendingEvents queued")
                }
            }

            val plan = subscriptionResponse?.plan
            Text("Plan", fontWeight = FontWeight.SemiBold)
            if (plan == null) {
                MutedText("Free plan or no active subscription")
            } else {
                MutedText("${plan.name} - ${plan.planType} - ${plan.maxMembers} members")
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedTextField(
                    value = code,
                    onValueChange = { code = it },
                    label = { Text("Coupon or invite code") },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                Button(
                    onClick = { onRegisterCode(code) },
                    enabled = code.isNotBlank() && !billingBusy,
                ) {
                    Text("Apply")
                }
            }

            Text("Coupons ${vouchers.size}", fontWeight = FontWeight.SemiBold)
            if (vouchers.isEmpty()) {
                MutedText("No issued coupons loaded")
            } else {
                vouchers.take(3).forEach { voucher ->
                    MutedText("${voucher.code} - ${voucher.planName} - ${voucher.status}")
                }
            }
        }
    }
}

@Composable
private fun PanelHeader(
    title: String,
    actionLabel: String,
    enabled: Boolean,
    onAction: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
        )
        TextButton(onClick = onAction, enabled = enabled) {
            Text(actionLabel)
        }
    }
}

@Composable
private fun CompactActionRow(
    title: String,
    subtitle: String,
    actionLabel: String,
    enabled: Boolean = true,
    onAction: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, fontWeight = FontWeight.Medium)
            MutedText(subtitle)
        }
        TextButton(onClick = onAction, enabled = enabled) {
            Text(actionLabel)
        }
    }
}

@Composable
private fun MutedText(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun PermissionPanel(
    permissions: PermissionSnapshot,
    onRequestNotifications: () -> Unit,
    onRequestExactAlarms: () -> Unit,
    onRequestFullScreen: () -> Unit,
) {
    OutlinedCard {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = "Permissions",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            PermissionRow(
                icon = Icons.Outlined.Alarm,
                label = "Exact alarms",
                granted = permissions.exactAlarms,
                actionLabel = "Open",
                onAction = onRequestExactAlarms,
            )
            PermissionRow(
                icon = Icons.Outlined.Notifications,
                label = "Notifications",
                granted = permissions.notifications,
                actionLabel = "Allow",
                onAction = onRequestNotifications,
            )
            PermissionRow(
                icon = Icons.Outlined.Fullscreen,
                label = "Full screen",
                granted = permissions.fullScreenIntent,
                actionLabel = "Open",
                onAction = onRequestFullScreen,
            )
        }
    }
}

@Composable
private fun PermissionRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    granted: Boolean,
    actionLabel: String,
    onAction: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(icon, contentDescription = null)
            Column {
                Text(text = label, fontWeight = FontWeight.Medium)
                Text(
                    text = if (granted) "Allowed" else "Required",
                    style = MaterialTheme.typography.bodySmall,
                    color = if (granted) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.error
                    },
                )
            }
        }
        if (granted) {
            Icon(Icons.Outlined.CheckCircle, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
        } else {
            TextButton(onClick = onAction) {
                Icon(Icons.Outlined.ErrorOutline, contentDescription = null)
                Spacer(Modifier.width(6.dp))
                Text(actionLabel)
            }
        }
    }
}

@Composable
private fun AlarmRow(
    alarm: AlarmEntity,
    onToggleEnabled: (Boolean) -> Unit,
    onEditAlarm: () -> Unit,
    onDeleteAlarm: () -> Unit,
) {
    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    Text(
                        text = "%02d:%02d".format(alarm.hour, alarm.minute),
                        style = MaterialTheme.typography.displaySmall,
                        fontWeight = FontWeight.Normal,
                        color = if (alarm.enabled) {
                            MaterialTheme.colorScheme.onSurface
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                    Text(
                        text = alarm.label,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = if (alarm.enabled) {
                            MaterialTheme.colorScheme.onSurface
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                }
                Switch(
                    checked = alarm.enabled,
                    onCheckedChange = onToggleEnabled,
                )
            }
            Text(
                text = if (alarm.enabled) {
                    "Next ${formatFireTime(alarm.fireAtMillis)}"
                } else {
                    "Inactive"
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = "${repeatLabel(alarm.repeatDaysMask)} - snooze ${alarm.snoozeMinutes} min - ${vibrationLabel(alarm.vibrationPattern)} - ${playModeLabel(alarm.playMode)}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Surface(
                    shape = RoundedCornerShape(999.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant,
                ) {
                    Text(
                        text = "${alarm.state} - ${syncStateLabel(alarm.syncState)}",
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                        color = if (alarm.enabled) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    IconButton(onClick = onEditAlarm) {
                        Icon(Icons.Outlined.Edit, contentDescription = "Edit alarm")
                    }
                    IconButton(onClick = onDeleteAlarm) {
                        Icon(Icons.Outlined.Delete, contentDescription = "Delete alarm")
                    }
                }
            }
        }
    }
}

@Composable
private fun RefreshPermissionsOnResume(onResume: () -> Unit) {
    val lifecycleOwner = LocalLifecycleOwner.current
    val currentOnResume by rememberUpdatedState(onResume)

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) currentOnResume()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
        }
    }
}

private data class PermissionSnapshot(
    val exactAlarms: Boolean,
    val notifications: Boolean,
    val fullScreenIntent: Boolean,
) {
    companion object {
        fun read(context: Context): PermissionSnapshot {
            val alarmManager = requireNotNull(context.getSystemService<AlarmManager>())
            val notificationManager = NotificationManagerCompat.from(context)
            val platformNotificationManager = requireNotNull(context.getSystemService<NotificationManager>())

            val exactAlarms = Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
                alarmManager.canScheduleExactAlarms()
            val notifications = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                notificationManager.areNotificationsEnabled()
            val fullScreenIntent = Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE ||
                platformNotificationManager.canUseFullScreenIntent()

            return PermissionSnapshot(
                exactAlarms = exactAlarms,
                notifications = notifications,
                fullScreenIntent = fullScreenIntent,
            )
        }
    }
}

private fun Context.openExactAlarmSettings() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return

    val intent = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
        data = Uri.parse("package:$packageName")
    }
    startSettingsActivity(intent)
}

private fun Context.openFullScreenIntentSettings() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return

    val intent = Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
        data = Uri.parse("package:$packageName")
    }
    startSettingsActivity(intent)
}

private fun Context.startSettingsActivity(intent: Intent) {
    runCatching {
        startActivity(intent)
    }.recoverCatching { error ->
        if (error is ActivityNotFoundException) {
            startActivity(
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.parse("package:$packageName")
                },
            )
        } else {
            throw error
        }
    }.onFailure { error ->
        Log.e(TAG, "Failed to open settings", error)
    }
}

private fun formatFireTime(millis: Long): String {
    val formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")
    return Instant.ofEpochMilli(millis)
        .atZone(ZoneId.systemDefault())
        .format(formatter)
}

private fun audioFileLabel(localAudioUri: String): String =
    Uri.parse(localAudioUri).lastPathSegment
        ?.substringAfterLast('/')
        ?.ifBlank { null }
        ?: "Local voice audio"

private fun repeatLabel(mask: Int): String {
    if (mask == 0) return "Once"
    if (mask == 0b1111111) return "Every day"
    val days = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
    return days.filterIndexed { index, _ -> mask and (1 shl index) != 0 }.joinToString(", ")
}

private fun vibrationLabel(pattern: String): String = when (pattern) {
    VibrationPatterns.STRONG -> "strong vibration"
    VibrationPatterns.NONE -> "no vibration"
    else -> "default vibration"
}

private fun playModeLabel(mode: String): String = when (mode) {
    AlarmPlayModes.VOICE_ONLY -> "voice only"
    AlarmPlayModes.ALARM_VOICE -> "alarm + voice"
    else -> "alarm only"
}

private fun stageEmoji(stage: String): String = when (stage) {
    "sprout" -> "Sprout"
    "tree" -> "Tree"
    "bloom" -> "Bloom"
    else -> "Seed"
}

private fun stageLabel(stage: String): String = when (stage) {
    "sprout" -> "sprout"
    "tree" -> "tree"
    "bloom" -> "flower"
    else -> "seed"
}

private fun syncStateLabel(state: String): String = when (state) {
    AlarmSyncStates.SYNCED -> "synced"
    AlarmSyncStates.DIRTY -> "changed"
    AlarmSyncStates.FAILED -> "sync failed"
    else -> "local only"
}

@Composable
private fun VoiceAlarmTheme(content: @Composable () -> Unit) {
    val colorScheme = if (androidx.compose.foundation.isSystemInDarkTheme()) {
        androidx.compose.material3.darkColorScheme(
            primary = Color(0xFFF0C25C),
            onPrimary = Color(0xFF1F1B14),
            primaryContainer = Color(0xFFD8A93D),
            onPrimaryContainer = Color(0xFF1F1B14),
            secondary = Color(0xFF7B8FB5),
            onSecondary = Color(0xFF1F1B14),
            tertiary = Color(0xFFD89677),
            background = Color(0xFF1F1B14),
            onBackground = Color(0xFFF0EBE0),
            surface = Color(0xFF2A251D),
            surfaceVariant = Color(0xFF332C22),
            onSurface = Color(0xFFF0EBE0),
            onSurfaceVariant = Color(0xFFA89F8F),
            outline = Color(0xFF3A332A),
            outlineVariant = Color(0xFF3A332A),
            error = Color(0xFFD86F5E),
        )
    } else {
        androidx.compose.material3.lightColorScheme(
            primary = Color(0xFFE8B341),
            onPrimary = Color(0xFF2C2620),
            primaryContainer = Color(0xFFF2C669),
            onPrimaryContainer = Color(0xFF2C2620),
            secondary = Color(0xFF2D3E5C),
            onSecondary = Color(0xFFFFFFFF),
            tertiary = Color(0xFFC97B5C),
            background = Color(0xFFFBF8F2),
            onBackground = Color(0xFF2C2620),
            surface = Color(0xFFFFFFFF),
            surfaceVariant = Color(0xFFF5EFE0),
            onSurface = Color(0xFF2C2620),
            onSurfaceVariant = Color(0xFF6B6358),
            outline = Color(0xFFEAE3D2),
            outlineVariant = Color(0xFFEAE3D2),
            error = Color(0xFFB84A3D),
        )
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = VoiceAlarmTypography,
    ) {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = MaterialTheme.colorScheme.background,
            content = content,
        )
    }
}
