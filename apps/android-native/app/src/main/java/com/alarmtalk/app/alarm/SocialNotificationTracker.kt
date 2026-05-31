package com.alarmtalk.app.alarm

import android.content.Context
import com.alarmtalk.app.network.ReceivedNote

object SocialNotificationTracker {
    private const val PREFS_NAME = "voice_alarm_social_notifications"
    private const val KEY_SEEN_NOTE_IDS = "seen_note_ids"

    fun notifyNewNotes(context: Context, notes: List<ReceivedNote>, allowInitialNotify: Boolean) {
        val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val seenIds = prefs.getStringSet(KEY_SEEN_NOTE_IDS, emptySet()).orEmpty()
        val unreadNotes = notes.filter { it.readAt.isNullOrBlank() }

        if (allowInitialNotify || seenIds.isNotEmpty()) {
            unreadNotes
                .filter { it.id !in seenIds }
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

        val nextSeenIds = (seenIds.toList() + notes.map { it.id })
            .distinct()
            .takeLast(200)
            .toSet()

        prefs.edit()
            .putStringSet(KEY_SEEN_NOTE_IDS, nextSeenIds)
            .apply()
    }
}
