package com.alarmtalk.app.data

import com.alarmtalk.app.network.RemoteAlarm
import com.alarmtalk.app.network.RemoteAlarmListResponse
import java.io.IOException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

/** 전체 커서 순회가 성공한 뒤에만 반환한다. 부분 목록으로 예약·ACK·prune하지 않는다. */
internal suspend fun collectRemoteAlarmPages(
    fetchPage: suspend (after: String?) -> RemoteAlarmListResponse,
): List<RemoteAlarm> {
    val latestById = linkedMapOf<String, RemoteAlarm>()
    val seenVersions = mutableMapOf<String, MutableSet<String>>()
    var cursor: String? = null
    var sequence = 0L
    while (true) {
        currentCoroutineContext().ensureActive()
        val page = fetchPage(cursor)
        currentCoroutineContext().ensureActive()
        val hasMore = page.hasMore ?: throw IOException("Missing alarm cursor contract")
        val pageIds = mutableSetOf<String>()
        for (alarm in page.alarms) {
            if (!pageIds.add(alarm.id)) throw IOException("Duplicate alarm in one page")
            val version = alarm.deliveryVersion?.takeIf { it.isNotBlank() }
            val versions = seenVersions.getOrPut(alarm.id) { mutableSetOf() }
            if (latestById.containsKey(alarm.id)) {
                if (version == null || version in versions) {
                    throw IOException("Repeated or regressed alarm delivery")
                }
                // 같은 id의 새 전달 세대는 마지막으로 읽은 순서로 수신 처리에 넘긴다.
                latestById.remove(alarm.id)
            }
            if (version != null) versions.add(version)
            latestById[alarm.id] = alarm
        }
        if (!hasMore) {
            if (page.nextCursor != null) throw IOException("Unexpected terminal alarm cursor")
            return latestById.values.toList()
        }
        val next = page.nextCursor
        val nextSequence = next?.toLongOrNull()
        if (page.alarms.isEmpty() || nextSequence == null || nextSequence.toString() != next ||
            nextSequence <= sequence || nextSequence > 9_007_199_254_740_991L
        ) {
            throw IOException("Invalid or non-advancing alarm cursor")
        }
        cursor = next
        sequence = nextSequence
    }
}
