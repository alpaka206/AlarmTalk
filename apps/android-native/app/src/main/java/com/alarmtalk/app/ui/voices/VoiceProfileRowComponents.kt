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
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.PlayArrow
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
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = profile.name,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.weight(1f, fill = false),
                        )
                        if (canShareVoice && isShared && !isProcessing && !isDeleting) {
                            VoiceSharedBadge()
                        }
                    }
                }
                when {
                    isProcessing -> VoiceProgressMessage(stringResource(R.string.voicesr_status_creating))
                    isDeleting -> VoiceProgressMessage(stringResource(R.string.voicesr_status_deleting))
                    else -> {
                        Box {
                            IconButton(
                                onClick = { menuExpanded = true },
                                enabled = rowEnabled,
                            ) {
                                Icon(Icons.Outlined.MoreVert, contentDescription = stringResource(R.string.voicesr_more))
                            }
                            DropdownMenu(
                                expanded = menuExpanded,
                                onDismissRequest = { menuExpanded = false },
                            ) {
                                DropdownMenuItem(
                                    text = { Text(stringResource(R.string.voicesr_edit_info)) },
                                    leadingIcon = { Icon(Icons.Outlined.Edit, contentDescription = null) },
                                    onClick = {
                                        menuExpanded = false
                                        onRename()
                                    },
                                )
                                DropdownMenuItem(
                                    text = { Text(stringResource(R.string.voicesr_delete)) },
                                    leadingIcon = { Icon(Icons.Outlined.Delete, contentDescription = null) },
                                    onClick = {
                                        menuExpanded = false
                                        onDelete()
                                    },
                                )
                            }
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
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = WakerPanelShape,
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.42f),
                    border = wakerCardBorder(if (canShareVoice) 0.72f else 0.36f),
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(
                            modifier = Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(3.dp),
                        ) {
                            Text(
                                text = stringResource(R.string.voicesr_share_voice),
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                        AlarmTalkSwitch(
                            checked = isShared,
                            onCheckedChange = onShareChange,
                            enabled = rowEnabled && canShareVoice,
                        )
                    }
                }
            }
        }
    }
}

@Composable
internal fun VoiceSharedBadge() {
    Surface(
        shape = WakerPillShape,
        color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.65f),
    ) {
        Text(
            text = stringResource(R.string.voicesr_sharing_badge),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onPrimaryContainer,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
        )
    }
}

/**
 * 인사말 미리듣기 재생 중임을 나타내는 작은 이퀄라이저 애니메이션.
 * 기본 목소리 선택 시트(VoiceProfileManagementPanel)의 옵션 행 trailing 에 쓰인다.
 */
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
                    Icon(
                        Icons.Outlined.PlayArrow,
                        contentDescription = stringResource(R.string.voicesr_play_shared_sample),
                    )
                }
            }
        }
    }
}

