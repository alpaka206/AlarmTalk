package com.alarmtalk.app.alarm

import android.content.Context
import android.content.SharedPreferences
import com.alarmtalk.app.network.ReceivedNote

object SocialNotificationTracker {
    private const val PREFS_NAME = "voice_alarm_social_notifications"
    // 순서 보존형 저장 키. 과거 putStringSet 기반 "seen_note_ids"(순서 미보장)는 폐기하고 새 키를 쓴다.
    // 구 키에는 StringSet 이 들어 있어 getString 으로 읽으면 ClassCastException 이 나므로 재사용하지 않는다.
    // (출시 전이라 back-compat 불필요 — 구 키 값 무시로 인한 seen 목록 유실은 무해)
    private const val KEY_SEEN_NOTE_IDS = "seen_note_ids_ordered"

    // 최근순으로 유지할 seen note id 최대 개수
    private const val MAX_SEEN_IDS = 200

    // seen id 목록 직렬화 구분자. note id 는 서버 UUID 라 개행을 포함하지 않는다.
    private const val SEPARATOR = "\n"

    fun notifyNewNotes(context: Context, notes: List<ReceivedNote>, allowInitialNotify: Boolean) {
        val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        // 순서 보존형(오래된→최신) 리스트로 로드
        val seenIds = loadSeenIds(prefs)
        // 포함 검사는 Set 으로 변환해 O(1) 유지
        val seenIdSet = seenIds.toHashSet()
        val unreadNotes = notes.filter { it.readAt.isNullOrBlank() }

        if (allowInitialNotify || seenIds.isNotEmpty()) {
            unreadNotes
                .filter { it.id !in seenIdSet }
                .take(3)
                .forEach { note ->
                    SocialNotificationFactory.notifyNewMessage(
                        context = context,
                        noteId = note.id,
                        senderName = note.senderName ?: note.senderEmail,
                        text = note.text,
                    )
                }
        }

        // 현재 노트 id 를 '가장 최근'으로 취급(뒤에 붙임) → 역순 dedup 으로 최신 우선 유지 → 최신 200개만 보존
        val merged = seenIds + notes.map { it.id }
        val nextSeenIds = merged.asReversed().distinct().take(MAX_SEEN_IDS).asReversed()

        prefs.edit()
            .putString(KEY_SEEN_NOTE_IDS, nextSeenIds.joinToString(SEPARATOR))
            .apply()
    }

    // 순서 보존형 문자열을 List<String> 으로 복원 (값 누락/공백 시 빈 리스트)
    private fun loadSeenIds(prefs: SharedPreferences): List<String> {
        val raw = prefs.getString(KEY_SEEN_NOTE_IDS, null).orEmpty()
        if (raw.isEmpty()) return emptyList()
        return raw.split(SEPARATOR).filter { it.isNotEmpty() }
    }
}
