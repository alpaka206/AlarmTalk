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
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Delete
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
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import com.voicealarm.nativeapp.network.CheckoutRequest
import com.voicealarm.nativeapp.network.CodeRegisterRequest
import com.voicealarm.nativeapp.network.FamilyGroupCurrentResponse
import com.voicealarm.nativeapp.network.FamilyInvite
import com.voicealarm.nativeapp.network.FamilyVoiceProfile
import com.voicealarm.nativeapp.network.LoginRequest
import com.voicealarm.nativeapp.network.ReceivedNote
import com.voicealarm.nativeapp.network.RegisterRequest
import com.voicealarm.nativeapp.network.SendNoteRequest
import com.voicealarm.nativeapp.network.TtsGenerateRequest
import com.voicealarm.nativeapp.network.TtsGenerateResponse
import com.voicealarm.nativeapp.network.TtsMessage
import com.voicealarm.nativeapp.network.TtsMessageAudioResponse
import com.voicealarm.nativeapp.network.VoiceAlarmApiClient
import com.voicealarm.nativeapp.network.VoiceProfile
import com.voicealarm.nativeapp.network.VoiceProfileUpdateRequest
import com.voicealarm.nativeapp.network.VoucherItem
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.ApiException
import java.io.File
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
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
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

    var noteBusy by mutableStateOf(false)
        private set

    var receivedNotes by mutableStateOf<List<ReceivedNote>>(emptyList())
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
                message = "알람을 저장했어요. ${timeUntilAlarmLabel(alarm.fireAtMillis)}"
                onDone()
            }.onFailure { error ->
                Log.e(TAG, "Failed to create alarm", error)
                message = userFacingError(error, "알람 저장에 실패했어요")
            }
        }
    }

    fun updateAlarm(alarmId: String, draft: AlarmDraft, onDone: () -> Unit) {
        viewModelScope.launch {
            runCatching {
                repository.updateAlarm(alarmId, draft)
            }.onSuccess { alarm ->
                message = "변경사항을 저장했어요. ${timeUntilAlarmLabel(alarm.fireAtMillis)}"
                onDone()
            }.onFailure { error ->
                Log.e(TAG, "Failed to update alarm id=$alarmId", error)
                message = userFacingError(error, "알람 수정에 실패했어요")
            }
        }
    }

    fun setAlarmEnabled(alarmId: String, enabled: Boolean) {
        viewModelScope.launch {
            runCatching {
                repository.setEnabled(alarmId, enabled)
            }.onSuccess {
                message = null
            }.onFailure { error ->
                Log.e(TAG, "Failed to change alarm enabled id=$alarmId", error)
                message = userFacingError(error, "알람 상태 변경에 실패했어요")
            }
        }
    }

    fun deleteAlarm(alarmId: String) {
        viewModelScope.launch {
            runCatching {
                repository.deleteAlarm(alarmId)
            }.onSuccess {
                message = "알람을 삭제했어요"
            }.onFailure { error ->
                Log.e(TAG, "Failed to delete alarm id=$alarmId", error)
                message = userFacingError(error, "알람 삭제에 실패했어요")
            }
        }
    }

    fun copyAlarm(alarmId: String) {
        viewModelScope.launch {
            runCatching {
                repository.copyAlarm(alarmId)
            }.onSuccess { alarm ->
                message = "알람을 10분 뒤로 복사했어요. ${timeUntilAlarmLabel(alarm.fireAtMillis)}"
            }.onFailure { error ->
                Log.e(TAG, "Failed to copy alarm id=$alarmId", error)
                message = userFacingError(error, "알람 복사에 실패했어요")
            }
        }
    }

    fun createTestAlarm(delayMinutes: Int) {
        viewModelScope.launch {
            runCatching {
                repository.createTestAlarm(delayMinutes)
            }.onSuccess { alarm ->
                message = "테스트 알람을 저장했어요. ${timeUntilAlarmLabel(alarm.fireAtMillis)}"
            }.onFailure { error ->
                Log.e(TAG, "Failed to create test alarm", error)
                message = userFacingError(error, "테스트 알람 예약에 실패했어요")
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
                message = "${response.user.email} 계정으로 로그인했어요"
            }.onFailure { error ->
                Log.e(TAG, "Email login failed", error)
                message = userFacingError(error, "로그인에 실패했어요")
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
                message = "${response.user.email} 계정을 만들었어요"
            }.onFailure { error ->
                Log.e(TAG, "Email registration failed", error)
                message = userFacingError(error, "회원가입에 실패했어요")
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
        message = "Google 계정으로 로그인했어요"
    }

    fun logout() {
        authSessionStore.clear()
        authSession = null
        message = "로그아웃했어요"
    }

    fun syncNow() {
        val session = authSession
        if (session == null) {
            message = "동기화하려면 먼저 로그인해 주세요"
            return
        }
        viewModelScope.launch {
            syncBusy = true
            runCatching {
                repository.syncWithBackend(api, session.token)
            }.onSuccess { result ->
                message = "동기화 완료: 생성 ${result.created}개, 수정 ${result.updated}개, 실패 ${result.failed}개"
            }.onFailure { error ->
                Log.e(TAG, "Backend sync failed", error)
                message = userFacingError(error, "동기화에 실패했어요")
            }
            syncBusy = false
        }
    }

    fun loadVoiceProfiles() {
        fetchVoiceProfiles(showMessage = true)
    }

    fun preloadVoiceProfiles() {
        if (authSession == null || voiceProfileBusy || voiceProfiles.isNotEmpty()) return
        fetchVoiceProfiles(showMessage = false)
    }

    private fun fetchVoiceProfiles(showMessage: Boolean) {
        val session = authSession
        if (session == null) {
            if (showMessage) message = "음성을 불러오려면 먼저 로그인해 주세요"
            return
        }
        viewModelScope.launch {
            if (voiceProfileBusy) return@launch
            voiceProfileBusy = true
            runCatching {
                api.listVoiceProfiles(VoiceAlarmApiClient.bearer(session.token)).profiles
            }.onSuccess { profiles ->
                voiceProfiles = profiles
                if (showMessage) message = "음성 프로필 ${profiles.size}개를 불러왔어요"
            }.onFailure { error ->
                Log.e(TAG, "Failed to load voice profiles", error)
                if (showMessage) message = userFacingError(error, "음성 프로필을 불러오지 못했어요")
            }
            voiceProfileBusy = false
        }
    }

    fun createVoiceProfile(name: String, audio: CachedAlarmAudio) {
        val session = authSession
        if (session == null) {
            message = "음성 프로필을 만들려면 먼저 로그인해 주세요"
            return
        }
        val trimmedName = name.trim()
        if (trimmedName.isBlank()) {
            message = "음성 프로필 이름을 입력해 주세요"
            return
        }
        if (voiceProfiles.size >= MAX_VOICE_PROFILES) {
            message = "음성 프로필은 최대 ${MAX_VOICE_PROFILES}개까지 만들 수 있어요"
            return
        }

        viewModelScope.launch {
            if (voiceProfileBusy) return@launch
            voiceProfileBusy = true
            runCatching {
                withContext(Dispatchers.IO) {
                    api.createVoiceClone(
                        authorization = VoiceAlarmApiClient.bearer(session.token),
                        audio = voiceUploadPart(audio),
                        name = trimmedName.toRequestBody("text/plain".toMediaType()),
                    ).profile
                }
            }.onSuccess { profile ->
                voiceProfiles = listOf(profile) + voiceProfiles.filterNot { it.id == profile.id }
                message = "음성 프로필 '${profile.name}'을 만들었어요"
            }.onFailure { error ->
                Log.e(TAG, "Failed to create voice profile", error)
                message = userFacingError(error, "음성 프로필 생성에 실패했어요")
            }
            voiceProfileBusy = false
        }
    }

    fun renameVoiceProfile(profileId: String, name: String) {
        val session = authSession
        if (session == null) {
            message = "음성 프로필을 수정하려면 먼저 로그인해 주세요"
            return
        }
        val trimmedName = name.trim()
        if (trimmedName.isBlank()) {
            message = "음성 프로필 이름을 입력해 주세요"
            return
        }

        viewModelScope.launch {
            if (voiceProfileBusy) return@launch
            voiceProfileBusy = true
            runCatching {
                withContext(Dispatchers.IO) {
                    api.updateVoiceProfile(
                        authorization = VoiceAlarmApiClient.bearer(session.token),
                        id = profileId,
                        request = VoiceProfileUpdateRequest(name = trimmedName),
                    ).profile
                }
            }.onSuccess { profile ->
                voiceProfiles = voiceProfiles.map {
                    if (it.id == profile.id) it.copy(name = profile.name) else it
                }
                message = "음성 프로필 이름을 바꿨어요"
            }.onFailure { error ->
                Log.e(TAG, "Failed to rename voice profile id=$profileId", error)
                message = userFacingError(error, "음성 프로필 이름 변경에 실패했어요")
            }
            voiceProfileBusy = false
        }
    }

    fun deleteVoiceProfile(profileId: String) {
        val session = authSession
        if (session == null) {
            message = "음성 프로필을 삭제하려면 먼저 로그인해 주세요"
            return
        }

        viewModelScope.launch {
            if (voiceProfileBusy) return@launch
            voiceProfileBusy = true
            runCatching {
                withContext(Dispatchers.IO) {
                    api.deleteVoiceProfile(
                        authorization = VoiceAlarmApiClient.bearer(session.token),
                        id = profileId,
                    )
                }
            }.onSuccess {
                voiceProfiles = voiceProfiles.filterNot { it.id == profileId }
                message = "음성 프로필을 삭제했어요"
            }.onFailure { error ->
                Log.e(TAG, "Failed to delete voice profile id=$profileId", error)
                message = userFacingError(error, "사용 중인 음성 프로필은 삭제할 수 없어요")
            }
            voiceProfileBusy = false
        }
    }

    suspend fun generateTtsAudio(request: TtsGenerateRequest): TtsGenerateResponse {
        val session = authSession ?: throw IllegalStateException("음성 오디오를 만들려면 먼저 로그인해 주세요")
        return withContext(Dispatchers.IO) {
            api.generateTts(VoiceAlarmApiClient.bearer(session.token), request)
        }
    }

    fun loadTtsMessages() {
        val session = authSession
        if (session == null) {
            message = "저장된 음성을 불러오려면 먼저 로그인해 주세요"
            return
        }
        viewModelScope.launch {
            ttsMessageBusy = true
            runCatching {
                api.listTtsMessages(VoiceAlarmApiClient.bearer(session.token)).messages
            }.onSuccess { messages ->
                ttsMessages = messages
                message = "저장된 음성 ${messages.size}개를 불러왔어요"
            }.onFailure { error ->
                Log.e(TAG, "Failed to load saved TTS messages", error)
                message = userFacingError(error, "저장된 음성을 불러오지 못했어요")
            }
            ttsMessageBusy = false
        }
    }

    suspend fun downloadTtsMessageAudio(messageId: String): TtsMessageAudioResponse {
        val session = authSession ?: throw IllegalStateException("저장된 음성 오디오를 불러오려면 먼저 로그인해 주세요")
        return withContext(Dispatchers.IO) {
            api.getTtsMessageAudio(VoiceAlarmApiClient.bearer(session.token), messageId)
        }
    }

    fun refreshSocial() {
        val authorization = bearerOrMessage("커플/가족 정보를 불러오려면 먼저 로그인해 주세요") ?: return
        viewModelScope.launch {
            socialBusy = true
            runCatching {
                val group = api.getFamilyGroup(authorization)
                val invites = api.listFamilyInvites(authorization).invites
                val sharedVoices = api.listFamilyVoiceProfiles(authorization).profiles
                SocialSnapshot(
                    familyGroup = group,
                    familyInvites = invites,
                    familyVoices = sharedVoices,
                )
            }.onSuccess { snapshot ->
                familyGroup = snapshot.familyGroup
                familyInvites = snapshot.familyInvites
                familyVoices = snapshot.familyVoices
                message = "커플/가족 정보를 불러왔어요"
            }.onFailure { error ->
                Log.e(TAG, "Failed to refresh social data", error)
                message = userFacingError(error, "커플/가족 정보를 불러오지 못했어요")
            }
            socialBusy = false
        }
    }

    fun createFamilyInvite() {
        val authorization = bearerOrMessage("초대 코드를 만들려면 먼저 로그인해 주세요") ?: return
        viewModelScope.launch {
            socialBusy = true
            runCatching {
                api.createFamilyInvite(authorization, emptyMap()).invite
            }.onSuccess { invite ->
                familyInvites = listOf(invite) + familyInvites
                message = "초대 코드 ${invite.code}를 만들었어요"
            }.onFailure { error ->
                Log.e(TAG, "Failed to create family invite", error)
                message = userFacingError(error, "초대 코드 생성에 실패했어요")
            }
            socialBusy = false
        }
    }

    fun acceptFamilyInvite(code: String) {
        val authorization = bearerOrMessage("초대를 수락하려면 먼저 로그인해 주세요") ?: return
        viewModelScope.launch {
            socialBusy = true
            runCatching {
                api.acceptFamilyInvite(authorization, code.trim(), emptyMap())
            }.onSuccess {
                message = "초대를 수락했어요"
                refreshSocial()
            }.onFailure { error ->
                Log.e(TAG, "Failed to accept family invite", error)
                message = userFacingError(error, "초대 수락에 실패했어요")
            }
            socialBusy = false
        }
    }

    fun revokeFamilyInvite(code: String) {
        val authorization = bearerOrMessage("초대 코드를 취소하려면 먼저 로그인해 주세요") ?: return
        viewModelScope.launch {
            socialBusy = true
            runCatching {
                api.revokeFamilyInvite(authorization, code, emptyMap())
            }.onSuccess {
                message = "초대 코드를 취소했어요"
                refreshSocial()
            }.onFailure { error ->
                Log.e(TAG, "Failed to revoke family invite code=$code", error)
                message = userFacingError(error, "초대 코드 취소에 실패했어요")
            }
            socialBusy = false
        }
    }

    fun refreshCharacterAndBilling() {
        val authorization = bearerOrMessage("성장 정보를 불러오려면 먼저 로그인해 주세요") ?: return
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
                message = "캐릭터와 플랜 정보를 불러왔어요"
            }.onFailure { error ->
                Log.e(TAG, "Failed to load character or billing", error)
                message = userFacingError(error, "성장 정보를 불러오지 못했어요")
            }
            characterBusy = false
            billingBusy = false
        }
    }

    fun syncCharacterEvents() {
        val session = authSession
        if (session == null) {
            message = "성장 기록을 동기화하려면 먼저 로그인해 주세요"
            return
        }
        viewModelScope.launch {
            characterBusy = true
            runCatching {
                repository.syncCharacterEvents(api, session.token)
            }.onSuccess { result ->
                message = "XP 동기화: 완료 ${result.synced}개, 실패 ${result.failed}개"
                refreshCharacterAndBilling()
            }.onFailure { error ->
                Log.e(TAG, "Character event sync failed", error)
                message = userFacingError(error, "XP 동기화에 실패했어요")
            }
            characterBusy = false
        }
    }

    fun registerCode(code: String) {
        val authorization = bearerOrMessage("코드를 등록하려면 먼저 로그인해 주세요") ?: return
        viewModelScope.launch {
            billingBusy = true
            runCatching {
                api.registerCode(authorization, CodeRegisterRequest(code.trim()))
            }.onSuccess { response ->
                message = "코드를 등록했어요${response.type?.let { ": ${codeTypeLabel(it)}" } ?: ""}"
                refreshSocial()
                refreshCharacterAndBilling()
            }.onFailure { error ->
                Log.e(TAG, "Failed to register code", error)
                message = userFacingError(error, "코드 등록에 실패했어요")
            }
            billingBusy = false
        }
    }

    fun refreshNotes() {
        val authorization = bearerOrMessage("음성 메시지를 불러오려면 먼저 로그인해 주세요") ?: return
        viewModelScope.launch {
            noteBusy = true
            runCatching {
                api.listReceivedNotes(authorization, limit = 20, offset = 0).notes
            }.onSuccess { notes ->
                receivedNotes = notes
                message = "받은 메시지 ${notes.size}개를 불러왔어요"
            }.onFailure { error ->
                Log.e(TAG, "Failed to refresh notes", error)
                message = userFacingError(error, "음성 메시지를 불러오지 못했어요")
            }
            noteBusy = false
        }
    }

    fun sendNote(receiverId: String, text: String) {
        val authorization = bearerOrMessage("메시지를 보내려면 먼저 로그인해 주세요") ?: return
        val trimmedText = text.trim()
        if (receiverId.isBlank()) {
            message = "받는 사람을 선택해 주세요"
            return
        }
        if (trimmedText.isBlank()) {
            message = "메시지를 입력해 주세요"
            return
        }
        viewModelScope.launch {
            noteBusy = true
            runCatching {
                api.sendNote(
                    authorization = authorization,
                    request = SendNoteRequest(receiverId = receiverId, text = trimmedText),
                )
            }.onSuccess {
                message = "메시지를 보냈어요"
                refreshNotes()
            }.onFailure { error ->
                Log.e(TAG, "Failed to send note", error)
                message = userFacingError(error, "메시지 전송에 실패했어요")
            }
            noteBusy = false
        }
    }

    fun markNoteRead(noteId: String) {
        val authorization = bearerOrMessage("메시지를 읽음 처리하려면 먼저 로그인해 주세요") ?: return
        viewModelScope.launch {
            runCatching {
                api.markNoteRead(authorization, noteId)
            }.onSuccess {
                receivedNotes = receivedNotes.map { note ->
                    if (note.id == noteId && note.readAt == null) {
                        note.copy(readAt = Instant.now().toString())
                    } else {
                        note
                    }
                }
            }.onFailure { error ->
                Log.e(TAG, "Failed to mark note read id=$noteId", error)
            }
        }
    }

    fun checkoutPlan(planKey: String) {
        val authorization = bearerOrMessage("구독을 변경하려면 먼저 로그인해 주세요") ?: return
        viewModelScope.launch {
            billingBusy = true
            runCatching {
                api.checkoutPlan(authorization, CheckoutRequest(planKey = planKey))
            }.onSuccess { response ->
                subscriptionResponse = BillingSubscriptionResponse(
                    subscription = response.subscription,
                    plan = response.plan,
                )
                response.voucher?.let { voucher ->
                    vouchers = listOf(
                        VoucherItem(
                            id = voucher.id,
                            code = voucher.code,
                            planName = response.plan.name,
                            planType = response.plan.planType,
                            status = "issued",
                            expiresAt = voucher.expiresAt,
                        ),
                    ) + vouchers
                }
                message = "${response.plan.name} 플랜을 적용했어요"
                refreshAppSession()
                refreshSocial()
            }.onFailure { error ->
                Log.e(TAG, "Failed to checkout plan key=$planKey", error)
                message = userFacingError(error, "구독 변경에 실패했어요")
            }
            billingBusy = false
        }
    }

    fun showGoogleSetupRequired() {
        message = "Google 로그인을 쓰려면 voiceAlarmGoogleWebClientId를 설정해 주세요."
    }

    fun showGoogleSignInFailed(reason: String? = null) {
        message = reason ?: "Google 로그인에 실패했어요"
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
    val familyGroup: FamilyGroupCurrentResponse,
    val familyInvites: List<FamilyInvite>,
    val familyVoices: List<FamilyVoiceProfile>,
)

private data class CharacterBillingSnapshot(
    val character: CharacterResponse,
    val subscription: BillingSubscriptionResponse,
    val vouchers: List<VoucherItem>,
)

private data class SubscriptionPlanOption(
    val key: String,
    val name: String,
    val price: String,
    val description: String,
    val features: List<String>,
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
    Messages,
    Growth,
    Billing,
}

private const val MAX_VOICE_PROFILES = 2

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
                onRefreshVoiceProfiles = viewModel::loadVoiceProfiles,
                onCreateVoiceProfile = viewModel::createVoiceProfile,
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
    alarms: List<AlarmEntity>,
    authSession: AuthSession?,
    authBusy: Boolean,
    syncBusy: Boolean,
    voiceProfiles: List<VoiceProfile>,
    voiceProfileBusy: Boolean,
    socialBusy: Boolean,
    familyGroup: FamilyGroupCurrentResponse?,
    familyInvites: List<FamilyInvite>,
    familyVoices: List<FamilyVoiceProfile>,
    characterEvents: List<CharacterEventEntity>,
    characterBusy: Boolean,
    characterResponse: CharacterResponse?,
    billingBusy: Boolean,
    subscriptionResponse: BillingSubscriptionResponse?,
    vouchers: List<VoucherItem>,
    noteBusy: Boolean,
    receivedNotes: List<ReceivedNote>,
    message: String?,
    onClearMessage: () -> Unit,
    onLogin: (String, String) -> Unit,
    onRegister: (String, String, String) -> Unit,
    onGoogleSignIn: () -> Unit,
    onSyncNow: () -> Unit,
    onLogout: () -> Unit,
    onRefreshVoiceProfiles: () -> Unit,
    onCreateVoiceProfile: (String, CachedAlarmAudio) -> Unit,
    onRenameVoiceProfile: (String, String) -> Unit,
    onDeleteVoiceProfile: (String) -> Unit,
    onRefreshSocial: () -> Unit,
    onCreateFamilyInvite: () -> Unit,
    onAcceptFamilyInvite: (String) -> Unit,
    onRevokeFamilyInvite: (String) -> Unit,
    onRefreshCharacterBilling: () -> Unit,
    onSyncCharacterEvents: () -> Unit,
    onRegisterCode: (String) -> Unit,
    onRefreshNotes: () -> Unit,
    onSendNote: (String, String) -> Unit,
    onMarkNoteRead: (String) -> Unit,
    onCheckoutPlan: (String) -> Unit,
    onCreateAlarm: () -> Unit,
    onToggleEnabled: (String, Boolean) -> Unit,
    onEditAlarm: (AlarmEntity) -> Unit,
    onDeleteAlarm: (String) -> Unit,
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
                item {
                    HomeHeader(
                        authSession = authSession,
                        syncBusy = syncBusy,
                        onSelectTab = onSelectTab,
                        onSyncNow = onSyncNow,
                        onLogout = onLogout,
                    )
                }
                item {
                    HomeStatsRow(
                        activeAlarms = alarms.count { it.enabled },
                        voiceCount = voiceProfiles.size,
                        connectionCount = familyGroup?.members?.size ?: 0,
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
                        onOpenVoices = {
                            onSelectTab(NativeTab.Voices)
                        },
                        onOpenGrowth = { onSelectTab(NativeTab.Growth) },
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
                            onLogout = onLogout,
                        )
                    }
                }
            }

            NativeTab.Voices -> {
                item {
                    ScreenHeader(
                        title = "음성",
                        subtitle = "내 목소리를 AI 음성 프로필로 만들고 관리해요.",
                    )
                }
                if (authSession == null) {
                    item { VoiceLoginRequiredCard() }
                } else {
                    item {
                        VoiceProfileManagementPanel(
                            voiceProfiles = voiceProfiles,
                            voiceProfileBusy = voiceProfileBusy,
                            onRefresh = onRefreshVoiceProfiles,
                            onCreateVoiceProfile = onCreateVoiceProfile,
                            onRenameVoiceProfile = onRenameVoiceProfile,
                            onDeleteVoiceProfile = onDeleteVoiceProfile,
                        )
                    }
                }
            }

            NativeTab.Alarms -> {
                item { AlarmsHeader(onCreateAlarm = onCreateAlarm) }
                if (nextAlarm != null) {
                    item { CountdownBanner(nextAlarm = nextAlarm) }
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
                        title = "커플/가족 연결",
                        subtitle = "초대 코드로 연결하고, 공유 허용된 음성만 알람에 사용할 수 있어요.",
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
                            onLogout = onLogout,
                        )
                    }
                } else {
                    item {
                        FamilyConnectionPanel(
                            socialBusy = socialBusy,
                            familyGroup = familyGroup,
                            familyInvites = familyInvites,
                            familyVoices = familyVoices,
                            subscriptionResponse = subscriptionResponse,
                            onRefreshSocial = onRefreshSocial,
                            onCreateFamilyInvite = onCreateFamilyInvite,
                            onAcceptFamilyInvite = onAcceptFamilyInvite,
                            onRevokeFamilyInvite = onRevokeFamilyInvite,
                            onOpenBilling = { onSelectTab(NativeTab.Billing) },
                        )
                    }
                }
            }

            NativeTab.Messages -> {
                item {
                    ScreenHeader(
                        title = "음성 메시지",
                        subtitle = "커플/가족 플랜에서 연결된 사람에게 메시지를 보내고 받은 메시지를 확인해요.",
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
                            onLogout = onLogout,
                        )
                    }
                } else {
                    item {
                        VoiceMessagePanel(
                            authSession = authSession,
                            noteBusy = noteBusy,
                            familyGroup = familyGroup,
                            subscriptionResponse = subscriptionResponse,
                            receivedNotes = receivedNotes,
                            onRefresh = {
                                onRefreshSocial()
                                onRefreshNotes()
                            },
                            onSendNote = onSendNote,
                            onMarkNoteRead = onMarkNoteRead,
                            onOpenFamily = { onSelectTab(NativeTab.People) },
                            onOpenBilling = { onSelectTab(NativeTab.Billing) },
                        )
                    }
                }
            }

            NativeTab.Growth -> {
                item {
                    ScreenHeader(
                        title = "캐릭터",
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

            NativeTab.Billing -> {
                item {
                    ScreenHeader(
                        title = "구독/이용권",
                        subtitle = "플랜을 확인하고 이용권 코드를 등록해요.",
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
                            onLogout = onLogout,
                        )
                    }
                } else {
                    item {
                        SubscriptionPanel(
                            billingBusy = billingBusy,
                            subscriptionResponse = subscriptionResponse,
                            vouchers = vouchers,
                            onRefresh = onRefreshCharacterBilling,
                            onRegisterCode = onRegisterCode,
                            onCheckoutPlan = onCheckoutPlan,
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
private fun HomeHeader(
    authSession: AuthSession?,
    syncBusy: Boolean,
    onSelectTab: (NativeTab) -> Unit,
    onSyncNow: () -> Unit,
    onLogout: () -> Unit,
) {
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
        ProfileMenu(
            authSession = authSession,
            syncBusy = syncBusy,
            onSelectTab = onSelectTab,
            onSyncNow = onSyncNow,
            onLogout = onLogout,
        )
    }
}

@Composable
private fun ProfileMenu(
    authSession: AuthSession?,
    syncBusy: Boolean,
    onSelectTab: (NativeTab) -> Unit,
    onSyncNow: () -> Unit,
    onLogout: () -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { expanded = true }) {
            AvatarBubble(label = authSession?.user?.name ?: authSession?.user?.email)
        }
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            DropdownMenuItem(
                text = {
                    Column {
                        Text(
                            text = authSession?.user?.name?.takeIf { it.isNotBlank() }
                                ?: authSession?.user?.email
                                ?: "로그인이 필요해요",
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            text = authSession?.user?.email ?: "홈에서 로그인하면 모든 기능을 사용할 수 있어요.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                onClick = { expanded = false },
            )
            HorizontalDivider()
            ProfileMenuItem("커플/가족 연결") {
                expanded = false
                onSelectTab(NativeTab.People)
            }
            ProfileMenuItem("음성 메시지") {
                expanded = false
                onSelectTab(NativeTab.Messages)
            }
            ProfileMenuItem("캐릭터") {
                expanded = false
                onSelectTab(NativeTab.Growth)
            }
            ProfileMenuItem("구독/이용권") {
                expanded = false
                onSelectTab(NativeTab.Billing)
            }
            HorizontalDivider()
            ProfileMenuItem(if (syncBusy) "동기화 중" else "지금 동기화") {
                expanded = false
                onSyncNow()
            }
            if (authSession != null) {
                ProfileMenuItem("로그아웃") {
                    expanded = false
                    onLogout()
                }
            }
        }
    }
}

@Composable
private fun ProfileMenuItem(
    label: String,
    onClick: () -> Unit,
) {
    DropdownMenuItem(
        text = { Text(label) },
        onClick = onClick,
    )
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
    connectionCount: Int,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        StatPill(label = "활성 알람", count = activeAlarms, modifier = Modifier.weight(1f))
        StatPill(label = "음성", count = voiceCount, modifier = Modifier.weight(1f))
        StatPill(label = "연결", count = connectionCount, modifier = Modifier.weight(1f))
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
                    text = "레벨 ${character.level} - ${stageLabel(character.stage)} - 연속 ${characterResponse.streak.current}일",
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
                text = if (pendingEvents > 0) "동기화 ${pendingEvents}개" else ">",
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
    onOpenVoices: () -> Unit,
    onOpenGrowth: () -> Unit,
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
                label = "음성 관리",
                icon = Icons.Outlined.Message,
                onClick = onOpenVoices,
                modifier = Modifier.weight(1f),
            )
            HomeActionCard(
                label = "캐릭터",
                icon = Icons.Outlined.People,
                onClick = onOpenGrowth,
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
private fun VoiceLoginRequiredCard() {
    OutlinedCard {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = "로그인이 필요해요",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            MutedText("음성 프로필은 계정에 저장됩니다. 홈 탭에서 로그인한 뒤 다시 열어 주세요.")
        }
    }
}

@Composable
private fun VoiceProfileManagementPanel(
    voiceProfiles: List<VoiceProfile>,
    voiceProfileBusy: Boolean,
    onRefresh: () -> Unit,
    onCreateVoiceProfile: (String, CachedAlarmAudio) -> Unit,
    onRenameVoiceProfile: (String, String) -> Unit,
    onDeleteVoiceProfile: (String) -> Unit,
) {
    val context = LocalContext.current
    val appContext = context.applicationContext
    val audioStore = remember(appContext) { AlarmAudioStore(appContext) }
    val recorder = remember(appContext) { AlarmVoiceRecorder(appContext, audioStore) }
    val scope = rememberCoroutineScope()
    var profileName by remember { mutableStateOf("") }
    var selectedAudio by remember { mutableStateOf<CachedAlarmAudio?>(null) }
    var localMessage by remember { mutableStateOf<String?>(null) }
    var isRecording by remember { mutableStateOf(false) }
    var showCreateConfirm by remember { mutableStateOf(false) }
    var renameTarget by remember { mutableStateOf<VoiceProfile?>(null) }
    var renameName by remember { mutableStateOf("") }
    var deleteTarget by remember { mutableStateOf<VoiceProfile?>(null) }
    val isLimitReached = voiceProfiles.size >= MAX_VOICE_PROFILES

    fun applySelectedAudio(audio: CachedAlarmAudio) {
        selectedAudio = audio
        val seconds = audio.durationMillis?.let { " (${it / 1000}초)" } ?: ""
        localMessage = "프로필 생성용 오디오를 준비했어요$seconds"
    }

    fun cacheSelectedAudio(uri: Uri) {
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) { audioStore.cacheFromUri(uri) }
            }.onSuccess(::applySelectedAudio)
                .onFailure { error ->
                    Log.e(TAG, "Failed to cache voice profile audio", error)
                    localMessage = userFacingError(error, "선택한 오디오를 사용할 수 없어요")
                }
        }
    }

    fun stopRecording() {
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) { recorder.stop() }
            }.onSuccess { audio ->
                isRecording = false
                applySelectedAudio(audio)
            }.onFailure { error ->
                isRecording = false
                Log.e(TAG, "Failed to stop voice profile recording", error)
                localMessage = userFacingError(error, "녹음에 실패했어요")
            }
        }
    }

    fun startRecording() {
        runCatching {
            recorder.start()
            isRecording = true
            localMessage = "녹음 중..."
        }.onFailure { error ->
            Log.e(TAG, "Failed to start voice profile recording", error)
            localMessage = userFacingError(error, "녹음을 시작할 수 없어요")
        }
    }

    val pickAudioLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) cacheSelectedAudio(uri)
    }
    val recordPermissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            startRecording()
        } else {
            localMessage = "마이크 권한이 필요해요"
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

    OutlinedCard {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            PanelHeader(
                title = "내 음성 프로필",
                actionLabel = if (voiceProfileBusy) "처리 중" else "새로고침",
                enabled = !voiceProfileBusy,
                onAction = onRefresh,
            )
            MutedText("등록 ${voiceProfiles.size}/${MAX_VOICE_PROFILES}개")

            if (isLimitReached) {
                MutedText("음성 프로필은 최대 ${MAX_VOICE_PROFILES}개까지 만들 수 있어요.")
            } else {
                OutlinedTextField(
                    value = profileName,
                    onValueChange = { profileName = it.take(50) },
                    label = { Text("프로필 이름") },
                    placeholder = { Text("예: 내 목소리") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Text(
                    text = selectedAudio?.let { "선택된 오디오: ${audioFileLabel(it.localAudioUri)}" }
                        ?: "30초 이하 녹음 또는 음성 파일을 선택해 주세요.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    OutlinedButton(
                        onClick = { pickAudioLauncher.launch("audio/*") },
                        enabled = !voiceProfileBusy && !isRecording,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text("파일 선택")
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
                        enabled = !voiceProfileBusy,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text(if (isRecording) "녹음 종료" else "녹음")
                    }
                }
                Button(
                    onClick = { showCreateConfirm = true },
                    enabled = profileName.isNotBlank() && selectedAudio != null && !voiceProfileBusy && !isRecording,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                ) {
                    Text("음성 프로필 만들기")
                }
                MutedText("프로필 만들기는 음성 복제 API를 호출하므로 실제 크레딧이 발생할 수 있어요.")
            }

            if (localMessage != null) {
                MutedText(localMessage.orEmpty())
            }

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(1.dp)
                    .background(MaterialTheme.colorScheme.outlineVariant),
            )

            Text("프로필 목록", fontWeight = FontWeight.SemiBold)
            if (voiceProfiles.isEmpty()) {
                MutedText("아직 만든 음성 프로필이 없어요.")
            } else {
                voiceProfiles.forEach { profile ->
                    VoiceProfileRow(
                        profile = profile,
                        enabled = !voiceProfileBusy,
                        onRename = {
                            renameTarget = profile
                            renameName = profile.name
                        },
                        onDelete = { deleteTarget = profile },
                    )
                }
            }
        }
    }

    if (showCreateConfirm) {
        val audio = selectedAudio
        AlertDialog(
            onDismissRequest = { showCreateConfirm = false },
            title = { Text("음성 프로필 만들기") },
            text = {
                Text("이 작업은 음성 복제 API를 호출해 크레딧이 발생할 수 있어요. 계속할까요?")
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showCreateConfirm = false
                        if (audio != null) onCreateVoiceProfile(profileName, audio)
                    },
                ) {
                    Text("만들기")
                }
            },
            dismissButton = {
                TextButton(onClick = { showCreateConfirm = false }) {
                    Text("취소")
                }
            },
        )
    }

    renameTarget?.let { profile ->
        AlertDialog(
            onDismissRequest = { renameTarget = null },
            title = { Text("이름 변경") },
            text = {
                OutlinedTextField(
                    value = renameName,
                    onValueChange = { renameName = it.take(50) },
                    label = { Text("프로필 이름") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        onRenameVoiceProfile(profile.id, renameName)
                        renameTarget = null
                    },
                    enabled = renameName.isNotBlank(),
                ) {
                    Text("저장")
                }
            },
            dismissButton = {
                TextButton(onClick = { renameTarget = null }) {
                    Text("취소")
                }
            },
        )
    }

    deleteTarget?.let { profile ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text("음성 프로필 삭제") },
            text = {
                Text("'${profile.name}' 프로필을 삭제할까요? 연결된 메시지가 있으면 삭제가 실패할 수 있어요.")
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        onDeleteVoiceProfile(profile.id)
                        deleteTarget = null
                    },
                ) {
                    Text("삭제")
                }
            },
            dismissButton = {
                TextButton(onClick = { deleteTarget = null }) {
                    Text("취소")
                }
            },
        )
    }
}

@Composable
private fun VoiceProfileRow(
    profile: VoiceProfile,
    enabled: Boolean,
    onRename: () -> Unit,
    onDelete: () -> Unit,
) {
    OutlinedCard {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.weight(1f),
                ) {
                    AvatarBubble(label = profile.name)
                    Column {
                        Text(profile.name, fontWeight = FontWeight.SemiBold)
                        MutedText("${voiceStatusLabel(profile.status)} · ${profile.createdAt ?: "생성일 알 수 없음"}")
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                    TextButton(onClick = onRename, enabled = enabled) {
                        Text("이름")
                    }
                    TextButton(onClick = onDelete, enabled = enabled) {
                        Text("삭제")
                    }
                }
            }
        }
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
    onCancel: () -> Unit,
    onGenerateTts: suspend (TtsGenerateRequest) -> TtsGenerateResponse,
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
        audioMessage = "음성 오디오가 준비됐어요$seconds"
    }

    fun cacheSelectedAudio(uri: Uri) {
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) { audioStore.cacheFromUri(uri) }
            }.onSuccess(::applyCachedAudio)
                .onFailure { error ->
                    Log.e(TAG, "Failed to cache selected audio", error)
                    audioMessage = userFacingError(error, "선택한 오디오를 사용할 수 없어요")
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
                audioMessage = userFacingError(error, "녹음에 실패했어요")
            }
        }
    }

    fun startRecording() {
        runCatching {
            recorder.start()
            isRecording = true
            audioMessage = "녹음 중..."
        }.onFailure { error ->
            Log.e(TAG, "Failed to start recording", error)
            audioMessage = userFacingError(error, "녹음을 시작할 수 없어요")
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
        if (authSession == null) {
            audioMessage = "AI 음성 알람은 로그인 후 사용할 수 있어요"
            return
        }
        val profileId = editor.voiceProfileId
            ?: voiceProfiles.firstOrNull { it.status == null || it.status == "ready" }?.id
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
        val localTtsCacheKey = AlarmAudioStore.ttsCacheKey(
            profileId = profileId,
            text = text,
            category = editor.voiceCategory,
            language = editor.voiceLanguage,
        )
        audioStore.getCachedAudio(localTtsCacheKey, rawAudioUri = editor.rawAudioUri)?.let { cached ->
            editor.setGeneratedTtsAudio(
                audio = cached,
                profileId = profileId,
                text = text,
                messageId = cached.messageId ?: editor.ttsMessageId ?: "",
                rawAudioUri = cached.rawAudioUri,
            )
            audioMessage = "기존 음성 캐시를 사용했어요"
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
                val cacheKey = AlarmAudioStore.ttsCacheKey(
                    profileId = profileId,
                    text = response.text,
                    category = editor.voiceCategory,
                    language = editor.voiceLanguage,
                )
                val cachedAudio = withContext(Dispatchers.IO) {
                    audioStore.cacheGeneratedAudio(
                        bytes = audioBytes,
                        format = response.audioFormat,
                        rawAudioUri = rawAudioUri,
                        cacheKey = cacheKey,
                        messageId = response.messageId,
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
                audioMessage = userFacingError(error, "음성 생성에 실패했어요")
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
            audioMessage = "마이크 권한이 필요해요"
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

    val editorHorizontalPadding = 24.dp

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(contentPadding),
        contentPadding = PaddingValues(bottom = 36.dp),
        verticalArrangement = Arrangement.spacedBy(22.dp),
    ) {
        item {
            AlarmTimePickerCard(
                hour = editor.hour,
                minute = editor.minute,
                onTimeChange = { selectedHour, selectedMinute ->
                    editor.hour = selectedHour
                    editor.minute = selectedMinute
                },
                modifier = Modifier.fillParentMaxWidth(),
            )
        }

        item {
            Box(modifier = Modifier.padding(horizontal = editorHorizontalPadding)) {
                OutlinedTextField(
                    value = editor.label,
                    onValueChange = { editor.label = it },
                    placeholder = { Text("알람 이름") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        item {
            Column(
                modifier = Modifier.padding(horizontal = editorHorizontalPadding),
            ) {
                RepeatSelector(
                    repeatDaysMask = editor.repeatDaysMask,
                    holidayOff = editor.holidayOff,
                    onToggleDay = { dayIndex ->
                        editor.repeatDaysMask = editor.repeatDaysMask xor (1 shl dayIndex)
                    },
                    onHolidayOffChange = { editor.holidayOff = it },
                )
            }
        }

        item {
            Box(modifier = Modifier.padding(horizontal = editorHorizontalPadding)) {
                PlayModeSelector(
                    selected = editor.playMode,
                    onSelect = { selectedMode ->
                        val wasAlarmOnly = editor.playMode == AlarmPlayModes.ALARM_ONLY
                        editor.playMode = selectedMode
                        if (selectedMode != AlarmPlayModes.ALARM_ONLY && authSession == null) {
                            editor.voiceSource = VoiceSources.LOCAL_AUDIO
                            editor.clearTtsMeta()
                        } else if (selectedMode != AlarmPlayModes.ALARM_ONLY && wasAlarmOnly) {
                            editor.voiceSource = VoiceSources.TTS_PROFILE
                            editor.clearTtsMeta()
                        }
                    },
                )
            }
        }

        if (editor.playMode != AlarmPlayModes.ALARM_ONLY) {
            item {
                Column(
                    modifier = Modifier.padding(horizontal = editorHorizontalPadding),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    EditorSectionTitle("음성")
                    VoiceAudioCard(
                        editor = editor,
                        voiceProfiles = voiceProfiles,
                        voiceProfileBusy = voiceProfileBusy,
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
            }
        }

        item {
            Box(modifier = Modifier.padding(horizontal = editorHorizontalPadding)) {
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
        }

        item {
            Box(modifier = Modifier.padding(horizontal = editorHorizontalPadding)) {
                EditorActionButtons(
                    isEditing = alarm != null,
                    isSaving = isSaving,
                    onCancel = onCancel,
                    onSave = ::saveEditor,
                )
            }
        }
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
    modifier: Modifier = Modifier,
) {
    val currentOnTimeChange by rememberUpdatedState(onTimeChange)
    val itemHeight = 88.dp
    val verticalWheelPadding = 44.dp
    var workingHour by remember { mutableIntStateOf(hour) }
    var workingMinute by remember { mutableIntStateOf(minute) }
    val wheelBackgroundColor = Color(0xFF050505)
    val selectedTextColor = Color.White
    val unselectedTextColor = Color.White

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

    Column(
        modifier = modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = wheelBackgroundColor,
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(itemHeight * 3 + verticalWheelPadding * 2)
                    .padding(horizontal = 20.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                AmPmWheelColumn(
                    hour = workingHour,
                    itemHeight = itemHeight,
                    selectedTextColor = selectedTextColor,
                    unselectedTextColor = unselectedTextColor,
                    onStep = { steps ->
                        if (abs(steps) % 2 == 1) {
                            commitTime((workingHour + 12) % 24, workingMinute)
                        }
                    },
                )
                DraggableTimeWheelColumn(
                    itemHeight = itemHeight,
                    selectedTextColor = selectedTextColor,
                    unselectedTextColor = unselectedTextColor,
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
                    selectedTextColor = selectedTextColor,
                    unselectedTextColor = unselectedTextColor,
                    itemLabel = { offset -> "%02d".format(floorMod(workingMinute + offset, 60)) },
                    maxStepsPerGesture = 15,
                    onStep = ::applyMinuteSteps,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun AmPmWheelColumn(
    hour: Int,
    itemHeight: androidx.compose.ui.unit.Dp,
    selectedTextColor: Color,
    unselectedTextColor: Color,
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
                            color = if (selected) {
                                selectedTextColor
                            } else {
                                unselectedTextColor.copy(alpha = 0.18f)
                            },
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
    selectedTextColor: Color,
    unselectedTextColor: Color,
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
                            color = if (distance == 0) {
                                selectedTextColor
                            } else {
                                unselectedTextColor.copy(alpha = alpha)
                            },
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
            VoiceAlarmSwitch(
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
    "en" to "영어",
    "ja" to "일본어",
)

@Composable
private fun VoiceAudioCard(
    editor: AlarmEditorState,
    voiceProfiles: List<VoiceProfile>,
    voiceProfileBusy: Boolean,
    audioMessage: String?,
    isRecording: Boolean,
    onPick: () -> Unit,
    onRecord: () -> Unit,
    onClear: () -> Unit,
) {
    val visibleVoiceSource = if (editor.voiceSource == VoiceSources.SERVER_TTS) {
        VoiceSources.TTS_PROFILE
    } else {
        editor.voiceSource
    }

    LaunchedEffect(editor.voiceSource) {
        if (editor.voiceSource == VoiceSources.SERVER_TTS) {
            editor.voiceSource = VoiceSources.TTS_PROFILE
            editor.clearTtsMeta()
        }
    }

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
                    VoiceSources.LOCAL_AUDIO to "녹음/파일",
                ),
                selected = visibleVoiceSource,
                onSelect = {
                    editor.voiceSource = it
                    if (it == VoiceSources.TTS_PROFILE) {
                        editor.clearAudio()
                        editor.clearTtsMeta()
                    } else {
                        editor.clearTtsMeta()
                    }
                },
            )

            if (visibleVoiceSource == VoiceSources.TTS_PROFILE) {
                Text(
                    text = "서버에서 음성을 만들고, 알람 전에 기기에 저장합니다.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                val readyProfiles = voiceProfiles.filter { it.status == null || it.status == "ready" }
                LaunchedEffect(visibleVoiceSource, readyProfiles) {
                    if (
                        visibleVoiceSource == VoiceSources.TTS_PROFILE &&
                        editor.voiceProfileId.isNullOrBlank() &&
                        readyProfiles.isNotEmpty()
                    ) {
                        editor.voiceProfileId = readyProfiles.first().id
                    }
                }
                Text("음성 프로필", fontWeight = FontWeight.SemiBold)
                if (voiceProfileBusy) {
                    MutedText("음성 프로필을 불러오는 중이에요.")
                } else if (voiceProfiles.isEmpty()) {
                    MutedText("사용 가능한 음성 프로필이 없어요. 프로필을 만들면 자동으로 표시됩니다.")
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
                    VoiceAlarmSwitch(
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
                VoiceAlarmSwitch(
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
                VoiceAlarmSwitch(
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
                        VoiceAlarmSwitch(
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
                        VoiceAlarmSwitch(
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

private fun timeUntilAlarmLabel(fireAtMillis: Long): String {
    val millisUntilFire = (fireAtMillis - System.currentTimeMillis()).coerceAtLeast(60_000L)
    val duration = java.time.Duration.ofMillis(millisUntilFire)
    val days = duration.toDays()
    val hours = duration.minusDays(days).toHours()
    val minutes = duration.minusDays(days).minusHours(hours).toMinutes()
    return when {
        days > 0L && hours == 0L -> "약 ${days}일 뒤에 울려요"
        days > 0L -> "약 ${days}일 ${hours}시간 뒤에 울려요"
        hours == 0L -> "${minutes.coerceAtLeast(1)}분 뒤에 울려요"
        minutes == 0L -> "${hours}시간 뒤에 울려요"
        else -> "${hours}시간 ${minutes}분 뒤에 울려요"
    }
}

private fun googleSignInErrorMessage(statusCode: Int): String = when (statusCode) {
    10 -> "Google 로그인 설정이 맞지 않아요. Android OAuth 클라이언트의 패키지 이름과 SHA-1을 확인해 주세요."
    7 -> "네트워크 연결을 확인한 뒤 다시 시도해 주세요."
    12500 -> "Google 로그인에 실패했어요."
    12501 -> "Google 로그인을 취소했어요."
    12502 -> "Google 로그인이 이미 진행 중이에요."
    else -> "Google 로그인에 실패했어요. status=$statusCode"
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
    audioCacheKey: String?,
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
    var audioCacheKey by mutableStateOf(audioCacheKey)
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
            audioCacheKey = if (alarmOnly) null else audioCacheKey,
            rawAudioUri = if (alarmOnly) null else rawAudioUri,
            voiceSource = if (alarmOnly) VoiceSources.LOCAL_AUDIO else voiceSource,
            voiceProfileId = if (alarmOnly || voiceSource == VoiceSources.LOCAL_AUDIO) null else voiceProfileId,
            voiceText = if (alarmOnly || voiceSource == VoiceSources.LOCAL_AUDIO) null else ttsTextForSave(),
            voiceCategory = if (alarmOnly || voiceSource == VoiceSources.LOCAL_AUDIO) null else voiceCategory,
            voiceLanguage = if (alarmOnly || voiceSource == VoiceSources.LOCAL_AUDIO) null else voiceLanguage,
            ttsMessageId = if (alarmOnly || voiceSource == VoiceSources.LOCAL_AUDIO) null else ttsMessageId?.takeIf { it.isNotBlank() },
        )
    }

    fun setCachedAudio(audio: CachedAlarmAudio) {
        voiceSource = VoiceSources.LOCAL_AUDIO
        localAudioUri = audio.localAudioUri
        audioCacheKey = audio.cacheKey
        rawAudioUri = audio.rawAudioUri
        clearTtsMeta()
    }

    fun clearAudio() {
        localAudioUri = null
        audioCacheKey = null
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
        !localAudioUri.isNullOrBlank() && (
            generatedTtsKey == buildTtsKey(profileId, text, voiceCategory, voiceLanguage) ||
                audioCacheKey == AlarmAudioStore.ttsCacheKey(profileId, text, voiceCategory, voiceLanguage)
            )

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
        audioCacheKey = audio.cacheKey
        this.rawAudioUri = rawAudioUri ?: audio.rawAudioUri
        ttsMessageId = messageId.takeIf { it.isNotBlank() }
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
        audioCacheKey = null
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
        audioCacheKey = audio.cacheKey
        this.rawAudioUri = rawAudioUri ?: audio.rawAudioUri
        generatedTtsKey = null
    }

    companion object {
        fun from(alarm: AlarmEntity?): AlarmEditorState {
            val defaultTime = java.time.LocalTime.now().plusMinutes(5)
            return AlarmEditorState(
                label = alarm?.label ?: "",
                hour = alarm?.hour ?: defaultTime.hour,
                minute = alarm?.minute ?: defaultTime.minute,
                repeatDaysMask = alarm?.repeatDaysMask ?: 0,
                holidayOff = alarm?.holidayOff ?: false,
                snoozeEnabled = alarm?.snoozeEnabled ?: true,
                snoozeMinutes = alarm?.snoozeMinutes ?: 5,
                vibrationPattern = alarm?.vibrationPattern ?: VibrationPatterns.DEFAULT,
                playMode = alarm?.playMode ?: AlarmPlayModes.ALARM_ONLY,
                localAudioUri = alarm?.localAudioUri,
                audioCacheKey = alarm?.audioCacheKey,
                rawAudioUri = alarm?.rawAudioUri,
                voiceSource = alarm?.voiceSource ?: VoiceSources.TTS_PROFILE,
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
                Icon(Icons.Outlined.Remove, contentDescription = "$label 줄이기")
            }
            IconButton(onClick = onIncrease) {
                Icon(Icons.Outlined.Add, contentDescription = "$label 늘리기")
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
        0 to "일",
        1 to "월",
        2 to "화",
        3 to "수",
        4 to "목",
        5 to "금",
        6 to "토",
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
                    text = "로그인 방식 ${providerLabel(authSession.provider)} - 플랜 ${planTypeLabel(authSession.user.plan)}",
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
                if (voiceProfileBusy) {
                    MutedText("음성 프로필을 불러오는 중이에요")
                }
                if (voiceProfiles.isNotEmpty()) {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        voiceProfiles.take(3).forEach { profile ->
                            Text(
                                text = "${profile.name} (${voiceStatusLabel(profile.status)})",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        if (voiceProfiles.size > 3) {
                            Text(
                                text = "외 ${voiceProfiles.size - 3}개 더",
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
                            authBusy -> "처리 중"
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
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 12.dp, end = 12.dp),
        ) {
            Image(
                painter = painterResource(R.drawable.ic_google_g),
                contentDescription = null,
                modifier = Modifier
                    .align(Alignment.CenterStart)
                    .size(18.dp)
                    .padding(0.dp),
                alpha = contentAlpha,
            )
            Text(
                text = "Google로 계속하기",
                modifier = Modifier
                    .align(Alignment.Center)
                    .padding(horizontal = 32.dp),
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
private fun FamilyConnectionPanel(
    socialBusy: Boolean,
    familyGroup: FamilyGroupCurrentResponse?,
    familyInvites: List<FamilyInvite>,
    familyVoices: List<FamilyVoiceProfile>,
    subscriptionResponse: BillingSubscriptionResponse?,
    onRefreshSocial: () -> Unit,
    onCreateFamilyInvite: () -> Unit,
    onAcceptFamilyInvite: (String) -> Unit,
    onRevokeFamilyInvite: (String) -> Unit,
    onOpenBilling: () -> Unit,
) {
    var inviteCode by remember { mutableStateOf("") }
    val group = familyGroup
    val isGroupReady = group?.group != null
    val plan = subscriptionResponse?.plan

    OutlinedCard {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            PanelHeader(
                title = "커플/가족",
                actionLabel = if (socialBusy) "불러오는 중" else "새로고침",
                enabled = !socialBusy,
                onAction = onRefreshSocial,
            )

            Text("현재 플랜", fontWeight = FontWeight.SemiBold)
            if (plan == null) {
                MutedText("무료 플랜 또는 활성 구독이 없어요.")
            } else {
                MutedText("${plan.name} - ${planTypeLabel(plan.planType)} - 최대 ${plan.maxMembers}명")
            }
            OutlinedButton(
                onClick = onOpenBilling,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("구독/이용권 관리")
            }

            Text("초대 코드 등록", fontWeight = FontWeight.SemiBold)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedTextField(
                    value = inviteCode,
                    onValueChange = { inviteCode = it },
                    label = { Text("초대 코드") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.weight(1f),
                )
                Button(
                    onClick = {
                        onAcceptFamilyInvite(inviteCode)
                        inviteCode = ""
                    },
                    enabled = inviteCode.isNotBlank() && !socialBusy,
                ) {
                    Text("참여")
                }
            }

            Text("연결된 멤버", fontWeight = FontWeight.SemiBold)
            if (!isGroupReady) {
                MutedText("아직 연결된 커플/가족 그룹이 없어요. 초대 코드를 등록하거나 구독 후 코드를 발급하세요.")
            } else {
                MutedText("${roleLabel(group.role)} - ${group.members.size}/${group.group.maxMembers}명")
                group.members.forEach { member ->
                    MutedText("${member.name ?: member.email ?: member.userId} (${roleLabel(member.role)})")
                }
            }

            OutlinedButton(
                onClick = onCreateFamilyInvite,
                enabled = !socialBusy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("초대 코드 만들기")
            }

            familyInvites.take(3).forEach { invite ->
                CompactActionRow(
                    title = invite.code,
                    subtitle = "${inviteStatusLabel(invite.status)} - 만료 ${invite.expiresAt ?: "알 수 없음"}",
                    actionLabel = "취소",
                    enabled = invite.status == "pending" && !socialBusy,
                    onAction = { onRevokeFamilyInvite(invite.code) },
                )
            }

            Text("공유 음성", fontWeight = FontWeight.SemiBold)
            if (familyVoices.isEmpty()) {
                MutedText("공유된 음성이 아직 없어요.")
            } else {
                familyVoices.forEach { voice ->
                    MutedText("${voice.name} - ${voice.ownerName ?: "가족"} (${voiceStatusLabel(voice.status)})")
                }
            }

            MutedText("커플/가족 연결 안에서 허용된 음성만 공유됩니다.")
        }
    }
}

@Composable
private fun VoiceMessagePanel(
    authSession: AuthSession,
    noteBusy: Boolean,
    familyGroup: FamilyGroupCurrentResponse?,
    subscriptionResponse: BillingSubscriptionResponse?,
    receivedNotes: List<ReceivedNote>,
    onRefresh: () -> Unit,
    onSendNote: (String, String) -> Unit,
    onMarkNoteRead: (String) -> Unit,
    onOpenFamily: () -> Unit,
    onOpenBilling: () -> Unit,
) {
    val isAvailable = hasCoupleOrFamilyAccess(subscriptionResponse, familyGroup)
    val recipients = remember(familyGroup, authSession.user.id, authSession.user.email) {
        familyGroup?.members.orEmpty().filterNot { member ->
            member.userId == authSession.user.id || member.email == authSession.user.email
        }
    }
    var selectedRecipientId by remember(recipients) { mutableStateOf(recipients.firstOrNull()?.userId) }
    var text by remember { mutableStateOf("") }

    OutlinedCard {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            PanelHeader(
                title = "메시지",
                actionLabel = if (noteBusy) "불러오는 중" else "새로고침",
                enabled = !noteBusy,
                onAction = onRefresh,
            )

            if (!isAvailable) {
                MutedText("음성 메시지는 커플/가족 플랜에서만 사용할 수 있어요.")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = onOpenFamily,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text("연결하기")
                    }
                    Button(
                        onClick = onOpenBilling,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text("플랜 보기")
                    }
                }
                return@Column
            }

            Text("받는 사람", fontWeight = FontWeight.SemiBold)
            if (recipients.isEmpty()) {
                MutedText("같은 커플/가족 그룹에 보낼 사람이 없어요.")
                OutlinedButton(
                    onClick = onOpenFamily,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("초대 코드 관리")
                }
            } else {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    recipients.take(3).forEach { member ->
                        val selected = selectedRecipientId == member.userId
                        FilterChip(
                            selected = selected,
                            onClick = { selectedRecipientId = member.userId },
                            label = {
                                Text(
                                    text = member.name ?: member.email ?: "멤버",
                                    maxLines = 1,
                                )
                            },
                        )
                    }
                }
            }

            OutlinedTextField(
                value = text,
                onValueChange = { text = it.take(500) },
                label = { Text("메시지") },
                placeholder = { Text("전하고 싶은 말을 입력하세요") },
                minLines = 3,
                maxLines = 5,
                modifier = Modifier.fillMaxWidth(),
            )
            Text(
                text = "${text.length}/500",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.align(Alignment.End),
            )
            Button(
                onClick = {
                    val recipientId = selectedRecipientId
                    if (recipientId != null) {
                        onSendNote(recipientId, text)
                        text = ""
                    }
                },
                enabled = selectedRecipientId != null && text.isNotBlank() && !noteBusy,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
            ) {
                Text("메시지 보내기")
            }
            MutedText("보낸 메시지는 상대의 메시지함에 표시돼요. 음성 파일이 첨부된 메시지는 목록에서 확인할 수 있어요.")

            HorizontalDivider()

            Text("받은 메시지", fontWeight = FontWeight.SemiBold)
            if (receivedNotes.isEmpty()) {
                MutedText("아직 받은 메시지가 없어요.")
            } else {
                receivedNotes.take(8).forEach { note ->
                    NoteRow(note = note, onClick = { onMarkNoteRead(note.id) })
                }
            }
        }
    }
}

@Composable
private fun NoteRow(
    note: ReceivedNote,
    onClick: () -> Unit,
) {
    val unread = note.readAt == null
    Card(
        onClick = onClick,
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (unread) {
                MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.35f)
            } else {
                MaterialTheme.colorScheme.surface
            },
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = note.senderName ?: note.senderEmail ?: "보낸 사람",
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold,
                )
                if (unread) {
                    AssistChip(
                        onClick = onClick,
                        label = { Text("새 메시지") },
                    )
                }
            }
            Text(
                text = note.text,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            val meta = buildList {
                if (note.audioUrl != null) add("음성 파일 있음")
                note.createdAt?.let { add(it.take(10)) }
            }.joinToString(" · ")
            if (meta.isNotBlank()) {
                MutedText(meta)
            }
        }
    }
}

@Composable
private fun SubscriptionPanel(
    billingBusy: Boolean,
    subscriptionResponse: BillingSubscriptionResponse?,
    vouchers: List<VoucherItem>,
    onRefresh: () -> Unit,
    onRegisterCode: (String) -> Unit,
    onCheckoutPlan: (String) -> Unit,
) {
    var code by remember { mutableStateOf("") }
    var checkoutTarget by remember { mutableStateOf<SubscriptionPlanOption?>(null) }
    val currentPlan = subscriptionResponse?.plan
    val options = remember {
        listOf(
            SubscriptionPlanOption(
                key = "free",
                name = "무료",
                price = "무료",
                description = "일반 알람",
                features = listOf("로컬 일반 알람", "스누즈", "반복 요일"),
            ),
            SubscriptionPlanOption(
                key = "plus_personal",
                name = "개인",
                price = "월 4,900원",
                description = "AI 음성 알람과 캐릭터",
                features = listOf("AI 음성 프로필 2개", "TTS 알람", "캐릭터/스트릭"),
            ),
            SubscriptionPlanOption(
                key = "family",
                name = "커플/가족",
                price = "월 9,900원",
                description = "연결된 사람과 음성을 공유",
                features = listOf("초대 코드", "공유 음성", "메시지", "최대 6명"),
            ),
        )
    }

    OutlinedCard {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            PanelHeader(
                title = "구독",
                actionLabel = if (billingBusy) "불러오는 중" else "새로고침",
                enabled = !billingBusy,
                onAction = onRefresh,
            )

            Text("현재 플랜", fontWeight = FontWeight.SemiBold)
            if (currentPlan == null) {
                MutedText("무료 플랜 또는 활성 구독 없음")
            } else {
                MutedText("${currentPlan.name} - ${planTypeLabel(currentPlan.planType)} - 최대 ${currentPlan.maxMembers}명")
            }

            options.forEach { option ->
                val isCurrent = if (option.key == "free") {
                    currentPlan == null
                } else {
                    currentPlan?.key == option.key
                }
                SubscriptionPlanCard(
                    option = option,
                    isCurrent = isCurrent,
                    busy = billingBusy,
                    onCheckout = { checkoutTarget = option },
                )
            }

            HorizontalDivider()

            Text("이용권 코드 등록", fontWeight = FontWeight.SemiBold)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedTextField(
                    value = code,
                    onValueChange = { code = it.uppercase().take(18) },
                    label = { Text("VA-XXXX-XXXX-XXXX") },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                Button(
                    onClick = {
                        onRegisterCode(code)
                        code = ""
                    },
                    enabled = code.isNotBlank() && !billingBusy,
                ) {
                    Text("등록")
                }
            }

            Text("발급된 이용권", fontWeight = FontWeight.SemiBold)
            if (vouchers.isEmpty()) {
                MutedText("발급된 이용권이 없어요.")
            } else {
                vouchers.take(6).forEach { voucher ->
                    MutedText("${voucher.code} - ${voucher.planName} - ${voucherStatusLabel(voucher.status)}")
                }
            }
        }
    }

    checkoutTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { checkoutTarget = null },
            title = { Text("${target.name} 플랜 변경") },
            text = {
                Text("선택한 플랜으로 변경할까요? 적용 후 선물용 이용권 코드가 발급됩니다.")
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        checkoutTarget = null
                        onCheckoutPlan(target.key)
                    },
                ) {
                    Text("적용")
                }
            },
            dismissButton = {
                TextButton(onClick = { checkoutTarget = null }) {
                    Text("취소")
                }
            },
        )
    }
}

@Composable
private fun SubscriptionPlanCard(
    option: SubscriptionPlanOption,
    isCurrent: Boolean,
    busy: Boolean,
    onCheckout: () -> Unit,
) {
    Card(
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isCurrent) {
                MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.45f)
            } else {
                MaterialTheme.colorScheme.surface
            },
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    Text(option.name, fontWeight = FontWeight.SemiBold)
                    Text(
                        option.price,
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.primary,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                if (isCurrent) {
                    AssistChip(onClick = {}, label = { Text("현재") })
                }
            }
            MutedText(option.description)
            option.features.forEach { feature ->
                MutedText("• $feature")
            }
            if (!isCurrent && option.key != "free") {
                Button(
                    onClick = onCheckout,
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                ) {
                    Text("${option.name} 적용")
                }
            }
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
    val pendingEvents = characterEvents.count { it.state != "synced" }

    OutlinedCard {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            PanelHeader(
                title = "성장",
                actionLabel = if (characterBusy || billingBusy) "불러오는 중" else "새로고침",
                enabled = !characterBusy && !billingBusy,
                onAction = onRefresh,
            )

            if (characterResponse == null) {
                MutedText("캐릭터 정보를 아직 불러오지 않았어요.")
            } else {
                val character = characterResponse.character
                Text(
                    text = "${stageEmoji(character.stage)} ${character.name}",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                MutedText(
                    "레벨 ${character.level} - ${stageLabel(character.stage)} - XP ${character.xp} - 애정도 ${character.affection}",
                )
                MutedText(
                    "연속 ${characterResponse.streak.current}일 - 최장 ${characterResponse.streak.longest}일",
                )
                MutedText(
                    "진행도 ${characterResponse.progress.xpIntoLevel}/${characterResponse.progress.levelSpan}",
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
                    Text("XP 동기화")
                }
                OutlinedButton(
                    onClick = onRefresh,
                    enabled = !characterBusy && !billingBusy,
                    modifier = Modifier.weight(1f),
                ) {
                    Text("대기 ${pendingEvents}개")
                }
            }
            MutedText("구독과 이용권 코드는 홈 오른쪽 위 프로필 메뉴의 구독/이용권에서 관리해요.")
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
private fun VoiceAlarmSwitch(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val isDark = androidx.compose.foundation.isSystemInDarkTheme()
    Switch(
        checked = checked,
        onCheckedChange = onCheckedChange,
        modifier = modifier,
        colors = SwitchDefaults.colors(
            checkedThumbColor = MaterialTheme.colorScheme.onPrimary,
            checkedTrackColor = MaterialTheme.colorScheme.primary,
            checkedBorderColor = Color.Transparent,
            uncheckedThumbColor = if (isDark) Color(0xFFE4D8C6) else Color.White,
            uncheckedTrackColor = if (isDark) Color(0xFF40372B) else Color(0xFFE7DDCB),
            uncheckedBorderColor = if (isDark) Color(0xFF5A4D3B) else Color(0xFFD5C8B4),
        ),
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
                text = "권한",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            PermissionRow(
                icon = Icons.Outlined.Alarm,
                label = "정확한 알람",
                granted = permissions.exactAlarms,
                actionLabel = "열기",
                onAction = onRequestExactAlarms,
            )
            PermissionRow(
                icon = Icons.Outlined.Notifications,
                label = "알림",
                granted = permissions.notifications,
                actionLabel = "허용",
                onAction = onRequestNotifications,
            )
            PermissionRow(
                icon = Icons.Outlined.Fullscreen,
                label = "전체화면 알람",
                granted = permissions.fullScreenIntent,
                actionLabel = "열기",
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
                    text = if (granted) "허용됨" else "필요함",
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
    val deleteWidth = 92.dp
    val deleteWidthPx = with(LocalDensity.current) { deleteWidth.toPx() }
    var deleteRevealed by remember(alarm.id) { mutableStateOf(false) }
    var dragOffsetPx by remember(alarm.id) { mutableStateOf(0f) }
    val settledOffsetPx = if (deleteRevealed) -deleteWidthPx else 0f
    val currentOffsetPx = if (dragOffsetPx != 0f) dragOffsetPx else settledOffsetPx
    val dragState = rememberDraggableState { delta ->
        dragOffsetPx = (dragOffsetPx + delta).coerceIn(-deleteWidthPx, 0f)
    }

    Box(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.matchParentSize(),
            horizontalArrangement = Arrangement.End,
        ) {
            DeleteRevealButton(
                modifier = Modifier.width(deleteWidth),
                onDelete = onDeleteAlarm,
            )
        }

        Card(
            onClick = {
                if (!deleteRevealed) {
                    onEditAlarm()
                } else {
                    deleteRevealed = false
                    dragOffsetPx = 0f
                }
            },
            modifier = Modifier
                .offset { IntOffset(currentOffsetPx.roundToInt(), 0) }
                .draggable(
                    state = dragState,
                    orientation = Orientation.Horizontal,
                    onDragStarted = {
                        dragOffsetPx = settledOffsetPx
                        deleteRevealed = false
                    },
                    onDragStopped = {
                        deleteRevealed = dragOffsetPx <= -deleteWidthPx * 0.42f
                        dragOffsetPx = 0f
                    },
                ),
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
                    VoiceAlarmSwitch(
                        checked = alarm.enabled,
                        onCheckedChange = onToggleEnabled,
                    )
                }
                if (alarm.enabled) {
                    Text(
                        text = "다음 ${formatFireTime(alarm.fireAtMillis)}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
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
            }
        }
    }
}

@Composable
private fun DeleteRevealButton(
    modifier: Modifier,
    onDelete: () -> Unit,
) {
    Surface(
        onClick = onDelete,
        modifier = modifier.fillMaxHeight(),
        color = MaterialTheme.colorScheme.error,
        shape = RoundedCornerShape(16.dp),
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Icon(
                imageVector = Icons.Outlined.Delete,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onPrimary,
            )
            Text(
                text = "삭제",
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onPrimary,
            )
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
        ?: "로컬 음성 오디오"

private fun voiceUploadPart(audio: CachedAlarmAudio): MultipartBody.Part {
    val uri = Uri.parse(audio.localAudioUri)
    require(uri.scheme == "file") { "로컬에 저장된 오디오만 업로드할 수 있어요." }
    val file = File(requireNotNull(uri.path) { "오디오 파일 경로를 찾을 수 없어요." })
    require(file.exists()) { "오디오 파일을 찾을 수 없어요." }
    val mediaType = when (file.extension.lowercase()) {
        "m4a", "mp4", "aac" -> "audio/mp4"
        "mp3" -> "audio/mpeg"
        "wav" -> "audio/wav"
        "ogg" -> "audio/ogg"
        else -> "application/octet-stream"
    }.toMediaType()
    val uploadName = audio.displayName.ifBlank { file.name }
    return MultipartBody.Part.createFormData(
        name = "audio",
        filename = uploadName,
        body = file.asRequestBody(mediaType),
    )
}

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

private fun userFacingError(error: Throwable, fallback: String): String =
    error.message?.takeIf { it.any { char -> char in '\uAC00'..'\uD7A3' } } ?: fallback

private fun providerLabel(provider: String?): String = when (provider) {
    "google" -> "Google"
    "app" -> "이메일"
    else -> provider ?: "앱"
}

private fun hasCoupleOrFamilyAccess(
    subscriptionResponse: BillingSubscriptionResponse?,
    familyGroup: FamilyGroupCurrentResponse?,
): Boolean {
    val plan = subscriptionResponse?.plan
    return familyGroup?.group != null ||
        plan?.key == "family" ||
        plan?.key == "couple" ||
        plan?.planType == "family" ||
        plan?.planType == "couple"
}

private fun roleLabel(role: String?): String = when (role) {
    "owner" -> "소유자"
    "admin" -> "관리자"
    "member" -> "멤버"
    else -> role ?: "멤버"
}

private fun inviteStatusLabel(status: String?): String = when (status) {
    "pending" -> "대기 중"
    "used" -> "사용됨"
    "expired" -> "만료됨"
    "revoked" -> "취소됨"
    else -> status ?: "알 수 없음"
}

private fun voiceStatusLabel(status: String?): String = when (status) {
    null, "ready" -> "사용 가능"
    "processing" -> "준비 중"
    "failed" -> "실패"
    else -> status
}

private fun planTypeLabel(type: String?): String = when (type) {
    "free" -> "무료"
    "personal", "individual", "plus" -> "개인"
    "couple" -> "커플"
    "family" -> "가족"
    else -> type ?: "플랜"
}

private fun voucherStatusLabel(status: String?): String = when (status) {
    "active" -> "사용 가능"
    "pending" -> "대기 중"
    "redeemed", "used" -> "사용됨"
    "expired" -> "만료됨"
    "revoked" -> "취소됨"
    else -> status ?: "알 수 없음"
}

private fun codeTypeLabel(type: String): String = when (type) {
    "voucher" -> "쿠폰"
    "invite" -> "초대 코드"
    "subscription" -> "구독"
    else -> type
}

private fun alarmStateLabel(state: String?): String = when (state) {
    "scheduled" -> "예약됨"
    "ringing" -> "울리는 중"
    "snoozed" -> "다시 울림"
    "dismissed" -> "종료됨"
    "missed" -> "놓침"
    "failed" -> "실패"
    else -> state ?: "로컬"
}

private fun stageEmoji(stage: String): String = when (stage) {
    "sprout" -> "새싹"
    "tree" -> "나무"
    "bloom" -> "꽃"
    else -> "씨앗"
}

private fun stageLabel(stage: String): String = when (stage) {
    "sprout" -> "새싹"
    "tree" -> "나무"
    "bloom" -> "꽃"
    else -> "씨앗"
}

private fun syncStateLabel(state: String): String = when (state) {
    AlarmSyncStates.SYNCED -> "동기화됨"
    AlarmSyncStates.DIRTY -> "변경됨"
    AlarmSyncStates.FAILED -> "동기화 실패"
    else -> "로컬만"
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
