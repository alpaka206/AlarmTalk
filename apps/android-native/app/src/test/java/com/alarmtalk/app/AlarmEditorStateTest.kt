package com.alarmtalk.app

import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.AlarmOrigins
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.AlarmStates
import com.alarmtalk.app.data.AlarmSyncStates
import com.alarmtalk.app.data.CachedAlarmAudio
import com.alarmtalk.app.data.DefaultAlarmSounds
import com.alarmtalk.app.data.SYSTEM_VOICE_ID_PREFIX
import com.alarmtalk.app.data.SnoozeRepeatLimits
import com.alarmtalk.app.data.VibrationPatterns
import com.alarmtalk.app.data.VoiceSources
import com.alarmtalk.app.data.encodeBucketClipKeys
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

// 버킷 클립 목록 인코딩이 org.json 을 쓴다 — 순수 JVM 에서는 스텁이 던진다.
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AlarmEditorStateTest {
    @Test
    fun cloneBucketsRequireEveryBackendVariant() {
        // ⚠ 개수는 **서버가 내려준다**(`expected_variants`) — 앱 상수로 두지 않는다.
        // 운영이 시드를 늘리면 앱 업데이트 없이 따라와야 하고, 기본 목소리와 등록 목소리는
        // 개수가 다르다(medication 2 vs 3). 계약 검증은 백엔드
        // `test/expected-variants.test.ts` 가 맡는다.
        val counts = com.alarmtalk.app.network.ExpectedVariantCounts(
            system = mapOf("weather" to 9, "medication" to 2, "greeting" to 1),
            clone = mapOf("weather" to 9, "fortune" to 5, "cheer" to 3, "medication" to 3, "greeting" to 1),
        )
        assertEquals(2, counts.countFor("medication", isSystemVoice = true))
        assertEquals(3, counts.countFor("medication", isSystemVoice = false))
        assertNull(counts.countFor("unknown", isSystemVoice = false))
    }

    @Test
    fun defaultPresetContextUsesGreetingPrerenderBucket() {
        assertEquals("greeting", clonePrerenderBucketCategoryFor("preset"))
    }

    /**
     * **문구 목록은 하나다 — 유료·무료로 갈리지 않는다**(2026-09-02).
     *
     * 그전에는 `FreeBucketOrder` 가 `listOf("medication", "weather")` 로 손으로 적혀 있어,
     * 같은 '문구 종류' 가 **유료 5종 · 무료 2종**으로 갈라져 있었다. 그 차이는 제품 결정이
     * 아니라 *기본 목소리에 운세·사랑 클립이 없었다*는 사정이었고, 클립을 채우고 나니 남을
     * 이유가 없었다. 다시 손으로 적기 시작하면 한쪽만 늘어나는 사고가 그대로 돌아온다.
     *
     * 등급으로 갈리는 것은 **직접 입력 잠금 하나뿐**이다(`manualLocked = freeVoiceTier`).
     */
    @Test
    fun freeBucketOrderIsDerivedFromTheOneMessageList() {
        val fromMessageList = EditorMessageContexts
            .filterNot { (context, _) ->
                context == ManualMessageContext || context == DefaultRandomPromptContext
            }
            .mapNotNull { (context, _) -> clonePrerenderBucketCategoryFor(context) }
        assertEquals(fromMessageList, FreeBucketOrder)
        // ⚠ **'직접 입력' 은 걷어내고 매핑해야 한다.** 그냥 흘리면 모르는 값이 `preset` 으로
        //   접혀 **greeting 으로 둔갑**하고, 같은 버킷이 목록에 두 번 들어온다.
        assertEquals("greeting", clonePrerenderBucketCategoryFor(ManualMessageContext))
        assertEquals(FreeBucketOrder.distinct(), FreeBucketOrder)
        // ⚠ **'기본 인사말'(greeting)은 스톡 목소리의 알람 테마가 아니다**(2026-09-02 리뷰).
        //   스톡 greeting 은 목소리 미리듣기용 자기소개라 매일 아침 울릴 문구가 아니고,
        //   서버도 시스템 보이스 + greeting 을 `INVALID_BUCKET_ID` 로 거절한다
        //   (`alarm-mutation.ts`). 넣었다가 되돌린 자리이므로 다시 넣지 말 것 —
        //   넣으려면 **기상 인사 스톡 클립을 따로 구워야** 한다.
        assertFalse("greeting" in FreeBucketOrder)
        assertEquals(
            listOf("weather", "fortune", "cheer", "medication"),
            FreeBucketOrder,
        )
    }

    /**
     * **시딩이 도는 중에는 그 카테고리를 감춘다.**
     *
     * 매니페스트는 클립이 하나 구워질 때마다 카테고리를 곧바로 노출한다. 그때 고르면
     * `bindStockBucketClips` 가 **그 순간 보이는 variant 만** 알람에 박아 두고,
     * `StockClipLanguageRebinder` 는 같은 언어의 기존 버킷을 나중에 넓혀 주지 않는다 —
     * 시딩 중에 만든 알람이 **영구히 부분 세트**로 남는다. 조건형(날씨·운세)에서는 그게
     * 곧 엉뚱한 조건의 클립이 나가는 것이다(2026-09-02 리뷰).
     */
    @Test
    fun partialBucketsStayHiddenUntilFullySeeded() {
        fun clip(category: String, variant: Int) = com.alarmtalk.app.network.StockClip(
            messageId = "m-$category-$variant",
            voiceProfileId = "vp-1",
            category = category,
            language = "ko",
            variant = variant,
            text = "t",
            audioUrl = "r2://x",
        )
        val expected = com.alarmtalk.app.network.ExpectedVariantCounts(
            system = mapOf("medication" to 2, "cheer" to 3),
            clone = emptyMap(),
        )
        // love 는 3개가 있어야 하는데 2개뿐 = 시딩 중 → 감춘다. medication 은 완전하다.
        val partial = listOf(
            clip("medication", 0), clip("medication", 1),
            clip("cheer", 0), clip("cheer", 1),
        )
        assertEquals(listOf("medication"), freeBucketsFor(partial, "vp-1", "ko", expected))

        // 마지막 하나가 채워지면 그때 나타난다 — 앱 수정 없이.
        val complete = partial + clip("cheer", 2)
        assertEquals(listOf("cheer", "medication"), freeBucketsFor(complete, "vp-1", "ko", expected).sorted())

        // ⚠ **매니페스트를 못 받았으면 막지 않는다** — 못 물어본 것이 사용자를 막는 근거가
        //   되면 안 된다(관문들과 같은 규약).
        assertEquals(
            listOf("cheer", "medication"),
            freeBucketsFor(partial, "vp-1", "ko", null).sorted(),
        )
    }

    /**
     * **옛 이름 `love` 는 영원히 받아 준다.**
     *
     * 2026-09-02 에 '사랑'을 '응원'(`cheer`)으로 바꿨는데, 이미 저장된 알람 행과 스토어에
     * 올라간 구버전 앱은 여전히 `love` 를 들고 있다. 우리가 고칠 수 없는 것들이다.
     *
     * ⚠ 접기를 지우면 `normalizedRandomPromptContext` 의 `else` 가 모르는 값으로 보고
     * **`preset` 으로 떨어뜨린다** — 사용자는 응원을 골랐는데 기본 인사말이 울린다.
     * 조용히 뜻이 바뀌는 종류라 화면에도 로그에도 흔적이 남지 않는다.
     */
    @Test
    fun legacyLoveNameStillFoldsToCheer() {
        assertEquals("cheer", normalizedRandomPromptContext("love"))
        // 저장된 알람 행의 옛 버킷 id 도 같이 접힌다.
        assertEquals("cheer", randomPromptContextForBucket("love"))
        // 옛 컨텍스트로 저장된 행을 열어도 종류를 잃지 않는다.
        val editor = AlarmEditorState.from(
            alarm = bucketAlarmEntity(voiceRandomContext = "love", bucketId = "love"),
        )
        assertEquals("cheer", editor.voiceRandomContext)
    }

    @Test
    fun bucketCategoryMapsBackToItsMessageContext() {
        // clonePrerenderBucketCategoryFor 와 짝. 한쪽만 고치면 옛 알람 복구가 조용히 어긋난다.
        listOf("preset", "cheer", "medication", "wake_fortune", "wake_weather").forEach { context ->
            assertEquals(context, randomPromptContextForBucket(clonePrerenderBucketCategoryFor(context)))
        }
        assertNull(randomPromptContextForBucket(null))
        assertNull(randomPromptContextForBucket("unknown"))
    }

    /**
     * **재생 방식을 '알람' 으로 바꿔도 고른 문구 종류는 그대로여야 한다.**
     *
     * 2026-08-16 질문 "왜 알람으로 바꾸면 약이 직접 입력으로 바뀌냐". 원인은 표시 판정식이
     * `isActiveBucketAlarm()` 을 쓰고 있던 것 — 그 함수는 첫 줄에서 `playMode == ALARM_ONLY`
     * 면 false 를 돌려준다(그건 "울릴 때 클립을 쓰는가" 로는 맞다). 버킷이 붙으면
     * `voiceRandomPrompt` 가 꺼지므로, 알람 모드가 되는 순간 `!false && !false` 가 되어
     * 요약 행이 '직접 입력' 으로 뒤집혔다.
     *
     * 표시는 `hasBucketMessageChoice()`(재생 방식 무관), 저장·오디오는 `isActiveBucketAlarm()`.
     * 둘을 다시 합치면 이 테스트가 깨진다.
     */
    @Test
    fun alarmModeDoesNotChangeChosenMessageKind() {
        val editor = AlarmEditorState.from(alarm = null, defaultPlayMode = AlarmPlayModes.VOICE_ONLY)
        editor.voiceProfileId = "clone-profile"
        editor.voiceRandomPrompt = true
        editor.voiceRandomContext = "medication"
        editor.setBucketAudio(
            audio = CachedAlarmAudio(
                localAudioUri = "file://clip0.mp3",
                rawAudioUri = "r2://clip0.mp3",
                displayName = "clip0",
                durationMillis = null,
                cacheKey = "stock_clip-0",
                messageId = "clip-0",
            ),
            profileId = "clone-profile",
            messageId = "clip-0",
            text = "약 먹을 시간이에요",
            bucket = "medication",
            language = "ko",
            clipKeys = listOf("stock_clip-0", "stock_clip-1"),
        )

        // 목소리 모드: 둘 다 '테마 알람' 이라고 답한다.
        assertTrue(editor.isActiveBucketAlarm())
        assertTrue(editor.hasBucketMessageChoice())
        assertFalse(!editor.voiceRandomPrompt && !editor.hasBucketMessageChoice()) // = 직접 입력 아님

        editor.playMode = AlarmPlayModes.ALARM_ONLY

        // 울릴 때 클립을 쓰지 않는 건 맞다.
        assertFalse(editor.isActiveBucketAlarm())
        // ⚠ 그래도 **고른 문구는 그대로 '약'** 이다 — 여기서 true 가 되면 요약 행이
        // '직접 입력' 으로 뒤집힌다(고친 버그).
        assertTrue(editor.hasBucketMessageChoice())
        assertFalse(!editor.voiceRandomPrompt && !editor.hasBucketMessageChoice())
    }

    @Test
    fun bucketAlarmKeepsItsMessageContextOnSave() {
        // 버킷을 붙이면 voiceRandomPrompt 가 꺼진다. 그때 종류까지 떨어뜨리면 다음 새 알람이
        // '기본 인사말'로 되돌아가고, 이 알람을 다시 열면 '직접 입력'으로 보인다.
        val editor = AlarmEditorState.from(alarm = null, defaultPlayMode = AlarmPlayModes.VOICE_ONLY)
        editor.voiceProfileId = "clone-profile"
        editor.voiceRandomPrompt = true
        editor.voiceRandomContext = "cheer"

        editor.setBucketAudio(
            audio = CachedAlarmAudio(
                localAudioUri = "file://clip0.mp3",
                rawAudioUri = "r2://clip0.mp3",
                displayName = "clip0",
                durationMillis = null,
                cacheKey = "stock_clip-0",
                messageId = "clip-0",
            ),
            profileId = "clone-profile",
            messageId = "clip-0",
            text = "사랑해",
            bucket = "cheer",
            language = "ko",
            clipKeys = listOf("stock_clip-0", "stock_clip-1"),
        )

        val draft = editor.toDraft()

        assertFalse(draft.voiceRandomPrompt)
        assertEquals("cheer", draft.bucketId)
        assertEquals("cheer", draft.voiceRandomContext)
    }

    /**
     * ⚠ **바인딩이 풀린 버킷 알람도 여전히 '테마' 다**(2026-08-31 실기기 재현).
     *
     * `setBucketAudio` 는 버킷을 붙이면서 `voiceRandomPrompt` 를 끈다. 그래서 저장 갈래가
     * 그 값 하나로 "테마인가" 를 가르면, 오디오 바인딩이 풀린 순간(이미 고른 목소리를 다시
     * 누르기 · 재생 방식 왕복 · 클립 언어 변경) 그 알람은 **버킷 갈래로 돌아올 길이 없고**
     * '직접 입력' 으로 읽혀 유료 전용 라이브 TTS 를 부른다 — 무료 사용자가 기본 목소리로
     * 날씨를 고르고 저장만 눌렀는데 "유료 이용권" 을 본다.
     *
     * `hasBucketMessageChoice()`/`isActiveBucketAlarm()` 은 이 판정에 **쓸 수 없다** —
     * 둘 다 `audioCacheKey` 가 살아 있어야 true 라, 바로 그 상태에서 false 다.
     * 남는 단서는 `selectedBucket` 하나다.
     */
    @Test
    fun bucketChoiceSurvivesAudioBindingLoss() {
        val editor = AlarmEditorState.from(alarm = null, defaultPlayMode = AlarmPlayModes.VOICE_ONLY)
        editor.voiceProfileId = "system-profile"
        editor.voiceRandomPrompt = true
        editor.voiceRandomContext = "weather"
        editor.setBucketAudio(
            audio = CachedAlarmAudio(
                localAudioUri = "file://clip0.mp3",
                rawAudioUri = "r2://clip0.mp3",
                displayName = "clip0",
                durationMillis = null,
                cacheKey = "stock_clip-0",
                messageId = "clip-0",
            ),
            profileId = "system-profile",
            messageId = "clip-0",
            text = "오늘은 맑아요",
            bucket = "weather",
            language = "ko",
            clipKeys = listOf("stock_clip-0", "stock_clip-1"),
        )
        // 버킷을 붙이면 randomPrompt 는 꺼진다 — 이게 이 버그의 출발점이다.
        assertFalse(editor.voiceRandomPrompt)
        assertTrue(editor.hasBucketMessageChoice())

        // 목소리를 다시 고르면 오디오가 지워진다(동일 id 가드 없음).
        editor.clearAudio()

        // 바인딩 기반 판정 둘은 false 로 떨어진다 — 저장 갈래가 이걸 보면 안 된다.
        assertFalse(editor.hasBucketMessageChoice())
        assertFalse(editor.isActiveBucketAlarm())
        // 사용자가 고른 것은 여전히 '날씨' 다. 저장 갈래는 이 단서로 버킷을 다시 붙여야 한다.
        assertEquals("weather", editor.selectedBucket)
        assertTrue(editor.voiceRandomPrompt || editor.selectedBucket != null)
    }

    @Test
    fun manualAlarmStillDropsItsMessageContextOnSave() {
        // 직접 입력은 종류가 없다 — 버킷 예외가 여기까지 새면 안 된다.
        val editor = AlarmEditorState.from(alarm = null, defaultPlayMode = AlarmPlayModes.VOICE_ONLY)
        editor.voiceProfileId = "clone-profile"
        editor.voiceRandomContext = "cheer"
        editor.voiceRandomPrompt = false
        editor.voiceText = "일어나"

        assertNull(editor.toDraft().voiceRandomContext)
    }

    @Test
    fun newAlarmOpensWithTheLastManualTextWhenThatWasTheLastChoice() {
        // 문구까지 이어받아야 새 알람이 **바로 저장 가능**하다(빈 직접입력이면 저장이 막힌다).
        val editor = AlarmEditorState.from(
            alarm = null,
            defaultPlayMode = AlarmPlayModes.VOICE_ONLY,
            defaultManualText = "회의 자료 챙겨",
        )

        assertFalse(editor.voiceRandomPrompt)
        assertEquals("회의 자료 챙겨", editor.voiceText)
    }

    @Test
    fun existingAlarmIgnoresTheLastManualText() {
        // 기존 알람을 열기만 해도 문구가 바뀌면 안 된다.
        val editor = AlarmEditorState.from(
            alarm = bucketAlarmEntity(voiceRandomContext = "cheer", bucketId = "cheer"),
            defaultManualText = "회의 자료 챙겨",
        )

        assertEquals("클립 문구", editor.voiceText)
    }

    @Test
    fun blankLastManualTextFallsBackToTheGenerativeChoice() {
        val editor = AlarmEditorState.from(
            alarm = null,
            defaultPlayMode = AlarmPlayModes.VOICE_ONLY,
            defaultRandomContext = "cheer",
            defaultManualText = "   ",
        )

        assertTrue(editor.voiceRandomPrompt)
        assertEquals("cheer", editor.voiceRandomContext)
    }

    @Test
    fun legacyBucketAlarmRecoversMessageContextFromItsBucket() {
        // 종류를 떨어뜨리던 시절에 저장된 행: bucketId 만 남아 있다.
        val editor = AlarmEditorState.from(
            alarm = bucketAlarmEntity(voiceRandomContext = null, bucketId = "fortune"),
        )

        assertEquals("wake_fortune", editor.voiceRandomContext)
    }

    @Test
    fun savedMessageContextWinsOverBucketDerivedOne() {
        val editor = AlarmEditorState.from(
            alarm = bucketAlarmEntity(voiceRandomContext = "cheer", bucketId = "fortune"),
        )

        assertEquals("cheer", editor.voiceRandomContext)
    }

    @Test
    fun selectVoiceProfileClearsStaleListenerTitleWhenVoiceChanges() {
        val editor = AlarmEditorState.from(alarm = null)
        editor.voiceProfileId = "old-profile"
        editor.voiceListenerTitleOverride = "old-listener"
        editor.ttsMessageId = "old-message"

        editor.selectVoiceProfile("new-profile")

        assertEquals("new-profile", editor.voiceProfileId)
        assertEquals("", editor.voiceListenerTitleOverride)
        assertNull(editor.ttsMessageId)
    }

    @Test
    fun stockClipAudioIsTrackedWithoutListenerTitle() {
        val editor = AlarmEditorState.from(alarm = null)
        editor.voiceListenerTitleOverride = "old-listener"

        editor.setStockClipAudio(
            audio = CachedAlarmAudio(
                localAudioUri = "file://stock.mp3",
                rawAudioUri = "r2://stock.mp3",
                displayName = "stock clip",
                durationMillis = null,
                cacheKey = "stock_message-1",
                messageId = "message-1",
            ),
            profileId = "system-profile",
            messageId = "message-1",
            text = "wake up",
        )

        assertEquals("", editor.voiceListenerTitleOverride)
        assertTrue(editor.hasSelectedStockClipAudio("system-profile", "wake up"))
        assertTrue(editor.hasFreshTtsAudio("system-profile", "wake up"))
    }

    @Test
    fun freshTtsAudioFallsBackToStoredListenerTitle() {
        val editor = AlarmEditorState.from(alarm = null)
        editor.voiceRandomPrompt = false
        editor.voiceCategory = "custom"
        editor.voiceLanguage = "ko"
        editor.voiceListenerTitleOverride = "kiddo"

        editor.setGeneratedTtsAudio(
            audio = CachedAlarmAudio(
                localAudioUri = "file://tts.mp3",
                rawAudioUri = "r2://tts.mp3",
                displayName = "tts",
                durationMillis = null,
                cacheKey = "tts-cache",
                messageId = "message-2",
            ),
            profileId = "profile-1",
            text = "wake up",
            messageId = "message-2",
            rawAudioUri = "r2://tts.mp3",
            listenerTitle = "kiddo",
        )

        assertTrue(editor.hasFreshTtsAudio("profile-1", "wake up"))
    }

    /**
     * **알람 전용 알람을 목소리로 바꾸면 직전 선택을 잇는다 — 빈 '직접 입력' 이 아니다.**
     *
     * 2026-09-29 실기기 보고: "알람 소리였던 거 목소리로 바꾸면 직접 입력으로 되어 있는데 …
     * 직접 입력 등록 안 돼 있으면 생성도 안 되고". 알람 전용 행은 저장 때 문구 필드를 전부
     * 비우므로(`toDraft` 의 alarmOnly 갈래) 열면 `voiceRandomPrompt=false`·문구 없음·테마 없음이다.
     * 그 모양이 곧 '직접 입력' 판정식이라, 목소리로 옮기는 순간 빈 직접 입력이 됐다.
     */
    @Test
    fun alarmOnlyAlarmSwitchedToVoiceTakesTheLastMessageKind() {
        val editor = AlarmEditorState.from(alarm = alarmOnlyEntity())
        // 출발점 — 문구가 하나도 없고, 그대로 두면 화면은 '직접 입력' 으로 읽는다.
        assertTrue(editor.hasNoMessageChoice())
        assertTrue(editor.isManualForDisplay())
        assertFalse(editor.followsLastMessageChoice)

        editor.playMode = AlarmPlayModes.VOICE_ONLY
        editor.enterVoiceModeFromAlarmOnly(lastMessageContext = "medication", lastManualText = null)

        assertEquals(VoiceSources.TTS_PROFILE, editor.voiceSource)
        assertFalse(editor.isManualForDisplay())
        assertTrue(editor.voiceRandomPrompt)
        assertEquals("medication", editor.voiceRandomContext)
        // 저장해도 그 종류가 남는다(직접 입력으로 떨어지지 않는다).
        assertEquals("medication", editor.toDraft().voiceRandomContext)
        // 기본 목소리 테마 이어받기도 이 세션에서는 켜진다(`AlarmEditorScreen` 의 `remembered`).
        assertTrue(editor.followsLastMessageChoice)
    }

    /** 한 번도 고른 적 없으면 **기본 인사말**(preset) — 빈 직접 입력이 아니다. */
    @Test
    fun alarmOnlyAlarmWithoutHistoryFallsBackToPresetGreeting() {
        val editor = AlarmEditorState.from(alarm = alarmOnlyEntity())

        editor.playMode = AlarmPlayModes.VOICE_ONLY
        editor.enterVoiceModeFromAlarmOnly(lastMessageContext = null, lastManualText = null)

        assertFalse(editor.isManualForDisplay())
        assertTrue(editor.voiceRandomPrompt)
        assertEquals(DefaultRandomPromptContext, editor.voiceRandomContext)
        assertEquals(DefaultRandomPromptContext, editor.toDraft().voiceRandomContext)
    }

    /**
     * 마지막이 직접 입력이었으면 **문구까지** 잇는다 — 새 알람과 같은 규칙이다.
     * 글자가 같아 폰에 있는 음성을 재사용하므로 서버 호출도 한도 차감도 없다.
     * 빈 칸으로 두는 것만 안 된다.
     */
    @Test
    fun alarmOnlyAlarmTakesTheLastManualTextWhenThatWasTheLastChoice() {
        val editor = AlarmEditorState.from(alarm = alarmOnlyEntity())

        editor.playMode = AlarmPlayModes.VOICE_ONLY
        editor.enterVoiceModeFromAlarmOnly(lastMessageContext = null, lastManualText = "회의 자료 챙겨")

        assertTrue(editor.isManualForDisplay())
        assertTrue(editor.hasTypedManualText())
        assertEquals("회의 자료 챙겨", editor.voiceText)
        assertEquals("회의 자료 챙겨", editor.toDraft().voiceText)
    }

    /** 빈 직접 입력 기록(공백)은 없는 것으로 본다 — 그걸 이으면 다시 빈 직접 입력이다. */
    @Test
    fun blankLastManualTextIsNotAdopted() {
        val editor = AlarmEditorState.from(alarm = alarmOnlyEntity())

        editor.playMode = AlarmPlayModes.VOICE_ONLY
        editor.enterVoiceModeFromAlarmOnly(lastMessageContext = "cheer", lastManualText = "   ")

        assertTrue(editor.voiceRandomPrompt)
        assertEquals("cheer", editor.voiceRandomContext)
    }

    /**
     * 새 알람을 '알람' 으로 열었다가(로그인 전 등) 목소리로 옮겨도 **처음 이어받은 값**
     * 그대로다 — 이어받기는 문구가 비어 있을 때만 돈다.
     */
    @Test
    fun newAlarmStartedInAlarmModeKeepsItsInheritedKindWhenSwitchedToVoice() {
        val editor = AlarmEditorState.from(
            alarm = null,
            defaultPlayMode = AlarmPlayModes.ALARM_ONLY,
            defaultRandomContext = "cheer",
        )
        assertTrue(editor.followsLastMessageChoice)

        editor.playMode = AlarmPlayModes.VOICE_ONLY
        assertFalse(editor.adoptLastMessageChoiceIfUnset(lastMessageContext = "cheer", lastManualText = null))
        editor.enterVoiceModeFromAlarmOnly(lastMessageContext = "cheer", lastManualText = null)

        assertFalse(editor.isManualForDisplay())
        assertEquals("cheer", editor.voiceRandomContext)
    }

    /**
     * **이미 고른 문구는 절대 덮지 않는다.** 목소리 알람을 '알람' 으로 바꿨다가 되돌리면
     * 그 알람의 테마·직접 입력이 그대로여야 한다(열기만 해도 문구가 바뀌면 안 된다는 규칙).
     */
    @Test
    fun switchingBackToVoiceNeverOverridesAnExistingChoice() {
        val bucketEditor = AlarmEditorState.from(
            alarm = bucketAlarmEntity(voiceRandomContext = "cheer", bucketId = "cheer"),
        )
        bucketEditor.playMode = AlarmPlayModes.ALARM_ONLY
        bucketEditor.playMode = AlarmPlayModes.VOICE_ONLY
        bucketEditor.enterVoiceModeFromAlarmOnly(lastMessageContext = "medication", lastManualText = "딴 문구")
        assertEquals("cheer", bucketEditor.selectedBucket)
        assertEquals("cheer", bucketEditor.voiceRandomContext)
        assertEquals("클립 문구", bucketEditor.voiceText)
        assertFalse(bucketEditor.followsLastMessageChoice)

        val manualEditor = AlarmEditorState.from(alarm = null, defaultPlayMode = AlarmPlayModes.VOICE_ONLY)
        manualEditor.voiceRandomPrompt = false
        manualEditor.voiceText = "내가 친 문구"
        manualEditor.playMode = AlarmPlayModes.ALARM_ONLY
        manualEditor.playMode = AlarmPlayModes.VOICE_ONLY
        manualEditor.enterVoiceModeFromAlarmOnly(lastMessageContext = "medication", lastManualText = null)
        assertFalse(manualEditor.voiceRandomPrompt)
        assertEquals("내가 친 문구", manualEditor.voiceText)
    }

    /**
     * **'알람' → '목소리' 스위치가 실제로 잇기까지 닿는가** — 편집기 스위치가 부르는 함수 그대로
     * (`AlarmEditorScreen.applyAlarmOutput` → `AlarmEditorState.applyAlarmOutput`).
     * 목소리 → 목소리(알람음 스위치만 만짐)는 잇지 않는다 — 알람에서 올 때만이다.
     */
    @Test
    fun voiceSwitchFromAlarmOnlyAdoptsThroughTheEditorSwitch() {
        val editor = AlarmEditorState.from(alarm = alarmOnlyEntity())

        editor.applyAlarmOutput(
            voice = true,
            sound = false,
            signedIn = true,
            lastMessageContext = "medication",
            lastManualText = null,
        )

        assertEquals(AlarmPlayModes.VOICE_ONLY, editor.playMode)
        assertEquals(VoiceSources.TTS_PROFILE, editor.voiceSource)
        assertTrue(editor.voiceRandomPrompt)
        assertEquals("medication", editor.voiceRandomContext)
        assertTrue(editor.followsLastMessageChoice)

        // 이미 목소리인 알람에서 알람음 스위치만 만지면 잇기를 타지 않는다.
        val voiceEditor = AlarmEditorState.from(
            alarm = alarmOnlyEntity().copy(playMode = AlarmPlayModes.VOICE_ONLY, voiceSource = VoiceSources.TTS_PROFILE),
        )
        voiceEditor.applyAlarmOutput(
            voice = true,
            sound = true,
            signedIn = true,
            lastMessageContext = "medication",
            lastManualText = null,
        )
        assertFalse(voiceEditor.followsLastMessageChoice)
        assertFalse(voiceEditor.voiceRandomPrompt)
    }

    /**
     * **직접 녹음 알람도 문구가 없다** — 목소리로 옮길 때 같은 이어받기를 탄다
     * (`VoiceAudioCard` 가 부르는 `AlarmEditorState.selectTtsVoice`).
     */
    @Test
    fun recordingAlarmMovedToTtsVoiceTakesTheLastMessageKind() {
        val editor = AlarmEditorState.from(
            alarm = alarmOnlyEntity().copy(
                playMode = AlarmPlayModes.VOICE_ONLY,
                localAudioUri = "file://recording.m4a",
                audioCacheKey = "recording",
            ),
        )
        assertEquals(VoiceSources.LOCAL_AUDIO, editor.voiceSource)

        editor.selectTtsVoice("clone-profile", lastMessageContext = "wake_fortune", lastManualText = null)

        assertEquals(VoiceSources.TTS_PROFILE, editor.voiceSource)
        assertFalse(editor.isManualForDisplay())
        assertEquals("wake_fortune", editor.voiceRandomContext)
        assertTrue(editor.followsLastMessageChoice)
    }

    /**
     * 녹음 알람 → **기본 목소리**로 옮겨도 직전 **직접 입력 문구**가 살아남는다 — 잇기가
     * `selectVoiceProfile`(기본 목소리면 문구를 비운다) **뒤**에 돌기 때문이다.
     */
    @Test
    fun recordingAlarmMovedToSystemVoiceKeepsTheAdoptedManualText() {
        val editor = AlarmEditorState.from(
            alarm = alarmOnlyEntity().copy(playMode = AlarmPlayModes.VOICE_ONLY),
        )

        editor.selectTtsVoice(systemVoiceB, lastMessageContext = "cheer", lastManualText = "회의 자료 챙겨")

        assertEquals("회의 자료 챙겨", editor.voiceText)
        assertFalse(editor.voiceRandomPrompt)
    }

    /**
     * **자동 선택된 기본 목소리가 이은 직접 입력 문구를 지우지 않는다**(2026-09-29 리뷰).
     * 알람 전용 알람은 목소리가 비어 저장되므로(`toDraft`), '목소리' 로 바꾸면 직전 직접 입력
     * 문구를 이은 **뒤에** 편집기가 마지막에 쓴 목소리를 고른다. 그게 기본 목소리일 때
     * `selectVoiceProfile` 의 기본 목소리 갈래가 문구를 비우면, 스톡 클립 효과가 그 자리에
     * 테마를 붙여 이은 문구가 말없이 사라졌다(유료의 `manualChosen` 가드는 빈 문구를 못 본다).
     */
    @Test
    fun preselectedSystemVoiceKeepsTheAdoptedManualText() {
        val editor = AlarmEditorState.from(alarm = alarmOnlyEntity())
        editor.applyAlarmOutput(
            voice = true,
            sound = false,
            signedIn = true,
            lastMessageContext = "cheer",
            lastManualText = "회의 자료 챙겨",
        )
        assertNull(editor.voiceProfileId)

        // 기본 목소리 선택 `LaunchedEffect` 가 부르는 그대로.
        editor.preselectVoiceProfile(systemVoiceA)

        assertEquals(systemVoiceA, editor.voiceProfileId)
        assertEquals("회의 자료 챙겨", editor.voiceText)
        assertTrue(editor.hasTypedManualText())

        // 사용자가 기본 목소리로 **바꾸는** 것은 예전 그대로 문구를 비운다 — 목소리 시트가
        // "직접 입력한 문구는 사라져요" 를 확인받은 교체다(`VoiceAudioCard` 의 `losesManualText`).
        editor.selectTtsVoice(systemVoiceB, lastMessageContext = null, lastManualText = null)
        assertEquals("", editor.voiceText)
    }

    /**
     * **테마가 있던 알람은 직접 녹음을 거쳐 다른 기본 목소리로 가도 자기 테마를 지킨다**
     * (2026-09-29 리뷰). 잇기 판정을 `selectVoiceProfile` **뒤**에 하면, 기본 목소리 교체가
     * 테마·랜덤·문구를 비운 상태를 '문구 없음' 으로 읽어 계정의 직전 선택으로 덮었다 —
     * 유료 사용자의 직전 선택이 직접 입력이면 날씨 테마 알람이 **직접 입력 + 새 목소리**가
     * 돼, 폰에 없는 음성이라 저장 때 서버를 부르고 한도가 깎였다.
     */
    @Test
    fun themeAlarmPassingThroughRecordingKeepsItsThemeOnAnotherSystemVoice() {
        val editor = AlarmEditorState.from(
            alarm = bucketAlarmEntity(voiceRandomContext = "wake_weather", bucketId = "weather")
                .copy(voiceProfileId = systemVoiceA),
        )
        // 목소리 행에서 '직접 녹음' 을 골랐다(`VoiceAudioCard` 의 LOCAL_AUDIO 갈래) — 테마는 남는다.
        editor.clearAudio()
        editor.voiceSource = VoiceSources.LOCAL_AUDIO
        editor.clearTtsMeta()

        editor.selectTtsVoice(systemVoiceB, lastMessageContext = "medication", lastManualText = "딴 문구")

        // 기본 목소리 교체가 비운 뒤 편집기가 이 종류로 **같은 테마**를 다시 붙인다.
        assertEquals("wake_weather", editor.voiceRandomContext)
        assertFalse(editor.followsLastMessageChoice)
        assertEquals("", editor.voiceText)
        assertFalse(editor.voiceRandomPrompt)
    }

    /**
     * 관문 1/3 은 **바뀔 값**으로 판정한다 — 녹음 알람을 아직 클립이 없는 등록 목소리로
     * 옮기면, 잇기가 켤 종류(운세)로 막고 준비 화면으로 보낸다. 지금 값(랜덤 꺼짐)으로
     * 물으면 통과시킨 직후 클립이 필요한 상태가 됐다.
     */
    @Test
    fun voicePickGateSeesTheKindThatWillBeAdopted() {
        val gate = ClipGate(
            stockClips = emptyList(),
            expectedVariants = com.alarmtalk.app.network.ExpectedVariantCounts(clone = mapOf("fortune" to 3)),
            appVoiceLanguage = "ko",
        )
        val recording = AlarmEditorState.from(alarm = alarmOnlyEntity().copy(playMode = AlarmPlayModes.VOICE_ONLY))

        assertTrue(
            needsClipPreparationForVoicePick(gate, recording, cloneVoice, "wake_fortune", null),
        )
        // 직접 입력 문구를 잇게 되면 클립이 필요 없다.
        assertFalse(
            needsClipPreparationForVoicePick(gate, recording, cloneVoice, "wake_fortune", "회의 자료 챙겨"),
        )
        // 이미 목소리 갈래면 잇기가 없다 — 지금 값(직접 입력)대로다.
        recording.voiceSource = VoiceSources.TTS_PROFILE
        assertFalse(
            needsClipPreparationForVoicePick(gate, recording, cloneVoice, "wake_fortune", null),
        )
    }

    /**
     * **빈 직접 입력은 서버를 부르기 전에 막고, 그 이유를 제대로 말한다.**
     *
     * 이 판정은 저장 버튼이 `saveEditor()`(한도 조회·`/tts/generate`) **전에** 본다.
     * 예전에는 같은 상태를 `MESSAGE_PREPARING`("목소리 파일을 아직 받는 중이에요") 으로
     * 말해서, 기다려도 안 풀리는 상태를 기다리게 했다.
     */
    @Test
    fun emptyManualMessageIsBlockedWithItsOwnReason() {
        val editor = AlarmEditorState.from(alarm = alarmOnlyEntity())
        editor.playMode = AlarmPlayModes.VOICE_ONLY
        editor.voiceSource = VoiceSources.TTS_PROFILE
        editor.voiceProfileId = "clone-profile"

        // 등록(클론) 목소리 + 빈 직접 입력 → 전용 사유.
        assertEquals(SaveBlockReason.MANUAL_TEXT_MISSING, emptyMessageBlockReason(editor, usesStockClips = false))
        // 스톡 클립 목소리의 빈 문구는 클립이 붙기 전 과도기다 — 그대로 '준비 중'.
        assertEquals(SaveBlockReason.MESSAGE_PREPARING, emptyMessageBlockReason(editor, usesStockClips = true))

        // 문구가 있으면 막지 않는다.
        editor.voiceText = "일어나"
        assertNull(emptyMessageBlockReason(editor, usesStockClips = false))

        // 생성형 종류를 골랐으면 막지 않는다(음원은 저장이 테마로 묶는다).
        editor.voiceText = ""
        editor.adoptLastMessageChoiceIfUnset(lastMessageContext = null, lastManualText = null)
        assertNull(emptyMessageBlockReason(editor, usesStockClips = false))
    }

    private val systemVoiceA = SYSTEM_VOICE_ID_PREFIX + "000000000101"
    private val systemVoiceB = SYSTEM_VOICE_ID_PREFIX + "000000000102"
    private val cloneVoice = "clone-profile"

    /** `toDraft` 가 알람 전용일 때 남기는 모양 그대로의 행 — 문구 필드가 전부 비어 있다. */
    private fun alarmOnlyEntity() = bucketAlarmEntity(voiceRandomContext = null, bucketId = "unused").copy(
        playMode = AlarmPlayModes.ALARM_ONLY,
        localAudioUri = null,
        audioCacheKey = null,
        rawAudioUri = null,
        voiceSource = VoiceSources.LOCAL_AUDIO,
        voiceProfileId = null,
        voiceText = null,
        voiceCategory = null,
        voiceLanguage = null,
        voiceRandomPrompt = false,
        voiceRandomContext = null,
        ttsMessageId = null,
        bucketId = null,
        bucketClipKeysJson = null,
    )

    /** 버킷 회전으로 저장된 알람 행. [voiceRandomContext] 만 바꿔 옛 행/새 행을 만든다. */
    private fun bucketAlarmEntity(voiceRandomContext: String?, bucketId: String) = AlarmEntity(
        id = "a",
        label = "bucket",
        hour = 7,
        minute = 0,
        fireAtMillis = 0L,
        repeatDaysMask = 0,
        holidayOff = false,
        snoozeEnabled = true,
        snoozeMinutes = 5,
        snoozeRepeatLimit = SnoozeRepeatLimits.THREE,
        snoozeCount = 0,
        vibrationPattern = VibrationPatterns.DEFAULT,
        playMode = AlarmPlayModes.VOICE_ONLY,
        defaultAlarmSoundId = DefaultAlarmSounds.BUNDLED_DEFAULT,
        localAudioUri = "file://clip0.mp3",
        audioCacheKey = "stock_clip-0",
        rawAudioUri = "r2://clip0.mp3",
        voiceSource = VoiceSources.TTS_PROFILE,
        voiceProfileId = "clone-profile",
        voiceListenerTitle = null,
        voiceText = "클립 문구",
        voiceCategory = "custom",
        voiceLanguage = "ko",
        // 버킷 알람의 특징 — 랜덤 생성은 꺼진 채 버킷 메타만 남는다.
        voiceRandomPrompt = false,
        voiceRandomContext = voiceRandomContext,
        voiceWeatherCountry = null,
        voiceWeatherCity = null,
        voiceFortuneGender = null,
        voiceFortuneBirthDate = null,
        voiceFortuneBirthTime = null,
        dynamicVoicePreparedForFireAtMillis = null,
        voiceRepeat = true,
        voiceVolumePercent = 100,
        ttsMessageId = "clip-0",
        bucketId = bucketId,
        bucketClipKeysJson = encodeBucketClipKeys(listOf("stock_clip-0", "stock_clip-1")),
        remoteAlarmId = null,
        lastSyncedAtMillis = null,
        syncState = AlarmSyncStates.LOCAL_ONLY,
        origin = AlarmOrigins.LOCAL_OWNED,
        alarmVolumePercent = 100,
        alarmSoundUri = null,
        alarmSoundLabel = null,
        enabled = true,
        state = AlarmStates.SCHEDULED,
        createdAtMillis = 0L,
        updatedAtMillis = 0L,
    )

    @Test
    // 번역을 없앤 뒤에도 **언어 축은 살아 있어야 한다** — 스톡 클립을 어느 언어로 고를지와
    // 캐시 키를 정하는 값이라, 같이 지우면 en·ja 기기에서 한국어 클립이 나온다.
    fun activeVoiceLanguageFollowsSupportedAppLanguage() {
        val editor = AlarmEditorState.from(alarm = null)
        editor.voiceRandomPrompt = false

        editor.voiceLanguage = "ja"

        assertEquals("ja", editor.activeVoiceLanguage())

        editor.voiceLanguage = "fr"

        assertEquals("ko", editor.activeVoiceLanguage())
    }
}
