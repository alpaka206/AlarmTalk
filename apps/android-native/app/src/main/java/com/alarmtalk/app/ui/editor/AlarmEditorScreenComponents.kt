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
import com.alarmtalk.app.network.VoiceProfile


internal fun resolveListenerTitle(
    profileId: String,
    voiceProfiles: List<VoiceProfile>,
): String? =
    voiceProfiles.firstOrNull { it.id == profileId }?.listenerTitle?.takeIf { it.isNotBlank() }

// 편집기 섹션 헤더 단일 출처. 예전 titleMedium/Bold 는 카드 안 행 제목(titleMedium/SemiBold)과
// 크기가 같아 섹션 경계가 안 읽혔다 — 그룹 리스트 헤더 관례대로 한 단계 조용하게
// (titleSmall + onSurfaceVariant) 낮춰 행 제목과 위계를 분리한다.
@Composable
internal fun EditorSectionTitle(title: String, modifier: Modifier = Modifier) {
    Text(
        text = title,
        modifier = modifier,
        style = MaterialTheme.typography.titleSmall,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
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
