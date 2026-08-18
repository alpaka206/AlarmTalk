package com.alarmtalk.app

import com.alarmtalk.app.data.isSystemVoiceId
import com.alarmtalk.app.network.ExpectedVariantCounts
import com.alarmtalk.app.network.StockClip

/**
 * **사전렌더 클립 관문** — "이 목소리로 이 문구 종류를 지금 고를 수 있는가".
 *
 * 편집기(`AlarmEditorScreen`)는 화면 상태로 이걸 만들어 쓰기만 한다. 판정을 컴포저블 밖에
 * 둔 이유는 둘이다: 테스트에서 부를 수 있어야 하고, **판정식이 한 벌뿐임을 파일 경계로
 * 못 박기** 위해서다.
 *
 * iOS 짝은 `AlarmEditorSheet.needsClipPreparation` 이고 같은 갈래·같은 순서다.
 */
internal data class ClipGate(
    val stockClips: List<StockClip>,
    val expectedVariants: ExpectedVariantCounts?,
    val appVoiceLanguage: String,
) {
    /**
     * (보이스·버킷)의 클립 언어 선택: 앱 언어 클립이 있으면 앱 언어(시스템 스톡 3개국),
     * 없으면 그 보이스가 가진 유일한 언어 = 클론을 만들 때 고른 언어를 그대로 쓴다.
     * 일본어로 만든 클론은 한국어 기기(공유받은 쪽 포함)에서도 일본어 클립을 소비한다.
     */
    fun bucketClipLanguageFor(category: String, profileId: String): String {
        val langs = stockClips.asSequence()
            .filter { it.voiceProfileId == profileId && it.category == category }
            .map { it.language ?: "ko" }
            .toSet()
        return if (appVoiceLanguage in langs) appVoiceLanguage else langs.firstOrNull() ?: appVoiceLanguage
    }

    /**
     * 클론 버킷이 '완전한지' 판정. 날씨/운세는 서버가 조건/테마 '절대 인덱스' 로 클립을
     * 고르므로 variant 0..N-1 이 **전부** 있어야 인덱스가 안 엉킨다(부분 세트면 엉뚱한
     * 조건이 재생된다).
     *
     * ⚠ 이건 **서버가 다 만들었는가**이지 **폰이 다 받았는가**가 아니다. 받는 쪽 진행률은
     * `ClipReadiness.evaluate` 가 캐시를 보고 따로 센다. 둘을 헷갈리지 말 것 — 관문은 앞의
     * 것을 보고, 준비 페이지는 뒤의 것을 보여 준다.
     */
    fun hasCompleteCloneBucket(category: String, profileId: String): Boolean {
        val clipLanguage = bucketClipLanguageFor(category, profileId)
        val variants = stockClips
            .filter {
                it.voiceProfileId == profileId &&
                    it.category == category &&
                    (it.language ?: "ko") == clipLanguage
            }
            .map { it.variant }
            .toSet()
        if (variants.isEmpty()) return false
        // ⚠ **개수를 앱에 박지 않는다.** 서버가 내려주는 값을 쓴다 — 운영이 시드를 늘리면
        // 앱 업데이트 없이 따라와야 한다. 그리고 **기본 목소리와 등록 목소리는 개수가 다르다**
        // (지금도 medication 이 2 vs 3) 이라 목소리 종류로 갈라 본다.
        // 서버가 안 알려주면(옛 서버) 완전성을 단정할 수 없으므로 '불완전' 으로 둔다.
        val fullCount = expectedVariants?.countFor(
            category = category,
            isSystemVoice = isSystemVoiceId(profileId),
        ) ?: return false
        if (fullCount <= 0) return false
        return variants == (0 until fullCount).toSet()
    }

    /**
     * **이 목소리로 이 문구 종류를 지금 고를 수 있는가.**
     *
     * ⚠ **이 판정식을 어디에도 베끼지 말 것. 부르는 자리가 셋이다**(전부 `AlarmEditorScreen`):
     *  1. 목소리 선택 — `VoiceAudioCard` 의 `onNeedsClipPreparation`
     *  2. **문구 종류 선택** — `applyRandomPromptSettings`
     *  3. **저장 직전** — `saveEditor`
     *
     * 2026-08-18 전에는 **1번에만** 있었다. 그래서 목소리를 고를 때는 통과했는데 그 뒤 문구
     * 종류를 바꾸면 아무도 안 막았다 — 종류마다 버킷 category 가 다르고
     * ([clonePrerenderBucketCategoryFor]), 서버 렌더는 category 단위로 끝나므로 **같은
     * 목소리가 종류에 따라 준비됐을 수도 아닐 수도 있다.** 특히 방금 공유받은 목소리가 그렇다.
     *
     * 지금은 그 상태로 저장까지 가도 라이브 생성으로 폴백해서 티가 안 난다. 라이브 생성을
     * 걷어내면(「알람 음성의 최종 목적지」) 그대로 **저장이 조용히 막히는 막다른 길**이 된다 —
     * 사유 문구를 없앴기 때문에 왜 안 되는지 말해 줄 자리도 없다. 그래서 세 자리 모두에서
     * 막고, 막을 때는 반드시 **준비 페이지로 보낸다**(막기만 하면 빠져나갈 길이 없다).
     *
     * 통과시키는 갈래:
     *  - 기본(시스템) 목소리 — 선다운로드 대상이라 여기서 막을 일이 아니다.
     *  - 랜덤 문구가 아님(직접 입력·녹음) — 클립이 필요 없다.
     *  - 매니페스트 미수신 — 못 물어본 것이 사용자를 막는 근거가 되면 안 된다.
     *  - 버킷으로 매핑되지 않는 종류.
     *
     * @param randomContext 정규화 전 값을 그대로 넘겨도 된다
     *   ([clonePrerenderBucketCategoryFor] 가 안에서 정규화한다).
     */
    fun needsClipPreparation(
        profileId: String,
        randomPrompt: Boolean,
        randomContext: String?,
    ): Boolean = when {
        isSystemVoiceId(profileId) -> false
        !randomPrompt -> false
        expectedVariants == null -> false
        else -> {
            val category = clonePrerenderBucketCategoryFor(randomContext)
            category != null && !hasCompleteCloneBucket(category, profileId)
        }
    }
}
