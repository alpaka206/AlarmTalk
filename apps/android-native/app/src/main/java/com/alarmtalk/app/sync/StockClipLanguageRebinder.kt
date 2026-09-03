package com.alarmtalk.app.sync

import android.content.Context
import android.util.Base64
import com.alarmtalk.app.clonePrerenderBucketCategoryFor
import com.alarmtalk.app.data.AlarmAudioStore
import com.alarmtalk.app.data.AlarmDatabase
import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.VoiceSources
import com.alarmtalk.app.data.decodeBucketClipKeys
import com.alarmtalk.app.data.encodeBucketClipKeys
import com.alarmtalk.app.network.AlarmTalkApi
import com.alarmtalk.app.network.ExpectedVariantCounts
import com.alarmtalk.app.network.StockClip
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * **기기 언어를 바꾸면 이미 저장한 테마 알람도 그 언어로 말하게 한다.**
 *
 * 테마(무료 버킷) 알람은 저장하는 순간 그때 언어의 클립 키 목록으로 **고정된다**
 * (`AlarmEntity.bucketClipKeysJson`). 그래야 울릴 때 네트워크 없이도 순서대로 돌 수 있다.
 * 그런데 그 고정 때문에 시스템 언어를 한국어→영어로 바꿔도 **어제 만든 알람은 계속
 * 한국어로 울린다** — 앱 화면은 전부 영어인데 알람만 한국어라 어긋난다.
 *
 * 그래서 선다운로드가 새 언어분을 받아 둔 **직후에** 한 번, 언어가 어긋난 테마 알람을
 * 지금 언어의 같은 테마 클립으로 다시 묶는다.
 *
 * ⚠ **회전 인덱스는 건드리지 않는다.** 같은 테마의 같은 순번을 언어만 바꿔 이어가는
 * 것이라, 초기화하면 매번 첫 문구로 되돌아간다.
 *
 * ⚠ **대상은 테마 알람뿐이다.** 직접 입력·직접 녹음·유료 클론 알람은 건드리지 않는다 —
 * 사용자가 직접 친 문구를 언어가 바뀌었다고 갈아치우면 안 된다.
 *
 * ⚠ **그 언어에 클립이 없으면 그대로 둔다.** 지우면 소리가 사라진다. 옛 언어로라도
 * 울리는 편이 낫다.
 *
 * iOS 짝은 `StockClipLanguageRebinder.swift` 다 — **한쪽만 고치지 말 것.**
 */
object StockClipLanguageRebinder {

    /** 다시 묶은 알람 수. */
    // ⚠ **이름보다 하는 일이 넓다**(2026-09-03). 언어가 바뀐 알람뿐 아니라,
    //   같은 언어인데 **묶인 클립이 서버에서 사라진** 알람도 다시 묶는다.
    //   이름은 호출부 호환으로 남겨 두었다 — 조건을 언어 하나로 되돌리지 말 것.
    suspend fun rebindIfLanguageChanged(
        context: Context,
        api: AlarmTalkApi,
        auth: String,
        clips: List<StockClip>,
        language: String,
        expectedVariants: ExpectedVariantCounts? = null,
    ): Int = withContext(Dispatchers.IO) {
        if (clips.isEmpty()) return@withContext 0

        val alarmDao = AlarmDatabase.getInstance(context).alarmDao()
        val audioStore = AlarmAudioStore(context)

        // 지금 매니페스트에 살아 있는 클립 키. 알람이 들고 있는 키가 여기 없으면 그
        // 클립은 **서버에서 사라진 것**이다(문구 교체·목소리 교체로 프리셋을 새로 구우면
        // message id 가 새로 난다).
        val liveKeys = clips.map { "stock_${it.messageId}" }.toSet()

        val stale = alarmDao.getAllAlarms().filter {
            needsRebind(it, language, liveKeys) &&
                // ⚠ **갈아탈 세트가 완전할 때만 갈아탄다**(2026-09-03 리뷰 3차).
                //   아래 주석 참조 — 부분 세트를 박으면 영구히 굳는다.
                replacementIsComplete(it, clips, language, expectedVariants)
        }
        if (stale.isEmpty()) return@withContext 0

        var rebound = 0
        stale.forEach { alarm ->
            val bucket = alarm.bucketId ?: return@forEach
            val bound = bindBucket(api, auth, audioStore, clips, alarm, bucket, language)
                ?: return@forEach
            alarmDao.upsertPreservingServerSyncFields(bound)
            rebound++
        }
        rebound
    }

    /**
     * **라이브 랜덤 생성으로 저장된 옛 알람을 테마 클립에 다시 묶는다.**
     *
     * 그 알람들은 울릴 때마다 서버가 새 문장을 지어 주는 전제로 저장됐다
     * (`voiceRandomPrompt = true`, `bucketId` 없음). 라이브 생성을 걷어내면 그 전제가
     * 사라져 **마지막에 만들어진 한 문장만 매일 반복**되고, 시각만 바꾸려 열어도 편집기가
     * 되돌릴 방법이 없다 — 사용자 눈에는 "알람이 고장났다" 로 보인다.
     *
     * 그래서 고른 **문구 종류**(`voiceRandomContext`)를 같은 뜻의 테마로 옮겨 준다.
     * 매핑은 [clonePrerenderBucketCategoryFor] 를 **그대로 재사용**한다 — 편집기가 쓰는
     * 그 함수다. 여기에 다시 적으면 두 벌이 되고, 이 저장소가 반복해서 밟은 사고다.
     *
     * ⚠ **Room 마이그레이션으로는 못 한다.** `bucketId` 는 오프라인으로 채울 수 있지만
     * `bucketClipKeysJson` 이 가리키는 **파일은 받아야 생긴다.** 그래서 네트워크를 쓸 수 있는
     * 여기(선다운로드 직후)에 둔다.
     *
     * ⚠ **묶을 클립이 없으면 그대로 둔다.** 지우거나 `voiceRandomPrompt` 만 내리면 소리가
     * 사라진다 — 옛 문장이라도 울리는 편이 낫다. 다음 회차에 다시 시도한다(멱등).
     *
     * iOS 짝은 `StockClipLanguageRebinder.swift` 의 같은 함수다 — **한쪽만 고치지 말 것.**
     *
     * @return 다시 묶은 알람 수.
     */
    suspend fun rebindLiveGenerationRows(
        context: Context,
        api: AlarmTalkApi,
        auth: String,
        clips: List<StockClip>,
        language: String,
    ): Int = withContext(Dispatchers.IO) {
        if (clips.isEmpty()) return@withContext 0

        val alarmDao = AlarmDatabase.getInstance(context).alarmDao()
        val audioStore = AlarmAudioStore(context)

        val legacy = alarmDao.getAllAlarms().filter { alarm ->
            // ⚠ `bucketId` 가 **비어 있는** 것이 '옛 라이브 행' 의 표식이다. 테마 알람은
            // 저장할 때 `voiceRandomPrompt` 를 내리고 `bucketId` 를 적으므로 여기 안 걸린다.
            alarm.voiceRandomPrompt &&
                alarm.bucketId.isNullOrBlank() &&
                alarm.playMode != AlarmPlayModes.ALARM_ONLY &&
                alarm.voiceSource != VoiceSources.LOCAL_AUDIO
        }
        if (legacy.isEmpty()) return@withContext 0

        var rebound = 0
        legacy.forEach { alarm ->
            val bucket = clonePrerenderBucketCategoryFor(alarm.voiceRandomContext) ?: return@forEach
            val bound = bindBucket(api, auth, audioStore, clips, alarm, bucket, language)
                ?: return@forEach
            alarmDao.upsertPreservingServerSyncFields(
                bound.copy(
                    bucketId = bucket,
                    // ⚠ **랜덤을 내린다.** 안 내리면 다음 회차가 이 행을 또 옛 행으로 보고
                    // (위 술어) 매번 다시 묶으며, 편집기도 계속 '생성형' 으로 읽는다.
                    // 문구 **종류**(`voiceRandomContext`)는 그대로 둔다 — 편집기가 열 때
                    // 무엇을 골랐었는지 되짚는 값이다(CLAUDE.md 「일곱 자리」).
                    voiceRandomPrompt = false,
                ),
            )
            rebound++
        }
        rebound
    }

    /**
     * (알람·테마·언어)로 클립 세트를 받아 행에 묶을 값을 만든다. 묶을 수 없으면 null.
     *
     * ⚠ **두 재바인더가 이걸 공유한다.** 예전에는 언어 재바인딩에만 있던 코드인데, 옛 행
     * 재바인딩이 같은 일을 하므로 베끼지 않고 끌어냈다 — 베껴 두면 한쪽만 고치는 사고가 난다.
     * `bucketId`·`voiceRandomPrompt` 처럼 **갈래마다 다른 값은 호출자가** 얹는다.
     */

    /**
     * **이 알람을 다시 묶어야 하는가.**
     *
     * 판정이 둘이다. 어느 쪽이든 하나면 다시 묶는다:
     *  1. **앱 언어가 바뀌었다** — 이 함수의 원래 목적.
     *  2. **묶인 클립이 서버에서 사라졌다**(2026-09-03 리뷰). 발사는 저장된
     *     `stock_<id>` 키와 로컬 파일만 보고 **서버를 묻지 않는다** — 그래야 비행기모드
     *     에서도 울린다. 그래서 문구·목소리를 통째로 갈아 프리셋을 새로 구우면
     *     (message id 가 새로 난다) 그 알람은 **지워진 대사를 옛 목소리로 영원히
     *     재생한다.** 언어가 안 바뀌었으니 1번에도 안 걸린다.
     *
     * ⚠ **2번을 「하나라도 죽었으면」으로 넓히지 말 것.** 부분 세트는 정상 상태다 —
     *   시딩이 도는 중이거나 클립이 늘어난 직후에는 일부만 매니페스트에 있다. 그때
     *   다시 묶으면 매 회차 재바인딩이 돌아 네트워크를 낭비하고, 조건형(날씨·운세)은
     *   **아직 안 구워진 자리로 인덱스가 밀린다.** 전부 죽었을 때만 갈아탄다.
     */
    @JvmStatic
    internal fun needsRebind(
        alarm: AlarmEntity,
        language: String,
        liveKeys: Set<String>,
    ): Boolean {
        if (alarm.bucketId.isNullOrBlank()) return false
        if (alarm.playMode == AlarmPlayModes.ALARM_ONLY) return false
        if (alarm.voiceSource == VoiceSources.LOCAL_AUDIO) return false
        if ((alarm.voiceLanguage ?: "ko") != language) return true
        val bound = decodeBucketClipKeys(alarm.bucketClipKeysJson)
        return bound.isNotEmpty() && bound.none { it in liveKeys }
    }


    /**
     * **갈아탈 세트가 완전한가.**
     *
     * ⚠ 이게 없으면 [needsRebind] 가 **스스로 함정을 판다**(2026-09-03 리뷰 3차).
     *   #110·#111 이 옛 클립을 다 지운 직후, 시딩이 **첫 variant 만** 올린 순간을 생각해
     *   보자. 옛 키는 전부 죽었으니 `needsRebind` 는 true 를 돌려주고, `bindBucket` 은
     *   `firstOrNull()` 만 보므로 **그 하나짜리 세트를 알람에 박는다.** 그 키는 살아
     *   있으니 다음 회차부터는 stale 로도 안 잡힌다 — 시딩이 끝나도 그 알람은
     *   **영원히 첫 variant 만** 갖는다. 날씨·운세는 절대 인덱스로 조건을 고르므로
     *   그게 곧 **엉뚱한 조건의 클립**이다.
     *
     * 그래서 편집기 `freeBucketsFor` 와 **같은 규칙**을 쓴다: `expected_variants` 로
     * 0..N-1 이 다 있는지 본다. 매니페스트가 개수를 모르면(옛 서버) 막지 않는다 —
     * 못 물어본 것이 사용자를 막는 근거가 되면 안 된다.
     */
    internal fun replacementIsComplete(
        alarm: AlarmEntity,
        clips: List<StockClip>,
        language: String,
        expectedVariants: ExpectedVariantCounts?,
    ): Boolean {
        val bucket = alarm.bucketId ?: return false
        val variants = clips
            .filter {
                it.voiceProfileId == alarm.voiceProfileId &&
                    it.category == bucket &&
                    (it.language ?: "ko") == language
            }
            .map { it.variant }
            .toSet()
        if (variants.isEmpty()) return false
        val expected = expectedVariants?.countFor(
            bucket,
            isSystemVoice = com.alarmtalk.app.data.isSystemVoiceId(alarm.voiceProfileId),
        ) ?: return true
        if (expected <= 0) return true
        return variants == (0 until expected).toSet()
    }

    private suspend fun bindBucket(
        api: AlarmTalkApi,
        auth: String,
        audioStore: AlarmAudioStore,
        clips: List<StockClip>,
        alarm: AlarmEntity,
        bucket: String,
        language: String,
    ): AlarmEntity? {
        val target = clips
            .filter {
                it.voiceProfileId == alarm.voiceProfileId &&
                    it.category == bucket &&
                    (it.language ?: "ko") == language
            }
            .sortedBy { it.variant }
            // 편집기 `bindStockBucketClips` 와 같은 이유 — 중복 variant 가 있으면 매칭형
            // 버킷의 절대 인덱스가 밀려 엉뚱한 조건 클립이 재생된다.
            .distinctBy { it.variant }
        val first = target.firstOrNull() ?: return null

        val keys = mutableListOf<String>()
        val texts = mutableListOf<String>()
        target.forEach { clip ->
            val cacheKey = "stock_${clip.messageId}"
            val cached = audioStore.getCachedAudio(cacheKey, clip.audioUrl) ?: runCatching {
                val response = api.getTtsMessageAudio(auth, clip.messageId)
                audioStore.cacheGeneratedAudio(
                    bytes = Base64.decode(response.audioBase64, Base64.DEFAULT),
                    format = response.audioFormat,
                    rawAudioUri = response.audioUrl,
                    displayName = cacheKey,
                    cacheKey = cacheKey,
                    messageId = clip.messageId,
                )
            }.getOrNull() ?: return@forEach
            keys.add(cached.cacheKey ?: cacheKey)
            texts.add(clip.text)
        }
        if (keys.isEmpty()) return null

        val representative = audioStore.getCachedAudio(keys.first()) ?: return null
        return alarm.copy(
            bucketClipKeysJson = encodeBucketClipKeys(keys),
            bucketClipTextsJson = encodeBucketClipKeys(texts),
            audioCacheKey = representative.cacheKey ?: keys.first(),
            localAudioUri = representative.localAudioUri,
            voiceLanguage = language,
            voiceText = first.text,
            ttsMessageId = first.messageId,
            updatedAtMillis = System.currentTimeMillis(),
        )
    }
}
