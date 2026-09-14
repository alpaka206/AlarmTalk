package com.alarmtalk.app.data

import com.alarmtalk.app.network.RemoteAlarm
import com.alarmtalk.app.network.RemoteAlarmListResponse
import java.io.IOException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

/** 첫 응답으로 커서/구서버 offset 계약을 정하고, 전체 성공 뒤에만 예약·ACK·prune에 넘긴다. */
internal suspend fun collectRemoteAlarmPages(
    fetchPage: suspend (after: String?, offset: Int?) -> RemoteAlarmListResponse,
): List<RemoteAlarm> {
    val latestById = linkedMapOf<String, RemoteAlarm>()
    val seenVersions = mutableMapOf<String, MutableSet<String>>()
    var cursor: String? = null
    var offset = 0
    var cursorMode: Boolean? = null
    var sequence = 0L
    while (true) {
        currentCoroutineContext().ensureActive()
        val page = fetchPage(cursor, if (cursorMode == false) offset else null)
        currentCoroutineContext().ensureActive()
        if (cursorMode == null) cursorMode = page.hasMore != null
        if (cursorMode == false) {
            val limit = page.limit
            if (page.hasMore != null || page.nextCursor != null || page.offset != offset ||
                page.total == null || page.total < 0 || limit == null || limit !in 1..100 ||
                page.alarms.size > limit
            ) throw IOException("Invalid legacy alarm pagination contract")
            if (page.alarms.isEmpty()) return latestById.values.toList()
        } else if (page.hasMore == null) {
            throw IOException("Missing alarm cursor contract")
        }
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
        if (cursorMode == false) {
            if (offset > Int.MAX_VALUE - page.alarms.size) throw IOException("Alarm offset overflow")
            offset += page.alarms.size
            continue
        }
        if (page.hasMore == false) {
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
