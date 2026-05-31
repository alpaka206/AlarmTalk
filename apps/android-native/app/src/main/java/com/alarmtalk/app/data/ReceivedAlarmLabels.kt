package com.alarmtalk.app.data

internal fun receivedRemoteAlarmLabel(senderNameOrEmail: String?, fallbackSenderNameOrEmail: String? = null): String {
    val sender = sequenceOf(senderNameOrEmail, fallbackSenderNameOrEmail)
        .mapNotNull { it?.trim()?.takeIf(String::isNotBlank) }
        .firstOrNull()
        ?: return "상대가 보낸 알람"
    val displayName = if (sender.endsWith("님")) sender else "${sender}님"
    return "${displayName}이 보낸 알람"
}
