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
import android.util.Base64
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
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
import androidx.compose.foundation.layout.offset
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
import androidx.compose.material3.AlertDialog
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
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
import com.voicealarm.nativeapp.data.VoiceSources
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
import com.voicealarm.nativeapp.network.TtsGenerateRequest
import com.voicealarm.nativeapp.network.TtsGenerateResponse
import com.voicealarm.nativeapp.network.TtsMessage
import com.voicealarm.nativeapp.network.TtsMessageAudioResponse
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
import kotlin.math.abs
import kotlin.math.roundToInt

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

    var ttsMessages by mutableStateOf<List<TtsMessage>>(emptyList())
        private set

    var ttsMessageBusy by mutableStateOf(false)
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

    suspend fun generateTtsAudio(request: TtsGenerateRequest): TtsGenerateResponse {
        val session = authSession ?: throw IllegalStateException("Sign in before generating voice audio")
        return withContext(Dispatchers.IO) {
            api.generateTts(VoiceAlarmApiClient.bearer(session.token), request)
        }
    }

    fun loadTtsMessages() {
        val session = authSession
        if (session == null) {
            message = "Sign in before loading saved voices"
            return
        }
        viewModelScope.launch {
            ttsMessageBusy = true
            runCatching {
                api.listTtsMessages(VoiceAlarmApiClient.bearer(session.token)).messages
            }.onSuccess { messages ->
                ttsMessages = messages
                message = "Loaded ${messages.size} saved voices"
            }.onFailure { error ->
                Log.e(TAG, "Failed to load saved TTS messages", error)
                message = error.message ?: "Failed to load saved voices"
            }
            ttsMessageBusy = false
        }
    }

    suspend fun downloadTtsMessageAudio(messageId: String): TtsMessageAudioResponse {
        val session = authSession ?: throw IllegalStateException("Sign in before loading saved voice audio")
        return withContext(Dispatchers.IO) {
            api.getTtsMessageAudio(VoiceAlarmApiClient.bearer(session.token), messageId)
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
    val ttsMessages = viewModel.ttsMessages
    val ttsMessageBusy = viewModel.ttsMessageBusy
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
    var tabBackStack by remember { mutableStateOf<List<NativeTab>>(emptyList()) }
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
                        IconButton(onClick = ::goBackInApp) {
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
                    onSelectTab = ::navigateToTab,
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
                onSelectTab = ::navigateToTab,
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
                authSession = authSession,
                voiceProfiles = voiceProfiles,
                voiceProfileBusy = voiceProfileBusy,
                ttsMessages = ttsMessages,
                ttsMessageBusy = ttsMessageBusy,
                onCancel = ::goBackInApp,
                onLoadVoiceProfiles = viewModel::loadVoiceProfiles,
                onLoadTtsMessages = viewModel::loadTtsMessages,
                onGenerateTts = viewModel::generateTtsAudio,
                onDownloadTtsMessageAudio = viewModel::downloadTtsMessageAudio,
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
                ttsMessages = ttsMessages,
                ttsMessageBusy = ttsMessageBusy,
                onCancel = ::goBackInApp,
                onLoadVoiceProfiles = viewModel::loadVoiceProfiles,
                onLoadTtsMessages = viewModel::loadTtsMessages,
                onGenerateTts = viewModel::generateTtsAudio,
                onDownloadTtsMessageAudio = viewModel::downloadTtsMessageAudio,
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
    authSession: AuthSession?,
    voiceProfiles: List<VoiceProfile>,
    voiceProfileBusy: Boolean,
    ttsMessages: List<TtsMessage>,
    ttsMessageBusy: Boolean,
    onCancel: () -> Unit,
    onLoadVoiceProfiles: () -> Unit,
    onLoadTtsMessages: () -> Unit,
    onGenerateTts: suspend (TtsGenerateRequest) -> TtsGenerateResponse,
    onDownloadTtsMessageAudio: suspend (String) -> TtsMessageAudioResponse,
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
    var isSaving by remember { mutableStateOf(false) }

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

    fun saveEditor() {
        if (isSaving) return
        if (editor.playMode == AlarmPlayModes.ALARM_ONLY) {
            editor.clearAudio()
            onSave(editor.toDraft())
            return
        }
        if (editor.voiceSource == VoiceSources.LOCAL_AUDIO) {
            if (editor.localAudioUri.isNullOrBlank()) {
                audioMessage = "음성 오디오를 녹음하거나 파일로 선택해 주세요"
                return
            }
            onSave(editor.toDraft())
            return
        }
        if (editor.voiceSource == VoiceSources.SERVER_TTS) {
            val messageId = editor.ttsMessageId
            if (authSession == null) {
                audioMessage = "서버에 저장된 음성은 로그인 후 사용할 수 있어요"
                return
            }
            if (messageId.isNullOrBlank()) {
                audioMessage = "사용할 서버 음성을 선택해 주세요"
                return
            }
            if (editor.localAudioUri != null) {
                onSave(editor.toDraft())
                return
            }

            scope.launch {
                isSaving = true
                audioMessage = "서버 음성을 내려받아 로컬에 저장하는 중..."
                runCatching {
                    val response = onDownloadTtsMessageAudio(messageId)
                    val audioBytes = Base64.decode(response.audioBase64, Base64.DEFAULT)
                    val cachedAudio = withContext(Dispatchers.IO) {
                        audioStore.cacheGeneratedAudio(
                            bytes = audioBytes,
                            format = response.audioFormat,
                            rawAudioUri = response.audioUrl,
                        )
                    }
                    editor.setServerTtsAudio(
                        audio = cachedAudio,
                        messageId = response.messageId,
                        text = response.text,
                        category = response.category,
                        voiceProfileId = response.voiceProfileId,
                        rawAudioUri = response.audioUrl,
                    )
                    audioMessage = "서버 음성을 로컬에 저장했어요"
                    onSave(editor.toDraft())
                }.onFailure { error ->
                    Log.e(TAG, "Failed to cache server TTS alarm audio", error)
                    audioMessage = error.message ?: "서버 음성을 저장하지 못했어요"
                }
                isSaving = false
            }
            return
        }

        val profileId = editor.voiceProfileId
            ?: voiceProfiles.firstOrNull { it.status == null || it.status == "ready" }?.id
        if (authSession == null) {
            audioMessage = "음성 프로필 TTS는 로그인 후 사용할 수 있어요"
            return
        }
        if (profileId.isNullOrBlank()) {
            audioMessage = "사용할 음성 프로필을 선택해 주세요"
            return
        }
        val text = editor.ttsTextForSave()
        if (text.isBlank()) {
            audioMessage = "읽어줄 문구를 입력하거나 랜덤 문구를 켜 주세요"
            return
        }
        if (editor.hasFreshTtsAudio(profileId, text)) {
            onSave(editor.toDraft())
            return
        }

        scope.launch {
            isSaving = true
            audioMessage = "음성을 생성해서 저장하는 중..."
            runCatching {
                val response = onGenerateTts(
                    TtsGenerateRequest(
                        voiceProfileId = profileId,
                        text = text,
                        category = editor.voiceCategory,
                        language = editor.voiceLanguage,
                    ),
                )
                val audioBytes = Base64.decode(response.audioBase64, Base64.DEFAULT)
                val rawAudioUri = response.audioUrl ?: response.audioObjectKey?.let { "r2://$it" }
                val cachedAudio = withContext(Dispatchers.IO) {
                    audioStore.cacheGeneratedAudio(
                        bytes = audioBytes,
                        format = response.audioFormat,
                        rawAudioUri = rawAudioUri,
                    )
                }
                editor.setGeneratedTtsAudio(
                    audio = cachedAudio,
                    profileId = profileId,
                    text = response.text,
                    messageId = response.messageId,
                    rawAudioUri = rawAudioUri,
                )
                audioMessage = "생성한 음성을 로컬에 저장했어요"
                onSave(editor.toDraft())
            }.onFailure { error ->
                Log.e(TAG, "Failed to generate TTS alarm audio", error)
                audioMessage = error.message ?: "음성 생성에 실패했어요"
            }
            isSaving = false
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
                onTimeChange = { selectedHour, selectedMinute ->
                    editor.hour = selectedHour
                    editor.minute = selectedMinute
                },
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
            EditorSectionTitle("반복")
            RepeatSelector(
                repeatDaysMask = editor.repeatDaysMask,
                holidayOff = editor.holidayOff,
                onToggleDay = { dayIndex ->
                    editor.repeatDaysMask = editor.repeatDaysMask xor (1 shl dayIndex)
                },
                onHolidayOffChange = { editor.holidayOff = it },
            )
        }

        item {
            EditorSectionTitle("재생 모드")
            PlayModeSelector(
                selected = editor.playMode,
                onSelect = { editor.playMode = it },
            )
        }

        if (editor.playMode != AlarmPlayModes.ALARM_ONLY) {
            item {
                EditorSectionTitle("음성")
                VoiceAudioCard(
                    editor = editor,
                    authSession = authSession,
                    voiceProfiles = voiceProfiles,
                    voiceProfileBusy = voiceProfileBusy,
                    ttsMessages = ttsMessages,
                    ttsMessageBusy = ttsMessageBusy,
                    audioMessage = audioMessage,
                    isRecording = isRecording,
                    onLoadVoiceProfiles = onLoadVoiceProfiles,
                    onLoadTtsMessages = onLoadTtsMessages,
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
        }

        item {
            AlarmSettingsCard(
                snoozeEnabled = editor.snoozeEnabled,
                snoozeMinutes = editor.snoozeMinutes,
                vibrationPattern = editor.vibrationPattern,
                onSnoozeEnabledChange = { editor.snoozeEnabled = it },
                onSnoozeMinutesChange = { editor.snoozeMinutes = it },
                onVibrationEnabledChange = {
                    editor.vibrationPattern = if (it) VibrationPatterns.DEFAULT else VibrationPatterns.NONE
                },
                onVibrationSelect = { editor.vibrationPattern = it },
            )
        }

        item {
            EditorActionButtons(
                isEditing = alarm != null,
                isSaving = isSaving,
                onCancel = onCancel,
                onSave = ::saveEditor,
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
    onTimeChange: (Int, Int) -> Unit,
) {
    val currentOnTimeChange by rememberUpdatedState(onTimeChange)
    val itemHeight = 76.dp
    var workingHour by remember { mutableIntStateOf(hour) }
    var workingMinute by remember { mutableIntStateOf(minute) }
    val isDark = androidx.compose.foundation.isSystemInDarkTheme()
    val selectedTextColor = if (isDark) Color.White else MaterialTheme.colorScheme.onSurface
    val pickerColor = if (isDark) Color.Black else MaterialTheme.colorScheme.surface

    LaunchedEffect(hour, minute) {
        workingHour = hour
        workingMinute = minute
    }

    fun commitTime(nextHour: Int, nextMinute: Int) {
        workingHour = nextHour
        workingMinute = nextMinute
        currentOnTimeChange(nextHour, nextMinute)
    }

    fun applyHourSteps(steps: Int) {
        if (steps == 0) return
        commitTime(floorMod(workingHour + steps, 24), workingMinute)
    }

    fun applyMinuteSteps(steps: Int) {
        if (steps == 0) return
        val totalMinutes = floorMod(workingHour * 60 + workingMinute + steps, 24 * 60)
        val nextHour = totalMinutes / 60
        val nextMinute = totalMinutes % 60
        commitTime(nextHour, nextMinute)
    }

    Card(
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = pickerColor),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 22.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                AmPmWheelColumn(
                    hour = workingHour,
                    itemHeight = itemHeight,
                    selectedColor = selectedTextColor,
                    onStep = { steps ->
                        if (abs(steps) % 2 == 1) {
                            commitTime((workingHour + 12) % 24, workingMinute)
                        }
                    },
                )
                DraggableTimeWheelColumn(
                    itemHeight = itemHeight,
                    selectedColor = selectedTextColor,
                    itemLabel = { offset -> "%d".format(hour12(workingHour + offset)) },
                    maxStepsPerGesture = 15,
                    onStep = ::applyHourSteps,
                    modifier = Modifier.weight(1f),
                )
                Box(
                    modifier = Modifier
                        .width(24.dp)
                        .height(itemHeight * 3),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = ":",
                        style = MaterialTheme.typography.displayLarge,
                        fontWeight = FontWeight.Bold,
                        color = selectedTextColor,
                        textAlign = TextAlign.Center,
                    )
                }
                DraggableTimeWheelColumn(
                    itemHeight = itemHeight,
                    selectedColor = selectedTextColor,
                    itemLabel = { offset -> "%02d".format(floorMod(workingMinute + offset, 60)) },
                    maxStepsPerGesture = 15,
                    onStep = ::applyMinuteSteps,
                    modifier = Modifier.weight(1f),
                )
            }
            Text(
                text = timeUntilAlarmLabel(workingHour, workingMinute),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

@Composable
private fun AmPmWheelColumn(
    hour: Int,
    itemHeight: androidx.compose.ui.unit.Dp,
    selectedColor: Color,
    onStep: (Int) -> Unit,
) {
    val amPmIndex = if (hour >= 12) 1 else 0
    val isPm = amPmIndex == 1
    val scope = rememberCoroutineScope()
    val itemHeightPx = with(LocalDensity.current) { itemHeight.toPx() }
    var dragOffsetPx by remember { mutableStateOf(0f) }
    val minOffset = if (isPm) -itemHeightPx * 0.22f else -itemHeightPx * 0.72f
    val maxOffset = if (isPm) itemHeightPx * 0.72f else itemHeightPx * 0.22f
    val rows = if (isPm) {
        listOf(-1 to "오전", 0 to "오후", null to "")
    } else {
        listOf(null to "", 0 to "오전", 1 to "오후")
    }
    val draggableState = rememberDraggableState { delta ->
        dragOffsetPx = (dragOffsetPx + delta).coerceIn(minOffset, maxOffset)
    }

    Box(
        modifier = Modifier
            .width(96.dp)
            .height(itemHeight * 3)
            .clipToBounds()
            .draggable(
                state = draggableState,
                orientation = Orientation.Vertical,
                onDragStopped = { velocity ->
                    val minFlingVelocity = itemHeightPx * 3.5f
                    val requestedStep = when {
                        !isPm && (dragOffsetPx <= -itemHeightPx * 0.38f || velocity < -minFlingVelocity) -> 1
                        isPm && (dragOffsetPx >= itemHeightPx * 0.38f || velocity > minFlingVelocity) -> -1
                        else -> 0
                    }
                    val startOffset = dragOffsetPx
                    scope.launch {
                        animateWheelSettle(
                            startOffsetPx = startOffset,
                            steps = requestedStep,
                            itemHeightPx = itemHeightPx,
                            onStep = onStep,
                            onOffsetChange = { dragOffsetPx = it },
                        )
                    }
                },
            ),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier.offset { IntOffset(0, dragOffsetPx.roundToInt()) },
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            rows.forEach { (step, label) ->
                val selected = step == 0
                Surface(
                    onClick = {
                        if (step != null && step != 0) {
                            scope.launch {
                                animateWheelSettle(
                                    startOffsetPx = 0f,
                                    steps = step,
                                    itemHeightPx = itemHeightPx,
                                    onStep = onStep,
                                    onOffsetChange = { dragOffsetPx = it },
                                )
                            }
                        }
                    },
                    color = Color.Transparent,
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(itemHeight),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Text(
                            text = label,
                            fontSize = if (selected) 38.sp else 32.sp,
                            lineHeight = if (selected) 42.sp else 36.sp,
                            fontWeight = if (selected) FontWeight.Bold else FontWeight.SemiBold,
                            color = selectedColor.copy(alpha = if (selected) 1f else 0.18f),
                            textAlign = TextAlign.Center,
                            maxLines = 1,
                            softWrap = false,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun DraggableTimeWheelColumn(
    itemHeight: androidx.compose.ui.unit.Dp,
    selectedColor: Color,
    itemLabel: (Int) -> String,
    maxStepsPerGesture: Int,
    onStep: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    val itemHeightPx = with(LocalDensity.current) { itemHeight.toPx() }
    var dragOffsetPx by remember { mutableStateOf(0f) }
    var gestureSteps by remember { mutableIntStateOf(0) }

    fun remainingStepsFor(nextSteps: Int): Int {
        return if (nextSteps > 0) {
            nextSteps.coerceAtMost(maxStepsPerGesture - gestureSteps)
        } else {
            nextSteps.coerceAtLeast(-maxStepsPerGesture - gestureSteps)
        }
    }

    fun flingStepsFor(velocity: Float): Int {
        val minFlingVelocity = itemHeightPx * 3.5f
        if (abs(velocity) < minFlingVelocity) return 0
        val rawSteps = ((abs(velocity) / itemHeightPx) * 0.18f)
            .roundToInt()
            .coerceAtLeast(1)
        return if (velocity < 0f) rawSteps else -rawSteps
    }

    val draggableState = rememberDraggableState { delta ->
        dragOffsetPx += delta
        while (dragOffsetPx <= -itemHeightPx && gestureSteps < maxStepsPerGesture) {
            dragOffsetPx += itemHeightPx
            gestureSteps += 1
            onStep(1)
        }
        while (dragOffsetPx >= itemHeightPx && gestureSteps > -maxStepsPerGesture) {
            dragOffsetPx -= itemHeightPx
            gestureSteps -= 1
            onStep(-1)
        }
        if (gestureSteps >= maxStepsPerGesture && dragOffsetPx < -itemHeightPx * 0.6f) {
            dragOffsetPx = -itemHeightPx * 0.6f
        }
        if (gestureSteps <= -maxStepsPerGesture && dragOffsetPx > itemHeightPx * 0.6f) {
            dragOffsetPx = itemHeightPx * 0.6f
        }
    }

    Box(
        modifier = modifier
            .height(itemHeight * 3)
            .clipToBounds()
            .draggable(
                state = draggableState,
                orientation = Orientation.Vertical,
                onDragStarted = { gestureSteps = 0 },
                onDragStopped = { velocity ->
                    val startOffset = dragOffsetPx
                    val snapStep = when {
                        startOffset <= -itemHeightPx * 0.45f -> 1
                        startOffset >= itemHeightPx * 0.45f -> -1
                        else -> 0
                    }
                    val velocitySteps = flingStepsFor(velocity)
                    val requestedSteps = if (velocitySteps != 0) velocitySteps else snapStep
                    val stepsToSettle = remainingStepsFor(requestedSteps)
                    scope.launch {
                        animateWheelSettle(
                            startOffsetPx = startOffset,
                            steps = stepsToSettle,
                            itemHeightPx = itemHeightPx,
                            onStep = onStep,
                            onOffsetChange = { dragOffsetPx = it },
                        )
                        gestureSteps = 0
                    }
                },
            ),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier.offset { IntOffset(0, dragOffsetPx.roundToInt()) },
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            (-1..1).forEach { offset ->
                val distance = abs(offset)
                val alpha = when (distance) {
                    0 -> 1f
                    1 -> 0.18f
                    else -> 0.08f
                }
                val style = if (distance == 0) {
                    MaterialTheme.typography.displayLarge
                } else {
                    MaterialTheme.typography.displayMedium
                }
                Surface(
                    onClick = {
                        if (offset != 0) {
                            scope.launch {
                                animateWheelSettle(
                                    startOffsetPx = 0f,
                                    steps = offset.coerceIn(-maxStepsPerGesture, maxStepsPerGesture),
                                    itemHeightPx = itemHeightPx,
                                    onStep = onStep,
                                    onOffsetChange = { dragOffsetPx = it },
                                )
                            }
                        }
                    },
                    color = Color.Transparent,
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(itemHeight),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Text(
                            text = itemLabel(offset),
                            style = style,
                            fontWeight = FontWeight.Bold,
                            color = selectedColor.copy(alpha = alpha),
                            textAlign = TextAlign.Center,
                            maxLines = 1,
                            softWrap = false,
                        )
                    }
                }
            }
        }
    }
}

private suspend fun animateWheelSettle(
    startOffsetPx: Float,
    steps: Int,
    itemHeightPx: Float,
    onStep: (Int) -> Unit,
    onOffsetChange: (Float) -> Unit,
) {
    if (steps == 0) {
        Animatable(startOffsetPx).animateTo(
            targetValue = 0f,
            animationSpec = spring(
                dampingRatio = Spring.DampingRatioNoBouncy,
                stiffness = Spring.StiffnessMediumLow,
            ),
        ) {
            onOffsetChange(value)
        }
        return
    }

    val direction = if (steps > 0) 1 else -1
    var currentOffset = startOffsetPx
    repeat(abs(steps)) {
        val targetOffset = if (direction > 0) -itemHeightPx else itemHeightPx
        Animatable(currentOffset).animateTo(
            targetValue = targetOffset,
            animationSpec = tween(durationMillis = 64),
        ) {
            onOffsetChange(value)
        }
        onStep(direction)
        onOffsetChange(0f)
        currentOffset = 0f
    }
}

private fun floorMod(value: Int, divisor: Int): Int = ((value % divisor) + divisor) % divisor

@Composable
private fun RepeatSelector(
    repeatDaysMask: Int,
    holidayOff: Boolean,
    onToggleDay: (Int) -> Unit,
    onHolidayOffChange: (Boolean) -> Unit,
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
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("공휴일에는 끄기", fontWeight = FontWeight.SemiBold)
                MutedText("반복 알람이 주요 공휴일과 겹치면 다음 선택 요일로 넘겨요")
            }
            Switch(
                checked = holidayOff,
                onCheckedChange = onHolidayOffChange,
            )
        }
        if (repeatDaysMask != 0) {
            MutedText(repeatLabel(repeatDaysMask))
        }
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
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 10.dp, vertical = 14.dp),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
            color = if (selected) {
                MaterialTheme.colorScheme.onPrimary
            } else {
                MaterialTheme.colorScheme.onSurface
            },
        )
    }
}

private val TtsCategories = listOf(
    "morning" to "아침 기상",
    "lunch" to "점심",
    "sleep" to "취침",
    "medicine" to "약",
    "study" to "영어 공부",
    "custom" to "직접 입력",
)

private val TtsLanguages = listOf(
    "ko" to "한국어",
    "en" to "English",
    "ja" to "日本語",
)

@Composable
private fun VoiceAudioCard(
    editor: AlarmEditorState,
    authSession: AuthSession?,
    voiceProfiles: List<VoiceProfile>,
    voiceProfileBusy: Boolean,
    ttsMessages: List<TtsMessage>,
    ttsMessageBusy: Boolean,
    audioMessage: String?,
    isRecording: Boolean,
    onLoadVoiceProfiles: () -> Unit,
    onLoadTtsMessages: () -> Unit,
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
            OptionChips(
                options = listOf(
                    VoiceSources.TTS_PROFILE to "음성 프로필",
                    VoiceSources.SERVER_TTS to "서버 음성",
                    VoiceSources.LOCAL_AUDIO to "녹음/파일",
                ),
                selected = editor.voiceSource,
                onSelect = {
                    editor.voiceSource = it
                    if (it == VoiceSources.TTS_PROFILE) {
                        editor.clearAudio()
                        editor.clearTtsMeta()
                    } else if (it == VoiceSources.SERVER_TTS) {
                        editor.clearAudio()
                        editor.clearTtsMeta()
                    } else {
                        editor.clearTtsMeta()
                    }
                },
            )

            if (editor.voiceSource == VoiceSources.TTS_PROFILE) {
                Text(
                    text = "음성 프로필로 문구를 생성해 로컬에 저장합니다.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("음성 프로필", fontWeight = FontWeight.SemiBold)
                    OutlinedButton(
                        onClick = onLoadVoiceProfiles,
                        enabled = authSession != null && !voiceProfileBusy,
                    ) {
                        Text(if (voiceProfileBusy) "불러오는 중" else "불러오기")
                    }
                }
                val readyProfiles = voiceProfiles.filter { it.status == null || it.status == "ready" }
                if (authSession == null) {
                    MutedText("로그인 후 저장해 둔 음성 프로필을 사용할 수 있어요.")
                } else if (voiceProfiles.isEmpty()) {
                    MutedText("사용 가능한 음성 프로필이 없어요. 프로필을 만든 뒤 불러와 주세요.")
                } else if (readyProfiles.isEmpty()) {
                    MutedText("준비 완료된 음성 프로필이 아직 없어요.")
                } else {
                    ChipGrid(
                        options = readyProfiles.map { it.id to it.name },
                        selected = editor.voiceProfileId ?: "",
                        onSelect = {
                            editor.voiceProfileId = it
                            editor.clearTtsMeta()
                        },
                    )
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text("랜덤 문구", fontWeight = FontWeight.SemiBold)
                        MutedText("카테고리와 언어에 맞는 문구를 자동으로 넣어요")
                    }
                    Switch(
                        checked = editor.voiceRandomPrompt,
                        onCheckedChange = {
                            editor.voiceRandomPrompt = it
                            editor.clearTtsMeta()
                            if (it) editor.voiceText = ""
                        },
                    )
                }
                if (!editor.voiceRandomPrompt) {
                    OutlinedTextField(
                        value = editor.voiceText,
                        onValueChange = {
                            editor.voiceText = it.take(200)
                            editor.clearTtsMeta()
                        },
                        label = { Text("읽어줄 문구") },
                        minLines = 2,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                Text("카테고리", fontWeight = FontWeight.SemiBold)
                ChipGrid(
                    options = TtsCategories,
                    selected = editor.voiceCategory,
                    onSelect = {
                        editor.voiceCategory = it
                        editor.clearTtsMeta()
                        if (editor.voiceRandomPrompt) editor.voiceText = ""
                    },
                )
                Text("언어", fontWeight = FontWeight.SemiBold)
                ChipGrid(
                    options = TtsLanguages,
                    selected = editor.voiceLanguage,
                    onSelect = {
                        editor.voiceLanguage = it
                        editor.clearTtsMeta()
                        if (editor.voiceRandomPrompt) editor.voiceText = ""
                    },
                )
                if (editor.localAudioUri != null) {
                    MutedText("저장된 음성: ${audioFileLabel(editor.localAudioUri ?: "")}")
                }
            } else if (editor.voiceSource == VoiceSources.SERVER_TTS) {
                Text(
                    text = "서버에 저장된 더빙/TTS 음성을 알람 저장 시 로컬에 캐시합니다.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("저장된 음성", fontWeight = FontWeight.SemiBold)
                    OutlinedButton(
                        onClick = onLoadTtsMessages,
                        enabled = authSession != null && !ttsMessageBusy,
                    ) {
                        Text(if (ttsMessageBusy) "불러오는 중" else "불러오기")
                    }
                }
                val usableMessages = ttsMessages.filter { !it.audioUrl.isNullOrBlank() }
                if (authSession == null) {
                    MutedText("로그인 후 서버에 저장된 음성을 사용할 수 있어요.")
                } else if (ttsMessages.isEmpty()) {
                    MutedText("저장된 서버 음성이 없어요.")
                } else if (usableMessages.isEmpty()) {
                    MutedText("오디오 URL이 있는 서버 음성이 없어요. 새 TTS/더빙 결과부터 사용할 수 있어요.")
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        usableMessages.take(8).forEach { message ->
                            FilterChip(
                                selected = editor.ttsMessageId == message.id,
                                onClick = {
                                    editor.setPendingServerTts(message)
                                },
                                label = {
                                    Text(
                                        text = message.text.ifBlank { message.voiceName ?: "서버 음성" }.take(32),
                                        maxLines = 1,
                                    )
                                },
                            )
                        }
                    }
                }
                if (editor.localAudioUri != null) {
                    MutedText("저장된 음성: ${audioFileLabel(editor.localAudioUri ?: "")}")
                }
            } else {
                Text(
                    text = editor.localAudioUri?.let(::audioFileLabel) ?: "선택된 음성 오디오가 없어요",
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
                if (editor.localAudioUri != null) {
                    OutlinedButton(onClick = onClear, modifier = Modifier.fillMaxWidth()) {
                        Text("음성 지우기")
                    }
                }
                Text(
                    text = "최대 ${AlarmAudioLimits.MAX_DURATION_MILLIS / 1000}초까지 사용할 수 있고, 긴 파일은 30초로 자릅니다.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
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
private fun ChipGrid(
    options: List<Pair<String, String>>,
    selected: String,
    onSelect: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        options.chunked(3).forEach { rowOptions ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                rowOptions.forEach { (value, label) ->
                    FilterChip(
                        selected = selected == value,
                        onClick = { onSelect(value) },
                        label = { Text(label) },
                    )
                }
            }
        }
    }
}

@Composable
private fun AlarmSettingsCard(
    snoozeEnabled: Boolean,
    snoozeMinutes: Int,
    vibrationPattern: String,
    onSnoozeEnabledChange: (Boolean) -> Unit,
    onSnoozeMinutesChange: (Int) -> Unit,
    onVibrationEnabledChange: (Boolean) -> Unit,
    onVibrationSelect: (String) -> Unit,
) {
    var detailDialog by remember { mutableStateOf<String?>(null) }
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
                Surface(
                    onClick = { detailDialog = "snooze" },
                    color = Color.Transparent,
                    modifier = Modifier.weight(1f),
                ) {
                    Column(modifier = Modifier.padding(vertical = 4.dp)) {
                        Text("다시 울림", fontWeight = FontWeight.SemiBold)
                        MutedText(if (snoozeEnabled) "${snoozeMinutes}분" else "꺼짐")
                    }
                }
                Switch(
                    checked = snoozeEnabled,
                    onCheckedChange = onSnoozeEnabledChange,
                )
            }
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(1.dp)
                    .background(MaterialTheme.colorScheme.outlineVariant),
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Surface(
                    onClick = { detailDialog = "vibration" },
                    color = Color.Transparent,
                    modifier = Modifier.weight(1f),
                ) {
                    Column(modifier = Modifier.padding(vertical = 4.dp)) {
                        Text("진동", fontWeight = FontWeight.SemiBold)
                        MutedText(vibrationLabel(vibrationPattern))
                    }
                }
                Switch(
                    checked = vibrationPattern != VibrationPatterns.NONE,
                    onCheckedChange = onVibrationEnabledChange,
                )
            }
        }
    }

    if (detailDialog == "snooze") {
        AlertDialog(
            onDismissRequest = { detailDialog = null },
            title = { Text("다시 울림") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(if (snoozeEnabled) "켜짐" else "꺼짐", fontWeight = FontWeight.SemiBold)
                        Switch(
                            checked = snoozeEnabled,
                            onCheckedChange = onSnoozeEnabledChange,
                        )
                    }
                    StepperField(
                        label = "간격",
                        valueLabel = "${snoozeMinutes}분",
                        onDecrease = { onSnoozeMinutesChange((snoozeMinutes - 1).coerceAtLeast(1)) },
                        onIncrease = { onSnoozeMinutesChange((snoozeMinutes + 1).coerceAtMost(30)) },
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = { detailDialog = null }) {
                    Text("완료")
                }
            },
        )
    }

    if (detailDialog == "vibration") {
        AlertDialog(
            onDismissRequest = { detailDialog = null },
            title = { Text("진동") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            if (vibrationPattern == VibrationPatterns.NONE) "꺼짐" else "켜짐",
                            fontWeight = FontWeight.SemiBold,
                        )
                        Switch(
                            checked = vibrationPattern != VibrationPatterns.NONE,
                            onCheckedChange = onVibrationEnabledChange,
                        )
                    }
                    OptionChips(
                        options = listOf(
                            VibrationPatterns.DEFAULT to "기본",
                            VibrationPatterns.STRONG to "강하게",
                        ),
                        selected = if (vibrationPattern == VibrationPatterns.NONE) {
                            VibrationPatterns.DEFAULT
                        } else {
                            vibrationPattern
                        },
                        onSelect = {
                            onVibrationEnabledChange(true)
                            onVibrationSelect(it)
                        },
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = { detailDialog = null }) {
                    Text("완료")
                }
            },
        )
    }
}

@Composable
private fun EditorActionButtons(
    isEditing: Boolean,
    isSaving: Boolean,
    onCancel: () -> Unit,
    onSave: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        OutlinedButton(
            onClick = onCancel,
            enabled = !isSaving,
            modifier = Modifier.weight(1f),
        ) {
            Text("취소")
        }
        Button(
            onClick = onSave,
            enabled = !isSaving,
            modifier = Modifier.weight(1f),
            shape = RoundedCornerShape(16.dp),
        ) {
            Icon(Icons.Outlined.Save, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(
                when {
                    isSaving -> "저장 중"
                    isEditing -> "변경사항 저장"
                    else -> "알람 설정하기"
                },
            )
        }
    }
}

private fun amPmLabel(hour: Int): String = if (floorMod(hour, 24) < 12) "오전" else "오후"

private fun hour12(hour: Int): Int = when (val value = floorMod(hour, 12)) {
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
    holidayOff: Boolean,
    snoozeEnabled: Boolean,
    snoozeMinutes: Int,
    vibrationPattern: String,
    playMode: String,
    localAudioUri: String?,
    rawAudioUri: String?,
    voiceSource: String,
    voiceProfileId: String?,
    voiceText: String?,
    voiceCategory: String?,
    voiceLanguage: String?,
    voiceRandomPrompt: Boolean,
    ttsMessageId: String?,
) {
    var label by mutableStateOf(label)
    var hour by mutableIntStateOf(hour)
    var minute by mutableIntStateOf(minute)
    var repeatDaysMask by mutableIntStateOf(repeatDaysMask)
    var holidayOff by mutableStateOf(holidayOff)
    var snoozeEnabled by mutableStateOf(snoozeEnabled)
    var snoozeMinutes by mutableIntStateOf(snoozeMinutes)
    var vibrationPattern by mutableStateOf(vibrationPattern)
    var playMode by mutableStateOf(playMode)
    var localAudioUri by mutableStateOf(localAudioUri)
    var rawAudioUri by mutableStateOf(rawAudioUri)
    var voiceSource by mutableStateOf(voiceSource)
    var voiceProfileId by mutableStateOf(voiceProfileId)
    var voiceText by mutableStateOf(voiceText ?: "")
    var voiceCategory by mutableStateOf(voiceCategory ?: "morning")
    var voiceLanguage by mutableStateOf(voiceLanguage ?: "ko")
    var voiceRandomPrompt by mutableStateOf(voiceRandomPrompt)
    var ttsMessageId by mutableStateOf(ttsMessageId)
    private var generatedTtsKey by mutableStateOf(
        ttsMessageId?.let {
            buildTtsKey(
                profileId = voiceProfileId.orEmpty(),
                text = voiceText.orEmpty(),
                category = voiceCategory ?: "morning",
                language = voiceLanguage ?: "ko",
            )
        },
    )

    fun toDraft(): AlarmDraft {
        val alarmOnly = playMode == AlarmPlayModes.ALARM_ONLY
        return AlarmDraft(
            label = label,
            hour = hour,
            minute = minute,
            repeatDaysMask = repeatDaysMask,
            holidayOff = holidayOff,
            snoozeEnabled = snoozeEnabled,
            snoozeMinutes = snoozeMinutes,
            vibrationPattern = vibrationPattern,
            playMode = playMode,
            localAudioUri = if (alarmOnly) null else localAudioUri,
            rawAudioUri = if (alarmOnly) null else rawAudioUri,
            voiceSource = if (alarmOnly) VoiceSources.LOCAL_AUDIO else voiceSource,
            voiceProfileId = if (alarmOnly || voiceSource == VoiceSources.LOCAL_AUDIO) null else voiceProfileId,
            voiceText = if (alarmOnly || voiceSource == VoiceSources.LOCAL_AUDIO) null else ttsTextForSave(),
            voiceCategory = if (alarmOnly || voiceSource == VoiceSources.LOCAL_AUDIO) null else voiceCategory,
            voiceLanguage = if (alarmOnly || voiceSource == VoiceSources.LOCAL_AUDIO) null else voiceLanguage,
            ttsMessageId = if (alarmOnly || voiceSource == VoiceSources.LOCAL_AUDIO) null else ttsMessageId,
        )
    }

    fun setCachedAudio(audio: CachedAlarmAudio) {
        voiceSource = VoiceSources.LOCAL_AUDIO
        localAudioUri = audio.localAudioUri
        rawAudioUri = audio.rawAudioUri
        clearTtsMeta()
    }

    fun clearAudio() {
        localAudioUri = null
        rawAudioUri = null
    }

    fun clearTtsMeta() {
        ttsMessageId = null
        generatedTtsKey = null
    }

    fun ttsTextForSave(): String =
        if (voiceRandomPrompt && voiceText.isBlank()) {
            randomTtsPrompt(voiceCategory, voiceLanguage)
        } else {
            voiceText.trim()
        }

    fun hasFreshTtsAudio(profileId: String, text: String): Boolean =
        !localAudioUri.isNullOrBlank() &&
            ttsMessageId != null &&
            generatedTtsKey == buildTtsKey(profileId, text, voiceCategory, voiceLanguage)

    fun setGeneratedTtsAudio(
        audio: CachedAlarmAudio,
        profileId: String,
        text: String,
        messageId: String,
        rawAudioUri: String?,
    ) {
        voiceSource = VoiceSources.TTS_PROFILE
        voiceProfileId = profileId
        voiceText = text
        localAudioUri = audio.localAudioUri
        this.rawAudioUri = rawAudioUri ?: audio.rawAudioUri
        ttsMessageId = messageId
        generatedTtsKey = buildTtsKey(profileId, text, voiceCategory, voiceLanguage)
    }

    fun setPendingServerTts(message: TtsMessage) {
        voiceSource = VoiceSources.SERVER_TTS
        ttsMessageId = message.id
        voiceProfileId = message.voiceProfileId
        voiceText = message.text
        voiceCategory = message.category ?: "custom"
        voiceRandomPrompt = false
        localAudioUri = null
        rawAudioUri = message.audioUrl
        generatedTtsKey = null
    }

    fun setServerTtsAudio(
        audio: CachedAlarmAudio,
        messageId: String,
        text: String,
        category: String?,
        voiceProfileId: String?,
        rawAudioUri: String?,
    ) {
        voiceSource = VoiceSources.SERVER_TTS
        ttsMessageId = messageId
        voiceText = text
        voiceCategory = category ?: "custom"
        voiceRandomPrompt = false
        this.voiceProfileId = voiceProfileId
        localAudioUri = audio.localAudioUri
        this.rawAudioUri = rawAudioUri ?: audio.rawAudioUri
        generatedTtsKey = null
    }

    companion object {
        fun from(alarm: AlarmEntity?): AlarmEditorState {
            val defaultTime = java.time.LocalTime.now().plusMinutes(5)
            return AlarmEditorState(
                label = alarm?.label ?: "Morning alarm",
                hour = alarm?.hour ?: defaultTime.hour,
                minute = alarm?.minute ?: defaultTime.minute,
                repeatDaysMask = alarm?.repeatDaysMask ?: 0,
                holidayOff = alarm?.holidayOff ?: false,
                snoozeEnabled = alarm?.snoozeEnabled ?: true,
                snoozeMinutes = alarm?.snoozeMinutes ?: 5,
                vibrationPattern = alarm?.vibrationPattern ?: VibrationPatterns.DEFAULT,
                playMode = alarm?.playMode ?: AlarmPlayModes.ALARM_ONLY,
                localAudioUri = alarm?.localAudioUri,
                rawAudioUri = alarm?.rawAudioUri,
                voiceSource = alarm?.voiceSource ?: VoiceSources.LOCAL_AUDIO,
                voiceProfileId = alarm?.voiceProfileId,
                voiceText = alarm?.voiceText,
                voiceCategory = alarm?.voiceCategory ?: "morning",
                voiceLanguage = alarm?.voiceLanguage ?: "ko",
                voiceRandomPrompt = alarm?.let {
                    it.voiceSource == VoiceSources.TTS_PROFILE && it.voiceText.isNullOrBlank()
                } ?: false,
                ttsMessageId = alarm?.ttsMessageId,
            )
        }
    }
}

private fun buildTtsKey(profileId: String, text: String, category: String, language: String): String =
    listOf(profileId, text.trim(), category, language).joinToString("|")

private fun randomTtsPrompt(category: String, language: String): String {
    val ko = when (category) {
        "lunch" -> listOf("점심 시간이에요. 잠깐 쉬고 맛있게 챙겨 먹어요.", "몸도 마음도 충전할 시간이에요.")
        "sleep" -> listOf("이제 하루를 정리하고 편하게 쉬어요.", "내일을 위해 잠들 준비를 해요.")
        "medicine" -> listOf("약 먹을 시간이에요. 물과 함께 챙겨 주세요.", "건강을 위해 지금 약을 챙겨요.")
        "study" -> listOf("영어 공부할 시간이에요. 오늘도 한 문장부터 시작해요.", "짧게라도 영어 루틴을 이어가요.")
        else -> listOf("일어날 시간이에요. 오늘도 차분하게 시작해요.", "좋은 아침이에요. 지금 일어나요.")
    }
    val en = when (category) {
        "lunch" -> listOf("It is lunch time. Take a short break and recharge.", "Time for lunch. Enjoy your meal.")
        "sleep" -> listOf("It is time to wind down and get some rest.", "Prepare for sleep and let today go.")
        "medicine" -> listOf("It is time to take your medicine with water.", "Please take your medicine now.")
        "study" -> listOf("It is English study time. Start with one sentence.", "Keep your English routine going today.")
        else -> listOf("Good morning. It is time to wake up.", "Wake up now and start your day calmly.")
    }
    val ja = when (category) {
        "sleep" -> listOf("そろそろ休む時間です。ゆっくり眠りましょう。")
        "study" -> listOf("英語を勉強する時間です。短く始めましょう。")
        else -> listOf("起きる時間です。今日も落ち着いて始めましょう。")
    }
    val pool = when (language) {
        "en" -> en
        "ja" -> ja
        else -> ko
    }
    return pool.random()
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
            text = repeatLabel(repeatDaysMask),
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

                GoogleSignInButton(
                    enabled = !authBusy,
                    onClick = onGoogleSignIn,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
private fun GoogleSignInButton(
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val contentAlpha = if (enabled) 1f else 0.38f
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.height(40.dp),
        shape = RoundedCornerShape(999.dp),
        color = Color.White,
        contentColor = Color(0xFF1F1F1F),
        border = BorderStroke(1.dp, Color(0xFF747775)),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 12.dp, end = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Image(
                painter = painterResource(R.drawable.ic_google_g),
                contentDescription = null,
                modifier = Modifier
                    .size(18.dp)
                    .padding(0.dp),
                alpha = contentAlpha,
            )
            Spacer(Modifier.width(10.dp))
            Text(
                text = "Google로 계속하기",
                color = Color(0xFF1F1F1F).copy(alpha = contentAlpha),
                fontFamily = FontFamily.Default,
                fontWeight = FontWeight.Medium,
                fontSize = 14.sp,
                lineHeight = 20.sp,
                maxLines = 1,
            )
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
                text = listOf(
                    repeatLabel(alarm.repeatDaysMask),
                    if (alarm.holidayOff) "공휴일 끔" else null,
                    if (alarm.snoozeEnabled) "다시 울림 ${alarm.snoozeMinutes}분" else "다시 울림 꺼짐",
                    vibrationLabel(alarm.vibrationPattern),
                    playModeLabel(alarm.playMode),
                ).filterNotNull().joinToString(" · "),
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
    if (mask == 0) return "반복 없음"
    if (mask == 0b1111111) return "매일"
    val days = listOf("일", "월", "화", "수", "목", "금", "토")
    return days.filterIndexed { index, _ -> mask and (1 shl index) != 0 }.joinToString(", ")
}

private fun vibrationLabel(pattern: String): String = when (pattern) {
    VibrationPatterns.STRONG -> "강한 진동"
    VibrationPatterns.NONE -> "진동 꺼짐"
    else -> "기본 진동"
}

private fun playModeLabel(mode: String): String = when (mode) {
    AlarmPlayModes.VOICE_ONLY -> "음성만"
    AlarmPlayModes.ALARM_VOICE -> "알람+음성"
    else -> "알람만"
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
