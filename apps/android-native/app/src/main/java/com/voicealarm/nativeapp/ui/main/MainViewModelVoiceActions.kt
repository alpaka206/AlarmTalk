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
import com.voicealarm.nativeapp.network.VoiceSpeakerSegment
import com.voicealarm.nativeapp.network.VoucherItem
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


internal fun MainViewModel.loadVoiceProfiles() {
    fetchVoiceProfiles(showMessage = true)
}

internal fun MainViewModel.preloadVoiceProfiles() {
    if (authSession == null || voiceProfileBusy || voiceProfiles.isNotEmpty()) return
    fetchVoiceProfiles(showMessage = false)
}

internal fun MainViewModel.fetchVoiceProfiles(showMessage: Boolean) {
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
        }.onFailure { error ->
            Log.e(TAG, "Failed to load voice profiles", error)
            if (showMessage) message = userFacingError(error, "음성 프로필을 불러오지 못했어요")
        }
        voiceProfileBusy = false
    }
}

internal fun MainViewModel.createVoiceProfile(name: String, audio: CachedAlarmAudio, shared: Boolean) {
    createVoiceProfiles(listOf(Triple(name, audio, shared)))
}

internal fun MainViewModel.createVoiceProfiles(items: List<Triple<String, CachedAlarmAudio, Boolean>>) {
    val session = authSession
    if (session == null) {
        message = "음성 프로필을 만들려면 먼저 로그인해 주세요"
        return
    }
    val drafts = items.map { (name, audio, shared) -> Triple(name.trim(), audio, shared) }
    if (drafts.isEmpty() || drafts.any { it.first.isBlank() }) {
        message = "음성 프로필 이름을 입력해 주세요"
        return
    }
    if (voiceProfiles.size + drafts.size > MAX_VOICE_PROFILES) {
        message = "음성 프로필은 최대 ${MAX_VOICE_PROFILES}개까지 만들 수 있어요"
        return
    }

    viewModelScope.launch {
        if (voiceProfileBusy) return@launch
        voiceProfileBusy = true
        runCatching {
            withContext(Dispatchers.IO) {
                drafts.map { (name, audio, shared) ->
                    api.createVoiceClone(
                        authorization = VoiceAlarmApiClient.bearer(session.token),
                        audio = voiceUploadPart(audio),
                        name = name.toRequestBody("text/plain".toMediaType()),
                        isShared = shared.toString().toRequestBody("text/plain".toMediaType()),
                    ).profile
                }
            }
        }.onSuccess { profiles ->
            val newIds = profiles.map { it.id }.toSet()
            voiceProfiles = profiles + voiceProfiles.filterNot { it.id in newIds }
            message = if (profiles.size == 1) {
                "음성 프로필 '${profiles.first().name}'을 만들었어요"
            } else {
                "음성 프로필 ${profiles.size}개를 만들었어요"
            }
        }.onFailure { error ->
            Log.e(TAG, "Failed to create voice profile", error)
            message = userFacingError(error, "음성 프로필 생성에 실패했어요")
        }
        voiceProfileBusy = false
    }
}

internal suspend fun MainViewModel.separateVoiceSpeakers(audio: CachedAlarmAudio): List<VoiceSpeakerSegment> {
    val session = authSession ?: throw IllegalStateException("화자 분리를 하려면 먼저 로그인해 주세요")
    return withContext(Dispatchers.IO) {
        val upload = api.uploadVoiceAudio(
            authorization = VoiceAlarmApiClient.bearer(session.token),
            audio = voiceUploadPart(audio),
            durationMs = (audio.durationMillis ?: 0L).toString().toRequestBody("text/plain".toMediaType()),
            originalName = audio.displayName.toRequestBody("text/plain".toMediaType()),
        ).upload
        api.separateVoiceUpload(
            authorization = VoiceAlarmApiClient.bearer(session.token),
            uploadId = upload.id,
        ).speakers
    }
}

internal fun MainViewModel.renameVoiceProfile(profileId: String, name: String) {
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
                if (it.id == profile.id) it.copy(name = profile.name, isShared = profile.isShared ?: it.isShared) else it
            }
            message = "음성 프로필 이름을 바꿨어요"
        }.onFailure { error ->
            Log.e(TAG, "Failed to rename voice profile id=$profileId", error)
            message = userFacingError(error, "음성 프로필 이름 변경에 실패했어요")
        }
        voiceProfileBusy = false
    }
}

internal fun MainViewModel.setVoiceProfileShared(profileId: String, shared: Boolean) {
    val session = authSession
    if (session == null) {
        message = "음성 프로필을 공유하려면 먼저 로그인해 주세요"
        return
    }
    if (!hasCoupleOrFamilyAccess(subscriptionResponse, familyGroup)) {
        message = "음성 공유는 커플/가족 이용권에서 사용할 수 있어요"
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
                    request = VoiceProfileUpdateRequest(isShared = shared),
                ).profile
            }
        }.onSuccess { profile ->
            voiceProfiles = voiceProfiles.map {
                if (it.id == profile.id) it.copy(isShared = profile.isShared ?: shared) else it
            }
            runCatching {
                api.listFamilyVoiceProfiles(VoiceAlarmApiClient.bearer(session.token)).profiles
            }.onSuccess { profiles ->
                familyVoices = profiles
            }
            message = if (shared) "음성 프로필을 공유했어요" else "음성 프로필 공유를 껐어요"
        }.onFailure { error ->
            Log.e(TAG, "Failed to update voice profile sharing id=$profileId shared=$shared", error)
            message = userFacingError(error, "음성 프로필 공유 설정에 실패했어요")
        }
        voiceProfileBusy = false
    }
}

internal fun MainViewModel.deleteVoiceProfile(profileId: String) {
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
            message = userFacingError(error, "음성 프로필 삭제에 실패했어요")
        }
        voiceProfileBusy = false
    }
}

internal suspend fun MainViewModel.generateTtsAudio(request: TtsGenerateRequest): TtsGenerateResponse {
    val session = authSession ?: throw IllegalStateException("음성 오디오를 만들려면 먼저 로그인해 주세요")
    return withContext(Dispatchers.IO) {
        api.generateTts(VoiceAlarmApiClient.bearer(session.token), request)
    }
}

internal fun MainViewModel.loadTtsMessages() {
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
        }.onFailure { error ->
            Log.e(TAG, "Failed to load saved TTS messages", error)
            message = userFacingError(error, "저장된 음성을 불러오지 못했어요")
        }
        ttsMessageBusy = false
    }
}

internal suspend fun MainViewModel.downloadTtsMessageAudio(messageId: String): TtsMessageAudioResponse {
    val session = authSession ?: throw IllegalStateException("저장된 음성 오디오를 불러오려면 먼저 로그인해 주세요")
    return withContext(Dispatchers.IO) {
        api.getTtsMessageAudio(VoiceAlarmApiClient.bearer(session.token), messageId)
    }
}
