package com.alarmtalk.app.network

import com.alarmtalk.app.data.VoiceProfileCreationDraft
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody

private val TEXT_PLAIN = "text/plain".toMediaType()

/**
 * 등록 초안(= 실제 클론)을 만드는 `POST voice/clone`. **폼 필드 조립은 여기 한 곳에서만 한다** —
 * 뷰모델은 [VoiceProfileCreationDraft] 와 업로드 파트만 넘긴다. 필드가 늘 때마다 호출부에서
 * `toRequestBody` 를 손으로 이어 붙이면 한 필드가 조용히 빠져도 컴파일은 통과한다.
 *
 * - 관계·호칭은 선택 입력이라 비어 있으면 **파트를 보내지 않는다**(서버 옵셔널).
 * - 목소리의 결(`voiceEnergy`)은 **언제나 보낸다** — 자동이면 빈 값(`""`)이다. 서버 결과는 빈 값이든
 *   필드가 없든 같다(둘 다 '자동'). 언제나 싣는 이유는 필드가 조립에서 조용히 빠지는 회귀를
 *   테스트가 잡게 하려는 것이다(`docs/spec/voice-and-message.md` 4-2).
 * - 언어는 초안에 고른 값이 없으면 [fallbackLanguage](앱 로케일)를 쓴다 — 미전송이면 서버가
 *   'ko' 로 떨어져 비-ko 사용자가 클론 문구를 못 받는다.
 */
internal suspend fun VoiceProfileApi.createVoiceCloneDraft(
    authorization: String,
    draft: VoiceProfileCreationDraft,
    audio: MultipartBody.Part,
    fallbackLanguage: String,
): VoiceProfile {
    fun text(value: String): RequestBody = value.toRequestBody(TEXT_PLAIN)
    return createVoiceClone(
        authorization = authorization,
        audio = audio,
        name = text(draft.name),
        isShared = text(draft.shared.toString()),
        relationshipLabel = draft.relationshipLabel.takeIf { it.isNotBlank() }?.let { text(it) },
        listenerTitle = draft.listenerTitle.takeIf { it.isNotBlank() }?.let { text(it) },
        voiceEnergy = text(draft.voiceEnergy),
        durationMs = text(draft.audio.durationMillis?.toString() ?: ""),
        isDraft = text(true.toString()),
        language = text(draft.language ?: fallbackLanguage),
    ).profile
}
