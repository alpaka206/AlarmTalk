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
    // 확장자→MIME 매핑 단일 출처는 AlarmAudioStore.UPLOAD_AUDIO_MIME_BY_EXTENSION.
    // 목록 밖 컨테이너는 cacheFromUri 가 미리 m4a 로 트랜스코드하므로 여기 octet-stream 폴백은
    // 사실상 도달하지 않지만, 방어적으로 남겨 둔다.
    val mediaType = (
        com.alarmtalk.app.data.AlarmAudioStore.UPLOAD_AUDIO_MIME_BY_EXTENSION[file.extension.lowercase()]
            ?: "application/octet-stream"
        ).toMediaType()
    val uploadName = audio.displayName.ifBlank { file.name }
    return MultipartBody.Part.createFormData(
        name = "audio",
        filename = uploadName,
        body = file.asRequestBody(mediaType),
    )
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

/**
 * 유료 목소리 권한 판정 결과. **'모른다' 를 '무료' 와 구분하는 것이 이 타입의 존재 이유다.**
 *
 * 응답 전 기본값을 답으로 읽는 사고가 이 저장소에서 반복됐다
 * (`docs/spec/gates-and-overlays.md`). 그래서 판정기는 세 값을 돌려주고, 소비하는 쪽이
 * **모를 때 어느 쪽으로 기울지 스스로 밝히게** 한다.
 */
internal enum class PaidVoiceAccess { Entitled, NotEntitled, Unknown }

/**
 * **유료 목소리 판정의 유일한 출처**(2026-08-31). 우선순위 네 단이고 순서가 규칙이다.
 *
 * 1. **스토어가 유효하다고 하면 유료다 — 서버 만료로 절대 뒤집지 않는다.**
 *    「구독 수명주기 — 스토어가 권위다」(`docs/spec/billing-lifecycle.md`). 자동갱신은
 *    스토어에서 먼저 일어나고 서버 반영(RTDN·복원)이 늦을 수 있는데, 그때 서버의 옛
 *    `expiresAt` 으로 막으면 **돈을 내고 있는 사용자가 잠긴다.** 스펙이 더 나쁘다고 못박은 방향이다.
 * 2. **서버가 `users.plan = free` 라고 말하면 거기서 끝이다 — 구독 행보다 위다.**
 *    보류(ON_HOLD·결제 재시도)는 **행을 남긴다**: `propagateGroupMemberPlans` 는 멤버의
 *    그룹 연동 구독을 취소하지 않고 재계산에서 제외만 하므로, 행은 `status='active'` 인 채
 *    남고 `users.plan` 만 free 로 내려간다. 행부터 보면 결제가 밀린 그룹 멤버가 계속
 *    유료로 읽혀 3단에 영영 닿지 못한다(2026-09-01 리뷰).
 *    신규 결제를 잘못 막지 않는다 — `createNewSubscriptionForPlan` 이 행 삽입과 **같은
 *    트랜잭션에서** `users.plan` 을 올리고, 산 직후는 어차피 1단(스토어)이 잡는다.
 * 3. 서버가 내 구독을 알고 있으면 **만료 시각으로** 가른다. 스토어가 침묵할 때(그룹 멤버·
 *    미로그인 스토어 등) 이 값이 스스로 신선도를 말한다 — 별도의 '신선도' 필드가 필요 없다.
 * 4. 남은 `users.plan` 으로 가른다. **그룹보다 위다** — 위 2단과 같은 이유다.
 * 5. 스냅샷 자체가 없으면 **모른다.** 무료가 아니다.
 *
 * @param storeEntitled 스토어(Play/StoreKit)가 지금 유효한 구독을 확인해 줬는가. 모르면 false —
 *   **거짓이라고 단정하는 값이 아니라 '확인 못 했다' 는 뜻**이라 2단 이하로 내려갈 뿐이다.
 */
internal fun resolvePaidVoiceAccess(
    subscriptionResponse: BillingSubscriptionResponse?,
    familyGroup: FamilyGroupCurrentResponse?,
    userPlan: String?,
    storeEntitled: Boolean,
    nowMillis: Long,
): PaidVoiceAccess {
    if (storeEntitled) return PaidVoiceAccess.Entitled
    val snapshot = subscriptionResponse ?: return PaidVoiceAccess.Unknown
    val plan = userPlan?.trim()?.lowercase()
    if (plan == "free") return PaidVoiceAccess.NotEntitled
    val subscription = snapshot.subscription
    if (subscription != null) {
        if (!hasPaidVoiceAccess(snapshot)) return PaidVoiceAccess.NotEntitled
        // 만료 시각을 못 읽으면 **막지 않는다** — 과차단이 더 나쁘다(기존 규칙 유지).
        val expiryMillis =
            runCatching { java.time.Instant.parse(subscription.expiresAt).toEpochMilli() }.getOrNull()
                ?: return PaidVoiceAccess.Entitled
        return if (expiryMillis > nowMillis) PaidVoiceAccess.Entitled else PaidVoiceAccess.NotEntitled
    }
    return when {
        // ⚠ **여기서 Unknown 을 돌려주지 말 것.** '모름' 은 서버에 **한 번도 못 물어본**
        // 상태(위의 `subscriptionResponse == null`)의 뜻이다. 여기는 서버가 "본인 구독
        // 없음" 이라고 **답했고** 그룹 접근도 없는 상태라 근거가 다 모인 무료다 — 모름으로
        // 접으면 낙관 규칙에 걸려 **무료 사용자의 유료 목소리가 영영 강등되지 않는다.**
        plan == null || plan.isBlank() ->
            if (hasCoupleOrFamilyAccess(snapshot, familyGroup)) PaidVoiceAccess.Entitled
            else PaidVoiceAccess.NotEntitled
        plan in setOf("personal", "plus", "couple", "family") -> PaidVoiceAccess.Entitled
        else -> PaidVoiceAccess.NotEntitled
    }
}

/**
 * **모르면 잠그지 않는다.** 표시·울림·저장/생성 게이트가 쓴다 — 잘못 잠그면 사용자는 산
 * 기능을 못 쓰고, 잘못 열어 두면 다음 동기화에서 정리된다. 후자가 회복 가능하다.
 */
internal fun PaidVoiceAccess.isEntitledOptimistic(): Boolean = this != PaidVoiceAccess.NotEntitled

/**
 * **확실히 무료일 때만 참.** 되돌리기 어려운 동작(무료 잠금 적용·알람 영구 강등)이 쓴다.
 */
internal fun PaidVoiceAccess.isDefinitelyFree(): Boolean = this == PaidVoiceAccess.NotEntitled

internal fun hasPaidVoiceAccess(subscriptionResponse: BillingSubscriptionResponse?): Boolean {
    val subscription = subscriptionResponse?.subscription ?: return false
    if (subscription.status != "active") return false
    val plan = subscriptionResponse.plan ?: return false
    return plan.key in setOf("personal", "plus", "couple", "family") ||
        plan.planType in setOf("personal", "individual", "plus", "couple", "family")
}

/**
 * 유료 목소리 권한을 '만료시각까지' 고려해 판정한다. hasPaidVoiceAccess 는 status=="active" 만
 * 보므로, 로컬에 마지막으로 저장된(=stale 가능) 구독이 active 로 남아 있어도 expiresAt 이 지났으면
 * 무권한으로 본다. 앱 미실행/오프라인이라 서버 재조회를 못 해도 만료된 유료 목소리가 계속
 * 재생되지 않게 하는 근거(울림 시점 게이트·무료 잠금 트리거 공용). 만료시각을 못 읽으면
 * status 만 신뢰(기존 동작 유지 — 과차단 방지).
 */
internal fun isPaidVoiceEntitledNow(
    subscriptionResponse: BillingSubscriptionResponse?,
    nowMillis: Long,
): Boolean {
    if (!hasPaidVoiceAccess(subscriptionResponse)) return false
    val expiresAt = subscriptionResponse?.subscription?.expiresAt ?: return true
    val expiryMillis = runCatching { java.time.Instant.parse(expiresAt).toEpochMilli() }.getOrNull()
        ?: return true
    return expiryMillis > nowMillis
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
