package com.alarmtalk.app.sync

import android.content.Context
import android.util.Base64
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
            val first = target.firstOrNull() ?: return@forEach

            val keys = mutableListOf<String>()
            val texts = mutableListOf<String>()
            target.forEach { clip ->
                val cacheKey = "stock_${clip.messageId}"
                val cached = audioStore.getCachedAudio(cacheKey) ?: runCatching {
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
            if (keys.isEmpty()) return@forEach

            val representative = audioStore.getCachedAudio(keys.first()) ?: return@forEach
            val updated: AlarmEntity = alarm.copy(
                bucketClipKeysJson = encodeBucketClipKeys(keys),
                bucketClipTextsJson = encodeBucketClipKeys(texts),
                audioCacheKey = representative.cacheKey ?: keys.first(),
                localAudioUri = representative.localAudioUri,
                voiceLanguage = language,
                voiceText = first.text,
                ttsMessageId = first.messageId,
                updatedAtMillis = System.currentTimeMillis(),
            )
            alarmDao.upsertPreservingServerSyncFields(updated)
            rebound++
        }
        rebound
    }
}
