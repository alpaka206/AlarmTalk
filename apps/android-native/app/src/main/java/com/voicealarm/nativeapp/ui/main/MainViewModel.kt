package com.voicealarm.nativeapp

import android.app.Application
import android.util.Log
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Message
import androidx.compose.material3.Text
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.voicealarm.nativeapp.core.VoiceAlarmLog.TAG
import com.voicealarm.nativeapp.data.AlarmAppContainer
import com.voicealarm.nativeapp.data.AlarmDraft
import com.voicealarm.nativeapp.data.AlarmEntity
import com.voicealarm.nativeapp.data.CachedAlarmAudio
import com.voicealarm.nativeapp.data.CharacterEventEntity
import com.voicealarm.nativeapp.network.AuthTokenResponse
import com.voicealarm.nativeapp.network.AuthSession
import com.voicealarm.nativeapp.network.AuthSessionStore
import com.voicealarm.nativeapp.network.BillingSubscriptionResponse
import com.voicealarm.nativeapp.network.CharacterResponse
import com.voicealarm.nativeapp.network.CheckoutRequest
import com.voicealarm.nativeapp.network.CodeRegisterRequest
import com.voicealarm.nativeapp.network.FamilyGroupCurrentResponse
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
import com.voicealarm.nativeapp.sync.RemoteAlarmSyncScheduler
import java.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue

class MainViewModel(application: Application) : AndroidViewModel(application) {
    internal val repository = AlarmAppContainer.repository(application)
    internal val api = VoiceAlarmApiClient.create()
    internal val authSessionStore = AuthSessionStore(application)

    val alarms: StateFlow<List<AlarmEntity>> = repository.observeAlarms()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val characterEvents: StateFlow<List<CharacterEventEntity>> = repository.observeCharacterEvents()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    var authSession by mutableStateOf<AuthSession?>(authSessionStore.read())
        internal set

    var authBusy by mutableStateOf(false)
        internal set

    var registerEmailVerificationSentTo by mutableStateOf<String?>(null)
        internal set

    var registerEmailVerified by mutableStateOf<String?>(null)
        internal set

    var syncBusy by mutableStateOf(false)
        internal set

    var voiceProfiles by mutableStateOf<List<VoiceProfile>>(emptyList())
        internal set

    var voiceProfileBusy by mutableStateOf(false)
        internal set

    var ttsMessages by mutableStateOf<List<TtsMessage>>(emptyList())
        internal set

    var ttsMessageBusy by mutableStateOf(false)
        internal set

    var socialBusy by mutableStateOf(false)
        internal set

    var familyGroup by mutableStateOf<FamilyGroupCurrentResponse?>(null)
        internal set

    var familyVoices by mutableStateOf<List<FamilyVoiceProfile>>(emptyList())
        internal set

    var characterBusy by mutableStateOf(false)
        internal set

    var characterResponse by mutableStateOf<CharacterResponse?>(null)
        internal set

    var billingBusy by mutableStateOf(false)
        internal set

    var subscriptionResponse by mutableStateOf<BillingSubscriptionResponse?>(null)
        internal set

    var vouchers by mutableStateOf<List<VoucherItem>>(emptyList())
        internal set

    var noteBusy by mutableStateOf(false)
        internal set

    var receivedNotes by mutableStateOf<List<ReceivedNote>>(emptyList())
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

    private val onboardingPrefs = application.getSharedPreferences("voice_alarm_onboarding", android.content.Context.MODE_PRIVATE)
    var showOnboarding by mutableStateOf(false)
        internal set

    var permissionGateRequest by mutableStateOf<PermissionTarget?>(null)
        internal set

    var navigateHomeTick by mutableStateOf(0)
        internal set

    fun requestPermissionGate(target: PermissionTarget) {
        permissionGateRequest = target
    }

    fun dismissPermissionGate() {
        permissionGateRequest = null
    }

    fun checkOnboardingFor(userId: String) {
        if (userId.isBlank()) return
        val seen = onboardingPrefs.getStringSet("seen_users", emptySet()) ?: emptySet()
        showOnboarding = userId !in seen
    }

    fun completeOnboarding() {
        val userId = authSession?.user?.id?.takeIf { it.isNotBlank() }
        if (userId != null) {
            val seen = onboardingPrefs.getStringSet("seen_users", emptySet())?.toMutableSet() ?: mutableSetOf()
            seen += userId
            onboardingPrefs.edit().putStringSet("seen_users", seen).apply()
        }
        showOnboarding = false
    }

    fun loadReceivedAlarmBadgeState() {
        val userId = authSession?.user?.id ?: run {
            receivedAlarmSeenAtMillis = 0L
            return
        }
        receivedAlarmSeenAtMillis = receivedAlarmBadgeStore.readSeenAtMillis(userId)
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
            message = "로그인 후 사용할 수 있어요"
            return
        }
        nicknameEditDialogOpen = true
    }

    fun dismissEditNickname() {
        nicknameEditDialogOpen = false
    }

    fun requestDeleteAccount() {
        if (authSession == null) {
            message = "로그인 후 사용할 수 있어요"
            return
        }
        deleteAccountConfirmOpen = true
    }

    fun dismissDeleteAccount() {
        deleteAccountConfirmOpen = false
    }

    init {
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
                Log.e(TAG, "Startup alarm sync failed", error)
            }
        }
        refreshAppSession()
    }

}

private fun loadInitialThemeMode(prefs: android.content.SharedPreferences): ThemeMode {
    val raw = prefs.getString("mode", ThemeMode.System.name) ?: return ThemeMode.System
    return runCatching { ThemeMode.valueOf(raw) }.getOrDefault(ThemeMode.System)
}
