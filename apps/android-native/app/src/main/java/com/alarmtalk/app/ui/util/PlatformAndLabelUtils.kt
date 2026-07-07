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
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.AlarmSyncStates
import com.alarmtalk.app.data.CachedAlarmAudio
import com.alarmtalk.app.data.SnoozeRepeatLimits
import com.alarmtalk.app.data.VibrationPatterns
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.FamilyGroupCurrentResponse
import com.alarmtalk.app.network.FamilyGroupMember
import java.io.File
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody

// DateTimeFormatter 는 스레드 안전하며 불변이므로 호출마다 새로 만들 필요가 없어
// top-level val 로 1회만 할당한다.
private val DateTimeMinuteFormatter: DateTimeFormatter =
    DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")
private val DotDateFormatter: DateTimeFormatter =
    DateTimeFormatter.ofPattern("yyyy.MM.dd")
private val BackendSecondFormatter: DateTimeFormatter =
    DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")
private val BackendMinuteFormatter: DateTimeFormatter =
    DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")

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

internal fun formatFireTime(millis: Long): String {
    return Instant.ofEpochMilli(millis)
        .atZone(ZoneId.systemDefault())
        .format(DateTimeMinuteFormatter)
}

internal fun formatVoucherIssuedAt(isoString: String?): String? {
    if (isoString.isNullOrBlank()) return null
    return runCatching {
        Instant.parse(isoString)
            .atZone(ZoneId.systemDefault())
            .format(DotDateFormatter)
    }.getOrNull()
}

internal fun formatNoteCreatedAt(isoString: String?, zoneId: ZoneId = ZoneId.systemDefault()): String? {
    val value = isoString?.trim()?.takeIf { it.isNotBlank() } ?: return null
    val instant = parseBackendTimestamp(value)
    return instant
        ?.atZone(zoneId)
        ?.format(DateTimeMinuteFormatter)
        ?: value
            .replace('T', ' ')
            .take(16)
            .takeIf { it.isNotBlank() }
}

private fun parseBackendTimestamp(value: String): Instant? =
    runCatching { Instant.parse(value) }.getOrNull()
        ?: runCatching {
            LocalDateTime.parse(value, BackendSecondFormatter)
                .atZone(ZoneOffset.UTC)
                .toInstant()
        }.getOrNull()
        ?: runCatching {
            LocalDateTime.parse(value, BackendMinuteFormatter)
                .atZone(ZoneOffset.UTC)
                .toInstant()
        }.getOrNull()

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

internal fun snoozeListLabel(context: Context, enabled: Boolean, minutes: Int, repeatLimit: Int): String? =
    if (enabled) {
        context.getString(
            R.string.label_snooze_list,
            minutes,
            snoozeRepeatLabel(context, repeatLimit),
        )
    } else {
        null
    }

internal fun vibrationLabel(context: Context, pattern: String): String = when (pattern) {
    VibrationPatterns.STRONG -> context.getString(R.string.label_vibration_strong)
    VibrationPatterns.SHORT -> context.getString(R.string.label_vibration_short)
    VibrationPatterns.MEDIUM -> context.getString(R.string.label_vibration_medium)
    VibrationPatterns.HEARTBEAT -> context.getString(R.string.label_vibration_heartbeat)
    VibrationPatterns.TICKTOCK -> context.getString(R.string.label_vibration_ticktock)
    VibrationPatterns.WALTZ -> context.getString(R.string.label_vibration_waltz)
    VibrationPatterns.ZIGZAG -> context.getString(R.string.label_vibration_zigzag)
    VibrationPatterns.OFF_BEAT -> context.getString(R.string.label_vibration_off_beat)
    VibrationPatterns.RIPPLE -> context.getString(R.string.label_vibration_ripple)
    VibrationPatterns.SIREN -> context.getString(R.string.label_vibration_siren)
    VibrationPatterns.NONE -> context.getString(R.string.label_vibration_off)
    else -> context.getString(R.string.label_vibration_basic_call)
}

internal fun playModeLabel(context: Context, mode: String): String = when (mode) {
    AlarmPlayModes.VOICE_ONLY -> context.getString(R.string.label_play_mode_voice_only)
    AlarmPlayModes.ALARM_VOICE -> context.getString(R.string.label_play_mode_alarm_voice)
    else -> context.getString(R.string.label_play_mode_alarm)
}

internal fun userFacingError(error: Throwable, fallback: String): String =
    error.message?.takeIf { it.any { char -> char in '\uAC00'..'\uD7A3' } } ?: fallback

internal fun providerLabel(context: Context, provider: String?): String = when (provider) {
    "google" -> context.getString(R.string.label_provider_google)
    "app" -> context.getString(R.string.label_provider_email)
    else -> provider ?: context.getString(R.string.label_provider_app)
}

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

internal fun roleLabel(context: Context, role: String?): String = when (role) {
    "owner" -> context.getString(R.string.label_role_owner)
    "admin" -> context.getString(R.string.label_role_admin)
    "member" -> context.getString(R.string.label_role_member)
    else -> role ?: context.getString(R.string.label_role_member)
}

internal fun inviteStatusLabel(context: Context, status: String?): String = when (status) {
    "pending" -> context.getString(R.string.label_invite_status_pending)
    "used" -> context.getString(R.string.label_invite_status_used)
    "expired" -> context.getString(R.string.label_invite_status_expired)
    "revoked" -> context.getString(R.string.label_invite_status_revoked)
    else -> status ?: context.getString(R.string.label_invite_status_unknown)
}

internal fun voiceStatusLabel(context: Context, status: String?): String = when (status) {
    null, "ready" -> context.getString(R.string.label_voice_status_ready)
    "processing" -> context.getString(R.string.label_voice_status_processing)
    "failed" -> context.getString(R.string.label_voice_status_failed)
    else -> status
}

internal fun planTypeLabel(context: Context, type: String?): String = when (type) {
    "free" -> context.getString(R.string.label_plan_type_free)
    "personal", "individual", "plus" -> context.getString(R.string.label_plan_type_personal)
    "couple" -> context.getString(R.string.label_plan_type_couple)
    "family" -> context.getString(R.string.label_plan_type_family)
    else -> type ?: context.getString(R.string.label_plan_type_default)
}

internal fun voucherStatusLabel(context: Context, status: String?): String = when (status) {
    "active", "issued" -> context.getString(R.string.label_voucher_status_available)
    "pending" -> context.getString(R.string.label_voucher_status_pending)
    "redeemed", "used" -> context.getString(R.string.label_voucher_status_used)
    "expired" -> context.getString(R.string.label_voucher_status_expired)
    "revoked" -> context.getString(R.string.label_voucher_status_revoked)
    else -> status ?: context.getString(R.string.label_voucher_status_unknown)
}

internal fun codeTypeLabel(context: Context, type: String): String = when (type) {
    "voucher" -> context.getString(R.string.label_code_type_voucher)
    "invite" -> context.getString(R.string.label_code_type_invite)
    "subscription" -> context.getString(R.string.label_code_type_subscription)
    else -> type
}

internal fun alarmStateLabel(context: Context, state: String?): String = when (state) {
    "scheduled" -> context.getString(R.string.label_alarm_state_scheduled)
    "ringing" -> context.getString(R.string.label_alarm_state_ringing)
    "snoozed" -> context.getString(R.string.label_alarm_state_snoozed)
    "dismissed" -> context.getString(R.string.label_alarm_state_dismissed)
    "missed" -> context.getString(R.string.label_alarm_state_missed)
    "failed" -> context.getString(R.string.label_alarm_state_failed)
    else -> state ?: context.getString(R.string.label_alarm_state_local)
}

internal fun syncStateLabel(context: Context, state: String): String = when (state) {
    AlarmSyncStates.SYNCED -> context.getString(R.string.label_sync_state_synced)
    AlarmSyncStates.DIRTY -> context.getString(R.string.label_sync_state_dirty)
    AlarmSyncStates.FAILED -> context.getString(R.string.label_sync_state_failed)
    else -> context.getString(R.string.label_sync_state_device_only)
}
