package com.alarmtalk.app

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
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.data.AlarmAppContainer
import com.alarmtalk.app.data.AlarmDraft
import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.CachedAlarmAudio
import com.alarmtalk.app.data.CharacterEventEntity
import com.alarmtalk.app.data.VoiceProfileCreationDraft
import com.alarmtalk.app.network.apiErrorCode
import com.alarmtalk.app.network.AuthTokenResponse
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.CharacterResponse
import com.alarmtalk.app.network.CheckoutRequest
import com.alarmtalk.app.network.CodeRegisterRequest
import com.alarmtalk.app.network.FamilyGroupCurrentResponse
import com.alarmtalk.app.network.FamilyVoiceProfile
import com.alarmtalk.app.network.LoginRequest
import com.alarmtalk.app.network.ReceivedNote
import com.alarmtalk.app.network.RegisterRequest
import com.alarmtalk.app.network.SendNoteRequest
import com.alarmtalk.app.network.TtsGenerateRequest
import com.alarmtalk.app.network.TtsGenerateResponse
import com.alarmtalk.app.network.TtsMessage
import com.alarmtalk.app.network.TtsMessageAudioResponse
import com.alarmtalk.app.network.AlarmTalkApiClient
import com.alarmtalk.app.network.VoiceProfile
import com.alarmtalk.app.network.VoiceProfileRelationshipUpdateRequest
import com.alarmtalk.app.network.VoiceProfileUpdateRequest
import com.alarmtalk.app.network.VoiceSpeakerSegment
import com.alarmtalk.app.network.VoucherItem
import java.time.Instant
import java.util.UUID
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
            api.listVoiceProfiles(AlarmTalkApiClient.bearer(session.token)).profiles
        }.onSuccess { profiles ->
            voiceProfiles = profiles
        }.onFailure { error ->
            Log.e(TAG, "Failed to load voice profiles", error)
            if (showMessage) message = userFacingError(error, "목소리를 불러오지 못했어요")
        }
        voiceProfileBusy = false
    }
}

internal fun MainViewModel.createVoiceProfile(
    name: String,
    audio: CachedAlarmAudio,
    shared: Boolean,
    relationshipLabel: String,
    listenerTitle: String,
) {
    createVoiceProfiles(
        listOf(
            VoiceProfileCreationDraft(
                name = name,
                audio = audio,
                shared = shared,
                relationshipLabel = relationshipLabel,
                listenerTitle = listenerTitle,
            ),
        ),
    )
}

internal fun MainViewModel.createVoiceProfiles(items: List<VoiceProfileCreationDraft>) {
    val session = authSession
    if (session == null) {
        message = "목소리를 만들려면 먼저 로그인해 주세요"
        return
    }
    if (!hasPaidVoiceAccess(subscriptionResponse)) {
        message = "유료 이용권에서 사용할 수 있어요."
        return
    }
    val drafts = items.map {
        it.copy(
            name = it.name.trim(),
            relationshipLabel = it.relationshipLabel.trim(),
            listenerTitle = it.listenerTitle.trim(),
        )
    }
    if (drafts.isEmpty() || drafts.any { it.name.isBlank() }) {
        message = "목소리 이름을 입력해 주세요"
        return
    }
    if (drafts.any { it.relationshipLabel.isBlank() }) {
        message = "나와의 관계를 입력해 주세요"
        return
    }
    if (drafts.any { it.listenerTitle.isBlank() }) {
        message = "이 목소리가 나를 부를 이름을 입력해 주세요"
        return
    }
    // 시스템 스톡 보이스는 개수 제한에서 제외 — 내가 만든 목소리만 센다.
    if (voiceProfiles.count { it.isSystem != true } + drafts.size > MAX_VOICE_PROFILES) {
        message = "목소리는 최대 ${MAX_VOICE_PROFILES}개까지 만들 수 있어요"
        return
    }

    viewModelScope.launch {
        if (voiceProfileBusy) return@launch
        voiceProfileBusy = true
        val pendingProfiles = drafts.map { draft ->
            VoiceProfile(
                id = "local-pending-${UUID.randomUUID()}",
                name = draft.name,
                status = "processing",
                isShared = draft.shared,
                relationshipLabel = draft.relationshipLabel,
                listenerTitle = draft.listenerTitle,
            )
        }
        val pendingIds = pendingProfiles.map { it.id }.toSet()
        voiceProfiles = pendingProfiles + voiceProfiles
        runCatching {
            withContext(Dispatchers.IO) {
                drafts.map { draft ->
                    api.createVoiceClone(
                        authorization = AlarmTalkApiClient.bearer(session.token),
                        audio = voiceUploadPart(draft.audio),
                        name = draft.name.toRequestBody("text/plain".toMediaType()),
                        isShared = draft.shared.toString().toRequestBody("text/plain".toMediaType()),
                        relationshipLabel = draft.relationshipLabel.toRequestBody("text/plain".toMediaType()),
                        listenerTitle = draft.listenerTitle.toRequestBody("text/plain".toMediaType()),
                        durationMs = (draft.audio.durationMillis?.toString() ?: "").toRequestBody("text/plain".toMediaType()),
                        isDraft = false.toString().toRequestBody("text/plain".toMediaType()),
                    ).profile
                }
            }
        }.onSuccess { profiles ->
            val newIds = profiles.map { it.id }.toSet()
            voiceProfiles = profiles + voiceProfiles.filterNot { it.id in pendingIds || it.id in newIds }
            message = if (profiles.size == 1) {
                "'${profiles.first().name}' 목소리를 만들었어요"
            } else {
                "목소리 ${profiles.size}개를 만들었어요"
            }
        }.onFailure { error ->
            voiceProfiles = voiceProfiles.filterNot { it.id in pendingIds }
            Log.e(TAG, "Failed to create voice profile", error)
            message = when (apiErrorCode(error)) {
                "VOICE_CLONE_AUDIO_TOO_SHORT" -> "목소리를 만들 음성은 1분 이상이어야 해요."
                "VOICE_CLONE_AUDIO_TOO_LONG" -> "목소리를 만들 음성은 2분 이하로 준비해 주세요."
                "INVALID_DURATION" -> "음성 길이를 확인하지 못했어요. 파일을 다시 선택해 주세요."
                "VOICE_SLOT_EXHAUSTED" -> "지금은 목소리 생성 요청이 많아요. 잠시 후 다시 시도해 주세요."
                "VOICE_FEATURE_REQUIRES_PAID_PLAN" -> "유료 이용권에서 사용할 수 있어요."
                else -> userFacingError(error, "목소리를 만들지 못했어요")
            }
        }
        voiceProfileBusy = false
    }
}

internal suspend fun MainViewModel.separateVoiceSpeakers(audio: CachedAlarmAudio): List<VoiceSpeakerSegment> {
    val session = authSession ?: throw IllegalStateException("목소리를 나누려면 먼저 로그인해 주세요")
    check(hasPaidVoiceAccess(subscriptionResponse)) {
        "유료 이용권에서 사용할 수 있어요."
    }
    return withContext(Dispatchers.IO) {
        val upload = api.uploadVoiceAudio(
            authorization = AlarmTalkApiClient.bearer(session.token),
            audio = voiceUploadPart(audio),
            durationMs = (audio.durationMillis ?: 0L).toString().toRequestBody("text/plain".toMediaType()),
            originalName = audio.displayName.toRequestBody("text/plain".toMediaType()),
        ).upload
        api.separateVoiceUpload(
            authorization = AlarmTalkApiClient.bearer(session.token),
            uploadId = upload.id,
        ).speakers
    }
}

/**
 * 화자 미리듣기용 임시(draft) 보이스 프로파일을 만든다.
 * MAX_VOICE_PROFILES 카운트에서 제외되고, 사용자가 "선택" 하면 promote 로 정식 등록한다.
 */
internal suspend fun MainViewModel.cloneSpeakerDraft(
    name: String,
    audio: CachedAlarmAudio,
): VoiceProfile {
    val session = authSession ?: throw IllegalStateException("목소리 미리듣기를 하려면 먼저 로그인해 주세요")
    check(hasPaidVoiceAccess(subscriptionResponse)) {
        "유료 이용권에서 사용할 수 있어요."
    }
    return withContext(Dispatchers.IO) {
        api.createVoiceClone(
            authorization = AlarmTalkApiClient.bearer(session.token),
            audio = voiceUploadPart(audio),
            name = name.toRequestBody("text/plain".toMediaType()),
            isShared = false.toString().toRequestBody("text/plain".toMediaType()),
            relationshipLabel = "".toRequestBody("text/plain".toMediaType()),
            listenerTitle = "".toRequestBody("text/plain".toMediaType()),
            durationMs = (audio.durationMillis?.toString() ?: "").toRequestBody("text/plain".toMediaType()),
            isDraft = true.toString().toRequestBody("text/plain".toMediaType()),
        ).profile
    }
}

/**
 * draft=true 프로파일을 promote 해 정식 보이스로 등록한다.
 * 사용자의 기존 non-draft 음성이 있으면 서버가 409 VOICE_LIMIT_REACHED 를 반환한다.
 */
internal suspend fun MainViewModel.promoteDraftVoice(profileId: String): VoiceProfile {
    val session = authSession ?: throw IllegalStateException("음성을 등록하려면 먼저 로그인해 주세요")
    return withContext(Dispatchers.IO) {
        api.updateVoiceProfile(
            authorization = AlarmTalkApiClient.bearer(session.token),
            id = profileId,
            request = VoiceProfileUpdateRequest(isDraft = false),
        ).profile
    }
}

/** draft 보이스 정리용. 기존 deleteVoiceProfile 과 동일하게 force=true 로 삭제. */
internal suspend fun MainViewModel.deleteDraftVoice(profileId: String) {
    val session = authSession ?: return
    withContext(Dispatchers.IO) {
        runCatching {
            api.deleteVoiceProfile(
                authorization = AlarmTalkApiClient.bearer(session.token),
                id = profileId,
                force = true,
            )
        }.onFailure { error ->
            Log.w(TAG, "Failed to delete draft voice id=$profileId", error)
        }
    }
}

internal fun MainViewModel.renameVoiceProfile(
    profileId: String,
    name: String,
    relationshipLabel: String,
    listenerTitle: String,
) {
    val session = authSession
    if (session == null) {
        message = "목소리를 수정하려면 먼저 로그인해 주세요"
        return
    }
    val trimmedName = name.trim()
    val trimmedRelationship = relationshipLabel.trim()
    val trimmedListener = listenerTitle.trim()
    if (trimmedName.isBlank()) {
        message = "목소리 이름을 입력해 주세요"
        return
    }
    if (trimmedRelationship.isBlank()) {
        message = "나와의 관계를 입력해 주세요"
        return
    }
    if (trimmedListener.isBlank()) {
        message = "이 목소리가 나를 부를 이름을 입력해 주세요"
        return
    }

    viewModelScope.launch {
        if (voiceProfileBusy) return@launch
        voiceProfileBusy = true
        runCatching {
            withContext(Dispatchers.IO) {
                api.updateVoiceProfile(
                    authorization = AlarmTalkApiClient.bearer(session.token),
                    id = profileId,
                    request = VoiceProfileUpdateRequest(
                        name = trimmedName,
                        relationshipLabel = trimmedRelationship,
                        listenerTitle = trimmedListener,
                    ),
                ).profile
            }
        }.onSuccess { profile ->
            voiceProfiles = voiceProfiles.map {
                if (it.id == profile.id) {
                    it.copy(
                        name = profile.name,
                        isShared = profile.isShared ?: it.isShared,
                        relationshipLabel = profile.relationshipLabel ?: it.relationshipLabel,
                        listenerTitle = profile.listenerTitle ?: it.listenerTitle,
                    )
                } else {
                    it
                }
            }
            message = "정보를 수정했어요"
        }.onFailure { error ->
            Log.e(TAG, "Failed to rename voice profile id=$profileId", error)
            message = userFacingError(error, "정보 수정에 실패했어요")
        }
        voiceProfileBusy = false
    }
}

internal fun MainViewModel.updateSharedVoiceViewerInfo(
    profileId: String,
    relationshipLabel: String,
    listenerTitle: String,
    onSuccess: () -> Unit = {},
) {
    val session = authSession
    if (session == null) {
        message = "공유받은 목소리를 설정하려면 먼저 로그인해 주세요"
        return
    }
    val trimmedRelationship = relationshipLabel.trim()
    val trimmedListener = listenerTitle.trim()
    if (trimmedRelationship.isBlank()) {
        message = "나와의 관계를 입력해 주세요"
        return
    }
    if (trimmedListener.isBlank()) {
        message = "이 목소리가 나를 부를 이름을 입력해 주세요"
        return
    }

    viewModelScope.launch {
        if (voiceProfileBusy) return@launch
        voiceProfileBusy = true
        runCatching {
            withContext(Dispatchers.IO) {
                api.updateVoiceProfileRelationship(
                    authorization = AlarmTalkApiClient.bearer(session.token),
                    id = profileId,
                    request = VoiceProfileRelationshipUpdateRequest(
                        relationshipLabel = trimmedRelationship,
                        listenerTitle = trimmedListener,
                    ),
                ).profile
            }
        }.onSuccess { profile ->
            familyVoices = familyVoices.map {
                if (it.id == profile.id) {
                    it.copy(
                        relationshipLabel = profile.relationshipLabel ?: trimmedRelationship,
                        listenerTitle = profile.listenerTitle ?: trimmedListener,
                    )
                } else {
                    it
                }
            }
            message = "공유받은 목소리 정보를 저장했어요"
            onSuccess()
        }.onFailure { error ->
            Log.e(TAG, "Failed to update shared voice viewer info id=$profileId", error)
            message = userFacingError(error, "공유받은 목소리 정보 저장에 실패했어요")
        }
        voiceProfileBusy = false
    }
}

internal fun MainViewModel.setVoiceProfileShared(profileId: String, shared: Boolean) {
    val session = authSession
    if (session == null) {
        message = "목소리를 공유하려면 먼저 로그인해 주세요"
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
                    authorization = AlarmTalkApiClient.bearer(session.token),
                    id = profileId,
                    request = VoiceProfileUpdateRequest(isShared = shared),
                ).profile
            }
        }.onSuccess { profile ->
            voiceProfiles = voiceProfiles.map {
                if (it.id == profile.id) it.copy(isShared = profile.isShared ?: shared) else it
            }
            runCatching {
                api.listFamilyVoiceProfiles(AlarmTalkApiClient.bearer(session.token)).profiles
            }.onSuccess { profiles ->
                familyVoices = profiles
            }
            message = if (shared) "목소리를 공유했어요" else "목소리 공유를 껐어요"
        }.onFailure { error ->
            Log.e(TAG, "Failed to update voice profile sharing id=$profileId shared=$shared", error)
            message = userFacingError(error, "목소리 공유 설정에 실패했어요")
        }
        voiceProfileBusy = false
    }
}

internal fun MainViewModel.deleteVoiceProfile(profileId: String) {
    val session = authSession
    if (session == null) {
        message = "목소리를 삭제하려면 먼저 로그인해 주세요"
        return
    }

    viewModelScope.launch {
        if (voiceProfileBusy) return@launch
        voiceProfileBusy = true
        val originalProfile = voiceProfiles.firstOrNull { it.id == profileId }
        if (originalProfile != null) {
            voiceProfiles = voiceProfiles.map {
                if (it.id == profileId) it.copy(status = "deleting") else it
            }
        }
        runCatching {
            withContext(Dispatchers.IO) {
                api.deleteVoiceProfile(
                    authorization = AlarmTalkApiClient.bearer(session.token),
                    id = profileId,
                    force = true,
                )
            }
        }.onSuccess {
            voiceProfiles = voiceProfiles.filterNot { it.id == profileId }
            message = "목소리를 삭제했어요"
            refreshNotesSilently()
        }.onFailure { error ->
            if (error is retrofit2.HttpException && error.code() == 404) {
                voiceProfiles = voiceProfiles.filterNot { it.id == profileId }
                message = "이미 삭제된 목소리예요"
                refreshNotesSilently()
            } else {
                if (originalProfile != null) {
                    voiceProfiles = voiceProfiles.map {
                        if (it.id == profileId) originalProfile else it
                    }
                }
                Log.e(TAG, "Failed to delete voice profile id=$profileId", error)
                message = userFacingError(error, "목소리 삭제에 실패했어요")
            }
        }
        voiceProfileBusy = false
    }
}

internal suspend fun MainViewModel.generateTtsAudio(request: TtsGenerateRequest): TtsGenerateResponse {
    check(hasPaidVoiceAccess(subscriptionResponse)) {
        "유료 이용권에서 사용할 수 있어요."
    }
    val session = authSession ?: throw IllegalStateException("음성 오디오를 만들려면 먼저 로그인해 주세요")
    return withContext(Dispatchers.IO) {
        api.generateTts(AlarmTalkApiClient.bearer(session.token), request)
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
            api.listTtsMessages(AlarmTalkApiClient.bearer(session.token)).messages
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
        api.getTtsMessageAudio(AlarmTalkApiClient.bearer(session.token), messageId)
    }
}
