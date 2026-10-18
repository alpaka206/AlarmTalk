package com.alarmtalk.app

import com.alarmtalk.app.data.VoiceTuning
import com.alarmtalk.app.network.VoiceDraftQuotaResponse
import com.alarmtalk.app.network.VoiceProfile
import com.google.gson.Gson
import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 목소리 등록 확정 화면의 판정(`VoicePreviewConfirmRules.kt`) — 스펙 voice-and-message §4-1·§4-3(2026-10-08 사용자).
 *
 * 지키는 것:
 *  - 톤 카드의 두 듣기 버튼: 트는 버튼을 다시 누르면 멈춤, 다른 버튼이면 지금 것을 멈추고 처음부터, 받은 클립이 없으면 서버.
 *    서버에서 받는 동안에도 두 버튼이 살아 있다(진행 표시도 '트는 중').
 *  - 막대에서 손을 떼면 현재 톤을 다시 틀되, 첫 청취 확인 전 재생이 **소리 나는 중**이면 끊지 않는다. 굽는 중이면 새 값으로
 *    다시 굽고, 받은 클립이 없으면 아무것도 하지 않는다(받은 뒤 그때의 값으로 굽는다).
 *  - 잠금표: 서버 일이 돌면 뒤로가기·다시 만들기·저장·공유·고치기를 잠그고, 막대·두 버튼은 받기·청취 확인으로는 잠그지 않는다.
 *  - 저장 잠금은 **지금 막대 값을 끝까지 들었을 때만** 열리고(원본은 0), 원본과 번갈아 들어도 다시 잠기지 않는다.
 *  - 이미 등록된 목소리가 있으면 저장은 **언제나 교체**다 — `replace_existing: true` 가 나간다(체크 없음).
 *  - 등록 흐름의 거절을 어디에 말하는가(2026-10-11, §4-1 「월 등록 한도」 ③): 월 한도는 흐름을 끝내고, 말소리 없음은
 *    처음 단계(음원 준비)로 돌려보내고, 그 밖은 등록 창 안에, 창이 닫힌 뒤에 온 것은 스낵바로. '창이 있다' 는 **그려져
 *    있다** 는 뜻이다(열기로 한 것과 다르다). 같은 녹음을 다시 보내도 같은 답인 거절(월 한도·말소리 없음)만 녹음을
 *    지운다. 배선은 `VoiceRegistrationFailureWiringTest`.
 */
class VoicePreviewConfirmRulesTest {

    // ── 월 등록 한도 — 추가·등록 동의·삭제 경고의 공통 판정 ────────────────────

    @Test
    fun `이번 달 등록을 다 썼는지는 서버가 준 남은 횟수로 판정한다`() {
        fun quota(remaining: Int, limit: Int = 1) =
            VoiceDraftQuotaResponse(registrationLimit = limit, registrationRemaining = remaining)
        // 2026-10-10 의 값 — 등록을 마쳤는데 다시 읽지 않아 `1/1` 로 남았다. 이 판정은 '남았다' 고
        // 답하고 `추가` 가 눌린다. 그래서 값은 확정 직후 다시 읽어야 한다(`VoiceRegistrationQuotaWiringTest`).
        assertFalse(monthlyRegistrationUsedUp(quota(remaining = 1)))
        // 다시 읽은 값 — `추가` 가 꺼지고 삭제 경고가 붙는다.
        assertTrue(monthlyRegistrationUsedUp(quota(remaining = 0)))
        // 음수로 내려와도(원장이 한도를 넘긴 경우) 다 쓴 것이다.
        assertTrue(monthlyRegistrationUsedUp(quota(remaining = -1)))
        // ⚠ 아직 모르면(조회 전·실패) 다 쓴 것이 아니다 — 실패는 "모른다" 이지 "다 썼다" 가 아니다.
        // 막는 것은 서버다(다 썼으면 초안을 만들기 전에 429).
        assertFalse(monthlyRegistrationUsedUp(null))
        // 초안 시도 쪽 숫자(`remaining`)는 보지 않는다 — 그건 호환용으로 0 고정이라, 그걸 보면 등록이
        // 남아 있어도 다 쓴 것으로 읽힌다.
        assertFalse(
            monthlyRegistrationUsedUp(
                VoiceDraftQuotaResponse(limit = 3, used = 3, remaining = 0, registrationLimit = 1, registrationRemaining = 1),
            ),
        )
    }

    @Test
    fun `등록 한도가 없는 호환 응답은 추가와 동의하기를 막지 않는다`() {
        val legacy = Gson().fromJson(
            """{"limit":3,"used":3,"remaining":0}""",
            VoiceDraftQuotaResponse::class.java,
        )
        assertEquals(0, legacy.registrationLimit)
        assertEquals(0, legacy.registrationRemaining)
        // 모달은 원본 응답을 넘긴다. 호출부의 사전 필터 없이도 한도 없음으로 판정해야 한다.
        assertFalse(monthlyRegistrationUsedUp(legacy))
        assertFalse(monthlyRegistrationUsedUp(VoiceDraftQuotaResponse(registrationLimit = 0, registrationRemaining = 0)))
        assertFalse(monthlyRegistrationUsedUp(VoiceDraftQuotaResponse(registrationLimit = 0, registrationRemaining = -1)))
        // 같은 남은 횟수라도 실제 한도가 있으면 등록을 막는다.
        assertTrue(monthlyRegistrationUsedUp(VoiceDraftQuotaResponse(registrationLimit = 1, registrationRemaining = 0)))
    }

    // ── 등록 흐름의 거절 — 어디에 말하는가 ──────────────────────────────────
    //
    // 스펙 voice-and-message §4-1 「월 등록 한도」 ③. 등록 창은 화면을 다 덮는 자기 창이라 앱 스낵바는
    // 그 뒤에 그려진다 — 2026-10-10 prod(1.2.10)의 한 사용자는 월 한도로 거절된 같은 저장을 일곱 번
    // 눌렀다. 그때는 이 가르기가 없었고 모든 거절이 스낵바로 갔다.

    @Test
    fun `월 한도 거절은 등록 단계든 저장 단계든 흐름을 끝낸다`() {
        // 두 단계가 같은 코드를 받는다 — 서버는 초안을 만들기 전에 막고(등록), 확정에서도 다시 본다(저장).
        // 규칙에 단계가 없는 것이 곧 "어느 단계든" 이다: 창이 열려 있고 그 코드면 끝낸다.
        assertEquals("VOICE_MONTHLY_CHANGE_LIMIT_REACHED", VOICE_MONTHLY_LIMIT_ERROR_CODE)
        assertEquals(
            RegistrationFailureSurface.EndFlow,
            registrationFailureSurface(VOICE_MONTHLY_LIMIT_ERROR_CODE, windowOpen = true),
        )
    }

    @Test
    fun `그 밖의 거절과 네트워크 실패는 등록 창 안에서 말한다`() {
        // ⚠ 월 한도 말고는 흐름을 끝내지 않는다 — 사용자가 고치거나 그대로 다시 누를 수 있는 실패다.
        // 여기서 창을 닫으면 녹음을 처음부터 다시 해야 한다.
        val recoverable = listOf(
            "VOICE_FEATURE_REQUIRES_PAID_PLAN",
            "CONSENT_REQUIRED",
            "VOICE_PREVIEW_REQUIRED",
            "VOICE_CAPACITY_EXHAUSTED",
            "VOICE_SLOT_EXHAUSTED",
            "VOICE_LIMIT_REACHED",
            "VOICE_CLONE_AUDIO_TOO_SHORT",
            "RATE_LIMITED",
            "INTERNAL_ERROR",
            "SOMETHING_NEW",
            // 코드 없음 — 네트워크 실패·게이트웨이 5xx·초안 삭제(`다시 만들기`)의 실패.
            null,
        )
        for (code in recoverable) {
            assertEquals("$code", RegistrationFailureSurface.InWindow, registrationFailureSurface(code, windowOpen = true))
        }
    }

    @Test
    fun `등록 창이 닫힌 뒤에 온 실패는 스낵바로 간다`() {
        // 나가기 경고의 '나가기' 는 초안 삭제를 보내고 곧바로 창을 닫는다 — 그 실패를 창 안의 줄에만
        // 쓰면 어디에도 안 보인다. 월 한도 코드여도 같다: 닫을 창도, 그 위에 띄울 흐름도 없다. 말소리 없음도 같다:
        // 돌아갈 단계가 그려지지 않는다.
        for (code in listOf(
            null,
            "INTERNAL_ERROR",
            "VOICE_PREVIEW_REQUIRED",
            VOICE_MONTHLY_LIMIT_ERROR_CODE,
            VOICE_CLONE_NO_SPEECH_ERROR_CODE,
        )) {
            assertEquals("$code", RegistrationFailureSurface.AppSnackbar, registrationFailureSurface(code, windowOpen = false))
        }
    }

    // ── 말소리 없음 — 처음 단계로 돌아가 새로 녹음한다(2026-10-11 소유자 결정) ─────────────
    //
    // 2026-10-10 prod(UTC): 한 사용자가 세 번 목소리를 만들었다(세 번 다 201). 뒤이은 말투 분석은 셋 다 '실패' 였고,
    // 그중 둘은 받아 적은 글이 20자도 안 됐다 — 녹음에 말소리가 거의 없었는데 목소리는 만들어졌다. 그 사용자는 그 뒤
    // 다시 등록하다 월 한도에 걸렸다. 이제 서버는 그런 녹음을 provider 에 올리기 전에 거절한다(`VOICE_CLONE_NO_SPEECH`,
    // 아무것도 쓰지 않는다).

    @Test
    fun `말소리가 없는 녹음은 처음 단계로 돌려보낸다 — 흐름을 끝내지도 그 자리에 머물지도 않는다`() {
        // 서버가 내는 코드 그대로다(`packages/shared/src/schemas/error-codes.ts` — 배선 테스트가 목록에 있는지도 본다).
        assertEquals("VOICE_CLONE_NO_SPEECH", VOICE_CLONE_NO_SPEECH_ERROR_CODE)
        assertEquals(
            RegistrationFailureSurface.ReRecord,
            registrationFailureSurface(VOICE_CLONE_NO_SPEECH_ERROR_CODE, windowOpen = true),
        )
        // ⚠ 세부 정보 단계에 머물면(InWindow) `등록` 이 같은 녹음을 다시 보낸다 — 몇 번을 눌러도 같은 답이다. 흐름을
        // 끝내면(EndFlow) 다시 녹음하려고 창을 처음부터 다시 열어야 하고, 횟수와 무관한 거절에 월 한도 알럿이 뜬다.
        assertNotEquals(RegistrationFailureSurface.InWindow, registrationFailureSurface(VOICE_CLONE_NO_SPEECH_ERROR_CODE, windowOpen = true))
        assertNotEquals(RegistrationFailureSurface.EndFlow, registrationFailureSurface(VOICE_CLONE_NO_SPEECH_ERROR_CODE, windowOpen = true))
        // 처음 단계로 돌려보내는 것은 이 코드 하나다 — 다시 시도할 수 있는 실패는 녹음을 그대로 두고 그 자리에서 말한다.
        for (code in listOf(null, "INTERNAL_ERROR", "VOICE_CLONE_AUDIO_TOO_SHORT", "VOICE_CAPACITY_EXHAUSTED", "SOMETHING_NEW")) {
            assertNotEquals("$code", RegistrationFailureSurface.ReRecord, registrationFailureSurface(code, windowOpen = true))
        }
    }

    @Test
    fun `같은 녹음을 다시 보내도 같은 답인 거절만 녹음을 지운다`() {
        // 월 한도: 이번 달에는 몇 번을 눌러도 같은 답이다(창도 닫힌다). 말소리 없음: 그 녹음에는 말소리가 없다.
        assertTrue(cloneRejectionSpendsRecording(VOICE_MONTHLY_LIMIT_ERROR_CODE))
        assertTrue(cloneRejectionSpendsRecording(VOICE_CLONE_NO_SPEECH_ERROR_CODE))
        // ⚠ 다시 시도할 수 있는 실패는 녹음을 남긴다 — `등록` 을 그대로 다시 누를 수 있어야 한다(스펙 §4-1 ③). 코드 없음은
        // 네트워크 실패·게이트웨이 5xx 다.
        for (code in listOf(
            null,
            "INTERNAL_ERROR",
            "RATE_LIMITED",
            "VOICE_CAPACITY_EXHAUSTED",
            "VOICE_SLOT_EXHAUSTED",
            "VOICE_FEATURE_REQUIRES_PAID_PLAN",
            "CONSENT_REQUIRED",
            "VOICE_CLONE_AUDIO_TOO_SHORT",
            "SOMETHING_NEW",
        )) {
            assertFalse("$code", cloneRejectionSpendsRecording(code))
        }
    }

    // ── 등록 창이 그려져 있는가 — '열기로 했다' 와 다르다 ─────────────────────
    //
    // 2026-10-11 리뷰: 거절을 어디에 말할지를 '열기로 했는가'(패널의 `showCreateForm`)로 갈랐더니, 그려지지 않는 창
    // 안에 쓰는 경우가 생겼다. 배선(그리는 조건·뷰모델에 알리는 열림·거절 라우터가 이 값 하나를 본다)은
    // `VoiceRegistrationFailureWiringTest`.

    @Test
    fun `만드는 중·확정·준비 단계는 이용권이 흔들려도 그린다`() {
        // 결정(남길지 지울지)과 진행이 먼저다 — 구독 상태가 흔들렸다고 결정 화면을 치우지 않는다.
        for (step in listOf(VoiceRegistrationStep.Creating, VoiceRegistrationStep.Preview, VoiceRegistrationStep.Prerendering)) {
            assertTrue("$step", shouldDrawRegistrationWindow(requested = true, step = step, canOpenCreateForm = false))
            assertTrue("$step", shouldDrawRegistrationWindow(requested = true, step = step, canOpenCreateForm = true))
        }
    }

    @Test
    fun `음원 준비·세부 정보 단계는 등록을 열 수 있을 때만 그린다`() {
        for (step in listOf(VoiceRegistrationStep.Source, VoiceRegistrationStep.Details)) {
            assertTrue("$step", shouldDrawRegistrationWindow(requested = true, step = step, canOpenCreateForm = true))
            assertFalse("$step", shouldDrawRegistrationWindow(requested = true, step = step, canOpenCreateForm = false))
        }
    }

    @Test
    fun `열기로 하지 않았으면 어느 단계든 그리지 않는다`() {
        for (step in VoiceRegistrationStep.entries) {
            assertFalse("$step", shouldDrawRegistrationWindow(requested = false, step = step, canOpenCreateForm = true))
        }
    }

    @Test
    fun `만드는 중에 이용권이 끝나고 등록이 실패하면 그 거절은 스낵바로 간다`() {
        // 등록을 보낸 동안(만드는 중)은 창이 그려져 있다 — 뷰모델은 거절을 창에 올린다.
        assertTrue(shouldDrawRegistrationWindow(requested = true, step = VoiceRegistrationStep.Creating, canOpenCreateForm = false))
        // 실패하면 창은 세부 정보 단계로 돌아온다. 이용권이 없으면 그 단계는 그려지지 않는다 — 창이 '열기로 한' 채라도
        // 그 안에 쓰면 어디에도 안 보이므로(목소리 탭의 안내 줄도 창이 열린 동안은 꺼져 있다) 스낵바로 간다.
        val afterRevert = shouldDrawRegistrationWindow(requested = true, step = VoiceRegistrationStep.Details, canOpenCreateForm = false)
        assertFalse(afterRevert)
        for (code in listOf("VOICE_FEATURE_REQUIRES_PAID_PLAN", null, VOICE_MONTHLY_LIMIT_ERROR_CODE, VOICE_CLONE_NO_SPEECH_ERROR_CODE)) {
            assertEquals("$code", RegistrationFailureSurface.AppSnackbar, registrationFailureSurface(code, windowOpen = afterRevert))
        }
        // 이용권이 그대로면 같은 실패를 세부 정보 단계 안에 쓴다(예전 그대로).
        val entitled = shouldDrawRegistrationWindow(requested = true, step = VoiceRegistrationStep.Details, canOpenCreateForm = true)
        assertEquals(RegistrationFailureSurface.InWindow, registrationFailureSurface(null, windowOpen = entitled))
    }

    // ── 듣기 버튼 ────────────────────────────────────────────────────────

    @Test
    fun `트는 버튼을 다시 누르면 멈춘다`() {
        for (target in TuningListenTarget.values()) {
            assertEquals(TuningListenAction.Stop, tuningListenAction(target, active = target, clipReady = true))
        }
    }

    @Test
    fun `다른 버튼을 누르면 지금 것을 멈추고 그것을 기기에서 처음부터 튼다`() {
        assertEquals(
            TuningListenAction.PlayLocally,
            tuningListenAction(TuningListenTarget.Original, active = TuningListenTarget.Current, clipReady = true),
        )
        assertEquals(
            TuningListenAction.PlayLocally,
            tuningListenAction(TuningListenTarget.Current, active = TuningListenTarget.Original, clipReady = true),
        )
        // 아무것도 틀지 않을 때도 받아 둔 클립을 기기에서 튼다(서버 왕복 없음) — 첫 청취 확인 전이어도 같다.
        assertEquals(
            TuningListenAction.PlayLocally,
            tuningListenAction(TuningListenTarget.Original, active = null, clipReady = true),
        )
    }

    @Test
    fun `받은 클립이 없으면 어느 버튼이든 서버에서 받는다`() {
        for (target in TuningListenTarget.values()) {
            assertEquals(
                TuningListenAction.FetchFromServer,
                tuningListenAction(target, active = null, clipReady = false),
            )
        }
    }

    @Test
    fun `받는 중에도 두 버튼이 산다 — 진행 표시가 도는 버튼은 멈춤, 다른 버튼은 받은 뒤에 튼다`() {
        // 화면에 들어오면 `현재 톤 듣기` 로 받기 시작한다(진행 표시가 그 버튼에 돈다 — '트는 중' 이다).
        // 그 버튼을 누르면 멈춘다 — 화면은 받기는 그대로 두고 받은 뒤에 틀 버튼만 비운다.
        assertEquals(
            TuningListenAction.Stop,
            tuningListenAction(TuningListenTarget.Current, active = TuningListenTarget.Current, clipReady = false),
        )
        // 다른 버튼을 누르면 받은 뒤에 그것을 튼다 — 화면은 이미 받는 중이면 새로 받지 않고 틀 버튼만 바꾼다.
        assertEquals(
            TuningListenAction.FetchFromServer,
            tuningListenAction(TuningListenTarget.Original, active = TuningListenTarget.Current, clipReady = false),
        )
        // 멈춘 뒤(틀 버튼 없음) 다시 누르면 받은 뒤에 그것을 튼다.
        assertEquals(
            TuningListenAction.FetchFromServer,
            tuningListenAction(TuningListenTarget.Current, active = null, clipReady = false),
        )
    }

    // ── 막대에서 손을 뗐을 때 ─────────────────────────────────────────────

    @Test
    fun `첫 청취 확인 전 재생이 소리 나는 중에만 끊지 않고 미룬다`() {
        assertEquals(
            TuningReleaseAction.Defer,
            tuningReleaseAction(clipReady = true, firstListenConfirmed = false, audible = true),
        )
    }

    @Test
    fun `받은 클립이 없으면 막대는 아무것도 하지 않는다 — 받은 뒤 그때의 값으로 굽는다`() {
        // 받는 중이든 받는 요청이 없든 같다 — 막대는 서버를 부르지 않고, 받는 중이면 받은 뒤 굽기가 지금 값을 읽는다.
        // iOS `VoiceTonePreview` 의 막대 판정과 같은 답이다(클립이 없으면 무시).
        for (audible in listOf(false, true)) {
            assertEquals(
                TuningReleaseAction.None,
                tuningReleaseAction(clipReady = false, firstListenConfirmed = false, audible = audible),
            )
        }
    }

    @Test
    fun `그 밖에는 현재 톤을 다시 굽고 처음부터 튼다`() {
        // 첫 청취 확인 뒤 — 트는 중이던 것(원본 포함)을 멈추고 현재 톤.
        assertEquals(
            TuningReleaseAction.PlayCurrent,
            tuningReleaseAction(clipReady = true, firstListenConfirmed = true, audible = true),
        )
        assertEquals(
            TuningReleaseAction.PlayCurrent,
            tuningReleaseAction(clipReady = true, firstListenConfirmed = true, audible = false),
        )
        // 첫 미리듣기를 아직 굽는 중(소리 전 — 끊을 소리가 없다)·첫 재생을 멈춘 뒤·청취 확인을 기다리는 중 — 새 값으로
        // 다시 굽는다. 옛 추천값을 끝까지 튼 뒤에 새 값을 잇지 않는다.
        assertEquals(
            TuningReleaseAction.PlayCurrent,
            tuningReleaseAction(clipReady = true, firstListenConfirmed = false, audible = false),
        )
    }

    // ── 잠금표 ───────────────────────────────────────────────────────────

    private fun locks(
        fetching: Boolean = false,
        confirming: Boolean = false,
        savingText: Boolean = false,
        profileBusy: Boolean = false,
        editing: Boolean = false,
    ) = confirmStepLocks(fetching, confirming, savingText, profileBusy, editing)

    @Test
    fun `서버 일이 하나라도 돌면 뒤로가기·다시 만들기·저장·공유·고치기를 잠근다`() {
        assertEquals(ConfirmStepLocks(working = false, toneEnabled = true), locks())
        assertTrue(locks(fetching = true).working)
        assertTrue(locks(confirming = true).working)
        assertTrue(locks(savingText = true).working)
        assertTrue(locks(profileBusy = true).working)
        // 입력칸이 열려 있는 것만으로는 서버 일이 아니다 — 뒤로가기·다시 만들기는 그대로다(저장하기는 화면이 따로 잠근다).
        assertFalse(locks(editing = true).working)
    }

    @Test
    fun `막대와 두 듣기 버튼은 받기·청취 확인으로는 잠그지 않는다`() {
        // 받는 동안 누른 버튼이 받은 뒤에 트는 버튼이다 — 잠그면 진행 표시가 도는 버튼을 멈출 수 없다.
        assertTrue(locks(fetching = true).toneEnabled)
        assertTrue(locks(confirming = true).toneEnabled)
        // 문구를 고치는 동안(저장 포함)과 등록 확정·초안 삭제 중에는 잠근다.
        assertFalse(locks(editing = true).toneEnabled)
        assertFalse(locks(editing = true, savingText = true).toneEnabled)
        assertFalse(locks(profileBusy = true).toneEnabled)
    }

    // ── 저장 잠금(들은 높이) ──────────────────────────────────────────────

    private fun tuning(semitones: Float) = VoiceTuning(pitchSemitones = semitones, source = VoiceTuning.SOURCE_MANUAL)

    @Test
    fun `저장은 지금 막대 값을 끝까지 들었을 때만 열린다`() {
        assertFalse(tuningHeardToEnd(tuning(-1.5f), emptySet()))
        assertTrue(tuningHeardToEnd(tuning(-1.5f), setOf(tuning(-1.5f).heardKey())))
        // 막대를 옮기면 아직 듣지 않은 값이다.
        assertFalse(tuningHeardToEnd(tuning(-2f), setOf(tuning(-1.5f).heardKey())))
    }

    @Test
    fun `원본 듣기를 끝까지 들었으면 0 을 들은 것이다`() {
        val heard = setOf(VoiceTuning.NEUTRAL.heardKey())
        assertTrue(tuningHeardToEnd(VoiceTuning(source = VoiceTuning.SOURCE_MANUAL), heard))
        assertFalse(tuningHeardToEnd(tuning(-1.5f), heard))
        // −0 으로 적혀도 0 과 같은 열쇠다(Set 은 Float.equals 로 가른다 — −0f ≠ 0f).
        assertEquals(0f.toBits(), tuning(-0f).heardKey().toBits())
    }

    @Test
    fun `원본과 번갈아 들어도 저장이 다시 잠기지 않는다`() {
        // 현재 톤(−1.5)을 끝까지 듣고 → 비교하려고 원본을 끝까지 들었다.
        val heard = setOf(tuning(-1.5f).heardKey(), VoiceTuning.NEUTRAL.heardKey())
        assertTrue(tuningHeardToEnd(tuning(-1.5f), heard))
    }

    // ── 첫 청취 확인 직후 다시 틀기 ───────────────────────────────────────

    @Test
    fun `첫 재생 도중 막대에서 손을 뗐으면 끝난 뒤 새 높이로 다시 튼다`() {
        // 현재 톤(−1.5) 첫 재생 도중 −3 으로 옮겼다(끊지 않고 미뤘다).
        assertTrue(replaysCurrentToneAfterFirstListen(true, tuning(-3f), setOf(tuning(-1.5f).heardKey())))
        // 원본 첫 재생 도중 −3 으로 옮겼다 — 어느 버튼의 재생이었든 같다.
        assertTrue(replaysCurrentToneAfterFirstListen(true, tuning(-3f), setOf(VoiceTuning.NEUTRAL.heardKey())))
        // 옮겼다가 같은 값으로 돌아왔으면 이미 들은 값이다.
        assertFalse(replaysCurrentToneAfterFirstListen(true, tuning(-1.5f), setOf(tuning(-1.5f).heardKey())))
        // 막대를 0 에 두었으면 원본이 곧 그 소리다.
        assertFalse(
            replaysCurrentToneAfterFirstListen(
                true,
                VoiceTuning(source = VoiceTuning.SOURCE_MANUAL),
                setOf(VoiceTuning.NEUTRAL.heardKey()),
            ),
        )
    }

    @Test
    fun `막대를 건드리지 않았으면 저절로 다시 틀지 않는다 — 둘 다 한 번 튼다`() {
        val heardOriginal = setOf(VoiceTuning.NEUTRAL.heardKey())
        // 원본을 들으려고 누른 사람에게 곧바로 다른 소리를 잇지 않는다.
        assertFalse(replaysCurrentToneAfterFirstListen(false, tuning(-1.5f), heardOriginal))
        // 현재 톤을 굽지 못해 원본으로 대신 틀었어도 저절로 다시 굽지 않는다 — 0 을 들은 것이라 저장은 잠긴 채다.
        assertFalse(replaysCurrentToneAfterFirstListen(false, tuning(-1.5f), heardOriginal))
        assertFalse(tuningHeardToEnd(tuning(-1.5f), heardOriginal))
    }

    // ── 교체 ─────────────────────────────────────────────────────────────

    private val draft = VoiceProfile(id = "draft-1", name = "새 목소리", status = "ready", isDraft = true)
    private val registered = VoiceProfile(id = "voice-1", name = "엄마", status = "ready", isDraft = false)

    @Test
    fun `이미 등록된 목소리가 있으면 그것이 교체 대상이다`() {
        assertEquals(registered, registrationReplaceTarget(listOf(draft, registered), draftId = draft.id))
        // 다른 초안·실패한 목소리는 교체 대상이 아니다.
        val otherDraft = VoiceProfile(id = "draft-0", name = "옛 초안", status = "ready", isDraft = true)
        val failed = VoiceProfile(id = "voice-0", name = "실패", status = " Failed ", isDraft = false)
        assertNull(registrationReplaceTarget(listOf(draft, otherDraft, failed), draftId = draft.id))
        assertNull(registrationReplaceTarget(listOf(draft), draftId = draft.id))
    }

    private fun promotionBody(replaceExisting: Boolean, pitch: Float = 0f) = JsonParser.parseString(
        // Retrofit 의 `GsonConverterFactory.create()` 와 같은 기본 Gson(`serializeNulls` 꺼짐).
        Gson().toJson(
            voiceDraftPromotionRequest(
                replaceExisting = replaceExisting,
                isShared = false,
                language = "ko",
                pitchSemitones = pitch,
            ),
        ),
    ).asJsonObject

    @Test
    fun `이미 등록된 목소리가 있으면 저장은 언제나 교체로 보낸다`() {
        // 확정 화면이 넘기는 값 그대로 — 체크가 없으니 교체 대상이 있다는 사실이 곧 교체다.
        val target = registrationReplaceTarget(listOf(draft, registered), draftId = draft.id)
        val body = promotionBody(replaceExisting = target != null, pitch = -1.5f)
        assertTrue(body.get("replace_existing").asBoolean)
        assertEquals(false, body.get("is_draft").asBoolean)
        assertEquals(-1.5, body.get("pitch_semitones").asDouble, 0.0)
    }

    @Test
    fun `교체할 목소리가 없으면 교체 표시를 보내지 않는다`() {
        val target = registrationReplaceTarget(listOf(draft), draftId = draft.id)
        val body = promotionBody(replaceExisting = target != null)
        assertFalse(body.has("replace_existing"))
        // 0 은 원래 소리 — 높이 키도 나가지 않는다.
        assertFalse(body.has("pitch_semitones"))
    }
}
