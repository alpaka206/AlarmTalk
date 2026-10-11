package com.alarmtalk.app

import com.alarmtalk.app.data.VoiceTuning
import com.alarmtalk.app.network.VoiceDraftQuotaResponse
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

// ── 월 등록 한도 — '생성 가능 n/m회' 가 여는 두 곳 ──────────────────────────

/**
 * 이번 달 등록을 **다 썼는가.** `생성 가능 n/m회` 한 값이 두 곳을 연다 — 목소리 탭의 `추가` 버튼(다 썼으면
 * 끈다)과 삭제 경고(다 썼으면 "이번 달에는 새 목소리를 만들 수 없어요" 를 붙인다). 둘이 같은 판정을 쓴다
 * (스펙 voice-and-message §4-1 「월 등록 한도」 ②).
 *
 * - **아직 모르면(null) 다 쓴 것이 아니다.** 조회가 안 끝났거나 실패한 것이라 막을 근거가 없다 — 그때의
 *   안전판은 서버다(다 썼으면 초안을 만들기 전에 429 로 답한다, ①).
 * - 남은 횟수는 **서버가 준 값**이다. 앱이 `n − 1` 로 깎아 두지 않는다 — 그래서 이 판정이 맞으려면 값이
 *   제때 다시 읽혀야 한다(`MainViewModel.loadVoiceDraftQuota` 의 다시 읽는 때). 2026-10-10 prod 의 사용자는
 *   등록을 마친 같은 프로세스에서 값이 `1/1` 로 남아 이 판정이 '남았다' 고 답했다.
 *
 * `추가` 쪽은 유료일 때만, 그리고 한도가 있는(`registrationLimit > 0`) 값만 넘긴다 — 무료에게는 숫자도
 * 꺼진 버튼도 보이지 않는다(눌러서 이용권 안내를 듣는다).
 */
internal fun monthlyRegistrationUsedUp(quota: VoiceDraftQuotaResponse?): Boolean =
    quota != null && quota.registrationRemaining <= 0

// ── 등록 흐름의 거절 — 어디에 말하는가 ─────────────────────────────────────
//
// 스펙 voice-and-message §4-1 「월 등록 한도」 ③. 등록 창은 화면을 다 덮는 **자기 창**(`Dialog`)이라 앱
// 본체의 스낵바는 그 **뒤**에 그려진다. 2026-10-10 prod 에서 한 사용자가 같은 저장을 약 2분 반 동안 일곱
// 번 눌렀다 — 서버의 거절(429)을 옮긴 문구는 있었는데 창 뒤에 떠 있었던 것으로 읽는다(코드로 읽은
// 것이다 — 스낵바가 정말 가려지는지는 실기기로 확인하지 못했다).

/**
 * 서버가 "이번 달 등록을 다 썼다" 고 답하는 코드. 등록(`POST /voice/clone`)과 확정(승격·교체)이 **같은
 * 코드**를 낸다 — 이름은 '변경' 이지만 첫 등록도 이 한도에 든다. 이미 나간 코드라 이름을 바꾸지 않는다
 * (`docs/spec/error-codes.md` §2).
 */
internal const val VOICE_MONTHLY_LIMIT_ERROR_CODE = "VOICE_MONTHLY_CHANGE_LIMIT_REACHED"

/**
 * 서버가 "녹음에서 말소리를 거의 찾지 못했다" 고 답하는 코드 — 등록(`POST /voice/clone`)만 낸다. 서버는 provider 에
 * 올리기 전에 녹음을 한 번 받아 적어 보고, 글자가 너무 적으면 **아무것도 쓰지 않고** 거절한다 — 초안도, 초안 시도
 * 집계도, 월 등록 횟수도 그대로다(2026-10-11 소유자 결정: "목소리(말소리) 없으면 등록 못 하도록 막는다. 다시 만들기는
 * 횟수 제한 없음"). 그래서 다시 녹음하는 데는 제한이 없다.
 */
internal const val VOICE_CLONE_NO_SPEECH_ERROR_CODE = "VOICE_CLONE_NO_SPEECH"

/**
 * 등록 흐름(등록·저장·다시 만들기)의 거절 한 건 — 서버의 에러 코드와 사용자에게 보일 문구.
 * 뷰모델이 올리고(`MainViewModel.voiceRegistrationFailure`) 등록 창이 읽어 자기 안에 그린다.
 *
 * @param code 서버의 `error_code`. 네트워크 실패처럼 코드가 없으면 null.
 */
internal data class VoiceRegistrationFailure(val code: String?, val message: String)

/** 등록 흐름의 거절을 **어디에** 말하는가. */
internal enum class RegistrationFailureSurface {
    /**
     * 흐름을 끝낸다 — 알럿 하나로 이유를 말하고, 초안이 있으면 버리고, 등록 창을 닫는다. 이번 달에는 몇
     * 번을 눌러도 같은 답이라 같은 버튼을 다시 누르게 두지 않는다.
     */
    EndFlow,

    /**
     * 처음 단계(음원 준비 — 녹음 또는 파일)로 돌아간다 — 녹음(고른 파일)을 버리고 그 단계의 녹음 카드(파일 고르기) 바로
     * 아래에 이유를 쓴다. 같은 녹음은 다시 보내도 같은 답이라 `등록` 을 그대로 다시 누르게 두지 않는다. 흐름은 끝내지
     * 않는다 — 서버가 아무것도 쓰지 않았고(초안·횟수 그대로) 다시 녹음하는 데는 제한이 없다.
     */
    ReRecord,

    /** 지금 보이는 단계 안에 쓴다 — 세부 정보 단계의 안내 줄, 확정 화면의 오류 줄. 사용자가 고쳐 다시 누른다. */
    InWindow,

    /** 앱 본체의 스낵바. 등록 창이 없을 때만이다 — 창이 있으면 그 뒤에 가려 안 보인다. */
    AppSnackbar,
}

/**
 * 판정표:
 *
 * | 등록 창 | 코드 | 어디에 |
 * | --- | --- | --- |
 * | 닫혀 있다 | 무엇이든 | [RegistrationFailureSurface.AppSnackbar] |
 * | 열려 있다 | 월 한도([VOICE_MONTHLY_LIMIT_ERROR_CODE]) | [RegistrationFailureSurface.EndFlow] |
 * | 열려 있다 | 말소리 없음([VOICE_CLONE_NO_SPEECH_ERROR_CODE]) | [RegistrationFailureSurface.ReRecord] |
 * | 열려 있다 | 그 밖(유료·동의·미리듣기·용량·네트워크·5xx…) | [RegistrationFailureSurface.InWindow] |
 *
 * - 창이 닫혀 있는 경우는 **창을 닫으면서 보낸 요청**이다 — 나가기 경고의 '나가기' 가 초안 삭제를 보내고
 *   곧바로 창을 닫는다. 그 실패를 창 안의 줄에만 쓰면 **어디에도 안 보인다.** 열기로 했어도 그려지지 않는 창도
 *   닫힌 것이다([shouldDrawRegistrationWindow]). 말소리 없음도 그때는 스낵바다 — 돌아갈 단계가 그려지지 않는다.
 * - 월 한도는 등록 단계에서든 저장 단계에서든 같은 답이다. 서버가 초안을 만들기 전에 막으므로(§4-1 ①)
 *   보통은 등록 단계에서 만나고, 저장 단계에서 만나려면 그사이 다른 기기가 먼저 등록해야 한다.
 * - 말소리 없음은 등록 단계에서만 온다. 흐름을 끝내지도 횟수를 건드리지도 않고 처음 단계로 돌려보낸다 — 고칠 것은
 *   이름이 아니라 녹음이다. 녹음 파일은 뷰모델이 지운다([cloneRejectionSpendsRecording]).
 * - ⚠ **월 한도 말고는 흐름을 끝내지 않는다.** 유료·동의(403)와 `VOICE_PREVIEW_REQUIRED` 는 창 안에서
 *   말하고 사용자가 고친다. 다시 시도할 수 있는 실패(네트워크·5xx·`VOICE_CAPACITY_EXHAUSTED`)에서
 *   창을 닫으면 녹음을 처음부터 다시 해야 한다.
 *
 * iOS 는 창(`fullScreenCover`) 안에 이미 쓰고 있어 이 가르기가 없다 — 월 한도로 흐름을 끝내는 것
 * (`VoiceStudioViewModel.isMonthlyLimitRejection`)과, 말소리 없음으로 처음 단계로 돌려보내는 것이 같아야 한다.
 *
 * @param windowOpen 등록 창이 지금 **그려져 있는가**([shouldDrawRegistrationWindow]) — 열기로 했는가가 아니다.
 */
internal fun registrationFailureSurface(errorCode: String?, windowOpen: Boolean): RegistrationFailureSurface = when {
    !windowOpen -> RegistrationFailureSurface.AppSnackbar
    errorCode == VOICE_MONTHLY_LIMIT_ERROR_CODE -> RegistrationFailureSurface.EndFlow
    errorCode == VOICE_CLONE_NO_SPEECH_ERROR_CODE -> RegistrationFailureSurface.ReRecord
    else -> RegistrationFailureSurface.InWindow
}

/**
 * 등록(`POST /voice/clone`)의 거절이 **보낸 녹음을 다 쓴 것으로 만드는가** — 같은 녹음을 그대로 다시 보내도 같은 답이
 * 오는 거절이다. 그러면 뷰모델이 그 녹음(파일 경로는 잘라 낸 사본 — 업로드한 것이 그것이다)을 지운다. 녹음은 음성
 * 생체정보 평문이라, 남겨 두는 것은 그대로 다시 시도할 수 있을 때뿐이다(`purgeVoiceCloneSourceRecordings` 의 규칙).
 *
 * | 코드 | 녹음 | 왜 |
 * | --- | --- | --- |
 * | 월 한도([VOICE_MONTHLY_LIMIT_ERROR_CODE]) | 지운다 | 이번 달에는 몇 번을 눌러도 같은 답이다 — 창도 닫힌다 |
 * | 말소리 없음([VOICE_CLONE_NO_SPEECH_ERROR_CODE]) | 지운다 | 그 녹음에는 말소리가 없다 — 새로 녹음해야 한다 |
 * | 그 밖(네트워크·5xx·용량·코드 없음…) | 남긴다 | `등록` 을 그대로 다시 누를 수 있어야 한다(스펙 §4-1 ③) |
 *
 * 창이 녹음 참조를 놓는 것은 따로다 — 말소리 없음은 [RegistrationFailureSurface.ReRecord] 가, 월 한도는 창 닫기가 놓는다.
 */
internal fun cloneRejectionSpendsRecording(errorCode: String?): Boolean =
    errorCode == VOICE_MONTHLY_LIMIT_ERROR_CODE || errorCode == VOICE_CLONE_NO_SPEECH_ERROR_CODE

/**
 * 등록 창을 **그리는가** — 패널의 `registrationWindowShown` 이 이 값이다. 그리는 조건(`Dialog`), 뷰모델에 알리는 열림
 * (`voiceRegistrationWindowChanged`), 거절을 어디에 말할지([registrationFailureSurface] 의 `windowOpen`)가 **이 값
 * 하나**를 본다.
 *
 * - 만드는 중·확정·준비 단계는 이용권이 흔들려도 그린다 — 결정(남길지 지울지)과 진행이 먼저다.
 * - 음원 준비·세부 정보 단계는 등록을 열 수 있을 때([canOpenCreateForm] — 유료)만 그린다.
 *
 * ⚠ **'열기로 했다'([requested] — 패널의 `showCreateForm`)를 '보인다' 로 쓰지 말 것.** 만드는 중에 이용권이 끝나고
 * 등록이 실패하면 세부 정보 단계로 돌아오는데, 그 단계는 그려지지 않는다. 그때 거절을 창 안의 줄에 쓰면 창도 없고
 * 목소리 탭의 안내 줄도 꺼져 있어 **어디에도 안 보인다**(1.2.10 은 그 실패를 스낵바에 띄웠다 — 그보다 나빠진다).
 * 그려지지 않은 창의 거절은 스낵바로 간다([RegistrationFailureSurface.AppSnackbar]).
 */
internal fun shouldDrawRegistrationWindow(
    requested: Boolean,
    step: VoiceRegistrationStep,
    canOpenCreateForm: Boolean,
): Boolean = requested && when (step) {
    VoiceRegistrationStep.Creating,
    VoiceRegistrationStep.Preview,
    VoiceRegistrationStep.Prerendering,
    -> true
    VoiceRegistrationStep.Source,
    VoiceRegistrationStep.Details,
    -> canOpenCreateForm
}
