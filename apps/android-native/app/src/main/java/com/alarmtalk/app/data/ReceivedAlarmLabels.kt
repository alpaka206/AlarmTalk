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

/**
 * 가족 알람으로 보낸 녹음의 기본 라벨 — **저장·전송 계약값**이라 번역하지 않는다
 * (`docs/spec/localization.md` §2). 서버 `routes/family-alarm.ts` 의 `DEFAULT_VOICE_LABEL`,
 * iOS `ReceivedVoiceTextDisplay.familyVoiceDefault` 와 같은 글자여야 한다. 서버는 이 값을
 * 받는 사람의 `messages.text` 에 저장하고, 받는 기기는 그것을 울림 화면 문구로 쓴다.
 */
internal const val FAMILY_VOICE_DEFAULT_LABEL = "가족이 보낸 음성"

/**
 * 계약값 대신 앱 언어로 번역한 라벨을 보내던 안드로이드 빌드가 남긴 값. 받는 쪽에서는
 * 계약값과 같은 뜻으로 읽는다(사용자가 친 라벨이 아니다).
 */
private val LEGACY_FAMILY_VOICE_LABELS = setOf("Voice from family", "家族からの音声")

/**
 * 받은 알람의 녹음 문구를 화면에 그릴 때 쓴다. 기본 라벨(계약값)만 현재 언어의 문구로 바꾸고,
 * 보낸 사람이 직접 친 라벨은 그대로 둔다. 보낸 사람은 가족일 수도 커플 상대일 수도 있으니
 * '가족' 이라고 단정하지 않는다(§3).
 *
 * ⚠ **표시에서만 바꾼다.** 저장된 값을 번역문으로 덮지 않는다 — 편집기는 저장값을 그대로 연다.
 */
internal fun localizedReceivedVoiceText(context: Context, stored: String): String {
    val value = stored.trim()
    return if (value == FAMILY_VOICE_DEFAULT_LABEL || value in LEGACY_FAMILY_VOICE_LABELS) {
        context.getString(R.string.r3data_received_family_voice_text)
    } else {
        stored
    }
}

internal fun customRingingAlarmLabel(stored: String): String? = stored.trim()
    .takeIf { it.isNotBlank() && it !in setOf("알람", "Alarm", "アラーム") }
