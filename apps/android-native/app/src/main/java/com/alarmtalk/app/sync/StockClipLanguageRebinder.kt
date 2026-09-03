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
import com.alarmtalk.app.data.nextLocalSyncState
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
        /** `GET /tts/stock-clips` 의 `legacy_bucket_hints` — messageId → 테마. */
        legacyHints: Map<String, String> = emptyMap(),
    ): Int = withContext(Dispatchers.IO) {
        if (clips.isEmpty()) return@withContext 0

        val alarmDao = AlarmDatabase.getInstance(context).alarmDao()
        val audioStore = AlarmAudioStore(context)

        // 지금 매니페스트에 살아 있는 클립 키. 알람이 들고 있는 키가 여기 없으면 그
        // 클립은 **서버에서 사라진 것**이다(문구 교체·목소리 교체로 프리셋을 새로 구우면
        // message id 가 새로 난다).
        val liveKeys = clips.map { "stock_${it.messageId}" }.toSet()

        val stale = alarmDao.getAllAlarms().filter {
            shouldRebind(it, language, liveKeys, clips, expectedVariants, legacyHints)
        }
        if (stale.isEmpty()) return@withContext 0

        var rebound = 0
        var conditionBucketRebound = false
        stale.forEach { alarm ->
            // ⚠ **묶을 때도 접은 이름을 쓴다**(2026-09-03 리뷰 5차). 지난 회차에
            //   `normalizedBucketId` 를 **완전성 검사에만** 넣었더니, 검사는 통과하는데
            //   `bindBucket` 이 여전히 옛 이름(`love`)으로 매니페스트를 뒤져 아무것도
            //   못 찾고 그 알람이 **영원히 건너뛰어졌다.** 이름을 접는 자리는 '판정' 이
            //   아니라 **'저장된 값을 읽는 모든 곳'** 이다.
            val bucket = resolvedBucketId(alarm, legacyHints) ?: return@forEach
            val bound = bindBucket(api, auth, audioStore, clips, alarm, bucket, language)
                ?: return@forEach
            // 접은 이름을 **행에도 적는다.** 안 적으면 다음 회차도, 편집기도, 서버 동기도
            // 계속 옛 이름을 읽는다 — 접기를 매번 다시 해야 하는 상태로 남는다.
            val next = applyClipFields(alarmDao, alarm, bound)?.copy(bucketId = bucket)
                ?: return@forEach
            // ⚠ **서버에도 올려야 끝난다**(2026-09-03 리뷰 6차). #110 은 지운 프리셋을
            //   가리키던 서버 알람을 `mode='sound-only'`, `message_id=NULL` 로 깎는다.
            //   여기서 로컬만 되살리고 `SYNCED` 를 그대로 두면 업로드 대상
            //   (`AlarmSyncService` 의 LOCAL_ONLY·DIRTY·FAILED)에 안 들어가 **영영 안
            //   올라간다** — 다른 기기나 재설치는 사용자가 직접 알람을 고칠 때까지 그
            //   깎인 알람을 계속 받는다. iOS 는 upsert 헬퍼가 이미 이걸 한다.
            alarmDao.upsertPreservingServerSyncFields(
                next.copy(syncState = next.nextLocalSyncState()),
            )
            if (bucket in com.alarmtalk.app.data.MatchingBucketIds) conditionBucketRebound = true
            rebound++
        }
        // ⚠ **조건형 버킷은 묶는 것만으로 끝나지 않는다**(2026-09-03 리뷰 6차와 같은 이유).
        //   날씨는 `contextVariantIndex` 가 없으면 발사 때 **마지막 '못 알아봤어요' 클립**으로
        //   떨어진다 — 지역이 저장돼 있고 인터넷도 되는데 그 안내가 나간다. 편집기 저장
        //   경로는 `ensureDynamicVoiceRefreshScheduled` 가 조건을 즉시 resolve 하는데,
        //   이 경로만 빠져 있었다. (운세는 발사 때 사주+날짜로 로컬에서 고르므로 무관하다.)
        if (conditionBucketRebound) {
            DynamicVoiceRefreshScheduler.ensurePeriodic(context)
            DynamicVoiceRefreshScheduler.runOnce(context)
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
        expectedVariants: ExpectedVariantCounts? = null,
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
        var convertedWeather = false
        legacy.forEach { alarm ->
            val bucket = clonePrerenderBucketCategoryFor(alarm.voiceRandomContext) ?: return@forEach
            // ⚠ **여기도 완전한 세트일 때만 옮긴다**(2026-09-03 리뷰 4차). 지난 회차에
            //   완전성 검사를 `rebindIfLanguageChanged` 에만 넣었는데, 이 경로는 옛
            //   라이브 행을 테마로 **바꾸면서 `voiceRandomPrompt` 를 내린다** — 한 번
            //   옮겨지면 위 술어(`voiceRandomPrompt && bucketId 비어 있음`)에 다시
            //   안 걸려 **영원히 그 부분 세트로 남는다.** 되돌릴 길이 더 좁다.
            if (!replacementIsComplete(
                    alarm.copy(bucketId = bucket), clips, language, expectedVariants,
                )
            ) {
                return@forEach
            }
            val bound = bindBucket(api, auth, audioStore, clips, alarm, bucket, language)
                ?: return@forEach
            val converted = (applyClipFields(alarmDao, alarm, bound) ?: return@forEach).copy(
                bucketId = bucket,
                // ⚠ **랜덤을 내린다.** 안 내리면 다음 회차가 이 행을 또 옛 행으로 보고
                // (위 술어) 매번 다시 묶으며, 편집기도 계속 '생성형' 으로 읽는다.
                // 문구 **종류**(`voiceRandomContext`)는 그대로 둔다 — 편집기가 열 때
                // 무엇을 골랐었는지 되짚는 값이다(CLAUDE.md 「일곱 자리」).
                voiceRandomPrompt = false,
            )
            // ⚠ 위 갈래와 같은 이유로 **서버에도 올린다**(2026-09-03 리뷰 6차).
            alarmDao.upsertPreservingServerSyncFields(
                converted.copy(syncState = converted.nextLocalSyncState()),
            )
            if (bucket == "weather") convertedWeather = true
            rebound++
        }
        // ⚠ **날씨는 옮기고 나서 조건을 받아 와야 한다**(2026-09-03 리뷰 6차).
        //   방금 만든 행은 `contextVariantIndex` 가 없는데, 날씨 버킷은 그 값이 없으면
        //   발사 때 **마지막 클립("인터넷이 안 돼 날씨를 못 알아봤어요")** 으로 폴백한다
        //   (`AlarmEntity.bucketVariantIndex`). 지역도 저장돼 있고 인터넷도 되는데 그
        //   안내가 나가는 것이다. 편집기에서 저장할 때는
        //   `AlarmRepository.ensureDynamicVoiceRefreshScheduled` 가 같은 일을 한다 —
        //   이 경로만 빠져 있었다.
        if (convertedWeather) {
            runCatching {
                DynamicVoiceRefreshScheduler.ensurePeriodic(context)
                DynamicVoiceRefreshScheduler.runOnce(context)
            }
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
    /**
     * **다시 묶어야 하고, 갈아탈 세트도 완전한가.**
     *
     * ⚠ **두 술어를 호출부에서 손으로 조립하지 말 것**(2026-09-03 리뷰 5차). 예전에는
     *   안드로이드가 `needsRebind(...) && replacementIsComplete(...)` 로 조립하고 iOS 는
     *   필터 안에서 인라인으로 썼는데, iOS 쪽이 **언어 불일치에서 먼저 return 해**
     *   완전성 검사를 건너뛰었다. 같은 규칙이 두 모양으로 적혀 있으면 한쪽만 어긋난 것을
     *   아무도 못 본다. 이제 **이름이 하나**고 iOS 짝도 같은 이름이다.
     *
     * 언어가 바뀐 갈래에도 완전성이 필요하다 — 시딩이 도는 중에 언어를 바꾸면
     * 부분 세트가 박히고, 그 키는 살아 있으니 **다시는 stale 로 안 잡힌다.**
     */
    @JvmStatic
    internal fun shouldRebind(
        alarm: AlarmEntity,
        language: String,
        liveKeys: Set<String>,
        clips: List<StockClip>,
        expectedVariants: ExpectedVariantCounts?,
        legacyHints: Map<String, String> = emptyMap(),
    ): Boolean =
        needsRebind(alarm, language, liveKeys, legacyHints) &&
            replacementIsComplete(alarm, clips, language, expectedVariants, legacyHints)

    /**
     * **이 알람의 테마가 무엇인가** — 저장된 값이 먼저, 없으면 서버가 준 힌트.
     *
     * `bucket_id` 를 행에 적기 전에 만들어진 옛 알람은 저장된 값이 없다. 그 알람은 재바인더
     * 두 갈래 어디에도 안 걸려 **영원히 옛 대사·옛 목소리**로 울었다(이름만 새 이름).
     * 무엇으로 갈아탈지는 서버가 안다 — 그 알람이 문 message 의 `category` 다
     * (`GET /tts/stock-clips` 의 `legacy_bucket_hints`).
     *
     * ⚠ **힌트를 알람 스냅샷에 미리 써넣지 말 것.** `canApplyClipFields` 가
     *   `fresh.bucketId == snapshot.bucketId` 를 비교하는데, 스냅샷만 채워 두면 DB 의
     *   null 과 달라져 **모든 적용이 거부된다.** 해석한 값은 따로 들고 다니다가
     *   쓰기 시점에 `copy(bucketId = …)` 로 한 번만 적는다.
     */
    @JvmStatic
    internal fun resolvedBucketId(
        alarm: AlarmEntity,
        legacyHints: Map<String, String> = emptyMap(),
    ): String? {
        normalizedBucketId(alarm.bucketId)?.let { return it }
        val messageId = alarm.ttsMessageId?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        return legacyHints[messageId]?.let { normalizedBucketId(it) }
    }

    @JvmStatic
    internal fun needsRebind(
        alarm: AlarmEntity,
        language: String,
        liveKeys: Set<String>,
        legacyHints: Map<String, String> = emptyMap(),
    ): Boolean {
        if (resolvedBucketId(alarm, legacyHints) == null) return false
        if (alarm.playMode == AlarmPlayModes.ALARM_ONLY) return false
        if (alarm.voiceSource == VoiceSources.LOCAL_AUDIO) return false
        val bound = decodeBucketClipKeys(alarm.bucketClipKeysJson)
        // ⚠ **조건형 버킷(날씨·운세)을 비켜 가지 않는다**(2026-09-03 사용자 지시).
        //   12·13차에는 여기서 그냥 건너뛰었다 — 받은 알람에는 `contextVariantIndex` 도
        //   사주도 없어서, 값 없이 전체 세트를 묶으면 날씨가 마지막 '못 알아봤어요' 클립으로
        //   떨어졌기 때문이다. 그런데 그러면 그 알람은 **영원히 옛 대사**로 남는다.
        //   조건은 **받는 사람 자신의 설정으로 채울 수 있다** — 지역도 사주도 이 기기에
        //   있다. 그래서 갈아탄 뒤 `DynamicVoiceRefreshScheduler` 로 조건을 즉시 해석한다
        //   (편집기 저장 경로가 하는 것과 같다). 운세는 발사 때 사주+날짜로 로컬에서 고르므로
        //   따로 할 일이 없다.
        // ① 앱 언어가 바뀌었다 — 이 함수의 원래 목적.
        if ((alarm.voiceLanguage ?: "ko") != language) return true
        // ③ **테마는 아는데 클립 목록이 없는 알람**(2026-09-03 리뷰 11차).
        //    받은 가족 알람이 그렇다 — 동기가 `bucketId` 와 대표 클립 하나만 적고
        //    `bucketClipKeysJson` 은 비운다(`RemoteAlarmPullSyncService`). 목록이 비어
        //    있어 ②에도 안 걸리므로, 그 대표 클립이 매니페스트에서 사라졌는지로 판정한다.
        if (bound.isEmpty()) {
            val messageId = alarm.ttsMessageId?.trim()?.takeIf { it.isNotEmpty() } ?: return false
            return "stock_$messageId" !in liveKeys
        }
        return bound.none { it in liveKeys }
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

    /**
     * **아직 갈아탈 알람이 남았는가** — 교체 미완료 차단 화면의 판정.
     *
     * [needsRebind] 로 묻는다([shouldRebind] 가 아니다). 세트가 아직 다 안 구워져서 못
     * 갈아탄 것도 **미완료**이기 때문이다 — 그 알람은 지금 옛 목소리로 운다.
     *
     * ⚠ **클립 목록이 비면 판정하지 않는다.** 매니페스트를 못 받은 회차를 '갈아탈 것이
     *   없다' 로 읽으면 네트워크가 죽은 것이 **교체 완료**로 기록된다.
     */
    suspend fun hasPendingReplacement(
        context: Context,
        clips: List<StockClip>,
        language: String,
        legacyHints: Map<String, String> = emptyMap(),
    ): Boolean = withContext(Dispatchers.IO) {
        if (clips.isEmpty()) return@withContext false
        val liveKeys = clips.map { "stock_${it.messageId}" }.toSet()
        AlarmDatabase.getInstance(context).alarmDao().getAllAlarms().any {
            needsRebind(it, language, liveKeys, legacyHints)
        }
    }

    /**
     * **교체가 끝났으면 옛 스톡 클립 파일을 지운다.**
     *
     * 순서가 안전장치다: **다 받고 → 다 묶고 → 그 다음에 지운다.** 아직 갈아탈 알람이
     * 남아 있으면(시딩이 도는 중이라 세트가 모자란 경우) **아무것도 지우지 않고** 다음
     * 회차로 미룬다 — 중간에 멈추면 지운 것이 없으므로 잃는 것도 없다(멱등).
     *
     * ⚠ **판정은 [needsRebind] 하나로 한다.** "죽은 키를 물고 있는 알람이 하나라도 있으면
     *   미룬다" 로 하면 **영영 안 지운다** — 어떤 알람은 갈아탈 방법이 없는데도 죽은 키를
     *   계속 들고 있기 때문이다. [needsRebind] 가 그런 행을 false 로 돌려주므로 막지 않고,
     *   그 행이 물고 있는 키는 아래 참조 집합에 들어가 **파일이 지워지지도 않는다.**
     *
     * ⚠ **[legacyHints] 를 여기에도 넘겨야 한다**(2026-09-03). 힌트가 있으면 버킷 없는 옛
     *   행도 갈아탈 수 있게 됐는데, 여기만 힌트 없이 물으면 [needsRebind] 가 그 행을 false
     *   로 돌려줘 **아직 갈아타지 않은 알람을 두고 파일을 지운다.** 같은 규칙을 두 곳에서
     *   서로 다르게 묻는 그 실수다.
     *
     * @return 지운 파일 수. 아직 때가 아니면 0.
     */
    suspend fun pruneReplacedStockAudio(
        context: Context,
        clips: List<StockClip>,
        language: String,
        expectedVariants: ExpectedVariantCounts? = null,
        legacyHints: Map<String, String> = emptyMap(),
    ): Int = withContext(Dispatchers.IO) {
        if (clips.isEmpty()) return@withContext 0
        val alarmDao = AlarmDatabase.getInstance(context).alarmDao()
        val alarms = alarmDao.getAllAlarms()
        val liveKeys = clips.map { "stock_${it.messageId}" }.toSet()

        // ① 아직 갈아탈 것이 남았으면 미룬다.
        val pending = alarms.any {
            shouldRebind(it, language, liveKeys, clips, expectedVariants, legacyHints)
        }
        if (pending) return@withContext 0
        // ② 세트가 모자라 못 갈아탄 알람이 있어도 미룬다 — 그 알람의 옛 클립은 아직 쓰인다.
        val waitingForSeed = alarms.any { needsRebind(it, language, liveKeys, legacyHints) }
        if (waitingForSeed) return@withContext 0

        // ③ 지금 알람들이 물고 있는 키는 전부 남긴다(여러 알람이 같은 클립을 공유한다).
        val referenced = mutableSetOf<String>()
        alarms.forEach { alarm ->
            referenced += decodeBucketClipKeys(alarm.bucketClipKeysJson)
            alarm.audioCacheKey?.takeIf { it.isNotBlank() }?.let { referenced += it }
        }
        AlarmAudioStore(context).pruneReplacedStockAudio(referenced, liveKeys)
    }

    /**
     * 저장된 버킷 id 를 **현재 이름**으로 접는다.
     *
     * ⚠ 기기에 저장된 알람은 이름이 바뀌기 전 값(`love`)을 그대로 들고 있다. 매니페스트는
     * 새 이름(`cheer`)만 담으므로, 접지 않고 맞추면 **아무것도 안 걸린다.**
     * 접기의 단일 출처는 `randomPromptContextForBucket` ↔ `clonePrerenderBucketCategoryFor`
     * 한 쌍이다 — 여기에 표를 새로 만들지 말 것.
     */
    internal fun normalizedBucketId(bucketId: String?): String? {
        val raw = bucketId?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        val context = com.alarmtalk.app.randomPromptContextForBucket(raw) ?: return raw
        return com.alarmtalk.app.clonePrerenderBucketCategoryFor(context) ?: raw
    }

    internal fun replacementIsComplete(
        alarm: AlarmEntity,
        clips: List<StockClip>,
        language: String,
        expectedVariants: ExpectedVariantCounts?,
        legacyHints: Map<String, String> = emptyMap(),
    ): Boolean {
        // ⚠ **저장된 옛 이름을 접고 나서 맞춘다**(2026-09-03 리뷰 4차). 기기에 `love` 로
        //   저장된 알람은 새 매니페스트(`cheer`)와 이름이 달라 **variant 가 0개로 잡히고**,
        //   그러면 이 함수가 영원히 false 라 언어 재바인딩까지 통째로 막힌다 —
        //   그 알람은 갈아탈 방법이 사라진다.
        // 저장된 값이 없는 옛 알람은 서버 힌트로 해석한다(`resolvedBucketId`).
        val bucket = resolvedBucketId(alarm, legacyHints) ?: return false
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

    /**
     * **다운로드 도중 사용자가 고친 것을 덮지 않는다**(2026-09-03 리뷰 8차).
     *
     * 이 워커는 알람을 스냅샷으로 읽고 나서 **여러 번 중단되며**(클립 N개 다운로드) 돌아온다.
     * 그 사이 사용자가 시각을 바꾸거나 알람을 끄면, 스냅샷을 통째로 쓰는 순간 그 편집이
     * 사라진다 — `upsertPreservingServerSyncFields` 는 **서버 발급 필드와 날씨 인덱스만**
     * 보존하므로 시각·요일·on/off 는 지켜 주지 않는다.
     *
     * 그래서 쓰기 직전에 **행을 다시 읽고, 클립에 관한 값만** 얹는다. 사용자 편집(시각·
     * 요일·스누즈·on/off)은 갓 읽은 행의 것이 그대로 남는다.
     *
     * ⚠ 다시 읽은 행이 **더 이상 이 버킷/목소리가 아니면 포기한다** — 그 사이 사용자가
     *   목소리나 테마를 바꾼 것이라, 우리가 받아 둔 클립은 이미 남의 것이다.
     *   행이 아예 사라졌으면(삭제) 역시 포기한다. 다음 회차가 다시 판단한다.
     *
     * ⚠ **문구 갈래(`voiceRandomPrompt`·`voiceRandomContext`)도 함께 본다**(2026-09-03
     *   리뷰 9차). 목소리·테마·소스만 보면 **옛 라이브 행 → 직접 입력** 전환을 못 잡는다:
     *   그 편집은 같은 목소리·같은 소스에 `bucketId` 도 여전히 null 이라 가드를 그대로
     *   통과하고, 우리가 사용자가 방금 친 문구를 **덮어쓴 뒤 테마 알람으로 되돌린다.**
     *   판정 축은 「이 알람이 어떤 종류의 문구를 쓰는가」 전부여야 한다.
     *
     * iOS 짝은 `StockClipLanguageRebinder.applyClipFields` 다 — **한쪽만 고치지 말 것.**
     */
    /**
     * **받아 둔 클립을 이 행에 얹어도 되는가** — 스냅샷과 갓 읽은 행이 같은 알람인가.
     *
     * ⚠ **판정 축은 「이 알람이 어떤 종류의 문구를 쓰는가」 전부다**(2026-09-03 리뷰 9차).
     *   목소리·테마·소스만 보면 **옛 라이브 행 → 직접 입력** 전환을 못 잡는다: 그 편집은
     *   같은 목소리·같은 소스에 `bucketId` 도 여전히 null 이라 통과해 버리고, 우리가
     *   사용자가 방금 친 문구를 덮어쓴 뒤 테마 알람으로 되돌린다.
     *
     * 조건을 호출부에서 손으로 조립하지 말 것 — 이름이 하나여야 iOS 와 대조할 수 있다.
     */
    @JvmStatic
    internal fun canApplyClipFields(snapshot: AlarmEntity, fresh: AlarmEntity): Boolean =
        fresh.voiceProfileId == snapshot.voiceProfileId &&
            fresh.bucketId == snapshot.bucketId &&
            fresh.voiceSource == snapshot.voiceSource &&
            fresh.voiceRandomPrompt == snapshot.voiceRandomPrompt &&
            fresh.voiceRandomContext == snapshot.voiceRandomContext

    private suspend fun applyClipFields(
        alarmDao: com.alarmtalk.app.data.AlarmDao,
        snapshot: AlarmEntity,
        bound: AlarmEntity,
    ): AlarmEntity? {
        val fresh = alarmDao.getById(snapshot.id) ?: return null
        if (!canApplyClipFields(snapshot, fresh)) return null
        return fresh.copy(
            bucketClipKeysJson = bound.bucketClipKeysJson,
            bucketClipTextsJson = bound.bucketClipTextsJson,
            audioCacheKey = bound.audioCacheKey,
            localAudioUri = bound.localAudioUri,
            voiceLanguage = bound.voiceLanguage,
            voiceText = bound.voiceText,
            ttsMessageId = bound.ttsMessageId,
            updatedAtMillis = System.currentTimeMillis(),
        )
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
            }.getOrNull()
            // ⚠ **하나라도 못 받으면 통째로 포기한다**(2026-09-03 리뷰 4차).
            //   예전에는 실패한 클립만 건너뛰고 나머지로 묶었는데, 그렇게 저장하면 그
            //   키들이 `liveKeys` 에 들어가 **다음 회차부터 stale 로 안 잡힌다** —
            //   일시적인 네트워크 실패 하나가 그 알람을 **영구히 부분 세트**로 만든다.
            //   지금 포기하면 다음 회차가 처음부터 다시 시도한다(알람은 옛 클립을 그대로
            //   들고 있으므로 그동안에도 소리는 난다).
                ?: return null
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
