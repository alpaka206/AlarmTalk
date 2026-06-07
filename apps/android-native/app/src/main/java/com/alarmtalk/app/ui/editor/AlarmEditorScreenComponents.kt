package com.alarmtalk.app

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Base64
import android.util.Log
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.alarmtalk.app.core.VoiceAlarmLog.TAG
import com.alarmtalk.app.data.AlarmAudioLimits
import com.alarmtalk.app.data.AlarmAudioStore
import com.alarmtalk.app.data.AlarmDraft
import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.AlarmTimeCalculator
import com.alarmtalk.app.data.AlarmVoiceRecorder
import com.alarmtalk.app.data.CachedAlarmAudio
import com.alarmtalk.app.data.DynamicPromptPreferenceStore
import com.alarmtalk.app.data.DynamicPromptPreferences
import com.alarmtalk.app.data.toDynamicPromptSettings
import com.alarmtalk.app.data.VibrationPatterns
import com.alarmtalk.app.data.VoiceSources
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.DynamicPromptSettings
import com.alarmtalk.app.network.FamilyAlarmQuietWindow
import com.alarmtalk.app.network.FamilyGroupCurrentResponse
import com.alarmtalk.app.network.FamilyGroupMember
import com.alarmtalk.app.network.FamilyVoiceProfile
import com.alarmtalk.app.network.TtsGenerateRequest
import com.alarmtalk.app.network.TtsGenerateResponse
import com.alarmtalk.app.network.VoiceProfile
import com.alarmtalk.app.network.trimmedOrNull
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal fun SharedVoiceInfoRequiredDialog(
    profileName: String,
    sharedFromLabel: String,
    initialRelationship: String,
    initialListenerTitle: String,
    saving: Boolean,
    previewing: Boolean,
    onDismiss: () -> Unit,
    onPreview: () -> Unit,
    onConfirm: (String, String) -> Unit,
) {
    var draftRelationship by remember(initialRelationship) { mutableStateOf(initialRelationship) }
    var draftListenerTitle by remember(initialListenerTitle) { mutableStateOf(initialListenerTitle) }
    var submitted by remember { mutableStateOf(false) }
    val relationshipError = submitted && draftRelationship.isBlank()
    val listenerTitleError = submitted && draftListenerTitle.isBlank()

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .widthIn(max = 460.dp),
            shape = WakerCardShape,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 0.dp,
            shadowElevation = 18.dp,
            border = wakerCardBorder(),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 620.dp)
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                ModalDialogTitle(
                    title = "목소리 설정",
                    onDismiss = onDismiss,
                )
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(18.dp),
                    color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f),
                    border = wakerCardBorder(),
                ) {
                    Column(
                        modifier = Modifier.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Text(
                            text = profileName,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onPrimaryContainer,
                        )
                        Text(
                            text = sharedFromLabel,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.76f),
                        )
                    }
                }
                OutlinedTextField(
                    value = draftRelationship,
                    onValueChange = { draftRelationship = it.take(30) },
                    label = { Text("나와의 관계") },
                    placeholder = { Text("예: 손녀, 엄마, 연인") },
                    singleLine = true,
                    isError = relationshipError,
                    supportingText = {
                        if (relationshipError) Text("꼭 입력해 주세요.")
                    },
                    shape = WakerInputShape,
                    colors = wakerOutlinedTextFieldColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = draftListenerTitle,
                    onValueChange = { draftListenerTitle = it.take(30) },
                    label = { Text("이 목소리가 나를 부를 이름") },
                    placeholder = { Text("예: 지호야, 여보") },
                    singleLine = true,
                    isError = listenerTitleError,
                    supportingText = {
                        if (listenerTitleError) Text("꼭 입력해 주세요.")
                    },
                    shape = WakerInputShape,
                    colors = wakerOutlinedTextFieldColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedButton(
                    onClick = onPreview,
                    enabled = !saving && !previewing,
                    modifier = Modifier.fillMaxWidth(),
                    shape = WakerButtonShape,
                    border = wakerCardBorder(),
                    colors = wakerOutlinedButtonColors(),
                ) {
                    if (previewing) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(18.dp),
                            strokeWidth = 2.dp,
                        )
                        Spacer(Modifier.width(8.dp))
                        Text("재생 중")
                    } else {
                        Icon(Icons.Outlined.PlayArrow, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("미리듣기")
                    }
                }
                Button(
                    onClick = {
                        submitted = true
                        if (draftRelationship.isNotBlank() && draftListenerTitle.isNotBlank()) {
                            onConfirm(draftRelationship.trim(), draftListenerTitle.trim())
                        }
                    },
                    enabled = !saving,
                    modifier = Modifier.fillMaxWidth(),
                    shape = WakerButtonShape,
                ) {
                    Text(if (saving) "저장 중" else "저장하고 선택")
                }
            }
        }
    }
}


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

@Composable
internal fun AlarmEditorTopBar(
    isEditing: Boolean,
    familyAlarmMode: Boolean,
    onCancel: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 8.dp, top = 4.dp, end = 20.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onCancel) {
            Icon(
                imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                contentDescription = "닫기",
            )
        }
        Spacer(Modifier.width(8.dp))
        Text(
            text = when {
                familyAlarmMode -> "상대 알람 맞추기"
                isEditing -> "알람 수정"
                else -> "새 알람"
            },
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onBackground,
        )
    }
}

@Composable
internal fun EditorSectionTitle(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleLarge,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onBackground,
    )
}

@Composable
internal fun FamilyAlarmTargetCard(
    recipients: List<FamilyGroupMember>,
    selectedRecipientId: String?,
    hour: Int,
    minute: Int,
    repeatDaysMask: Int,
    holidayOff: Boolean,
    onSelectRecipient: (String) -> Unit,
) {
    var recipientDialogOpen by remember { mutableStateOf(false) }
    val selectedRecipient = recipients.firstOrNull { it.userId == selectedRecipientId }
        ?: recipients.firstOrNull()
    val leadTooSoon = isFamilyAlarmLeadTooSoon(hour, minute, repeatDaysMask, holidayOff)
    val quietUnavailable = selectedRecipient?.let {
        isFamilyAlarmTimeUnavailable(it, hour, minute, repeatDaysMask)
    } ?: false

    if (recipientDialogOpen) {
        AlertDialog(
            onDismissRequest = { recipientDialogOpen = false },
            title = {
                ModalDialogTitle(
                    title = "알람 받을 사람 선택",
                    onDismiss = { recipientDialogOpen = false },
                )
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    recipients.forEach { recipient ->
                        RecipientPickerRow(
                            recipient = recipient,
                            selected = recipient.userId == selectedRecipient?.userId,
                            onClick = {
                                onSelectRecipient(recipient.userId)
                                recipientDialogOpen = false
                            },
                        )
                    }
                }
            },
            confirmButton = {},
        )
    }

    Card(
        shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("알람 받을 사람", fontWeight = FontWeight.SemiBold)
                if (recipients.size > 1) {
                    TextButton(onClick = { recipientDialogOpen = true }) {
                        Text("변경")
                    }
                }
            }
            if (recipients.isEmpty()) {
                MutedText("상대가 내 알람 맞추기를 허용하면 여기에 표시돼요.")
            } else {
                RecipientSummaryRow(
                    recipient = requireNotNull(selectedRecipient),
                    clickable = recipients.size > 1,
                    onClick = { recipientDialogOpen = true },
                )

                FamilyAlarmTargetStatus(
                    leadTooSoon = leadTooSoon,
                    quietUnavailable = quietUnavailable,
                    quietLabel = familyAlarmQuietScheduleLabel(selectedRecipient),
                )

                if (recipients.size == 1) {
                    MutedText("이 알람은 선택된 한 사람에게만 설정돼요.")
                }
            }
        }
    }
}

@Composable
internal fun RecipientSummaryRow(
    recipient: FamilyGroupMember,
    clickable: Boolean,
    onClick: () -> Unit,
) {
    val content: @Composable () -> Unit = {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Text(
                    text = familyMemberLabel(recipient),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                recipient.email?.takeIf { it.isNotBlank() }?.let { email ->
                    MutedText(email)
                }
            }
            if (clickable) {
                Spacer(Modifier.width(12.dp))
                Text(
                    text = ">",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
    }

    if (clickable) {
        Surface(
            onClick = onClick,
            modifier = Modifier.fillMaxWidth(),
            shape = androidx.compose.foundation.shape.RoundedCornerShape(14.dp),
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.52f),
        ) {
            content()
        }
    } else {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = androidx.compose.foundation.shape.RoundedCornerShape(14.dp),
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.52f),
        ) {
            content()
        }
    }
}

@Composable
internal fun RecipientPickerRow(
    recipient: FamilyGroupMember,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
        color = if (selected) {
            MaterialTheme.colorScheme.secondaryContainer
        } else {
            MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)
        },
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(familyMemberLabel(recipient), fontWeight = FontWeight.SemiBold)
                MutedText("받지 않는 시간: ${familyAlarmQuietScheduleLabel(recipient)}")
            }
            if (selected) {
                Text(
                    text = "선택",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }
}

@Composable
internal fun FamilyAlarmTargetStatus(
    leadTooSoon: Boolean,
    quietUnavailable: Boolean,
    quietLabel: String,
) {
    val blocked = leadTooSoon || quietUnavailable
    val statusText = when {
        leadTooSoon -> "지금부터 30분 뒤 알람부터 설정할 수 있어요."
        quietUnavailable -> "상대가 이 시간에는 알람을 받지 않도록 해뒀어요."
        else -> "설정 가능"
    }
    Surface(
        shape = androidx.compose.foundation.shape.RoundedCornerShape(999.dp),
        color = if (blocked) {
            MaterialTheme.colorScheme.errorContainer
        } else {
            MaterialTheme.colorScheme.primaryContainer
        },
        contentColor = if (blocked) {
            MaterialTheme.colorScheme.onErrorContainer
        } else {
            MaterialTheme.colorScheme.onPrimaryContainer
        },
    ) {
        Text(
            text = statusText,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.SemiBold,
        )
    }
    MutedText("받지 않는 시간: $quietLabel")
}

private const val FAMILY_ALARM_MIN_LEAD_MILLIS = 30 * 60 * 1_000L

internal fun ringtoneTitle(context: Context, uri: Uri): String =
    runCatching {
        RingtoneManager.getRingtone(context, uri)?.getTitle(context)
    }.getOrNull()?.takeIf { it.isNotBlank() } ?: "선택한 알람"

internal fun isDefaultAlarmSoundUri(uri: Uri): Boolean {
    val uriText = uri.toString()
    return listOf(
        RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
        Settings.System.DEFAULT_ALARM_ALERT_URI,
    ).any { defaultUri -> defaultUri != null && uriText == defaultUri.toString() }
}

internal fun familyMemberLabel(member: FamilyGroupMember): String =
    member.name?.takeIf { it.isNotBlank() }
        ?: member.email?.takeIf { it.isNotBlank() }
        ?: "멤버"

internal fun familyAlarmQuietScheduleLabel(member: FamilyGroupMember): String {
    val windows = familyAlarmQuietWindows(member)
    return windows.joinToString(" · ") { window ->
        "${quietDaysLabelForFamily(window.days)} ${window.start}-${window.end}"
    }
}

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

internal fun quietDaysLabelForFamily(days: List<Int>): String {
    val sorted = days.distinct().sorted()
    return when (sorted) {
        emptyList<Int>() -> "없음"
        listOf(1, 2, 3, 4, 5) -> "평일"
        listOf(0, 6) -> "주말"
        listOf(0, 1, 2, 3, 4, 5, 6) -> "매일"
        else -> sorted.joinToString(",") { listOf("일", "월", "화", "수", "목", "금", "토")[it] }
    }
}
