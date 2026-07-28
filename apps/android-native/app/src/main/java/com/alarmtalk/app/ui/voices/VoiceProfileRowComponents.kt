package com.alarmtalk.app

import androidx.annotation.StringRes
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.R
import com.alarmtalk.app.WakerPillShape
import com.alarmtalk.app.network.FamilyVoiceProfile
import com.alarmtalk.app.network.VoiceProfile

// VoiceProfileManagement 행/필드 하위 컴포넌트.

internal enum class VoiceRegistrationStep {
    Source,
    Details,

    /** 등록 요청 후 클론 생성 대기 — 결정 전까지 플로우 밖으로 나가지 않는다. */
    Creating,

    /** 생성 완료 — 미리듣기 문구 확인·수정 후 유지/삭제를 결정하는 스텝. */
    Preview,

    /** 승격 직후 — 알람 문구(사전렌더)를 사용자 주도로 즉시 생성·다운로드하는 스텝.
     *  건너뛰어도 서버 cron 이 백그라운드에서 이어받으므로 언제든 닫을 수 있다. */
    Prerendering,
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun RelationshipDropdownField(
    selection: RelationshipSelection,
    onSelectionChange: (RelationshipSelection) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val presetLabel = selection.preset?.let { stringResource(it.labelRes) }.orEmpty()
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ExposedDropdownMenuBox(
            expanded = expanded,
            onExpandedChange = { expanded = !expanded },
            modifier = Modifier.fillMaxWidth(),
        ) {
            OutlinedTextField(
                value = presetLabel,
                onValueChange = {},
                readOnly = true,
                // 관계는 선택 입력 — 비워도 등록할 수 있다.
                label = { Text(stringResource(R.string.voicesr_relationship_label_required)) },
                placeholder = { Text(stringResource(R.string.voicesr_relationship_placeholder)) },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
                shape = WakerInputShape,
                colors = wakerOutlinedTextFieldColors(),
                modifier = Modifier
                    .fillMaxWidth()
                    .menuAnchor(MenuAnchorType.PrimaryNotEditable),
            )
            ExposedDropdownMenu(
                expanded = expanded,
                onDismissRequest = { expanded = false },
            ) {
                val relationshipOptions = listOf(RelationshipPreset.Custom) +
                    RelationshipPreset.entries.filterNot { it == RelationshipPreset.Custom }
                relationshipOptions.forEach { preset ->
                    DropdownMenuItem(
                        text = { Text(stringResource(preset.labelRes)) },
                        onClick = {
                            expanded = false
                            onSelectionChange(
                                if (preset == RelationshipPreset.Custom) {
                                    selection.copy(preset = preset)
                                } else {
                                    RelationshipSelection(preset = preset, customLabel = "")
                                },
                            )
                        },
                    )
                }
            }
        }
        if (selection.preset == RelationshipPreset.Custom) {
            OutlinedTextField(
                value = selection.customLabel,
                onValueChange = {
                    onSelectionChange(selection.copy(customLabel = it.take(30)))
                },
                label = { Text(stringResource(R.string.voicesr_relationship_custom_label)) },
                placeholder = { Text(stringResource(R.string.voicesr_relationship_custom_placeholder)) },
                singleLine = true,
                shape = WakerInputShape,
                colors = wakerOutlinedTextFieldColors(),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
internal fun ShareVoiceToggleCard(
    enabled: Boolean,
    checked: Boolean,
    title: String,
    description: String,
    onCheckedChange: (Boolean) -> Unit,
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = enabled) { onCheckedChange(!checked) },
        shape = WakerPanelShape,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.42f),
        border = wakerCardBorder(if (enabled) 0.72f else 0.36f),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                MutedText(description)
            }
            AlarmTalkSwitch(
                checked = checked,
                onCheckedChange = onCheckedChange,
                enabled = enabled,
            )
        }
    }
}

// label 은 백엔드에 저장되고 parseRelationshipLabel 로 다시 preset 으로 복원되는
// 정규(canonical) 값이라 로케일과 무관하게 고정한다. labelRes 는 드롭다운 표시용 번역 리소스.
internal enum class RelationshipPreset(val label: String, @StringRes val labelRes: Int) {
    Mom("엄마", R.string.voices2_relationship_mom),
    Dad("아빠", R.string.voices2_relationship_dad),
    Grandma("할머니", R.string.voices2_relationship_grandma),
    Grandpa("할아버지", R.string.voices2_relationship_grandpa),
    Son("아들", R.string.voices2_relationship_son),
    Daughter("딸", R.string.voices2_relationship_daughter),
    Granddaughter("손녀", R.string.voices2_relationship_granddaughter),
    Grandson("손주", R.string.voices2_relationship_grandson),
    Sibling("형제·자매", R.string.voices2_relationship_sibling),
    Boyfriend("남자친구", R.string.voices2_relationship_boyfriend),
    Girlfriend("여자친구", R.string.voices2_relationship_girlfriend),
    Husband("남편", R.string.voices2_relationship_husband),
    Wife("아내", R.string.voices2_relationship_wife),
    Friend("친구", R.string.voices2_relationship_friend),
    Celebrity("연예인", R.string.voices2_relationship_celebrity),
    Custom("직접 입력", R.string.voices2_relationship_custom),
}

internal data class RelationshipSelection(
    val preset: RelationshipPreset? = null,
    val customLabel: String = "",
) {
    val resolved: String
        get() = when (preset) {
            null -> ""
            RelationshipPreset.Custom -> customLabel.trim()
            else -> preset.label
        }

    val isComplete: Boolean
        get() = resolved.isNotBlank()
}

internal fun parseRelationshipLabel(raw: String?): RelationshipSelection {
    val trimmed = raw?.trim().orEmpty()
    if (trimmed.isEmpty()) return RelationshipSelection()
    val match = RelationshipPreset.entries.firstOrNull {
        it != RelationshipPreset.Custom && it.label == trimmed
    }
    return if (match != null) {
        RelationshipSelection(preset = match)
    } else {
        RelationshipSelection(preset = RelationshipPreset.Custom, customLabel = trimmed)
    }
}

/** 유료 클론 목소리의 알람 음성 준비 상태(서버 사전렌더 + 로컬 다운로드) 표시용. */
internal sealed interface CloneVoiceReadiness {
    /** 서버 사전렌더 진행 중 — "준비 중 n/전체". */
    data class Preparing(val generated: Int, val total: Int) : CloneVoiceReadiness

    /** 서버 사전렌더 완료, 로컬 클립 다운로드 중. */
    object Downloading : CloneVoiceReadiness

    /** 사전렌더 생성 실패 — [다시 시도] 버튼 노출. */
    object Failed : CloneVoiceReadiness
}

@Composable
internal fun VoiceProfileRow(
    profile: VoiceProfile,
    enabled: Boolean,
    canShareVoice: Boolean,
    onRename: () -> Unit,
    onShareChange: (Boolean) -> Unit,
    onDelete: () -> Unit,
    readiness: CloneVoiceReadiness? = null,
    onRetryPrerender: () -> Unit = {},
    retryPrerenderBusy: Boolean = false,
    speechStyleFailed: Boolean = false,
    onRetrySpeechStyle: () -> Unit = {},
    retrySpeechStyleBusy: Boolean = false,
) {
    val isProcessing = profile.status == "processing"
    val isDeleting = profile.status == "deleting"
    val rowEnabled = enabled && !isProcessing && !isDeleting
    var menuExpanded by remember { mutableStateOf(false) }
    val isShared = profile.isShared == true
    OutlinedCard(
        shape = WakerCardShape,
        border = wakerCardBorder(),
        colors = CardDefaults.outlinedCardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    Text(
                        text = profile.name,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    // 공유 토글이 '⋮' 시트 안으로 들어가면서 카드에서 상태가 사라졌다 —
                    // 공유는 남에게 내 목소리가 보이는 일이라 열어보지 않아도 알아야 한다.
                    if (isShared) {
                        MutedText(stringResource(R.string.voicesr_sharing_badge))
                    }
                }
                when {
                    isProcessing -> VoiceProgressMessage(stringResource(R.string.voicesr_status_creating))
                    isDeleting -> VoiceProgressMessage(stringResource(R.string.voicesr_status_deleting))
                    else -> {
                        IconButton(
                            onClick = { menuExpanded = true },
                            enabled = rowEnabled,
                        ) {
                            Icon(Icons.Outlined.MoreVert, contentDescription = stringResource(R.string.voicesr_more))
                        }
                        if (menuExpanded) {
                            VoiceProfileMenuSheet(
                                profileName = profile.name,
                                isShared = isShared,
                                canShare = rowEnabled && canShareVoice,
                                onRename = onRename,
                                onShareChange = onShareChange,
                                onDelete = onDelete,
                                onDismiss = { menuExpanded = false },
                            )
                        }
                    }
                }
            }

            if (!isProcessing && !isDeleting) {
                // 알람 음성(사전렌더 21클립) 준비 상태 — 준비 완료(서버 21/21 + 로컬 다운로드
                // 완료)면 아무것도 표시하지 않는다.
                when (readiness) {
                    is CloneVoiceReadiness.Preparing -> VoiceProgressMessage(
                        stringResource(
                            R.string.voicesr_prerender_preparing,
                            readiness.generated,
                            readiness.total,
                        ),
                    )

                    CloneVoiceReadiness.Downloading ->
                        VoiceProgressMessage(stringResource(R.string.voicesr_prerender_downloading))

                    CloneVoiceReadiness.Failed -> Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(modifier = Modifier.weight(1f)) {
                            MutedText(stringResource(R.string.voicesr_prerender_failed))
                        }
                        TextButton(
                            onClick = onRetryPrerender,
                            enabled = rowEnabled && !retryPrerenderBusy,
                        ) {
                            Text(stringResource(R.string.voicesr_prerender_retry))
                        }
                    }

                    null -> Unit
                }
                if (speechStyleFailed) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(modifier = Modifier.weight(1f)) {
                            MutedText(stringResource(R.string.voicesr_speech_style_failed))
                        }
                        TextButton(
                            onClick = onRetrySpeechStyle,
                            enabled = rowEnabled && !retrySpeechStyleBusy,
                        ) {
                            Text(stringResource(R.string.voicesr_speech_style_retry))
                        }
                    }
                }
            }
        }
    }
}

/**
 * 목소리 행의 '⋮' 메뉴. Material3 DropdownMenu(작은 흰 박스) 대신 앱 고유 바텀시트를 쓴다 —
 * 이 앱의 다른 선택 UI(테마·목소리·수신자)가 전부 이 시트라서 톤이 맞고, 손가락이 닿는
 * 화면 아래쪽에서 열려 한 손 조작이 쉽다.
 *
 * '정보 수정'이 아니라 '이름 수정'이다: 알람 클립은 등록 시점에 통째로 렌더되므로 나중에
 * 관계·호칭을 바꿔도 이미 만들어진 클립이 부르는 말은 바뀌지 않는다(서버도 등록 완료 후엔
 * 페르소나 변경을 거부한다). 이름은 클립에 들어가지 않고 목록·선택 시트 표시용이라 언제든
 * 고칠 수 있어야 한다 — 목소리는 계정당 1개, 교체는 월 1회라 등록 때 낸 오타를 못 고치면
 * 한 달을 그대로 산다.
 */
@Composable
private fun VoiceProfileMenuSheet(
    profileName: String,
    isShared: Boolean,
    canShare: Boolean,
    onRename: () -> Unit,
    onShareChange: (Boolean) -> Unit,
    onDelete: () -> Unit,
    onDismiss: () -> Unit,
) {
    WakerSelectionSheet(title = profileName, onDismiss = onDismiss) { dismiss ->
        WakerSheetOptionRow(
            title = stringResource(R.string.voicesr_edit_name),
            selected = false,
            onClick = {
                dismiss()
                onRename()
            },
            divider = true,
        )
        WakerSheetOptionRow(
            title = stringResource(R.string.voicesr_share_voice),
            description = stringResource(
                if (canShare) R.string.voicesr_share_voice_desc else R.string.voicesr_share_voice_locked,
            ),
            selected = false,
            onClick = { if (canShare) onShareChange(!isShared) },
            trailing = {
                AlarmTalkSwitch(
                    checked = isShared,
                    onCheckedChange = onShareChange,
                    enabled = canShare,
                )
            },
            divider = true,
        )
        WakerSheetOptionRow(
            title = stringResource(R.string.voicesr_delete),
            selected = false,
            onClick = {
                dismiss()
                onDelete()
            },
            // 파괴적 항목은 색으로만 구분한다 — 아이콘을 붙이면 나머지 두 행에도 장식용
            // 아이콘을 달아야 균형이 맞고, 그때부터 시트가 아이콘 목록처럼 보인다.
            destructive = true,
        )
    }
}

@Composable
internal fun PlayingEqualizer() {
    val transition = rememberInfiniteTransition(label = "voicePlaying")
    val barColor = MaterialTheme.colorScheme.primary
    Row(
        horizontalArrangement = Arrangement.spacedBy(3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        listOf(0, 160, 320, 120).forEachIndexed { index, delayMillis ->
            val scale by transition.animateFloat(
                initialValue = 0.35f,
                targetValue = 1f,
                animationSpec = infiniteRepeatable(
                    animation = tween(durationMillis = 520, delayMillis = delayMillis),
                    repeatMode = RepeatMode.Reverse,
                ),
                label = "bar$index",
            )
            Box(
                modifier = Modifier
                    .width(3.dp)
                    .height((6 + scale * 14).dp)
                    .background(barColor, WakerPillShape),
            )
        }
    }
}

@Composable
internal fun SharedVoiceProfileRow(
    profile: FamilyVoiceProfile,
    isPlaying: Boolean,
    onPlay: () -> Unit,
) {
    OutlinedCard(
        shape = WakerCardShape,
        border = wakerCardBorder(),
        colors = CardDefaults.outlinedCardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Text(profile.name, fontWeight = FontWeight.SemiBold)
                val ownerText = profile.ownerName?.takeIf { it.isNotBlank() }
                    ?.let { stringResource(R.string.voicesr_shared_from_owner, it) }
                    ?: stringResource(R.string.voicesr_shared_voice)
                MutedText(ownerText)
            }
            IconButton(onClick = onPlay) {
                if (isPlaying) {
                    PlayingEqualizer()
                } else {
                    // 맨몸 벡터 대신 은은한 원형 배경 위 라운드 재생 아이콘 — 리스트에서 눌리는
                    // 대상임이 분명해지고 기본 아이콘 티가 덜 난다.
                    Box(
                        modifier = Modifier
                            .size(34.dp)
                            .background(
                                MaterialTheme.colorScheme.secondaryContainer,
                                androidx.compose.foundation.shape.CircleShape,
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            Icons.Rounded.PlayArrow,
                            contentDescription = stringResource(R.string.voicesr_play_shared_sample),
                            tint = MaterialTheme.colorScheme.onSecondaryContainer,
                            modifier = Modifier.size(22.dp),
                        )
                    }
                }
            }
        }
    }
}

