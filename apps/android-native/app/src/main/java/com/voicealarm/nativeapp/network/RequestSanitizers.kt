package com.voicealarm.nativeapp.network

internal fun String?.trimmedOrNull(): String? =
    this?.trim()?.takeIf { it.isNotEmpty() }

