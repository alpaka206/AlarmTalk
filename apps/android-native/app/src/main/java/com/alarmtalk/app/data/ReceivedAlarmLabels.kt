package com.alarmtalk.app.data

import android.content.Context
import android.content.res.Configuration
import com.alarmtalk.app.R
import java.util.Locale

internal fun receivedRemoteAlarmLabel(
    context: Context,
    senderNameOrEmail: String?,
    fallbackSenderNameOrEmail: String? = null,
): String {
    val sender = sequenceOf(senderNameOrEmail, fallbackSenderNameOrEmail)
        .mapNotNull { it?.trim()?.takeIf(String::isNotBlank) }
        .firstOrNull()
        ?: return context.getString(R.string.r3data_received_alarm_from_other)
    val displayName = if (sender.endsWith("님") || sender.endsWith("さん")) sender else context.getString(R.string.r3data_honorific_name, sender)
    return context.getString(R.string.r3data_received_alarm_from_sender, displayName)
}

internal fun localizedReceivedAlarmLabel(context: Context, stored: String): String {
    val value = stored.trim()
    if (value == "Alarm from your friend") return receivedRemoteAlarmLabel(context, null)
    for (language in listOf("ko", "en", "ja")) {
        val config = Configuration(context.resources.configuration).apply { setLocale(Locale.forLanguageTag(language)) }
        val source = context.createConfigurationContext(config)
        if (value == source.getString(R.string.r3data_received_alarm_from_other)) {
            return receivedRemoteAlarmLabel(context, null)
        }
        val parts = source.getString(R.string.r3data_received_alarm_from_sender).split("%1\$s")
        if (parts.size != 2 || !value.startsWith(parts[0]) || !value.endsWith(parts[1]) ||
            value.length <= parts[0].length + parts[1].length
        ) continue
        var sender = value.substring(parts[0].length, value.length - parts[1].length)
        if (language == "ko") sender = sender.removeSuffix("님")
        if (language == "ja") sender = sender.removeSuffix("さん").removeSuffix("さん")
        return receivedRemoteAlarmLabel(context, sender)
    }
    return stored
}

internal fun customRingingAlarmLabel(stored: String): String? = stored.trim()
    .takeIf { it.isNotBlank() && it !in setOf("알람", "Alarm", "アラーム") }
