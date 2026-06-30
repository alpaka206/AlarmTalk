package com.alarmtalk.app.data

import android.content.Context
import com.alarmtalk.app.R

internal fun receivedRemoteAlarmLabel(
    context: Context,
    senderNameOrEmail: String?,
    fallbackSenderNameOrEmail: String? = null,
): String {
    val sender = sequenceOf(senderNameOrEmail, fallbackSenderNameOrEmail)
        .mapNotNull { it?.trim()?.takeIf(String::isNotBlank) }
        .firstOrNull()
        ?: return context.getString(R.string.r3data_received_alarm_from_other)
    val displayName = if (sender.endsWith("님")) sender else context.getString(R.string.r3data_honorific_name, sender)
    return context.getString(R.string.r3data_received_alarm_from_sender, displayName)
}
