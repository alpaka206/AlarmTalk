package com.alarmtalk.app

import android.app.Application
import android.util.Log
import androidx.lifecycle.viewModelScope
import com.alarmtalk.app.R
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import java.util.Locale
import com.alarmtalk.app.data.CachedAlarmAudio
import com.alarmtalk.app.data.VoiceProfileCreationDraft
import com.alarmtalk.app.data.isSystemVoiceId
import com.alarmtalk.app.network.apiErrorCode
import com.alarmtalk.app.network.TtsGenerateRequest
import com.alarmtalk.app.network.TtsGenerateResponse
import com.alarmtalk.app.network.ManualQuotaResponse
import com.alarmtalk.app.network.TtsMessageAudioResponse
import com.alarmtalk.app.network.AlarmTalkApiClient
import com.alarmtalk.app.network.VoiceProfileUpdateRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody


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
                // 삭제 화면에서 '이번 달 재생성 가능 여부'를 판정하도록 월 생성 쿼터도 함께 갱신.
                loadVoiceDraftQuota()
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
    language: String,
    consentAgreedInline: Boolean,
): Boolean =
    createVoiceProfiles(
        listOf(
            VoiceProfileCreationDraft(
                name = name,
                audio = audio,
                shared = shared,
                relationshipLabel = relationshipLabel,
                listenerTitle = listenerTitle,
                language = language,
            ),
        ),
        consentAgreedInline = consentAgreedInline,
    )

/**
 * 반환값: 클론 생성 요청을 실제로 시작했는지. false 면 검증 실패로 아무 요청도 나가지
 * 않은 것 — 호출측(등록 패널)은 이때 '만드는 중' 스텝에 진입하면 안 된다(갇힘 방지).
 *
 * [consentAgreedInline] 은 등록 화면의 인라인 동의 항목을 사용자가 체크했다는 뜻이다.
 * true 면 모달을 띄우지 않고 **같은 코루틴에서 동의를 먼저 기록한 뒤** 업로드한다 —
 * 순서가 중요하다. draft 도 생성 즉시 실제 ElevenLabs 보이스를 만들기 때문에, 녹음이
 * 올라간 뒤에 동의를 받으면 이미 처리한 생체정보에 사후 동의를 받는 꼴이 된다.
 * 기록이 실패하면 업로드도 안 나가고 기존 실패 경로(메시지 + busy 해제)를 그대로 탄다.
 */
internal fun MainViewModel.createVoiceProfiles(
    items: List<VoiceProfileCreationDraft>,
    consentAgreedInline: Boolean = false,
): Boolean {
    val session = authSession
    if (session == null) {
        message = getApplication<android.app.Application>().getString(R.string.msg_voice_create_login_required)
        return false
    }
    if (!hasPaidVoiceAccess(subscriptionResponse)) {
        message = getApplication<android.app.Application>().getString(R.string.msg_voice_paid_plan_required)
        return false
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
        return false
    }
    // 관계·호칭은 선택 입력 — 비어 있으면 파트를 보내지 않는다(백엔드 옵셔널).
    // 시스템 스톡 보이스는 개수 제한에서 제외 — 내가 만든 목소리만 센다.
    if (voiceProfiles.count { it.isSystem != true } >= MAX_VOICE_PROFILES || pendingVoiceDraft != null) {
        message = getApplication<android.app.Application>().getString(R.string.msg_voice_max_profiles_reached, MAX_VOICE_PROFILES)
        return false
    }
    if (voiceProfileBusy) return false

    // 아직 없는 민감 동의. 등록 화면이 인라인 항목으로 이미 물어봤으면(consentAgreedInline)
    // 모달 없이 아래 코루틴에서 먼저 기록하고, 물어보지 못한 경로(예: 화면 밖에서 호출)
    // 에서만 전용 시트를 띄운다.
    val consentsToRecord = sensitiveConsentMissing
    if (consentsToRecord.isNotEmpty() && !consentAgreedInline) {
        pendingSensitiveConsent = MainViewModel.SensitiveConsentRequest(
            types = consentsToRecord,
            resumeVoiceDrafts = drafts,
        )
        return false
    }

    // busy 는 launch 안이 아니라 여기서 세운다 — true 를 반환하는 순간 이미 busy 인 것이
    // 보장돼야 호출측 '만드는 중' 스텝의 종료 감지(!busy && draft 없음)가 어긋나지 않는다.
    voiceProfileBusy = true
    // 동의 기록에 실려 보낼 정책 버전. 코루틴 밖에서 읽어 둔다.
    val policyVersion = cachedPolicyVersion()
    viewModelScope.launch {
        runCatching {
            // 순서 고정: 동의 기록 → 업로드. 같은 runCatching 안에 두어 기록이 실패하면
            // 녹음이 절대 나가지 않고, 실패 처리도 업로드 실패와 같은 경로를 탄다.
            if (consentsToRecord.isNotEmpty()) {
                api.recordConsents(
                    AlarmTalkApiClient.bearer(session.token),
                    com.alarmtalk.app.network.RecordConsentsRequest(
                        consents = consentsToRecord.map { type ->
                            com.alarmtalk.app.network.ConsentItemRequest(
                                type = type,
                                agreed = true,
                                version = policyVersion,
                            )
                        },
                    ),
                )
                sensitiveConsentMissing = sensitiveConsentMissing - consentsToRecord.toSet()
            }
            withContext(Dispatchers.IO) {
                drafts.map { draft ->
                    api.createVoiceClone(
                        authorization = AlarmTalkApiClient.bearer(session.token),
                        audio = voiceUploadPart(draft.audio),
                        name = draft.name.toRequestBody("text/plain".toMediaType()),
                        isShared = draft.shared.toString().toRequestBody("text/plain".toMediaType()),
                        relationshipLabel = draft.relationshipLabel.takeIf { it.isNotBlank() }
                            ?.toRequestBody("text/plain".toMediaType()),
                        listenerTitle = draft.listenerTitle.takeIf { it.isNotBlank() }
                            ?.toRequestBody("text/plain".toMediaType()),
                        durationMs = (draft.audio.durationMillis?.toString() ?: "").toRequestBody("text/plain".toMediaType()),
                        isDraft = true.toString().toRequestBody("text/plain".toMediaType()),
                        language = (draft.language ?: deviceAppVoiceLanguage()).toRequestBody("text/plain".toMediaType()),
                    ).profile
                }
            }
        }.onSuccess { profiles ->
            pendingVoiceDraft = profiles.firstOrNull()
            // 클론 생성이 이번 달 생성 시도(쿼터)를 소모했으므로 잔여 횟수를 재조회한다
            // (삭제 화면의 '이번 달 재생성 불가' 경고가 최신 잔여로 판정되게).
            loadVoiceDraftQuota()
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
                "INVALID_AUDIO_MIME_TYPE" -> app.getString(R.string.msg_voice_invalid_audio_format)
                "VOICE_SLOT_EXHAUSTED" -> app.getString(R.string.msg_voice_slot_exhausted)
                "VOICE_FEATURE_REQUIRES_PAID_PLAN" -> app.getString(R.string.msg_voice_paid_plan_required)
                else -> userFacingError(error, app.getString(R.string.msg_voice_create_failed))
            }
        }
        voiceProfileBusy = false
    }
    return true
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
            // 서버 PATCH 응답은 변경된 필드만 돌려준다 — 승격은 is_draft 만 보내므로 name 이 빠진다.
            // Gson 은 누락 필드에 (기본값 "" 을 무시하고) null 을 주입할 수 있어, non-null 로 선언된
            // profile.name 이 런타임에 null 이 되면 ifBlank 가 NPE 를 냈다(버튼 눌러도 앱이 죽음).
            // nullable 로 넓혀 안전하게 판정하고, 서버가 안 준 이름은 draft 값으로 폴백한다.
            val serverName: String? = profile.name
            val resolvedName = if (serverName.isNullOrBlank()) draft?.name.orEmpty() else serverName
            val official = profile.copy(
                name = resolvedName,
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

internal suspend fun MainViewModel.confirmVoicePreviewPlayed(profileId: String, token: String) {
    val session = authSession ?: error("Authentication required")
    withContext(Dispatchers.IO) {
        api.confirmVoicePreviewPlayed(
            authorization = AlarmTalkApiClient.bearer(session.token),
            id = profileId,
            request = com.alarmtalk.app.network.VoicePreviewPlayedRequest(token),
        )
    }
}

/**
 * 등록 미리듣기 문구 직접 수정. 서버가 previewed_at 을 리셋하므로 호출 후에는
 * 수정본을 끝까지 다시 들어야 승격(keep)할 수 있다. 정규화된 최종 문구를 돌려준다.
 */
internal suspend fun MainViewModel.updateVoicePreviewText(profileId: String, text: String): String {
    val session = authSession ?: error("Authentication required")
    return withContext(Dispatchers.IO) {
        api.updateVoicePreviewText(
            authorization = AlarmTalkApiClient.bearer(session.token),
            id = profileId,
            request = com.alarmtalk.app.network.VoicePreviewTextUpdateRequest(previewText = text),
        ).previewText
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

/** 등록된 목소리의 표시 이름만 바꾼다(관계·호칭은 등록 시 확정 — VoiceProfileEditDialog 참고). */
internal fun MainViewModel.renameVoiceProfile(
    profileId: String,
    name: String,
) {
    val session = authSession
    if (session == null) {
        message = getApplication<android.app.Application>().getString(R.string.msg_voice_edit_login_required)
        return
    }
    val trimmedName = name.trim()
    if (trimmedName.isBlank()) {
        message = getApplication<android.app.Application>().getString(R.string.msg_voice_name_required)
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

    // 낙관적 업데이트 + 전역 busy 미사용: 스위치는 즉시 뒤집히고, 서버 반영은 목소리별
    // 단일 워커가 PATCH 를 직렬화한다 — 이미 서버로 나간 요청은 코루틴 cancel 로 회수할 수
    // 없어 겹쳐 보내면 늦게 도착한 이전 요청이 최종 상태를 뒤집을 수 있다. 워커는 한 번에
    // 하나만 보내고 desired 최신값으로 수렴하므로(중간 연타 값은 건너뜀) 그 경합이 없다.
    // 성공 토스트는 띄우지 않고(스위치 상태가 곧 결과), 서버 실패 시에만 원상복구+안내한다.
    val previousShared = voiceProfiles.firstOrNull { it.id == profileId }?.isShared
    voiceProfiles = voiceProfiles.map {
        if (it.id == profileId) it.copy(isShared = shared) else it
    }
    shareToggleDesired[profileId] = shared
    if (shareToggleJobs[profileId]?.isActive == true) return
    shareToggleJobs[profileId] = viewModelScope.launch {
        // 이 워커 세션에서 서버가 확정해 준 마지막 값 — 실패 시 여기로 되돌린다.
        var acked = previousShared
        try {
            while (true) {
                val want = shareToggleDesired[profileId] ?: break
                val profile = withContext(Dispatchers.IO) {
                    api.updateVoiceProfile(
                        authorization = AlarmTalkApiClient.bearer(session.token),
                        id = profileId,
                        request = VoiceProfileUpdateRequest(isShared = want),
                    ).profile
                }
                acked = profile.isShared ?: want
                // PATCH 중에 다시 토글됐으면 최신 desired 로 재전송(직렬이라 순서 역전 없음).
                if (shareToggleDesired[profileId] != want) continue
                shareToggleDesired.remove(profileId)
                voiceProfiles = voiceProfiles.map {
                    if (it.id == profile.id) it.copy(isShared = acked) else it
                }
                // 공유 목록 갱신도 suspend(네트워크 왕복)라 이 동안 새 토글이 오면 desired 가
                // 다시 채워진다(새 토글은 isActive 워커를 믿고 return). 갱신 실패는 치명적이지
                // 않아 무시하되(공유 상태는 이미 확정, 상대 반영은 push 가 따로 담당),
                // CancellationException 은 삼키지 말고 그대로 던진다.
                try {
                    familyVoices = api.listFamilyVoiceProfiles(AlarmTalkApiClient.bearer(session.token)).profiles
                } catch (e: kotlin.coroutines.cancellation.CancellationException) {
                    throw e
                } catch (_: Exception) {
                }
                // 갱신 중 새 토글이 왔으면 종료하지 말고 그 값을 마저 전송한다 — 여기서 그냥
                // break 하면 마지막 의도가 전송되지 않은 채 고아로 남는다.
                if (shareToggleDesired.containsKey(profileId)) continue
                break
            }
        } catch (error: kotlin.coroutines.cancellation.CancellationException) {
            throw error
        } catch (error: Exception) {
            shareToggleDesired.remove(profileId)
            voiceProfiles = voiceProfiles.map {
                if (it.id == profileId) it.copy(isShared = acked) else it
            }
            AlarmTalkLog.reportError("Failed to update voice profile sharing id=$profileId shared=$shared", error)
            message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_voice_share_setting_failed))
        }
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
            // 삭제된 목소리를 쓰던 내 알람을 즉시 기본 알람으로 변환한다(공유해제·무료강등과 동일 결과).
            // 서버는 sound-only 로 바꾸지만 본인 LOCAL_OWNED 알람은 pull 로 안 돌아오므로 로컬에서 강등.
            // 삭제된 id 만 대상으로 하는 타깃 강등이라 소셜 목록 신선도(reconcile 가드)에 막히지 않는다.
            viewModelScope.launch { runCatching { repository.degradeAlarmsUsingVoiceProfile(profileId) } }
        }.onFailure { error ->
            if (error is retrofit2.HttpException && error.code() == 404) {
                voiceProfiles = voiceProfiles.filterNot { it.id == profileId }
                message = getApplication<android.app.Application>().getString(R.string.msg_voice_already_deleted)
                viewModelScope.launch { runCatching { repository.degradeAlarmsUsingVoiceProfile(profileId) } }
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

// 이번 달 목소리 초안 생성 쿼터 조회 → voiceDraftQuota 상태 갱신(삭제 전 재생성 가능 판정용).
// 실패/미로그인은 조용히 무시(기존 값 유지). fire-and-forget.
internal fun MainViewModel.loadVoiceDraftQuota() {
    val session = authSession ?: return
    viewModelScope.launch {
        runCatching {
            withContext(Dispatchers.IO) {
                api.getVoiceDraftQuota(AlarmTalkApiClient.bearer(session.token))
            }
        }.onSuccess { voiceDraftQuota = it }
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

/**
 * 기본(시스템) 목소리 **전체**의 무료 버킷 클립(날씨·약)을 기기 언어로 미리 내려받는다.
 *
 * 예전에는 온보딩에서 고른 목소리 1개분만 받았다. 이제 목소리를 알람마다 자유롭게 고를 수
 * 있으므로 4개를 모두 받아 둬야 고르는 즉시 오프라인으로 울릴 수 있다.
 *  - 기기 언어 1개만 받는다. 3개 언어를 다 받으면 약 3배(≈30MB)가 되는데 앱은 한 번에 한
 *    언어만 쓰고, 언어를 바꾸면 그때 이 함수가 다시 돌아 부족분을 채운다.
 *  - 이미 캐시된 클립은 건너뛴다 -> 중간에 끊겨도 다시 부르면 빠진 것만 이어받는다.
 *  - 카테고리를 무료 버킷(날씨·약)으로 한정한다. greeting 은 APK 에 내장돼 있고, 운세·사랑은
 *    유료 클론 전용이라 받아도 쓰지 못한 채 저장 공간만 먹는다(Codex #607).
 * best-effort: 실패해도 알람 저장 시점의 기존 다운로드 경로가 다시 시도한다.
 */
/** 스톡 클립 동시 다운로드 수. 순차는 약전파에서 1분을 넘기고, 과하면 서버·기기가 힘들다. */
private const val PREFETCH_PARALLELISM = 4

internal fun MainViewModel.prefetchFreeBucketClips(voiceProfileId: String? = null) {
    // 목소리를 연달아 바꾸면 이전 프리페치는 취소하고 마지막 선택만 받는다.
    voicePrefetchJob?.cancel()
    var job: kotlinx.coroutines.Job? = null
    job = viewModelScope.launch(Dispatchers.IO) {
        try {
            val language = deviceAppVoiceLanguage()
            val audioStore = com.alarmtalk.app.data.AlarmAudioStore(getApplication<Application>())
            // 무료 버킷에서 실제로 쓰이는 카테고리(날씨·약)만 받는다 — greeting 제외 전부를 받으면
            // 무료 사용자의 클론처럼 운세/사랑 사전렌더가 섞인 보이스에서 제한 편집기가 노출하지
            // 않는 유료 전용 클립까지 내려받아 저장 공간만 차지한다(Codex #607).
            // voiceProfileId 를 주면 그 목소리만(레거시 호출), 안 주면 시스템 목소리 전체.
            val clips = stockClips.filter {
                (if (voiceProfileId != null) it.voiceProfileId == voiceProfileId else isSystemVoiceId(it.voiceProfileId)) &&
                    (it.language ?: "ko") == language &&
                    it.category in FreeBucketOrder
            }
            if (clips.isEmpty()) return@launch
            // 이미 캐시된 클립도 진행 수에 포함해 n/전체가 실제 준비율을 보여주게 한다.
            voicePrefetchProgress = 0 to clips.size
            val done = java.util.concurrent.atomic.AtomicInteger(0)
            // 클립당 HTTP 왕복 1회다. 44개를 순차로 받으면 약전파에서 1분을 넘기므로 소량 병렬로
            // 겹친다(서버·기기 부담을 감안해 4로 제한).
            kotlinx.coroutines.coroutineScope {
                clips.chunked(PREFETCH_PARALLELISM).forEach { batch ->
                    batch.map { clip ->
                        async {
                            val cacheKey = "${com.alarmtalk.app.data.AlarmAudioStore.STOCK_CACHE_KEY_PREFIX}${clip.messageId}"
                            if (audioStore.getCachedAudio(cacheKey) == null) {
                                val response = downloadTtsMessageAudio(clip.messageId)
                                audioStore.cacheGeneratedAudio(
                                    bytes = android.util.Base64.decode(response.audioBase64, android.util.Base64.DEFAULT),
                                    format = response.audioFormat,
                                    rawAudioUri = response.audioUrl,
                                    displayName = cacheKey,
                                    cacheKey = cacheKey,
                                    messageId = clip.messageId,
                                )
                            }
                            voicePrefetchProgress = done.incrementAndGet() to clips.size
                        }
                    }.awaitAll()
                }
            }
        } catch (error: kotlin.coroutines.cancellation.CancellationException) {
            throw error
        } catch (error: Exception) {
            // 실패는 조용히 — 편집기의 온디맨드 다운로드가 폴백한다.
            Log.w(TAG, "Failed to prefetch free bucket clips voice=$voiceProfileId", error)
        } finally {
            // 새 프리페치가 이미 시작됐다면 그쪽 진행 표시를 지우지 않는다.
            if (voicePrefetchJob === job) voicePrefetchProgress = null
        }
    }
    voicePrefetchJob = job
}

/** 유료 클론 사전렌더 진행 상태 조회 — 실패는 호출측(목소리 탭 폴링)이 처리한다. */
internal suspend fun MainViewModel.fetchVoicePrerenderStatus(
    profileId: String,
): com.alarmtalk.app.network.VoicePrerenderStatusResponse {
    val session = authSession ?: error("Authentication required")
    return withContext(Dispatchers.IO) {
        api.getVoicePrerenderStatus(AlarmTalkApiClient.bearer(session.token), profileId)
    }
}

/** 사전렌더 전진 1스텝(서버가 호출당 최대 3클립 생성). 드라이브 루프가 done 까지 반복
 *  호출한다 — cron(5분 틱)을 기다리지 않고 즉시 채우기 위한 경로. */
internal suspend fun MainViewModel.advanceVoicePrerender(
    profileId: String,
): com.alarmtalk.app.network.VoicePrerenderAdvanceResponse {
    val session = authSession ?: error("Authentication required")
    return withContext(Dispatchers.IO) {
        api.advanceVoicePrerender(AlarmTalkApiClient.bearer(session.token), profileId)
    }
}

/** promote 직후 사전렌더 드라이브 시작: 생성(advance 반복) → 클립 전체 기기 다운로드.
 *  viewModelScope 에서 돌아 '목소리 생성 중' 화면을 닫아도 같은 속도로 계속된다.
 *  실패/무진전 시엔 조용히 끝낸다 — 서버 cron 드레인이 폴백으로 이어받는다. */
internal fun MainViewModel.startPrerenderDrive(voiceId: String) {
    if (prerenderDrive?.voiceId == voiceId && prerenderDriveJob?.isActive == true) return
    prerenderDriveJob?.cancel()
    // 동기 세팅: '생성 중' 화면의 종료 감시가 launch 시작 전의 null 을 보고 바로 닫지 않게.
    prerenderDrive = PrerenderDriveState(voiceId, 0, 0, downloading = false)
    prerenderDriveJob = viewModelScope.launch {
        try {
            var stagnantRounds = 0
            var lastGenerated = -1
            while (true) {
                val step = runCatching { advanceVoicePrerender(voiceId) }.getOrElse { error ->
                    AlarmTalkLog.reportError("Voice prerender drive failed", error)
                    return@launch
                }
                prerenderDrive = PrerenderDriveState(voiceId, step.generated, step.total, downloading = false)
                if (step.done) break
                stagnantRounds = if (step.generated == lastGenerated) stagnantRounds + 1 else 0
                lastGenerated = step.generated
                // 3회 연속 무진전이면 여기서 더 붙잡지 않는다 — cron 이 이어받는다.
                if (stagnantRounds >= 3) return@launch
            }
            // 다운로드 단계 진입: generated 를 0 으로 리셋한다(생성 완료값 total 을 이월하면 결합
            // 진행바가 순간 100% 로 튀었다가 다운로드 0%(=50%)로 역행해 보인다). 리셋하면 생성 0~50%
            // → 다운로드 50~100% 로 매끄럽게 이어진다.
            prerenderDrive = prerenderDrive?.let {
                PrerenderDriveState(it.voiceId, 0, it.total, downloading = true)
            }
            runCatching {
                downloadAllPresetClips(voiceId) { done, total ->
                    prerenderDrive = PrerenderDriveState(voiceId, done, total, downloading = true)
                }
            }.onFailure { error ->
                AlarmTalkLog.reportError("Voice preset clip download failed", error)
            }
        } finally {
            // 종료(완료/실패/취소) 시 진행 표시를 걷는다 — 열려 있던 '생성 중' 화면은 닫힌다.
            prerenderDrive = null
        }
    }
}

/** 방금 생성된 클론 preset 클립 전체를 기기에 내려받아 캐시한다(비행기모드 알람 대비).
 *  스톡 매니페스트를 새로 받아 방금 생성분까지 포함하고, 이미 캐시된 클립은 건너뛴다. */
internal suspend fun MainViewModel.downloadAllPresetClips(
    voiceProfileId: String,
    onProgress: (Int, Int) -> Unit,
) {
    val session = authSession ?: return
    withContext(Dispatchers.IO) {
        val manifest = api.getStockClips(AlarmTalkApiClient.bearer(session.token)).clips
        stockClips = manifest
        // 클론 사전렌더는 '등록 때 고른 언어' 단일 세트 — 기기 언어로 거르지 않고 전부 받는다
        // (일본어로 만든 목소리를 한국어 기기에서 쓰는 경우에도 클립이 캐시되게).
        val clips = manifest.filter { it.voiceProfileId == voiceProfileId }
        if (clips.isEmpty()) return@withContext
        val audioStore = com.alarmtalk.app.data.AlarmAudioStore(getApplication<Application>())
        var done = 0
        onProgress(0, clips.size)
        clips.forEach { clip ->
            val cacheKey = "stock_${clip.messageId}"
            if (audioStore.getCachedAudio(cacheKey) == null) {
                val response = downloadTtsMessageAudio(clip.messageId)
                audioStore.cacheGeneratedAudio(
                    bytes = android.util.Base64.decode(response.audioBase64, android.util.Base64.DEFAULT),
                    format = response.audioFormat,
                    rawAudioUri = response.audioUrl,
                    displayName = cacheKey,
                    cacheKey = cacheKey,
                    messageId = clip.messageId,
                )
            }
            done += 1
            onProgress(done, clips.size)
        }
    }
}

/** 사전렌더 실패 시 재생성 요청. true 면 재시작 수락 — 호출측이 폴링을 재개한다. */
internal suspend fun MainViewModel.retryVoicePrerender(profileId: String): Boolean {
    val session = authSession ?: return false
    return try {
        withContext(Dispatchers.IO) {
            api.retryVoicePrerender(AlarmTalkApiClient.bearer(session.token), profileId)
        }.success
    } catch (error: kotlin.coroutines.cancellation.CancellationException) {
        throw error
    } catch (error: Exception) {
        AlarmTalkLog.reportError("Failed to retry voice prerender id=$profileId", error)
        message = userFacingError(
            error,
            getApplication<android.app.Application>().getString(R.string.msg_voice_prerender_retry_failed),
        )
        false
    }
}

/** 말투 분석 재시도. 성공하면 프로필의 speech_style_status 를 갱신해 실패 안내가 사라지게 한다. */
internal suspend fun MainViewModel.retryVoiceSpeechStyleAnalysis(profileId: String): Boolean {
    val session = authSession ?: return false
    return try {
        val response = withContext(Dispatchers.IO) {
            api.retryVoiceSpeechStyle(AlarmTalkApiClient.bearer(session.token), profileId)
        }
        if (response.success) {
            voiceProfiles = voiceProfiles.map {
                if (it.id == profileId) it.copy(speechStyleStatus = response.status ?: "done") else it
            }
        }
        response.success
    } catch (error: kotlin.coroutines.cancellation.CancellationException) {
        throw error
    } catch (error: Exception) {
        AlarmTalkLog.reportError("Failed to retry voice speech style analysis id=$profileId", error)
        message = userFacingError(
            error,
            getApplication<android.app.Application>().getString(R.string.msg_voice_speech_style_retry_failed),
        )
        false
    }
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
            // 매니페스트 도착 전 setDefaultVoice 로 프리페치가 빈손이었으면 여기서 1회 재시도한다.
            // 재시도 여부와 무관하게 pending 은 비워 무한 재시도를 막는다(비움 결과도 정상 종료).
            pendingPrefetchVoiceId?.let { voiceId ->
                pendingPrefetchVoiceId = null
                prefetchFreeBucketClips(voiceId)
            }
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to load stock clips", error)
        }
    }
}
