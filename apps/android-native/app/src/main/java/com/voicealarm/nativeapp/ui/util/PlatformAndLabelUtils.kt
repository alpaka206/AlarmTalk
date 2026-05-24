package com.voicealarm.nativeapp

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
import com.voicealarm.nativeapp.core.VoiceAlarmLog.TAG
import com.voicealarm.nativeapp.data.AlarmPlayModes
import com.voicealarm.nativeapp.data.AlarmSyncStates
import com.voicealarm.nativeapp.data.CachedAlarmAudio
import com.voicealarm.nativeapp.data.SnoozeRepeatLimits
import com.voicealarm.nativeapp.data.VibrationPatterns
import com.voicealarm.nativeapp.network.AuthSession
import com.voicealarm.nativeapp.network.BillingSubscriptionResponse
import com.voicealarm.nativeapp.network.FamilyGroupCurrentResponse
import com.voicealarm.nativeapp.network.FamilyGroupMember
import java.io.File
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody

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
        Log.e(TAG, "Failed to open settings", error)
    }
}

internal fun formatFireTime(millis: Long): String {
    val formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")
    return Instant.ofEpochMilli(millis)
        .atZone(ZoneId.systemDefault())
        .format(formatter)
}

internal fun formatVoucherIssuedAt(isoString: String?): String? {
    if (isoString.isNullOrBlank()) return null
    val formatter = DateTimeFormatter.ofPattern("yyyy.MM.dd")
    return runCatching {
        Instant.parse(isoString)
            .atZone(ZoneId.systemDefault())
            .format(formatter)
    }.getOrNull()
}

internal fun audioFileLabel(localAudioUri: String): String =
    Uri.parse(localAudioUri).lastPathSegment
        ?.substringAfterLast('/')
        ?.ifBlank { null }
        ?: "음성 파일"

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

internal fun repeatLabel(mask: Int): String {
    if (mask == 0) return "반복 없음"
    if (mask == 0b1111111) return "매일"
    val days = listOf("일", "월", "화", "수", "목", "금", "토")
    return days.filterIndexed { index, _ -> mask and (1 shl index) != 0 }.joinToString(", ")
}

internal fun snoozeRepeatLabel(limit: Int): String = when (limit) {
    SnoozeRepeatLimits.THREE -> "3회"
    SnoozeRepeatLimits.FIVE -> "5회"
    SnoozeRepeatLimits.FOREVER -> "계속 반복"
    else -> "${limit}회"
}

internal fun snoozeListLabel(enabled: Boolean, minutes: Int, repeatLimit: Int): String? =
    if (enabled) {
        "${minutes}분 · ${snoozeRepeatLabel(repeatLimit)}"
    } else {
        null
    }

internal fun vibrationLabel(pattern: String): String = when (pattern) {
    VibrationPatterns.STRONG -> "Strong"
    VibrationPatterns.SHORT -> "Short"
    VibrationPatterns.MEDIUM -> "Medium"
    VibrationPatterns.HEARTBEAT -> "Heartbeat"
    VibrationPatterns.TICKTOCK -> "Ticktock"
    VibrationPatterns.WALTZ -> "Waltz"
    VibrationPatterns.ZIGZAG -> "Zig-zig-zig"
    VibrationPatterns.OFF_BEAT -> "Off-beat"
    VibrationPatterns.RIPPLE -> "Ripple"
    VibrationPatterns.SIREN -> "Siren"
    VibrationPatterns.NONE -> "Off"
    else -> "Basic call"
}

internal fun playModeLabel(mode: String): String = when (mode) {
    AlarmPlayModes.VOICE_ONLY -> "목소리"
    AlarmPlayModes.ALARM_VOICE -> "알람 + 목소리"
    else -> "알람"
}

internal fun userFacingError(error: Throwable, fallback: String): String =
    error.message?.takeIf { it.any { char -> char in '\uAC00'..'\uD7A3' } } ?: fallback

internal fun providerLabel(provider: String?): String = when (provider) {
    "google" -> "Google"
    "app" -> "이메일"
    else -> provider ?: "앱"
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

internal fun roleLabel(role: String?): String = when (role) {
    "owner" -> "소유자"
    "admin" -> "관리자"
    "member" -> "멤버"
    else -> role ?: "멤버"
}

internal fun inviteStatusLabel(status: String?): String = when (status) {
    "pending" -> "대기 중"
    "used" -> "사용됨"
    "expired" -> "만료됨"
    "revoked" -> "취소됨"
    else -> status ?: "알 수 없음"
}

internal fun voiceStatusLabel(status: String?): String = when (status) {
    null, "ready" -> "목소리 준비됨"
    "processing" -> "목소리 준비 중"
    "failed" -> "실패"
    else -> status
}

internal fun planTypeLabel(type: String?): String = when (type) {
    "free" -> "무료"
    "personal", "individual", "plus" -> "개인"
    "couple" -> "커플"
    "family" -> "가족"
    else -> type ?: "이용권"
}

internal fun voucherStatusLabel(status: String?): String = when (status) {
    "active", "issued" -> "사용 가능"
    "pending" -> "대기 중"
    "redeemed", "used" -> "사용됨"
    "expired" -> "만료됨"
    "revoked" -> "취소됨"
    else -> status ?: "알 수 없음"
}

internal fun codeTypeLabel(type: String): String = when (type) {
    "voucher" -> "쿠폰"
    "invite" -> "초대 코드"
    "subscription" -> "이용권"
    else -> type
}

internal fun alarmStateLabel(state: String?): String = when (state) {
    "scheduled" -> "예약됨"
    "ringing" -> "울리는 중"
    "snoozed" -> "다시 울림"
    "dismissed" -> "종료됨"
    "missed" -> "놓침"
    "failed" -> "알람을 다시 예약하지 못했어요"
    else -> state ?: "로컬"
}

internal fun stageEmoji(stage: String): String = when (stage) {
    "sprout" -> "\uD83C\uDF31"
    "tree" -> "\uD83C\uDF33"
    "bloom" -> "\uD83C\uDF38"
    else -> "\uD83C\uDF30"
}

internal fun stageLabel(stage: String): String = when (stage) {
    "sprout" -> "새싹"
    "tree" -> "나무"
    "bloom" -> "꽃"
    else -> "씨앗"
}

internal fun syncStateLabel(state: String): String = when (state) {
    AlarmSyncStates.SYNCED -> "동기화됨"
    AlarmSyncStates.DIRTY -> "저장 대기"
    AlarmSyncStates.FAILED -> "서버에 저장하지 못했어요"
    else -> "기기에만 저장됨"
}
