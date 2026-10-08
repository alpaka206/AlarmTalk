package com.alarmtalk.app

import com.alarmtalk.app.data.VoiceTuning
import com.alarmtalk.app.network.VoiceProfile

/**
 * 목소리 등록 **확정 화면**(미리듣기·확정 단계)의 판정 — 화면(`VoiceProfileManagementPanel` Preview)이 상태를 들고,
 * 무엇을 할지는 여기서 정한다. 규칙은 스펙 voice-and-message §4-1(확정 화면 구성·교체)·§4-3 「누가 어디서 바꾸는가」.
 * 회귀 테스트 `VoicePreviewConfirmRulesTest`.
 *
 * 톤 카드 안 하단의 두 듣기 버튼(2026-10-08 사용자 — 번갈아 들을 수 있게):
 *  - `원본 듣기` = 받은 초안 클립 그대로(높이 0), `현재 톤 듣기` = 막대 값으로 **메모리에서** 구운 소리.
 *  - 둘 다 **한 번** 튼다. 트는 중인 버튼을 다시 누르면 멈추고, 다른 버튼을 누르면 지금 것을 멈추고 그것을 처음부터 튼다.
 *  - 서버에서 받는 동안에도 두 버튼은 살아 있다 — 받는 중의 진행 표시도 '트는 중' 이다. 진행 표시가 도는 버튼을 누르면
 *    받기는 그대로 두고 받은 뒤에 틀지 않으며, 다른 버튼을 누르면 받은 뒤에 그것을 튼다.
 *  - 첫 청취 확인(서버 토큰)은 그 클립을 처음 끝까지 들었을 때 — 어느 버튼으로 들었든 — 보낸다.
 */
internal enum class TuningListenTarget { Original, Current }

/** 듣기 버튼을 눌렀을 때 할 일. */
internal enum class TuningListenAction {
    /**
     * 트는(또는 준비하는) 버튼을 다시 눌렀다 — 멈춘다. 끝까지 듣지 않았으니 청취가 아니다. 서버에서 받는 중이었으면 받기는
     * 그대로 두고(문구·클립은 받아 둔다) 받은 뒤에 아무것도 틀지 않는다.
     */
    Stop,

    /**
     * 아직 받은 클립이 없다 — 서버에서 미리듣기를 받아 누른 버튼대로 튼다(예전 재생 버튼과 같은 요청). 이미 받는 중이면
     * 새로 받지 않고 받은 뒤에 틀 버튼만 이것으로 바꾼다.
     */
    FetchFromServer,

    /** 받아 둔 클립을 기기에서 처음부터 튼다(서버 왕복 없음). 다른 버튼이 틀고 있었으면 그걸 멈추고. */
    PlayLocally,
}

internal fun tuningListenAction(
    pressed: TuningListenTarget,
    active: TuningListenTarget?,
    clipReady: Boolean,
): TuningListenAction = when {
    pressed == active -> TuningListenAction.Stop
    !clipReady -> TuningListenAction.FetchFromServer
    else -> TuningListenAction.PlayLocally
}

/** 막대에서 손을 뗐을 때 할 일. */
internal enum class TuningReleaseAction {
    /**
     * 받은 클립이 아직 없다 — 막대는 서버를 부르지 않는다. 받는 중이면 받은 뒤 **그때의** 막대 값으로 굽는다(굽기는 받은 뒤의
     * 일이다). 받는 요청도 없으면 듣기 버튼이 서버에서 받는다.
     */
    None,

    /**
     * 첫 청취 확인 전의 재생이 **소리 나는 중**이다 — 끊지 않는다. 끝까지 들어야 저장이 열리는 화면이라, 그게 끝난 직후
     * 현재 톤으로 다시 튼다([replaysCurrentToneAfterFirstListen]). 아직 굽는 중(소리 전)이면 끊을 소리가 없으니 미루지
     * 않는다 — 새 값으로 다시 굽는다.
     */
    Defer,

    /** 지금 것(굽기 포함)을 멈추고 현재 톤을 다시 구워 처음부터 한 번 튼다. */
    PlayCurrent,
}

/**
 * 스펙이 막는 것은 **소리 나는** 첫 재생을 끊는 것뿐이다 — 그래서 미루는 것은 그때뿐이고, 굽는 중·청취 확인을 기다리는
 * 중에는 새 값으로 다시 굽는다. iOS `VoiceTonePreview` 의 막대 판정과 같은 답이다.
 *
 * @param audible 실제로 소리가 나는 중이다 — 받는 중·굽는 중(소리 전)·청취 확인을 기다리는 중은 아니다.
 */
internal fun tuningReleaseAction(
    clipReady: Boolean,
    firstListenConfirmed: Boolean,
    audible: Boolean,
): TuningReleaseAction = when {
    !clipReady -> TuningReleaseAction.None
    !firstListenConfirmed && audible -> TuningReleaseAction.Defer
    else -> TuningReleaseAction.PlayCurrent
}

/**
 * 확정 화면의 **잠금표**. 서버 일 다섯 — 받기(미리듣기 합성·재기), 청취 확인, 문구 저장, 등록 확정, 초안 삭제 — 중 하나라도
 * 돌면 [working] 이다. iOS `VoicePreviewConfirmView` 도 같은 표여야 한다(한쪽만 고치면 같은 순간에 두 폰이 다르게 잠긴다).
 *
 *  - [working] 이면 뒤로가기(상단바·시스템)·다시 만들기·저장하기·공유 스위치·문구 고치기(연필·재생성)를 잠근다.
 *  - 막대와 두 듣기 버튼([toneEnabled])은 받기·청취 확인으로는 잠그지 않는다 — 받는 동안 누른 버튼이 받은 뒤에 트는
 *    버튼이고([TuningListenAction]), 막대 값은 받은 뒤 구울 때 읽는다. 문구 입력칸이 열려 있을 때(문구 저장 포함)와 등록
 *    확정·초안 삭제 중에만 잠근다. 입력칸을 열 때 트는 소리를 멈춘다 — 잠긴 버튼으로는 멈출 수 없다.
 *  - 저장하기는 여기에 더해 입력칸이 닫혀 있고, 서버가 청취를 확인했고, 지금 막대 값을 끝까지 들었을 때만 열린다
 *    ([tuningHeardToEnd]).
 */
internal data class ConfirmStepLocks(val working: Boolean, val toneEnabled: Boolean)

internal fun confirmStepLocks(
    fetching: Boolean,
    confirming: Boolean,
    savingText: Boolean,
    profileBusy: Boolean,
    editing: Boolean,
): ConfirmStepLocks = ConfirmStepLocks(
    working = fetching || confirming || savingText || profileBusy,
    toneEnabled = !editing && !savingText && !profileBusy,
)

/** '끝까지 들은 높이' 를 적는 열쇠 — 범위·눈금에 맞춘 반음(−0 은 0). 구운 소리를 못 틀어 원본을 틀었으면 0 이다. */
internal fun VoiceTuning.heardKey(): Float = normalized().pitchSemitones

/**
 * 저장 잠금 — **지금 막대 값을 끝까지 들었는가**(스펙 §4-3). `원본 듣기` 를 끝까지 들었으면 0 을 들은 것이다.
 *
 * ⚠ 들은 값은 **모아 둔다**(마지막 하나만 두지 않는다). 현재 톤을 끝까지 듣고 비교하려고 `원본 듣기` 를 누르면, 마지막
 * 값만 보는 잠금은 저장을 다시 닫는다 — 번갈아 들으라고 둔 버튼이 덫이 된다. 막대 값이 들은 값 중 하나면 저장이 열린다.
 * 모은 값은 클립이 바뀌면(문구 수정·새 초안) 비운다.
 */
internal fun tuningHeardToEnd(current: VoiceTuning, heard: Set<Float>): Boolean = current.heardKey() in heard

/**
 * 첫 청취 확인 직후 현재 톤으로 다시 틀까 — 그 재생 도중 막대에서 손을 뗐고([releasedDuringPlay] — 끊지 않고 미뤘다,
 * [TuningReleaseAction.Defer]) 지금 막대 값을 아직 끝까지 듣지 못했을 때만. 어느 버튼의 재생이었든 같다.
 *
 * 막대를 건드리지 않았으면 잇지 않는다 — 둘 다 **한 번** 튼다. 원본을 들으려고 누른 사람에게 곧바로 다른 소리를 잇지
 * 않고, 굽기·재생이 안 돼 원본으로 대신 틀었을 때도 저절로 다시 굽지 않는다(그때는 0 을 들은 것이라 저장이 잠긴 채
 * 남고, `현재 톤 듣기` 를 누르면 다시 굽는다).
 */
internal fun replaysCurrentToneAfterFirstListen(
    releasedDuringPlay: Boolean,
    current: VoiceTuning,
    heard: Set<Float>,
): Boolean = releasedDuringPlay && !tuningHeardToEnd(current, heard)

/**
 * 등록 확정에서 교체되는 **이미 등록된 내 목소리**(이 초안·다른 초안·실패 제외). [ownVoices] 는 시스템 목소리를 뺀 내 목록이다.
 *
 * 있으면 이 화면의 저장은 **언제나 교체**다(2026-10-08 사용자 — 체크하지 않는다): 톤 카드 아래에 교체 한 줄
 * (`voices_confirm_replace_body`)을 두고, 저장하면 `replace_existing` 을 보낸다(스펙 §4-1). 없으면 그 줄도 교체 표시도 없다.
 */
internal fun registrationReplaceTarget(ownVoices: List<VoiceProfile>, draftId: String?): VoiceProfile? =
    ownVoices.firstOrNull {
        it.id != draftId && it.isDraft != true && it.status?.trim()?.lowercase() != "failed"
    }
