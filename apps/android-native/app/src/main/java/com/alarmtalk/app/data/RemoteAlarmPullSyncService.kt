package com.alarmtalk.app.data

import android.content.Context
import android.util.Base64
import android.util.Log
import com.alarmtalk.app.alarm.AlarmScheduler
import com.alarmtalk.app.alarm.SocialNotificationFactory
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.network.RemoteAlarm
import com.alarmtalk.app.network.AlarmTalkApi
import com.alarmtalk.app.network.AlarmTalkApiClient
import java.util.UUID
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class RemoteAlarmPullResult(
    val total: Int,
    val imported: Int,
    val updated: Int,
    val skipped: Int,
    val failed: Int,
)

internal class RemoteAlarmPullSyncService(
    private val alarmDao: AlarmDao,
    private val alarmScheduler: AlarmScheduler,
    private val alarmAudioStore: AlarmAudioStore,
    private val context: android.content.Context,
    // 현재 로그인 계정(=받은 알람의 수신자) id. 새로 임포트하는 받은 알람에 소유자로 기록해,
    // 무료 잠금/복원이 그 수신자에게만 스코프되게 한다(같은 기기에 다른 계정이 로그인해도 남의
    // 받은 알람을 복원·스케줄하지 못하게 함). 없으면(null) 레거시처럼 미기록으로 둔다.
    private val currentUserIdProvider: () -> String? = { null },
    /**
     * 지금 울리는(또는 리시버→서비스 인계 중인) 알람 id. 이 알람들은 pull 이 건드리지
     * 않는다 — 과거 시각을 살려 다시 예약하면 즉시 재발화한다(Codex #675 P1).
     */
    private val ringingAlarmIds: () -> Set<String> =
        { com.alarmtalk.app.alarm.RingingService.ringingOrHandingOffAlarmIds() },
    /**
     * 알람 행 + OS 예약을 바꾸는 구간을 **저장소의 다른 경로들과** 직렬화하는 락
     * (`AlarmRepository.restoreMutex` 를 그대로 받는다).
     *
     * [pullMutex] 는 pull 끼리만 막는다. 그런데 15분 주기 정합성 복원이 같은 행을 두고 이
     * pull 과 겹친다 — 복원이 행을 읽은 뒤 이 pull 이 그 알람을 끄거나 지우거나 시각을 옮기면,
     * 복원은 자기가 읽어 둔 옛 값으로 예약을 되심는다. 서버가 취소한 알람이 그대로 울린다
     * (Codex #666 P1).
     *
     * **네트워크는 이 락 밖에서 한다.** 목록 조회와 음성 다운로드까지 잡고 있으면 그동안
     * 스누즈·해제가 통째로 막힌다 — 알람 앱에서 그건 받아들일 수 없다. 그래서 이 파일은
     * '읽고 고치는 로컬 구간' 만 세 곳(중복 정리 / 반영 / prune) 따로 잡는다.
     */
    private val alarmMutationLock: Mutex = Mutex(),
) {
    // pull 이 동시에 두 번 돌면(FCM 수신 + 주기 sync 등) 둘 다 '기존 행 없음'으로 보고
    // 같은 받은 알람을 서로 다른 로컬 id 로 두 번 임포트한다(같은 시각 중복 울림).
    // 직렬화로 레이스를 제거한다.
    private val pullMutex = Mutex()

    private fun ownedByRecipient(alarm: AlarmEntity): Boolean =
        isOwnedByRecipient(alarm, currentUserIdProvider())

    suspend fun pullReceivedAlarms(
        api: AlarmTalkApi,
        token: String,
    ): RemoteAlarmPullResult {
        pullMutex.lock()
        try {
            return pullReceivedAlarmsLocked(api, token)
        } finally {
            pullMutex.unlock()
        }
    }

    private suspend fun pullReceivedAlarmsLocked(
        api: AlarmTalkApi,
        token: String,
    ): RemoteAlarmPullResult {
        val authorization = AlarmTalkApiClient.bearer(token)
        // 서버는 user_id IN (...) OR target_user_id IN (...) 로 이미 스코프해서 보내준다.
        // 그중 "내가 만든 게 아니라 누군가가 나를 target 으로 만든" 받은 알람만 가져온다 —
        // 판별은 서버가 뷰어의 두 식별자(PK·로그인 id)를 모두 담은 집합으로 계산한 is_received 를 쓴다.
        // 클라측 session.user.id 로 sender 를 직접 비교하면 계정 연동(PK≠google_id) 사용자의
        // '보낸 알람'을 '받은 알람'으로 오분류해 자기 기기에 예약해버린다(PR #536 P1).
        // 페이지네이션으로 전체 스냅샷을 모은다 — 1페이지만 받으면 알람이 많은 사용자는 받은 알람
        // 처리·prune 이 누락된다. 완전 스냅샷(snapshotComplete)일 때만 아래에서 prune 한다.
        val allRemote = mutableListOf<RemoteAlarm>()
        var offset = 0
        var reportedTotal = 0
        var snapshotComplete = false
        val pageSize = 100
        for (page in 0 until 25) {
            val resp = api.listAlarms(authorization, pageSize, offset)
            allRemote.addAll(resp.alarms)
            reportedTotal = resp.total ?: allRemote.size
            offset += resp.alarms.size
            if (resp.alarms.size < pageSize || allRemote.size >= reportedTotal) {
                snapshotComplete = true
                break
            }
        }
        val remoteAlarms = allRemote.filter { it.isReceived }

        var imported = 0
        var updated = 0
        var skipped = 0
        var failed = 0

        remoteAlarms.forEach { remote ->
            runCatching {
                // 과거 동시 pull 레이스로 같은 서버 알람이 여러 로컬 행으로 임포트됐다면
                // 가장 오래된 행만 남기고 나머지를 정리한다(같은 시각 중복 울림 자가 치유).
                // 행 삭제 + 예약 취소라 [alarmMutationLock] 안에서 한다.
                // 울리는 중이면 헛일이므로 먼저 걸러 낸다. 다만 **이건 1차 거르기일 뿐이다** —
                // 아래 buildLocalAlarm 이 음성 다운로드로 대기하는 사이에 울리기 시작할 수
                // 있어, 진짜 판단은 반영 직전에 한 번 더 한다(Codex #675 P1).
                if (alarmDao.getAllByRemoteAlarmId(remote.id)
                        .any { it.id in ringingAlarmIds() }
                ) {
                    skipped += 1
                    return@runCatching
                }

                val existing = alarmMutationLock.withLock {
                    val existingRows = alarmDao.getAllByRemoteAlarmId(remote.id)
                    existingRows.drop(1).forEach { duplicate ->
                        alarmScheduler.cancel(duplicate.id)
                        val duplicateCacheKey = duplicate.audioCacheKey
                        alarmDao.delete(duplicate)
                        alarmAudioStore.deleteCachedAudioIfUnreferenced(alarmDao, duplicateCacheKey)
                        Log.i(TAG, "Removed duplicate received alarm row remoteId=${remote.id} localId=${duplicate.id}")
                    }
                    existingRows.firstOrNull()
                }
                // **락 밖에서 받는다** — 음성 다운로드는 오래 걸려서, 잡고 있으면 그동안
                // 스누즈·해제가 막힌다. 행을 만드는 일은 여기서 하지 않는다(아래 참조).
                val cachedAudio = fetchRemoteMessageAudio(
                    api = api,
                    authorization = authorization,
                    remote = remote,
                )

                // 실제로 저장한 행. 건너뛴 경우(삭제됨·울리는 중·형식 불량)는 null 로 남아
                // 아래 알림·집계를 건너뛴다.
                var applied: AlarmEntity? = null
                // 여기부터 반영 구간 — 전부 로컬 행 쓰기 + OS 예약이다. 정합성 복원이 이 사이에
                // 끼면 자기가 읽어 둔 옛 값으로 예약을 되심는다(Codex #666 P1).
                alarmMutationLock.withLock {
                    // **여기서 다시 읽는다.** 위 스냅샷(existing)은 음성 다운로드 **전** 값이라,
                    // 그 사이에 두 가지가 일어날 수 있다:
                    //  (a) 알람이 울리기 시작 → 과거 fireAtMillis 를 살려 재예약하면 즉시 재발화
                    //  (b) 수신자가 시각을 고쳐 저장(updateAlarm 은 이 락을 쓰지 않는다)
                    //      → 옛 값으로 덮어써서 방금 한 수정이 조용히 사라진다
                    // 둘 다 사용자가 못 일어나거나 고친 게 없어지는 결과라, 반영 직전의 행을
                    // 기준으로 다시 판단한다(Codex #675 P1).
                    val current = alarmDao.getAllByRemoteAlarmId(remote.id).firstOrNull()

                    // 대기 중에 **지워졌으면 되살리지 않는다.** 그대로 upsert 하면 사용자가
                    // 지운 알람이 다시 생겨 울린다(Codex #675 P1).
                    if (existing != null && current == null) {
                        skipped += 1
                        Log.i(TAG, "Skipped pull apply; row deleted during download remoteId=${remote.id}")
                        return@withLock
                    }
                    // 대기 중에 **울리기 시작했으면 건드리지 않는다.** 과거 fireAtMillis 를 살려
                    // 재예약하면 즉시 다시 울린다.
                    if (current != null && current.id in ringingAlarmIds()) {
                        skipped += 1
                        return@withLock
                    }

                    // **행은 여기서, 다시 읽은 값으로 만든다.** 예전에는 다운로드 전 스냅샷으로
                    // 미리 만들어 두고 달라진 필드만 골라 덮었는데, 그 목록에서 빠진 것이 네 번
                    // 나왔다(시각 → 끄기 → 스누즈 상태 → 볼륨·알람음). 무엇이 바뀌었는지 세는
                    // 대신, 만드는 입력 자체를 최신 행으로 바꾼다 — 그러면 수신자가 고칠 수 있는
                    // 값은 세어 볼 것 없이 전부 최신이다(Codex #675 P1).
                    // 네트워크는 이미 끝났으므로(cachedAudio) 이 호출은 락 안에서도 짧다.
                    val local = buildReceivedAlarmRow(
                        context = context,
                        remote = remote,
                        existing = current,
                        cachedAudio = cachedAudio,
                        currentUserId = currentUserIdProvider(),
                    ) ?: run {
                        skipped += 1
                        return@withLock
                    }

                    if (existing != null) {
                        alarmScheduler.cancel(existing.id)
                    }
                    // upsert 를 먼저. schedule 이 권한 부족 등으로 throw 해도 알람은
                    // 로컬 DB 에 남아 리스트에 표시되고, 권한 받은 뒤 reschedule 가능.
                    alarmDao.upsert(local)
                    // 받은 알람과 같은 시각에 내가 켜 둔 알람이 있으면 보낸 사람의 알람이 우선한다 —
                    // 같은 시각 두 알람이 서로의 울림을 끊는 것을 막고, 내 알람은 삭제 대신 끄기만
                    // 해서(리스트에 남음) 언제든 다시 켤 수 있게 한다.
                    if (local.enabled) {
                        alarmDao.getEnabledAtTime(local.hour, local.minute, excludeId = local.id)
                            .filter { it.remoteAlarmId != remote.id }
                            // 끄는 대상은 '이 수신자의' 알람만이다. 같은 기기에 남은 앞 계정 알람을
                            // 끄면 그 계정은 영영 모른 채 알람이 안 울린다 — 재예약은 enabled=1 만
                            // 훑으므로(getEnabledAlarms) 다시 로그인해도 되살아나지 않는다.
                            .filter { ownedByRecipient(it) }
                            .forEach { conflicting ->
                                alarmScheduler.cancel(conflicting.id)
                                alarmDao.upsert(
                                    conflicting.copy(
                                        enabled = false,
                                        updatedAtMillis = System.currentTimeMillis(),
                                    ),
                                )
                                Log.i(
                                    TAG,
                                    "Disabled same-time alarm id=${conflicting.id} in favor of received remoteId=${remote.id}",
                                )
                            }
                    }
                    // 받은 알람의 메시지(음성)가 새 캐시로 교체됐으면 이전 캐시는 미참조일 때만 정리.
                    val previousCacheKey = existing?.audioCacheKey
                    if (!previousCacheKey.isNullOrBlank() && previousCacheKey != local.audioCacheKey) {
                        alarmAudioStore.deleteCachedAudioIfUnreferenced(alarmDao, previousCacheKey)
                    }
                    if (local.enabled) {
                        runCatching { alarmScheduler.schedule(local) }
                            .onFailure { error ->
                                Log.w(TAG, "Saved received alarm but failed to schedule id=${local.id}", error)
                            }
                    }
                    applied = local
                }
                val saved = applied ?: return@runCatching
                if (existing == null) {
                    SocialNotificationFactory.notifyReceivedAlarm(
                        context = context,
                        alarmId = saved.id,
                        senderName = remote.senderName
                            ?.takeIf { it.isNotBlank() }
                            ?: remote.senderEmail,
                        time = "%02d:%02d".format(saved.hour, saved.minute),
                    )
                    imported += 1
                } else {
                    updated += 1
                }
            }.onFailure { error ->
                failed += 1
                AlarmTalkLog.reportError("Failed to pull received alarm remoteId=${remote.id}", error)
            }
        }

        // 서버 목록에서 빠진 받은 알람을 정리한다 — **수신자가 '그만받기' 한 경우만이다.**
        //
        // 발신자가 지웠다고 수신자 알람까지 지우지 않는다. 받은 뒤부터는 받는 사람 것이고
        // (시각도 수신자가 고칠 수 있다), 내가 기대고 자는 알람이 남의 조작으로 사라지면
        // 그날 못 일어난다. 그래서 decline 기록이 있는 것만 지운다.
        //
        // decline 게이트가 서버 목록에서 빼므로, 그만받기 한 알람은 이미 임포트한 기기에서도
        // 울리지 않도록 prune 한다.
        // 비교 기준은 전체(allRemote)가 아니라 '받은 것'(is_received) 하위집합의 id 다 — 구 네임스페이스
        // 버그로 '보낸 알람'을 RECEIVED_REMOTE 로 잘못 임포트한 기기에서, 그 행의 remoteAlarmId 는 여전히
        // allRemote(내 보낸 알람)에 있어 안 지워진다. 받은 집합 기준으로 비교해야 그 잔재까지 정리된다.
        // 단, 목록이 페이지네이션으로 잘렸으면(size < total) 오삭제 위험이 있어 건너뛴다(완전 스냅샷일 때만).
        var pruned = 0
        // 그만받기 한 알람만 지우기 위해 서버에 따로 묻는다. 실패하면(네트워크 등) **아무것도
        // 지우지 않는다** — 못 물어봤다고 남의 알람을 지우는 쪽으로 기울면 안 된다.
        val declinedRemoteIds = runCatching {
            // 페이지를 끝까지 받는다 — 한 페이지만 보고 지우면 뒤 페이지에 있는 그만받기
            // 알람이 계속 울린다. 페이지 상한은 서버가 100 으로 클램프한다.
            val collected = mutableSetOf<String>()
            var offset = 0
            while (true) {
                val page = api.getDeclinedAlarmIds(authorization, limit = 100, offset = offset)
                collected.addAll(page.alarmIds)
                if (!page.hasMore || page.alarmIds.isEmpty()) break
                offset += page.alarmIds.size
            }
            collected.toSet()
        }
            .onFailure { if (it is kotlin.coroutines.cancellation.CancellationException) throw it }
            .getOrNull()
        if (snapshotComplete && declinedRemoteIds != null) {
            val servedRemoteIds = remoteAlarms.map { it.id }.toSet()
            val allRemoteIds = allRemote.map { it.id }.toSet()
            // 서버가 취소한 알람을 지우고 예약을 내리는 구간 — 정합성 복원과 겹치면 복원이
            // 방금 지운 알람의 옛 예약을 되심어 **서버가 취소한 알람이 그대로 울린다**
            // (Codex #666 P1). 네트워크 없이 로컬만 만지므로 통째로 잡아도 짧다.
            alarmMutationLock.withLock {
                alarmDao.getAllAlarms()
                    .filter {
                        it.origin == AlarmOrigins.RECEIVED_REMOTE &&
                            // 서버 알람의 수신자는 한 명이라, 앞 계정이 받은 알람은 이 스냅샷에
                            // 없는 게 당연하다. 소유자를 안 보면 B 의 첫 완전 pull 이 A 가 받은
                            // 알람과 그 음성 캐시를 통째로 지운다.
                            ownedByRecipient(it) &&
                            !it.remoteAlarmId.isNullOrBlank() &&
                            it.remoteAlarmId !in servedRemoteIds &&
                            // 서버 목록에서 빠지는 이유는 셋이고, 하나만 남겨야 한다.
                            //  (a) 수신자가 그만받기 → 지운다(다른 기기에서도 지워져야 한다)
                            //  (b) 구 네임스페이스 버그로 **내가 보낸 알람**을 받은 것으로
                            //      잘못 임포트한 잔재 → 지운다. 그 행의 remoteAlarmId 는
                            //      전체 목록에는 있는데 '받은 것' 에는 없다. 생성자는 자기
                            //      알람을 decline 할 수 없어(resolveDeclineTarget 이 거부)
                            //      (a) 조건만 두면 이 잔재가 영영 남아 진짜 알람과 함께 울린다
                            //      (Codex #675 P2).
                            //  (c) 발신자가 삭제 → **남긴다.** 받은 뒤부터는 받는 사람 것이라,
                            //      내가 기대고 자는 알람이 남의 조작으로 사라지면 안 된다.
                            (
                                declinedRemoteIds.contains(it.remoteAlarmId) ||
                                    it.remoteAlarmId in allRemoteIds
                                )
                    }
                    .forEach { stale ->
                        alarmScheduler.cancel(stale.id)
                        val cacheKey = stale.audioCacheKey
                        alarmDao.delete(stale)
                        alarmAudioStore.deleteCachedAudioIfUnreferenced(alarmDao, cacheKey)
                        pruned += 1
                        Log.i(TAG, "Pruned received alarm no longer served by server remoteId=${stale.remoteAlarmId}")
                    }
            }
        }

        Log.i(
            TAG,
            "Remote alarm pull complete total=${remoteAlarms.size} imported=$imported updated=$updated skipped=$skipped failed=$failed pruned=$pruned",
        )
        return RemoteAlarmPullResult(
            total = remoteAlarms.size,
            imported = imported,
            updated = updated,
            skipped = skipped,
            failed = failed,
        )
    }

    /**
     * 받은 알람의 음성을 **미리** 확보한다 — 유일한 네트워크 구간이라 락 밖에서 돈다.
     *
     * 행을 만드는 일([buildReceivedAlarmRow])과 떼어 놓은 이유: 다운로드가 오래 걸리는 사이에
     * 수신자가 그 알람을 고칠 수 있어서, 행은 **반영 직전에 다시 읽은 값**으로 만들어야 한다.
     */
    private suspend fun fetchRemoteMessageAudio(
        api: AlarmTalkApi,
        authorization: String,
        remote: RemoteAlarm,
    ): CachedAlarmAudio? =
        if (shouldDownloadRemoteMessageAudio(remote)) {
            val messageId = remote.messageId?.trim().orEmpty()
            val cacheKey = "remote-message-$messageId"
            // 이미 받아 둔 음성이면 다시 받지 않는다. 이 pull 은 로그인마다·푸시마다 도는데,
            // 그때마다 같은 파일을 다시 내려받으면 재로그인 한 번에 받은 알람 수만큼 왕복이
            // 생긴다(생성 음성은 messageId 당 불변이라 다시 받을 이유가 없다).
            // 기본 목소리 프리페치(StockClipPrefetchWorker)는 이미 이렇게 하고 있었다.
            alarmAudioStore.getCachedAudio(cacheKey) ?: runCatching {
                val audio = api.getTtsMessageAudio(authorization, messageId)
                alarmAudioStore.cacheGeneratedAudio(
                    bytes = Base64.decode(audio.audioBase64, Base64.DEFAULT),
                    format = audio.audioFormat,
                    rawAudioUri = audio.audioUrl,
                    cacheKey = cacheKey,
                    messageId = messageId,
                )
            }.onFailure { error ->
                Log.w(TAG, "Failed to cache remote alarm audio remoteId=${remote.id} messageId=$messageId", error)
            }.getOrNull()
        } else {
            null
        }
}

/**
 * 받은 알람의 소유자(무료 잠금 스코프용). 새 행(existing==null)은 현재 수신자(currentUserId)를 기록하고,
 * 기존 행은 이미 기록된 소유자를 보존한다 — 없으면(레거시 null) 현재 수신자로 자가 치유한다. 이렇게
 * 하면 같은 기기에 다른 계정이 로그인해도 남의 받은 목소리 알람을 복원·스케줄하지 못한다.
 */
internal fun resolveReceivedOwner(existing: AlarmEntity?, currentUserId: String?): String? =
    existing?.ownerUserId ?: currentUserId

/**
 * 이 pull 이 건드려도 되는 행인가 — 지금 수신자 소유이거나 소유자 미기록(레거시)일 때만.
 *
 * pull 은 이 세션이 서버에서 받은 목록만 보고 로컬을 정리한다. 그런데 로컬 알람은 로그아웃해도
 * 남으므로(원본이 기기다), 같은 기기에 앞 계정의 행이 함께 있다. 서버 알람의 수신자는 한 명이라
 * 앞 계정이 받은 알람이 이 스냅샷에 없는 건 당연한데, 소유자를 안 보면 '서버에 없다 → 끄기/지우기'로
 * 오판해 남의 알람을 죽인다. 특히 끄기는 치명적이다 — 재예약은 enabled=1 만 훑으므로(getEnabledAlarms)
 * 주인이 다시 로그인해도 되살아나지 않는다. 판정 규칙은 AlarmRepository.observeAlarms 와 같다.
 */
internal fun isOwnedByRecipient(alarm: AlarmEntity, currentUserId: String?): Boolean {
    val currentUser = currentUserId?.takeIf { it.isNotBlank() }
    return alarm.ownerUserId == null || alarm.ownerUserId == currentUser
}

internal data class ReceivedLockState(val playMode: String, val preLockPlayMode: String?)

/**
 * 받은 알람 재구성 시 무료 잠금 상태를 보존한다. 이전에 무료로 잠긴(existing.preLockPlayMode 설정)
 * 받은 알람은 매 FCM/주기 pull 재구성 후에도 잠금(playMode=ALARM_ONLY)을 유지한다 — 안 그러면
 * 동기화가 원격 목소리 모드로 되돌려 무료 사용자가 유료 목소리를 다시 듣게 된다. 잠금 설정/해제는
 * 유료 여부(구독 응답)를 아는 앱 시작 로직(lock/unlockPaidAlarmTalks)이 관장하고, 동기화는
 * 그 상태를 덮어쓰지 않는다. 잠기지 않았으면 재구성된 원격 모드를 그대로 쓴다.
 *
 * 잠긴 경우 복원용 preLockPlayMode 는: 이번 재구성으로 목소리 모드가 산출되면(computed != ALARM_ONLY)
 * 그 최신 모드를 담아 재유료 시 정확히 복원되게 하고, 이번 pull 에서 오디오를 못 받아 사운드온리가
 * 됐으면(computed == ALARM_ONLY) 기존 preLockPlayMode 를 보존해 잠금 마커 유실을 막는다.
 */
internal fun resolveReceivedLockState(
    computedPlayMode: String,
    existing: AlarmEntity?,
): ReceivedLockState {
    val wasLocked = !existing?.preLockPlayMode.isNullOrBlank()
    if (!wasLocked) return ReceivedLockState(computedPlayMode, null)
    val restoreMode = if (computedPlayMode != AlarmPlayModes.ALARM_ONLY) {
        computedPlayMode
    } else {
        existing?.preLockPlayMode
    }
    return ReceivedLockState(AlarmPlayModes.ALARM_ONLY, restoreMode)
}

/** 받은 알람의 스케줄 — 시각·요일·스누즈. [resolveReceivedSchedule] 결과. */
internal data class ReceivedSchedule(
    val hour: Int,
    val minute: Int,
    val repeatDaysMask: Int,
    val snoozeMinutes: Int,
    /** 스누즈를 껐는지. 값(분)만 지키고 이 토글을 놓치면 다음 pull 이 다시 켠다. */
    val snoozeEnabled: Boolean,
    /** 공휴일에 건너뛸지. 마찬가지로 다음 pull 이 조용히 되돌리면 공휴일에 울린다. */
    val holidayOff: Boolean,
    /** null = 새로 받은 것이라 다시 계산해야 함. */
    val keptFireAtMillis: Long?,
)

/**
 * **받은 뒤부터는 받는 사람 것이다.**
 *
 * 보낸 알람은 한 번 보내면 못 바꾼다(발신자 수정 기능이 없다). 그래서 서버 값은 **처음 받을
 * 때의 씨앗**일 뿐이고, 그 뒤로는 수신자가 고친 시각·요일·스누즈가 이긴다.
 *
 * 예전에는 매 pull 이 서버 값으로 덮어써서, 수신자가 시각을 고치면 로컬에 저장된 뒤 1초 만에
 * 조용히 되돌아갔다 — 사용자는 고쳐 뒀다고 믿고 그 시각에 못 일어난다. 켜짐/꺼짐은 이미
 * 로컬을 존중하고 있었다([resolveReceivedRemoteEnabled]) — 같은 규칙을 스케줄에도 넓힌다.
 */
internal fun resolveReceivedSchedule(
    existing: AlarmEntity?,
    remoteHour: Int,
    remoteMinute: Int,
    remoteRepeatDaysMask: Int,
    remoteSnoozeMinutes: Int,
): ReceivedSchedule = if (existing?.origin == AlarmOrigins.RECEIVED_REMOTE) {
    ReceivedSchedule(
        hour = existing.hour,
        minute = existing.minute,
        repeatDaysMask = existing.repeatDaysMask,
        snoozeMinutes = existing.snoozeMinutes,
        snoozeEnabled = existing.snoozeEnabled,
        holidayOff = existing.holidayOff,
        keptFireAtMillis = existing.fireAtMillis,
    )
} else {
    ReceivedSchedule(
        hour = remoteHour,
        minute = remoteMinute,
        repeatDaysMask = remoteRepeatDaysMask,
        snoozeMinutes = remoteSnoozeMinutes,
        // 처음 받는 알람의 기본값 — 보낸 사람이 정하는 값이 아니라 앱 기본이다.
        snoozeEnabled = true,
        holidayOff = false,
        keptFireAtMillis = null,
    )
}

internal fun resolveReceivedRemoteEnabled(existing: AlarmEntity?, remoteIsActive: Boolean?): Boolean {
    val remoteEnabled = remoteIsActive != false
    return if (existing?.origin == AlarmOrigins.RECEIVED_REMOTE) {
        existing.enabled && remoteEnabled
    } else {
        remoteEnabled
    }
}

internal fun shouldDownloadRemoteMessageAudio(remote: RemoteAlarm): Boolean =
    !remote.messageId.isNullOrBlank() &&
        !remote.messageAudioUrl.isNullOrBlank()

/**
 * 서버가 보낸 알람 + **지금 로컬에 있는 행**으로 저장할 행을 만든다.
 *
 * `existing` 에서 가져오는 값(시각·볼륨·알람음·스누즈 설정·소유자 …)이 곧 '받은 뒤부터는
 * 수신자 것' 인 값들이다. 그래서 이 함수에는 **반영 직전에 다시 읽은 행**을 넘겨야 한다 —
 * 다운로드 전 스냅샷을 넘기면 그 사이의 편집이 조용히 되돌아간다. 필드를 하나씩 골라 덮던
 * 시절에는 빠뜨린 값이 네 번 나왔다(Codex #675).
 *
 * 네트워크가 없어(음성은 [RemoteAlarmPullSyncService.fetchRemoteMessageAudio] 가 미리 받아
 * 둔다) 반영 락 안에서 불러도 짧다.
 */
internal fun buildReceivedAlarmRow(
    context: Context,
    remote: RemoteAlarm,
    existing: AlarmEntity?,
    cachedAudio: CachedAlarmAudio?,
    currentUserId: String?,
    now: Long = System.currentTimeMillis(),
): AlarmEntity? {
    val time = parseTime(remote.time) ?: return null
    val repeatMask = repeatDaysToMask(remote.repeatDays.orEmpty())
    val enabled = resolveReceivedRemoteEnabled(existing, remote.isActive)
    val hasVoiceAudio = cachedAudio != null

    // 스누즈 '한 회차' 는 마감(fireAtMillis)·상태·누른 횟수가 한 묶음이라 따로 놀면 안 된다.
    // 마감만 지키고 state 를 SCHEDULED 로 되돌리면 정합성 복원이 이 알람을 다음 정규 발생으로
    // 밀어(SNOOZED 만 재계산에서 뺀다) 5분 뒤 울리기로 한 스누즈가 사라지고, 횟수를 0 으로
    // 되돌리면 같은 회차에서 스누즈 제한이 초기화된다(Codex #675 P1·P2).
    val keepSnoozeEpisode = enabled && existing != null && existing.state == AlarmStates.SNOOZED

    val schedule = resolveReceivedSchedule(
        existing = existing,
        remoteHour = time.first,
        remoteMinute = time.second,
        remoteRepeatDaysMask = repeatMask,
        remoteSnoozeMinutes = remote.snoozeMinutes ?: 5,
    )
    val fireAtMillis = schedule.keptFireAtMillis ?: AlarmTimeCalculator.nextFireAtMillis(
        hour = schedule.hour,
        minute = schedule.minute,
        repeatDaysMask = schedule.repeatDaysMask,
        holidayOff = schedule.holidayOff,
        nowMillis = now,
    )
    val computedPlayMode = when {
        cachedAudio == null -> AlarmPlayModes.ALARM_ONLY
        remote.wakeMode == "voice_only" -> AlarmPlayModes.VOICE_ONLY
        else -> AlarmPlayModes.ALARM_VOICE
    }
    val lockState = resolveReceivedLockState(computedPlayMode, existing)
    val label = receivedRemoteAlarmLabel(context, remote.senderName, remote.senderEmail)

    return AlarmEntity(
        id = existing?.id ?: UUID.randomUUID().toString(),
        label = label,
        hour = schedule.hour,
        minute = schedule.minute,
        fireAtMillis = fireAtMillis,
        repeatDaysMask = schedule.repeatDaysMask,
        // 수신자가 끈 스누즈·켜 둔 공휴일 건너뛰기도 지킨다 — 값만 지키고 토글을 놓치면
        // 다음 pull 이 스누즈를 다시 켜고 공휴일에도 울린다(Codex #675 P2).
        holidayOff = schedule.holidayOff,
        snoozeEnabled = schedule.snoozeEnabled,
        snoozeMinutes = schedule.snoozeMinutes,
        snoozeRepeatLimit = existing?.snoozeRepeatLimit ?: SnoozeRepeatLimits.THREE,
        snoozeCount = if (keepSnoozeEpisode) existing.snoozeCount else 0,
        vibrationPattern = remote.vibrationPattern ?: VibrationPatterns.DEFAULT,
        playMode = lockState.playMode,
        defaultAlarmSoundId = DefaultAlarmSounds.BUNDLED_DEFAULT,
        localAudioUri = cachedAudio?.localAudioUri,
        audioCacheKey = cachedAudio?.cacheKey,
        rawAudioUri = cachedAudio?.rawAudioUri,
        voiceSource = if (hasVoiceAudio) VoiceSources.SERVER_TTS else VoiceSources.LOCAL_AUDIO,
        voiceProfileId = remote.voiceProfileId.takeIf { hasVoiceAudio },
        voiceListenerTitle = null,
        voiceText = remote.messageText.takeIf { hasVoiceAudio },
        voiceCategory = remote.category.takeIf { hasVoiceAudio },
        voiceLanguage = null,
        voiceRandomPrompt = false,
        voiceRandomContext = null,
        voiceWeatherCountry = null,
        voiceWeatherCity = null,
        voiceFortuneGender = null,
        voiceFortuneBirthDate = null,
        voiceFortuneBirthTime = null,
        dynamicVoicePreparedForFireAtMillis = null,
        voiceRepeat = existing?.voiceRepeat ?: true,
        voiceVolumePercent = existing?.voiceVolumePercent ?: 100,
        ttsMessageId = remote.messageId?.trim()?.takeIf { hasVoiceAudio && it.isNotBlank() },
        // 받은 알람은 버킷 식별자만 보존(회전 클립은 미다운로드 → 대표 클립 단일 재생 폴백).
        bucketId = remote.bucketId?.trim()?.takeIf { hasVoiceAudio && it.isNotBlank() },
        remoteAlarmId = remote.id,
        lastSyncedAtMillis = now,
        syncState = AlarmSyncStates.SYNCED,
        origin = AlarmOrigins.RECEIVED_REMOTE,
        alarmVolumePercent = existing?.alarmVolumePercent ?: 100,
        alarmSoundUri = existing?.alarmSoundUri,
        alarmSoundLabel = existing?.alarmSoundLabel,
        alarmSoundEnabled = existing?.alarmSoundEnabled ?: true,
        enabled = enabled,
        state = when {
            !enabled -> AlarmStates.DISABLED
            keepSnoozeEpisode -> AlarmStates.SNOOZED
            else -> AlarmStates.SCHEDULED
        },
        createdAtMillis = existing?.createdAtMillis ?: now,
        updatedAtMillis = now,
        // 무료 잠금 상태·소유자를 재구성 시에도 보존한다(resolveReceivedLockState 참조).
        // 새 받은 알람은 현재 수신자를 소유자로 기록하고, 기존 행은 그 값을 보존한다.
        preLockPlayMode = lockState.preLockPlayMode,
        ownerUserId = resolveReceivedOwner(existing, currentUserId),
    )
}

private fun parseTime(value: String?): Pair<Int, Int>? {
    val parts = value?.split(':') ?: return null
    if (parts.size < 2) return null
    val hour = parts[0].toIntOrNull() ?: return null
    val minute = parts[1].toIntOrNull() ?: return null
    if (hour !in 0..23 || minute !in 0..59) return null
    return hour to minute
}

private fun repeatDaysToMask(days: List<Int>): Int =
    days.filter { it in 0..6 }.fold(0) { mask, day -> mask or (1 shl day) }
