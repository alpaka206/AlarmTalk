package com.alarmtalk.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.CloudDownload
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.VoiceSources
import com.alarmtalk.app.data.isSystemVoiceId

/**
 * **다음 알람 상태**(2026-10-26 v1.3 W06, `docs/spec/alarm-lifecycle.md` 「다음 알람 상태 카드」) — 홈이 다음 알람에 대해 지금
 * 해야 할 일 **하나**를 말한다. 울리는 순간에는 아무것도 부르지 않는다(이 판정은 홈 화면에서만 돈다).
 *
 * 우선순위: 권한(제때·잠금 화면에 못 뜰 수 있다) → 기본 목소리를 받는 중 → 날씨 갱신 실패 → 등록 목소리 이용 종료 예정 → 정상.
 * 재동의·탈퇴 대기는 앱 전체를 막는 화면이 따로 있어 여기서 다루지 않는다. iOS 짝은 `NextAlarmStatus.swift`.
 */
internal sealed interface NextAlarmStatus {
    data object Ready : NextAlarmStatus
    data class PermissionMissing(val target: PermissionTarget) : NextAlarmStatus
    data object VoicePreparing : NextAlarmStatus
    data object WeatherStale : NextAlarmStatus
    data class VoiceEnding(val endsAtMillis: Long) : NextAlarmStatus
}

/** 날씨 테마는 울리기 하루 안쪽이 되면 그 날의 조건을 받아 둔다 — 그 창 안인데 이만큼 오래된 답이면 갱신하지 못한 것이다. */
private const val WEATHER_WINDOW_MS = 24L * 60 * 60 * 1000
private const val WEATHER_STALE_MS = 30L * 60 * 60 * 1000

internal fun nextAlarmStatus(
    alarm: AlarmEntity,
    nextFireAtMillis: Long,
    missingPermission: PermissionTarget?,
    defaultVoiceDownloadInProgress: Boolean,
    limitedPlanEndsAtMillis: Long?,
    nowMillis: Long,
): NextAlarmStatus {
    if (missingPermission != null) return NextAlarmStatus.PermissionMissing(missingPermission)
    val speaks = AlarmPlayModes.normalize(alarm.playMode) == AlarmPlayModes.VOICE_ONLY &&
        alarm.voiceSource != VoiceSources.LOCAL_AUDIO
    if (!speaks) return NextAlarmStatus.Ready
    val systemVoice = isSystemVoiceId(alarm.voiceProfileId)
    if (systemVoice && defaultVoiceDownloadInProgress) return NextAlarmStatus.VoicePreparing
    if (alarm.bucketId == "weather" && nextFireAtMillis - nowMillis in 0..WEATHER_WINDOW_MS) {
        val resolved = alarm.contextResolvedAtMillis
        // 지금 기준으로 잰다 — 울릴 시각 기준으로 재면 8시간 전에 받은 답도 23시간 뒤 알람에서는 31시간이 되어 실패로 읽힌다.
        if (resolved == null || nowMillis - resolved > WEATHER_STALE_MS) return NextAlarmStatus.WeatherStale
    }
    if (!systemVoice && !alarm.voiceProfileId.isNullOrBlank() &&
        limitedPlanEndsAtMillis != null && limitedPlanEndsAtMillis <= nextFireAtMillis
    ) {
        return NextAlarmStatus.VoiceEnding(limitedPlanEndsAtMillis)
    }
    return NextAlarmStatus.Ready
}

@Composable
internal fun NextAlarmStatusCard(
    status: NextAlarmStatus,
    voiceName: String?,
    endsAtLabel: String?,
    onRequestPermission: (PermissionTarget) -> Unit,
    modifier: Modifier = Modifier,
) {
    val (icon, tintError) = when (status) {
        NextAlarmStatus.Ready -> Icons.Outlined.CheckCircle to false
        is NextAlarmStatus.PermissionMissing -> Icons.Outlined.ErrorOutline to true
        NextAlarmStatus.VoicePreparing -> Icons.Outlined.CloudDownload to false
        NextAlarmStatus.WeatherStale, is NextAlarmStatus.VoiceEnding -> Icons.Outlined.Info to false
    }
    val text = when (status) {
        NextAlarmStatus.Ready -> stringResource(R.string.next_alarm_status_ready)
        is NextAlarmStatus.PermissionMissing -> stringResource(
            when (status.target) {
                PermissionTarget.Notifications -> R.string.hs_perm_banner_notifications
                PermissionTarget.ExactAlarms -> R.string.hs_perm_banner_exact_alarm
                else -> R.string.hs_perm_banner_full_screen
            },
        )
        NextAlarmStatus.VoicePreparing -> stringResource(R.string.next_alarm_status_preparing)
        NextAlarmStatus.WeatherStale -> stringResource(R.string.next_alarm_status_weather)
        is NextAlarmStatus.VoiceEnding -> stringResource(R.string.next_alarm_status_voice_ending, endsAtLabel.orEmpty())
    }
    OutlinedCard(
        onClick = { (status as? NextAlarmStatus.PermissionMissing)?.let { onRequestPermission(it.target) } },
        enabled = status is NextAlarmStatus.PermissionMissing,
        shape = WakerTileShape,
        border = wakerCardBorder(),
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(
                icon,
                contentDescription = null,
                tint = if (tintError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(20.dp),
            )
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    text = voiceName?.let { stringResource(R.string.next_alarm_status_title_voice, it) }
                        ?: stringResource(R.string.next_alarm_status_title),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(text = text, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}
