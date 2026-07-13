package com.alarmtalk.app

import android.content.Context
import android.media.RingtoneManager
import android.net.Uri
import android.provider.Settings
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import com.alarmtalk.app.R
import com.alarmtalk.app.data.AlarmTimeCalculator
import com.alarmtalk.app.data.DynamicPromptPreferences
import com.alarmtalk.app.network.DynamicPromptSettings
import com.alarmtalk.app.network.FamilyAlarmQuietWindow
import com.alarmtalk.app.network.FamilyGroupMember
import com.alarmtalk.app.network.FamilyVoiceProfile
import com.alarmtalk.app.network.VoiceProfile
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId


internal fun resolveListenerTitle(
    profileId: String,
    voiceProfiles: List<VoiceProfile>,
    familyVoices: List<FamilyVoiceProfile>,
): String? {
    val own = voiceProfiles.firstOrNull { it.id == profileId }?.listenerTitle
    if (!own.isNullOrBlank()) return own
    val shared = familyVoices.firstOrNull { it.id == profileId }?.listenerTitle
    return shared?.takeIf { it.isNotBlank() }
}

internal fun DynamicPromptSettings.toPromptPreferences(): DynamicPromptPreferences =
    DynamicPromptPreferences(
        weatherCountry = weather.country?.trim().orEmpty(),
        weatherCity = weather.city?.trim().orEmpty(),
        fortuneGender = fortune.gender?.trim().orEmpty(),
        fortuneBirthDate = fortune.birthDate?.trim().orEmpty(),
        fortuneBirthTime = fortune.birthTime?.trim().orEmpty(),
    )

// 편집기 섹션 헤더 단일 출처. '재생 방식'·'세부 설정'이 이미 쓰던 titleMedium/Bold/onBackground
// 규격으로 맞춰, 각 파일에 흩어진 인라인 Text 대신 이 컴포저블로 통일한다.
@Composable
internal fun EditorSectionTitle(title: String, modifier: Modifier = Modifier) {
    Text(
        text = title,
        modifier = modifier,
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onBackground,
    )
}

internal const val FAMILY_ALARM_MIN_LEAD_MILLIS = 30 * 60 * 1_000L

// 가족 알람은 수신자가 준비할 여유가 필요해 다음 울림까지 최소 30분 리드타임을 요구한다.
// saveEditor()와 단위 테스트가 함께 쓰는 단일 판정 출처.
internal fun isFamilyAlarmLeadTooSoon(
    hour: Int,
    minute: Int,
    repeatDaysMask: Int,
    holidayOff: Boolean,
    nowMillis: Long = System.currentTimeMillis(),
): Boolean {
    val fireAtMillis = AlarmTimeCalculator.nextFireAtMillis(
        hour = hour,
        minute = minute,
        repeatDaysMask = repeatDaysMask,
        holidayOff = holidayOff,
        nowMillis = nowMillis,
    )
    return fireAtMillis - nowMillis < FAMILY_ALARM_MIN_LEAD_MILLIS
}

internal fun ringtoneTitle(context: Context, uri: Uri): String =
    runCatching {
        RingtoneManager.getRingtone(context, uri)?.getTitle(context)
    }.getOrNull()?.takeIf { it.isNotBlank() } ?: context.getString(R.string.editor_selected_ringtone)

internal fun isDefaultAlarmSoundUri(uri: Uri): Boolean {
    val uriText = uri.toString()
    return listOf(
        RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
        Settings.System.DEFAULT_ALARM_ALERT_URI,
    ).any { defaultUri -> defaultUri != null && uriText == defaultUri.toString() }
}

internal fun familyMemberLabel(context: Context, member: FamilyGroupMember): String =
    member.name?.takeIf { it.isNotBlank() }
        ?: member.email?.takeIf { it.isNotBlank() }
        ?: context.getString(R.string.editor2_family_member_fallback)

internal fun familyAlarmQuietScheduleLabel(context: Context, member: FamilyGroupMember): String {
    val windows = familyAlarmQuietWindows(member)
    if (windows.isEmpty()) return ""
    // '누구를 깨울까요' 시트·수신자 카드 행에 들어가므로 1개만 노출하고 나머지는 '외 N개'로 축약해
    // 행 라벨이 길어지지 않게 한다(설정 화면 quietScheduleLabel과 동일 정책).
    val first = windows.first().let { "${quietDaysLabelForFamily(context, it.days)} ${it.start}-${it.end}" }
    val hidden = windows.size - 1
    return if (hidden > 0) context.getString(R.string.misc2_quiet_more, first, hidden) else first
}

internal fun isFamilyAlarmTimeUnavailable(
    member: FamilyGroupMember,
    hour: Int,
    minute: Int,
    repeatDaysMask: Int,
    nowMillis: Long = System.currentTimeMillis(),
): Boolean {
    val dayIndices = familyAlarmTargetDayIndices(hour, minute, repeatDaysMask, nowMillis)
    return familyAlarmQuietWindows(member).any { window ->
        dayIndices.any { dayIndex -> window.blocks(dayIndex, hour, minute) }
    }
}

internal fun familyAlarmQuietWindows(member: FamilyGroupMember): List<FamilyAlarmQuietWindow> {
    val fallback = FamilyAlarmQuietWindow(
        days = safeQuietDays(runCatching { member.familyAlarmQuietDays }.getOrNull()),
        start = safeQuietTime(runCatching { member.familyAlarmQuietStart }.getOrNull(), "09:00"),
        end = safeQuietTime(runCatching { member.familyAlarmQuietEnd }.getOrNull(), "18:30"),
    )
    return runCatching { member.familyAlarmQuietWindows }.getOrNull()
        ?.mapNotNull { window ->
            val start = safeQuietTime(runCatching { window.start }.getOrNull(), "")
            val end = safeQuietTime(runCatching { window.end }.getOrNull(), "")
            if (start.isBlank() || end.isBlank()) {
                null
            } else {
                FamilyAlarmQuietWindow(
                    days = safeQuietDays(runCatching { window.days }.getOrNull()),
                    start = start,
                    end = end,
                )
            }
        }
        ?.takeIf { it.isNotEmpty() }
        ?: listOf(fallback)
}

internal fun familyAlarmTargetDayIndices(
    hour: Int,
    minute: Int,
    repeatDaysMask: Int,
    nowMillis: Long,
): List<Int> {
    if (repeatDaysMask != 0) {
        return (0..6).filter { dayIndex -> repeatDaysMask and (1 shl dayIndex) != 0 }
    }
    val nextFireDate = Instant.ofEpochMilli(
        AlarmTimeCalculator.nextFireAtMillis(
            hour = hour,
            minute = minute,
            repeatDaysMask = 0,
            nowMillis = nowMillis,
        ),
    ).atZone(ZoneId.systemDefault()).toLocalDate()
    return listOf(nextFireDate.dayOfWeek.value % 7)
}

internal fun FamilyAlarmQuietWindow.blocks(dayIndex: Int, hour: Int, minute: Int): Boolean {
    if (dayIndex !in safeQuietDays(days)) return false
    val startTime = parseQuietTime(start) ?: return false
    val endTime = parseQuietTime(end) ?: return false
    val target = LocalTime.of(hour, minute)
    return if (startTime <= endTime) {
        !target.isBefore(startTime) && target.isBefore(endTime)
    } else {
        !target.isBefore(startTime) || target.isBefore(endTime)
    }
}

internal fun parseQuietTime(value: String): LocalTime? =
    runCatching { LocalTime.parse(value) }.getOrNull()

internal fun safeQuietDays(days: List<Int>?): List<Int> =
    days
        ?.filter { it in 0..6 }
        ?.distinct()
        ?.sorted()
        ?.takeIf { it.isNotEmpty() }
        ?: listOf(1, 2, 3, 4, 5)

internal fun safeQuietTime(value: String?, fallback: String): String =
    value?.takeIf { it.isNotBlank() } ?: fallback

internal fun quietDaysLabelForFamily(context: Context, days: List<Int>): String {
    val sorted = days.distinct().sorted()
    return when (sorted) {
        emptyList<Int>() -> context.getString(R.string.editor2_quiet_days_none)
        listOf(1, 2, 3, 4, 5) -> context.getString(R.string.editor2_quiet_days_weekdays)
        listOf(0, 6) -> context.getString(R.string.editor2_quiet_days_weekend)
        listOf(0, 1, 2, 3, 4, 5, 6) -> context.getString(R.string.editor2_quiet_days_everyday)
        else -> {
            val weekdayResIds = listOf(
                R.string.editor2_weekday_sun,
                R.string.editor2_weekday_mon,
                R.string.editor2_weekday_tue,
                R.string.editor2_weekday_wed,
                R.string.editor2_weekday_thu,
                R.string.editor2_weekday_fri,
                R.string.editor2_weekday_sat,
            )
            sorted.joinToString(",") { context.getString(weekdayResIds[it]) }
        }
    }
}
