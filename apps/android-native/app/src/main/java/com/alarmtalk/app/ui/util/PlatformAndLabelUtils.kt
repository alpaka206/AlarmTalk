package com.alarmtalk.app

import android.app.AlarmManager
import android.app.Activity
import android.app.Application
import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.compose.material.icons.outlined.Message
import com.alarmtalk.app.R
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.data.CachedAlarmAudio
import com.alarmtalk.app.data.SnoozeRepeatLimits
import com.alarmtalk.app.data.VibrationPatterns
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.FamilyGroupCurrentResponse
import com.alarmtalk.app.network.FamilyGroupMember
import java.io.File
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody

// DateTimeFormatter 는 스레드 안전하며 불변이므로 호출마다 새로 만들 필요가 없어
// top-level val 로 1회만 할당한다.
private val DotDateFormatter: DateTimeFormatter =
    DateTimeFormatter.ofPattern("yyyy.MM.dd")

internal fun Context.canScheduleExactAlarms(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    val am = getSystemService(AlarmManager::class.java) ?: return false
    return am.canScheduleExactAlarms()
}

internal fun Context.canUseFullScreenIntent(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return true
    val nm = getSystemService(NotificationManager::class.java) ?: return false
    return nm.canUseFullScreenIntent()
}

internal fun Context.openExactAlarmSettings() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return

    val intent = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
        data = Uri.parse("package:$packageName")
    }
    startSettingsActivity(intent)
}

internal fun Context.openFullScreenIntentSettings() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return

    val intent = Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
        data = Uri.parse("package:$packageName")
    }
    startSettingsActivity(intent)
}

internal fun Context.startSettingsActivity(intent: Intent) {
    if (this !is Activity) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    runCatching {
        startActivity(intent)
    }.recoverCatching { error ->
        if (error is ActivityNotFoundException) {
            startActivity(
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.parse("package:$packageName")
                },
            )
        } else {
            throw error
        }
    }.onFailure { error ->
        AlarmTalkLog.reportError("Failed to open settings", error)
    }
}

internal fun formatVoucherIssuedAt(isoString: String?): String? {
    if (isoString.isNullOrBlank()) return null
    return runCatching {
        Instant.parse(isoString)
            .atZone(ZoneId.systemDefault())
            .format(DotDateFormatter)
    }.getOrNull()
}

internal fun audioFileLabel(context: Context, localAudioUri: String): String =
    Uri.parse(localAudioUri).lastPathSegment
        ?.substringAfterLast('/')
        ?.ifBlank { null }
        ?: context.getString(R.string.label_audio_file)

internal fun voiceUploadPart(audio: CachedAlarmAudio): MultipartBody.Part {
    val uri = Uri.parse(audio.localAudioUri)
    require(uri.scheme == "file") { "로컬에 저장된 오디오만 업로드할 수 있어요." }
    val file = File(requireNotNull(uri.path) { "오디오 파일 경로를 찾을 수 없어요." })
    require(file.exists()) { "오디오 파일을 찾을 수 없어요." }
    val mediaType = when (file.extension.lowercase()) {
        "m4a", "mp4", "aac" -> "audio/mp4"
        "mp3" -> "audio/mpeg"
        "wav" -> "audio/wav"
        "ogg" -> "audio/ogg"
        else -> "application/octet-stream"
    }.toMediaType()
    val uploadName = audio.displayName.ifBlank { file.name }
    return MultipartBody.Part.createFormData(
        name = "audio",
        filename = uploadName,
        body = file.asRequestBody(mediaType),
    )
}

internal fun repeatLabel(context: Context, mask: Int): String {
    if (mask == 0) return context.getString(R.string.label_repeat_none)
    if (mask == 0b1111111) return context.getString(R.string.label_repeat_daily)
    val days = listOf(
        context.getString(R.string.label_weekday_sun),
        context.getString(R.string.label_weekday_mon),
        context.getString(R.string.label_weekday_tue),
        context.getString(R.string.label_weekday_wed),
        context.getString(R.string.label_weekday_thu),
        context.getString(R.string.label_weekday_fri),
        context.getString(R.string.label_weekday_sat),
    )
    return days.filterIndexed { index, _ -> mask and (1 shl index) != 0 }.joinToString(", ")
}

internal fun snoozeRepeatLabel(context: Context, limit: Int): String = when (limit) {
    SnoozeRepeatLimits.THREE -> context.getString(R.string.label_snooze_repeat_three)
    SnoozeRepeatLimits.FIVE -> context.getString(R.string.label_snooze_repeat_five)
    SnoozeRepeatLimits.FOREVER -> context.getString(R.string.label_snooze_repeat_forever)
    else -> context.getString(R.string.label_snooze_repeat_count, limit)
}

// 패턴 이름은 알람음 이름(예: Homecoming)과 같은 고유명 취급 — 전 로케일 영어 고정
// (base strings 에 translatable=false). '기본'·'꺼짐' 같은 의미어만 로컬라이즈한다.
internal fun vibrationLabel(context: Context, pattern: String): String = when (pattern) {
    VibrationPatterns.STRONG -> context.getString(R.string.label_vibration_strong)
    VibrationPatterns.SHORT -> context.getString(R.string.label_vibration_short)
    VibrationPatterns.MEDIUM -> context.getString(R.string.label_vibration_medium)
    VibrationPatterns.RISE -> context.getString(R.string.label_vibration_rise)
    VibrationPatterns.PULSE -> context.getString(R.string.label_vibration_pulse)
    VibrationPatterns.BOUNCE -> context.getString(R.string.label_vibration_bounce)
    VibrationPatterns.DRUMROLL -> context.getString(R.string.label_vibration_drumroll)
    VibrationPatterns.HEARTBEAT -> context.getString(R.string.label_vibration_heartbeat)
    VibrationPatterns.TICKTOCK -> context.getString(R.string.label_vibration_ticktock)
    VibrationPatterns.WALTZ -> context.getString(R.string.label_vibration_waltz)
    VibrationPatterns.ZIGZAG -> context.getString(R.string.label_vibration_zigzag)
    VibrationPatterns.OFF_BEAT -> context.getString(R.string.label_vibration_off_beat)
    VibrationPatterns.RIPPLE -> context.getString(R.string.label_vibration_ripple)
    VibrationPatterns.SIREN -> context.getString(R.string.label_vibration_siren)
    VibrationPatterns.SOFT -> context.getString(R.string.label_vibration_soft)
    VibrationPatterns.SOS -> context.getString(R.string.label_vibration_sos)
    VibrationPatterns.NONE -> context.getString(R.string.label_vibration_off)
    else -> context.getString(R.string.label_vibration_basic_call)
}

internal fun userFacingError(error: Throwable, fallback: String): String =
    error.message?.takeIf { it.any { char -> char in '\uAC00'..'\uD7A3' } } ?: fallback

internal fun hasCoupleOrFamilyAccess(
    subscriptionResponse: BillingSubscriptionResponse?,
    familyGroup: FamilyGroupCurrentResponse?,
): Boolean {
    val plan = subscriptionResponse?.plan
    return familyGroup?.group != null ||
        plan?.key == "family" ||
        plan?.key == "couple" ||
        plan?.planType == "family" ||
        plan?.planType == "couple"
}

// 음성 공유 토글을 노출할지 판단한다. 개인 플랜이고 가족·커플 그룹에 본인 외 멤버가
// 0명이면 공유 대상이 없으므로 토글을 숨긴다. family/couple 플랜이거나 그룹에
// 다른 멤버가 1명이라도 있으면 노출한다.
internal fun canShareVoiceWithOthers(
    subscriptionResponse: BillingSubscriptionResponse?,
    familyGroup: FamilyGroupCurrentResponse?,
    authSession: AuthSession?,
): Boolean {
    val plan = subscriptionResponse?.plan
    val isFamilyOrCouplePlan = plan?.key == "family" || plan?.key == "couple" ||
        plan?.planType == "family" || plan?.planType == "couple"
    if (isFamilyOrCouplePlan) return true
    val currentUserId = authSession?.user?.id
    val currentEmail = authSession?.user?.email
    val membersExceptSelf = familyGroup?.members.orEmpty().count { member ->
        member.userId != currentUserId && member.email != currentEmail
    }
    return membersExceptSelf > 0
}

internal fun hasPaidVoiceAccess(subscriptionResponse: BillingSubscriptionResponse?): Boolean {
    val subscription = subscriptionResponse?.subscription ?: return false
    if (subscription.status != "active") return false
    val plan = subscriptionResponse.plan ?: return false
    return plan.key in setOf("personal", "plus", "couple", "family") ||
        plan.planType in setOf("personal", "individual", "plus", "couple", "family")
}

internal fun familyAlarmRecipients(
    familyGroup: FamilyGroupCurrentResponse?,
    authSession: AuthSession?,
): List<FamilyGroupMember> {
    val currentUserId = authSession?.user?.id
    val currentEmail = authSession?.user?.email
    return familyGroup?.members.orEmpty().filter { member ->
        member.userId != currentUserId &&
            member.email != currentEmail &&
            member.allowFamilyAlarms
    }
}
