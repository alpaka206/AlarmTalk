package com.alarmtalk.app.sync

import android.content.Context
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.data.AlarmAppContainer
import com.alarmtalk.app.data.UsageEventEntity
import com.alarmtalk.app.network.AlarmTalkApiClient
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.network.UsageEventBatchRequest
import com.alarmtalk.app.network.UsageEventPayload
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

/**
 * 쌓아 둔 사용 기록을 서버로 보낸다.
 *
 * ⚠ **보내는 일만 한다 — 적는 일은 `UsageEventRecorder` 가 한다.** 울림처럼 네트워크를
 * 부르면 안 되는 자리에서도 기록은 남아야 하므로 둘을 갈라 두었다(CLAUDE.md 「Real alarm」).
 *
 * 실패해도 큐를 비우지 않는다 — 성공한 배치만 지운다. 그래서 응답을 못 받으면 같은 배치를
 * 다시 보내는데, 서버가 클라 UUID 로 멱등 처리하므로 중복이 생기지 않는다.
 */
class UsageEventUploadWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val sessionStore = AuthSessionStore(applicationContext)
        // ⚠ 다른 워커와 같은 순서 — 세대를 세션보다 먼저 읽는다(A→B 전환 중이면 안전하게 실패).
        val startGeneration = sessionStore.sessionGeneration()
        val session = sessionStore.read() ?: return Result.success()
        val dao = AlarmAppContainer.database(applicationContext).usageEventDao()

        return runCatching {
            val api = AlarmTalkApiClient.create()
            val authorization = AlarmTalkApiClient.bearer(session.token)
            var sent = 0
            // 한 번의 실행에서 여러 배치를 보낸다 — 오래 오프라인이었으면 수백 건이 밀려 있다.
            repeat(MAX_BATCHES_PER_RUN) {
                val batch = dao.oldest(session.user.id, BATCH_SIZE)
                if (batch.isEmpty()) return@repeat
                if (sessionStore.sessionGeneration() != startGeneration) {
                    // 그 사이 계정이 바뀌었다 — 남은 큐는 다음 실행에서 **새 주인** 기준으로 보낸다.
                    Log.i(TAG, "Usage event upload stopped: session changed")
                    return@runCatching Result.success()
                }
                api.uploadUsageEvents(authorization, UsageEventBatchRequest(batch.map(::toPayload)))
                dao.deleteByIds(batch.map { it.id })
                sent += batch.size
            }
            if (sent > 0) Log.i(TAG, "Uploaded usage events count=$sent")
            Result.success()
        }.getOrElse { error ->
            // ⚠ **큐를 지우지 않는다.** 다음 기회에 그대로 다시 보낸다(서버가 멱등이다).
            AlarmTalkLog.reportError("Usage event upload failed", error)
            Result.retry()
        }
    }

    private fun toPayload(event: UsageEventEntity) = UsageEventPayload(
        id = event.id,
        type = event.type,
        occurredAt = iso8601(event.occurredAtMillis),
        alarmId = event.alarmId,
        voiceProfileId = event.voiceProfileId,
        messageId = event.messageId,
        detail = event.detail,
    )

    companion object {
        private const val BATCH_SIZE = 100
        private const val MAX_BATCHES_PER_RUN = 5
        private const val PERIODIC_WORK_NAME = "usage_event_periodic_upload"
        private const val ONE_TIME_WORK_NAME = "usage_event_immediate_upload"

        private val networkConstraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        /**
         * ⚠ **서버 스키마는 ISO-8601 오프셋을 요구한다**(`z.string().datetime({ offset: true })`).
         * 기기 로캘·시간대와 무관하게 UTC 로 굳혀 보낸다 — 로캘을 안 고정하면 아랍어 로캘에서
         * 아라비아-인도 숫자가 나와 서버가 통째로 400 을 낸다.
         */
        fun iso8601(millis: Long): String {
            val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
            format.timeZone = TimeZone.getTimeZone("UTC")
            return format.format(Date(millis))
        }

        /** 앱이 살아 있는 동안 주기적으로 — 오래 오프라인이었어도 언젠가는 올라간다. */
        fun ensurePeriodic(context: Context) {
            val request = PeriodicWorkRequestBuilder<UsageEventUploadWorker>(6, TimeUnit.HOURS)
                .setConstraints(networkConstraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(context.applicationContext).enqueueUniquePeriodicWork(
                PERIODIC_WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request,
            )
        }

        /** 연결이 돌아왔을 때·앱을 열었을 때 한 번. 이미 예약돼 있으면 그대로 둔다. */
        fun runOnce(context: Context) {
            val request = OneTimeWorkRequestBuilder<UsageEventUploadWorker>()
                .setConstraints(networkConstraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
                ONE_TIME_WORK_NAME,
                ExistingWorkPolicy.KEEP,
                request,
            )
        }
    }
}
