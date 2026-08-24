package com.alarmtalk.app.sync

import android.content.Context
import android.util.Base64
import com.alarmtalk.app.clonePrerenderBucketCategoryFor
import com.alarmtalk.app.data.AlarmAudioStore
import com.alarmtalk.app.data.AlarmDatabase
import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.VoiceSources
import com.alarmtalk.app.data.encodeBucketClipKeys
import com.alarmtalk.app.network.AlarmTalkApi
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
    suspend fun rebindIfLanguageChanged(
        context: Context,
        api: AlarmTalkApi,
        auth: String,
        clips: List<StockClip>,
        language: String,
    ): Int = withContext(Dispatchers.IO) {
        if (clips.isEmpty()) return@withContext 0

        val alarmDao = AlarmDatabase.getInstance(context).alarmDao()
        val audioStore = AlarmAudioStore(context)

        val stale = alarmDao.getAllAlarms().filter { alarm ->
            !alarm.bucketId.isNullOrBlank() &&
                alarm.playMode != AlarmPlayModes.ALARM_ONLY &&
                alarm.voiceSource != VoiceSources.LOCAL_AUDIO &&
                (alarm.voiceLanguage ?: "ko") != language
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
