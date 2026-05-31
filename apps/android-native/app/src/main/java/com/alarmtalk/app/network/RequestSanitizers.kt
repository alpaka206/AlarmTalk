package com.alarmtalk.app.network

internal fun String?.trimmedOrNull(): String? =
    this?.trim()?.takeIf { it.isNotEmpty() }

