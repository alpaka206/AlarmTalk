package com.alarmtalk.app

import com.alarmtalk.app.data.VoiceTuning
import com.alarmtalk.app.network.VoiceProfile
import com.google.gson.Gson
import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
 */
class VoicePreviewConfirmRulesTest {

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
