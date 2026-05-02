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
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Remove
import androidx.compose.material.icons.outlined.Save
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
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
import com.voicealarm.nativeapp.data.VibrationPatterns
import com.voicealarm.nativeapp.network.AuthTokenResponse
import com.voicealarm.nativeapp.network.AuthSession
import com.voicealarm.nativeapp.network.AuthSessionStore
import com.voicealarm.nativeapp.network.LoginRequest
import com.voicealarm.nativeapp.network.RegisterRequest
import com.voicealarm.nativeapp.network.VoiceAlarmApiClient
import com.voicealarm.nativeapp.network.VoiceProfile
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

    fun showCodeAuthUnavailable() {
        message = "Code login needs a backend verification endpoint. Current API supports email/password."
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
}

private sealed interface AlarmScreen {
    data object List : AlarmScreen
    data object Create : AlarmScreen
    data class Edit(val alarm: AlarmEntity) : AlarmScreen
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
    var screen by remember { mutableStateOf<AlarmScreen>(AlarmScreen.List) }
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
            TopAppBar(
                title = {
                    Text(
                        text = when (screen) {
                            AlarmScreen.List -> "Voice Alarm"
                            AlarmScreen.Create -> "Create Alarm"
                            is AlarmScreen.Edit -> "Edit Alarm"
                        },
                        fontWeight = FontWeight.SemiBold,
                    )
                },
                navigationIcon = {
                    if (screen !is AlarmScreen.List) {
                        IconButton(onClick = { screen = AlarmScreen.List }) {
                            Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back")
                        }
                    }
                },
            )
        },
        floatingActionButton = {
            if (screen is AlarmScreen.List) {
                FloatingActionButton(onClick = { screen = AlarmScreen.Create }) {
                    Icon(Icons.Outlined.Add, contentDescription = "Create alarm")
                }
            }
        },
    ) { padding ->
        when (val current = screen) {
            AlarmScreen.List -> AlarmListScreen(
                contentPadding = padding,
                permissions = permissions,
                alarms = alarms,
                authSession = authSession,
                authBusy = authBusy,
                syncBusy = syncBusy,
                voiceProfiles = voiceProfiles,
                voiceProfileBusy = voiceProfileBusy,
                message = message,
                onClearMessage = viewModel::clearMessage,
                onLogin = viewModel::login,
                onRegister = viewModel::register,
                onVerifyCode = { _, _ -> viewModel.showCodeAuthUnavailable() },
                onGoogleSignIn = ::launchGoogleSignIn,
                onSyncNow = viewModel::syncNow,
                onLoadVoiceProfiles = viewModel::loadVoiceProfiles,
                onLogout = viewModel::logout,
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
private fun AlarmListScreen(
    contentPadding: PaddingValues,
    permissions: PermissionSnapshot,
    alarms: List<AlarmEntity>,
    authSession: AuthSession?,
    authBusy: Boolean,
    syncBusy: Boolean,
    voiceProfiles: List<VoiceProfile>,
    voiceProfileBusy: Boolean,
    message: String?,
    onClearMessage: () -> Unit,
    onLogin: (String, String) -> Unit,
    onRegister: (String, String, String) -> Unit,
    onVerifyCode: (String, String) -> Unit,
    onGoogleSignIn: () -> Unit,
    onSyncNow: () -> Unit,
    onLoadVoiceProfiles: () -> Unit,
    onLogout: () -> Unit,
    onCreateAlarm: () -> Unit,
    onQuickTest: () -> Unit,
    onToggleEnabled: (String, Boolean) -> Unit,
    onEditAlarm: (AlarmEntity) -> Unit,
    onDeleteAlarm: (String) -> Unit,
    onRequestNotifications: () -> Unit,
    onRequestExactAlarms: () -> Unit,
    onRequestFullScreen: () -> Unit,
) {
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(contentPadding),
        contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            AccountPanel(
                authSession = authSession,
                authBusy = authBusy,
                syncBusy = syncBusy,
                voiceProfiles = voiceProfiles,
                voiceProfileBusy = voiceProfileBusy,
                onLogin = onLogin,
                onRegister = onRegister,
                onVerifyCode = onVerifyCode,
                onGoogleSignIn = onGoogleSignIn,
                onSyncNow = onSyncNow,
                onLoadVoiceProfiles = onLoadVoiceProfiles,
                onLogout = onLogout,
            )
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
            item {
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
        }

        item {
            Text(
                text = "Local alarms",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }

        if (alarms.isEmpty()) {
            item {
                Text(
                    text = "No local alarms",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        } else {
            items(alarms, key = { it.id }) { alarm ->
                AlarmRow(
                    alarm = alarm,
                    onToggleEnabled = { enabled -> onToggleEnabled(alarm.id, enabled) },
                    onEditAlarm = { onEditAlarm(alarm) },
                    onDeleteAlarm = { onDeleteAlarm(alarm.id) },
                )
            }
        }
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
        contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            OutlinedCard {
                Column(
                    modifier = Modifier.padding(18.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    OutlinedTextField(
                        value = editor.label,
                        onValueChange = { editor.label = it },
                        label = { Text("Label") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )

                    StepperField(
                        label = "Hour",
                        valueLabel = "%02d".format(editor.hour),
                        onDecrease = { editor.hour = (editor.hour + 23) % 24 },
                        onIncrease = { editor.hour = (editor.hour + 1) % 24 },
                    )

                    StepperField(
                        label = "Minute",
                        valueLabel = "%02d".format(editor.minute),
                        onDecrease = { editor.minute = (editor.minute + 59) % 60 },
                        onIncrease = { editor.minute = (editor.minute + 1) % 60 },
                    )

                    StepperField(
                        label = "Snooze",
                        valueLabel = "${editor.snoozeMinutes} min",
                        onDecrease = { editor.snoozeMinutes = (editor.snoozeMinutes - 1).coerceAtLeast(1) },
                        onIncrease = { editor.snoozeMinutes = (editor.snoozeMinutes + 1).coerceAtMost(30) },
                    )
                }
            }
        }

        item {
            OptionSection(title = "Repeat") {
                DayRows(
                    repeatDaysMask = editor.repeatDaysMask,
                    onToggleDay = { dayIndex ->
                        editor.repeatDaysMask = editor.repeatDaysMask xor (1 shl dayIndex)
                    },
                )
            }
        }

        item {
            OptionSection(title = "Vibration") {
                OptionChips(
                    options = listOf(
                        VibrationPatterns.DEFAULT to "Default",
                        VibrationPatterns.STRONG to "Strong",
                        VibrationPatterns.NONE to "None",
                    ),
                    selected = editor.vibrationPattern,
                    onSelect = { editor.vibrationPattern = it },
                )
            }
        }

        item {
            OptionSection(title = "Voice audio") {
                Text(
                    text = editor.localAudioUri?.let(::audioFileLabel) ?: "No voice audio",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    OutlinedButton(
                        onClick = { pickAudioLauncher.launch("audio/*") },
                        modifier = Modifier.weight(1f),
                    ) {
                        Text("Pick")
                    }
                    Button(
                        onClick = {
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
                        modifier = Modifier.weight(1f),
                    ) {
                        Text(if (isRecording) "Stop" else "Record")
                    }
                    if (editor.localAudioUri != null) {
                        OutlinedButton(onClick = {
                            editor.clearAudio()
                            audioMessage = "Voice audio cleared"
                        }) {
                            Text("Clear")
                        }
                    }
                }
                Text(
                    text = "Max ${AlarmAudioLimits.MAX_DURATION_MILLIS / 1000}s",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (audioMessage != null) {
                    Text(
                        text = requireNotNull(audioMessage),
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

        item {
            OptionSection(title = "Play mode") {
                OptionChips(
                    options = listOf(
                        AlarmPlayModes.ALARM_ONLY to "Alarm",
                        AlarmPlayModes.VOICE_ONLY to "Voice",
                        AlarmPlayModes.ALARM_VOICE to "Alarm + Voice",
                    ),
                    selected = editor.playMode,
                    onSelect = { editor.playMode = it },
                )
            }
        }

        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                OutlinedButton(
                    onClick = onCancel,
                    modifier = Modifier.weight(1f),
                ) {
                    Text("Cancel")
                }
                Button(
                    onClick = { onSave(editor.toDraft()) },
                    modifier = Modifier.weight(1f),
                ) {
                    Icon(Icons.Outlined.Save, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Save")
                }
            }
        }
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
    onVerifyCode: (String, String) -> Unit,
    onGoogleSignIn: () -> Unit,
    onSyncNow: () -> Unit,
    onLoadVoiceProfiles: () -> Unit,
    onLogout: () -> Unit,
) {
    var mode by remember { mutableStateOf("login") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }

    OutlinedCard {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = "Account",
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
                        Text(if (syncBusy) "Syncing" else "Sync now")
                    }
                    OutlinedButton(
                        onClick = onLogout,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text("Sign out")
                    }
                }
                OutlinedButton(
                    onClick = onLoadVoiceProfiles,
                    enabled = !voiceProfileBusy,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(if (voiceProfileBusy) "Loading voices" else "Load voices")
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
                        "login" to "Login",
                        "register" to "Register",
                        "code" to "Code",
                    ),
                    selected = mode,
                    onSelect = { mode = it },
                )

                if (mode == "register") {
                    OutlinedTextField(
                        value = name,
                        onValueChange = { name = it },
                        label = { Text("Name") },
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
                    label = { Text("Email") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Email,
                        imeAction = ImeAction.Next,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )

                if (mode == "code") {
                    OutlinedTextField(
                        value = code,
                        onValueChange = { code = it },
                        label = { Text("Verification code") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Number,
                            imeAction = ImeAction.Done,
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Button(
                        onClick = { onVerifyCode(email, code) },
                        enabled = !authBusy,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("Verify code")
                    }
                    Text(
                        text = "The deployed API does not expose code-login endpoints yet.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        label = { Text("Password") },
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
                                mode == "register" -> "Create account"
                                else -> "Sign in"
                            },
                        )
                    }
                }

                OutlinedButton(
                    onClick = onGoogleSignIn,
                    enabled = !authBusy,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Continue with Google")
                }
            }
        }
    }
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
    OutlinedCard(
        colors = CardDefaults.outlinedCardColors(
            containerColor = MaterialTheme.colorScheme.surface,
        ),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    Text(
                        text = "%02d:%02d".format(alarm.hour, alarm.minute),
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(text = alarm.label, fontWeight = FontWeight.SemiBold)
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
                Text(
                    text = "${alarm.state} - ${syncStateLabel(alarm.syncState)}",
                    color = if (alarm.enabled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.labelLarge,
                )
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
            error = Color(0xFFB84A3D),
        )
    }

    MaterialTheme(colorScheme = colorScheme) {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = MaterialTheme.colorScheme.background,
            content = content,
        )
    }
}
