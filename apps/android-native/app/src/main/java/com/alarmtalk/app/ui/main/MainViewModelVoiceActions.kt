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
import com.alarmtalk.app.R
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import java.util.Locale
import com.alarmtalk.app.data.AlarmAppContainer
import com.alarmtalk.app.data.AlarmDraft
import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.CachedAlarmAudio
import com.alarmtalk.app.data.VoiceProfileCreationDraft
import com.alarmtalk.app.data.isSystemVoiceId
import com.alarmtalk.app.network.apiErrorCode
import com.alarmtalk.app.network.AuthTokenResponse
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.CheckoutRequest
import com.alarmtalk.app.network.CodeRegisterRequest
import com.alarmtalk.app.network.FamilyGroupCurrentResponse
import com.alarmtalk.app.network.FamilyVoiceProfile
import com.alarmtalk.app.network.LoginRequest
import com.alarmtalk.app.network.RegisterRequest
import com.alarmtalk.app.network.TtsGenerateRequest
import com.alarmtalk.app.network.TtsGenerateResponse
import com.alarmtalk.app.network.TtsMessage
import com.alarmtalk.app.network.ManualQuotaResponse
import com.alarmtalk.app.network.TtsMessageAudioResponse
import com.alarmtalk.app.network.AlarmTalkApiClient
import com.alarmtalk.app.network.VoiceProfile
import com.alarmtalk.app.network.VoiceProfileRelationshipUpdateRequest
import com.alarmtalk.app.network.VoiceProfileUpdateRequest
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
    if (authSession == null || voiceProfileBusy) return
    val cachedSystemOnly = voiceProfiles.isNotEmpty() && voiceProfiles.all { it.isSystem == true }
    if (voiceProfiles.isNotEmpty() && !(cachedSystemOnly && hasPaidVoiceAccess(subscriptionResponse))) {
        voiceProfileLoadFinished = true
        return
    }
    fetchVoiceProfiles(showMessage = false)
}

internal fun MainViewModel.fetchVoiceProfiles(showMessage: Boolean) {
    val session = authSession
    if (session == null) {
        if (showMessage) message = getApplication<android.app.Application>().getString(R.string.msg_voice_fetch_login_required)
        return
    }
    viewModelScope.launch {
        if (voiceProfileBusy) return@launch
        voiceProfileLoadFinished = false
        voiceProfileBusy = true
        try {
            runCatching {
                val authorization = AlarmTalkApiClient.bearer(session.token)
                val profiles = api.listVoiceProfiles(authorization).profiles
                val draft = api.getVoiceDraft(authorization).profile
                profiles to draft
            }.onSuccess { (profiles, draft) ->
                voiceProfiles = profiles
                pendingVoiceDraft = draft
                voiceProfilesLoadedFresh = true
                // 내 음성 목록이 늦게 로드된 경우에도 접근권 잃은 목소리 알람 강등이 재실행되게 한다
                // (공유 목소리 목록이 먼저 신선 로드돼 스킵됐을 수 있음). 빈 목록도 유효한 로드다.
                reconcileInaccessibleVoiceAlarms()
            }.onFailure { error ->
                AlarmTalkLog.reportError("Failed to load voice profiles", error)
                if (showMessage) message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_voice_fetch_failed))
            }
        } finally {
            voiceProfileBusy = false
            voiceProfileLoadFinished = true
        }
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
        message = getApplication<android.app.Application>().getString(R.string.msg_voice_create_login_required)
        return
    }
    if (!hasPaidVoiceAccess(subscriptionResponse)) {
        message = getApplication<android.app.Application>().getString(R.string.msg_voice_paid_plan_required)
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
        message = getApplication<android.app.Application>().getString(R.string.msg_voice_name_required)
        return
    }
    if (drafts.any { it.relationshipLabel.isBlank() }) {
        message = getApplication<android.app.Application>().getString(R.string.msg_voice_relationship_required)
        return
    }
    if (drafts.any { it.listenerTitle.isBlank() }) {
        message = getApplication<android.app.Application>().getString(R.string.msg_voice_listener_title_required)
        return
    }
    // 시스템 스톡 보이스는 개수 제한에서 제외 — 내가 만든 목소리만 센다.
    if (voiceProfiles.count { it.isSystem != true } >= MAX_VOICE_PROFILES || pendingVoiceDraft != null) {
        message = getApplication<android.app.Application>().getString(R.string.msg_voice_max_profiles_reached, MAX_VOICE_PROFILES)
        return
    }

    viewModelScope.launch {
        if (voiceProfileBusy) return@launch
        voiceProfileBusy = true
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
                        isDraft = true.toString().toRequestBody("text/plain".toMediaType()),
                        language = deviceAppVoiceLanguage().toRequestBody("text/plain".toMediaType()),
                    ).profile
                }
            }
        }.onSuccess { profiles ->
            pendingVoiceDraft = profiles.firstOrNull()
            // 클론 성공 직후 로컬 녹음 샘플(음성 생체정보 평문 .m4a)을 즉시 정리한다.
            withContext(Dispatchers.IO) {
                drafts.forEach { draft ->
                    runCatching { repository.deleteVoiceCloneSourceRecording(draft.audio.cacheKey) }
                        .onFailure { Log.w(TAG, "Failed to delete voice clone source recording", it) }
                }
            }
            message = null
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to create voice profile", error)
            val app = getApplication<android.app.Application>()
            message = when (apiErrorCode(error)) {
                "VOICE_CLONE_AUDIO_TOO_SHORT" -> app.getString(R.string.msg_voice_clone_audio_too_short)
                "VOICE_CLONE_AUDIO_TOO_LONG" -> app.getString(R.string.msg_voice_clone_audio_too_long)
                "INVALID_DURATION" -> app.getString(R.string.msg_voice_invalid_duration)
                "VOICE_SLOT_EXHAUSTED" -> app.getString(R.string.msg_voice_slot_exhausted)
                "VOICE_DRAFT_ATTEMPT_LIMIT_REACHED" -> app.getString(R.string.msg_voice_monthly_limit_reached)
                "VOICE_FEATURE_REQUIRES_PAID_PLAN" -> app.getString(R.string.msg_voice_paid_plan_required)
                else -> userFacingError(error, app.getString(R.string.msg_voice_create_failed))
            }
        }
        voiceProfileBusy = false
    }
}

internal fun MainViewModel.promoteVoiceDraft(profileId: String) {
    val session = authSession ?: return
    viewModelScope.launch {
        if (voiceProfileBusy) return@launch
        voiceProfileBusy = true
        runCatching {
            withContext(Dispatchers.IO) {
                api.updateVoiceProfile(
                    authorization = AlarmTalkApiClient.bearer(session.token),
                    id = profileId,
                    request = VoiceProfileUpdateRequest(isDraft = false, language = deviceAppVoiceLanguage()),
                ).profile
            }
        }.onSuccess { profile ->
            val draft = pendingVoiceDraft
            val official = profile.copy(
                name = profile.name.ifBlank { draft?.name.orEmpty() },
                isShared = profile.isShared ?: draft?.isShared,
                isDraft = false,
                relationshipLabel = profile.relationshipLabel ?: draft?.relationshipLabel,
                listenerTitle = profile.listenerTitle ?: draft?.listenerTitle,
            )
            pendingVoiceDraft = null
            voiceProfiles = listOf(official) + voiceProfiles.filterNot { it.id == official.id }
            message = getApplication<android.app.Application>().getString(R.string.msg_voice_created_single, official.name)
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to promote voice draft id=$profileId", error)
            message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_voice_create_failed))
        }
        voiceProfileBusy = false
    }
}

internal fun MainViewModel.deleteVoiceDraft(profileId: String) {
    val session = authSession ?: return
    viewModelScope.launch {
        if (voiceProfileBusy) return@launch
        voiceProfileBusy = true
        runCatching {
            withContext(Dispatchers.IO) {
                api.deleteVoiceProfile(
                    authorization = AlarmTalkApiClient.bearer(session.token),
                    id = profileId,
                    draftOnly = true,
                )
            }
        }.onSuccess {
            if (pendingVoiceDraft?.id == profileId) pendingVoiceDraft = null
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to delete voice draft id=$profileId", error)
            message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_voice_delete_failed))
        }
        voiceProfileBusy = false
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
        message = getApplication<android.app.Application>().getString(R.string.msg_voice_edit_login_required)
        return
    }
    val trimmedName = name.trim()
    val trimmedRelationship = relationshipLabel.trim()
    val trimmedListener = listenerTitle.trim()
    if (trimmedName.isBlank()) {
        message = getApplication<android.app.Application>().getString(R.string.msg_voice_name_required)
        return
    }
    if (trimmedRelationship.isBlank()) {
        message = getApplication<android.app.Application>().getString(R.string.msg_voice_relationship_required)
        return
    }
    if (trimmedListener.isBlank()) {
        message = getApplication<android.app.Application>().getString(R.string.msg_voice_listener_title_required)
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
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to rename voice profile id=$profileId", error)
            message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_voice_info_update_failed))
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
        message = getApplication<android.app.Application>().getString(R.string.msg_voice_shared_setup_login_required)
        return
    }
    val trimmedRelationship = relationshipLabel.trim()
    val trimmedListener = listenerTitle.trim()
    if (trimmedRelationship.isBlank()) {
        message = getApplication<android.app.Application>().getString(R.string.msg_voice_relationship_required)
        return
    }
    if (trimmedListener.isBlank()) {
        message = getApplication<android.app.Application>().getString(R.string.msg_voice_listener_title_required)
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
            onSuccess()
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to update shared voice viewer info id=$profileId", error)
            message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_voice_shared_info_save_failed))
        }
        voiceProfileBusy = false
    }
}

internal fun MainViewModel.setVoiceProfileShared(profileId: String, shared: Boolean) {
    val session = authSession
    if (session == null) {
        message = getApplication<android.app.Application>().getString(R.string.msg_voice_share_login_required)
        return
    }
    if (!hasCoupleOrFamilyAccess(subscriptionResponse, familyGroup)) {
        message = getApplication<android.app.Application>().getString(R.string.msg_voice_share_couple_family_required)
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
            val app = getApplication<android.app.Application>()
            message = if (shared) app.getString(R.string.msg_voice_shared_on) else app.getString(R.string.msg_voice_shared_off)
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to update voice profile sharing id=$profileId shared=$shared", error)
            message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_voice_share_setting_failed))
        }
        voiceProfileBusy = false
    }
}

internal fun MainViewModel.deleteVoiceProfile(profileId: String) {
    val session = authSession
    if (session == null) {
        message = getApplication<android.app.Application>().getString(R.string.msg_voice_delete_login_required)
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
            message = getApplication<android.app.Application>().getString(R.string.msg_voice_deleted)
        }.onFailure { error ->
            if (error is retrofit2.HttpException && error.code() == 404) {
                voiceProfiles = voiceProfiles.filterNot { it.id == profileId }
                message = getApplication<android.app.Application>().getString(R.string.msg_voice_already_deleted)
            } else {
                if (originalProfile != null) {
                    voiceProfiles = voiceProfiles.map {
                        if (it.id == profileId) originalProfile else it
                    }
                }
                AlarmTalkLog.reportError("Failed to delete voice profile id=$profileId", error)
                message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_voice_delete_failed))
            }
        }
        voiceProfileBusy = false
    }
}

internal suspend fun MainViewModel.generateTtsAudio(request: TtsGenerateRequest): TtsGenerateResponse {
    check(hasPaidVoiceAccess(subscriptionResponse) || request.isFreeSystemPresetRequest()) {
        getApplication<android.app.Application>().getString(R.string.msg_voice_paid_plan_required)
    }
    val session = authSession ?: throw IllegalStateException(getApplication<android.app.Application>().getString(R.string.msg_voice_tts_generate_login_required))
    return withContext(Dispatchers.IO) {
        api.generateTts(AlarmTalkApiClient.bearer(session.token), request)
    }
}

internal fun TtsGenerateRequest.isFreeSystemPresetRequest(): Boolean =
    isSystemVoiceId(voiceProfileId) &&
        random &&
        randomContext == "preset" &&
        !translate &&
        language == "ko" &&
        text.isBlank()

internal fun MainViewModel.loadTtsMessages() {
    val session = authSession
    if (session == null) {
        message = getApplication<android.app.Application>().getString(R.string.msg_voice_tts_load_login_required)
        return
    }
    viewModelScope.launch {
        ttsMessageBusy = true
        runCatching {
            api.listTtsMessages(AlarmTalkApiClient.bearer(session.token)).messages
        }.onSuccess { messages ->
            ttsMessages = messages
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to load saved TTS messages", error)
            message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_voice_tts_load_failed))
        }
        ttsMessageBusy = false
    }
}

internal suspend fun MainViewModel.downloadTtsMessageAudio(messageId: String): TtsMessageAudioResponse {
    val session = authSession ?: throw IllegalStateException(getApplication<android.app.Application>().getString(R.string.msg_voice_tts_audio_load_login_required))
    return withContext(Dispatchers.IO) {
        api.getTtsMessageAudio(AlarmTalkApiClient.bearer(session.token), messageId)
    }
}

// 직접 입력 문구 만들기 이번 달 사용 현황(선택기 '직접 입력 (남은/총)' 표시용).
// 실패/미로그인은 null 로 조용히 넘긴다(표시만 생략, 기능엔 영향 없음).
internal suspend fun MainViewModel.loadManualQuota(): ManualQuotaResponse? {
    val session = authSession ?: return null
    return runCatching {
        withContext(Dispatchers.IO) {
            api.getManualQuota(AlarmTalkApiClient.bearer(session.token))
        }
    }.getOrNull()
}

// 사전렌더 앱 언어(편집기 appVoiceLanguage 와 동일 소스·규칙 en/ja/else→ko). 편집기는 Compose
// LocalConfiguration.locales[0] 로 클립을 필터하는데, 그 값은 앱 resources.configuration 에서 온다.
// 여기서도 같은 소스(앱 리소스 설정의 첫 로케일)를 써 두 언어 소스가 어긋나지 않게 한다. 어긋나면
// 서버가 렌더한 언어와 편집기 필터 언어가 달라 오프라인 버킷이 영영 안 붙는다.
private fun MainViewModel.deviceAppVoiceLanguage(): String {
    val locales = getApplication<Application>().resources.configuration.locales
    val language = (if (!locales.isEmpty) locales[0] else null)?.language
        ?: Locale.getDefault().language
    // 매핑 단일 출처(data.appVoiceLanguageOf) — 편집기 supportedAppVoiceLanguage 와 같은 함수라 divergence 없음.
    return com.alarmtalk.app.data.appVoiceLanguageOf(language)
}

internal fun MainViewModel.loadStockClips(forceReload: Boolean = false) {
    val session = authSession ?: return
    // stockClips 는 세션 전용 in-memory 캐시라 한번 채우면 재조회 안 함. 유료 클론 클립은 확정 후
    // cron 이 세션 중에 만들 수 있으므로, 클론 편집 진입 시 forceReload=true 로 매니페스트를 새로 받는다.
    if (!forceReload && stockClips.isNotEmpty()) return
    viewModelScope.launch {
        runCatching {
            api.getStockClips(AlarmTalkApiClient.bearer(session.token)).clips
        }.onSuccess { clips ->
            stockClips = clips
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to load stock clips", error)
        }
    }
}
