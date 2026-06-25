package com.alarmtalk.app

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.KeyboardArrowUp
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Save
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.R
import com.alarmtalk.app.WakerChipShape
import com.alarmtalk.app.WakerPanelShape
import com.alarmtalk.app.WakerTileShape
import com.alarmtalk.app.data.AlarmAudioLimits
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.VibrationPatterns
import com.alarmtalk.app.data.VoiceSources
import com.alarmtalk.app.network.FamilyVoiceProfile
import com.alarmtalk.app.network.VoiceProfile

@Composable
internal fun VoiceAudioCard(
    editor: AlarmEditorState,
    voiceProfiles: List<VoiceProfile>,
    familyVoices: List<FamilyVoiceProfile>,
    voiceProfileBusy: Boolean,
    stockClips: List<com.alarmtalk.app.network.StockClip>,
    selectedStockMessageId: String?,
    previewingStockMessageId: String?,
    onPreviewStockClip: (com.alarmtalk.app.network.StockClip) -> Unit,
    onSelectStockClip: (com.alarmtalk.app.network.StockClip) -> Unit,
    // 무료 플랜 제한 모드 — 녹음/파일·직접 입력·동적 문구는 [onLockedFeature] 로 게이트.
    freeVoiceTier: Boolean,
    onLockedFeature: () -> Unit,
    audioMessage: String?,
    localInputMode: VoiceCaptureMode,
    isRecording: Boolean,
    recordingElapsedMillis: Long,
    recordingLevels: List<Float>,
    selectedFileDurationMillis: Long?,
    cropStartMillis: Long,
    cropEndMillis: Long,
    isCropPreviewActive: Boolean,
    isCachedAudioPreviewActive: Boolean,
    isPreviewPreparing: Boolean,
    onLocalInputModeChange: (VoiceCaptureMode) -> Unit,
    onPick: () -> Unit,
    onRecord: () -> Unit,
    onCropChange: (Long, Long) -> Unit,
    onPreviewCrop: () -> Unit,
    onPreviewAudio: () -> Unit,
    onCreateVoiceProfileClick: () -> Unit,
    onSharedVoiceInfoRequired: (FamilyVoiceProfile) -> Unit,
    onOpenRandomPromptSettings: () -> Unit,
    onOpenVoiceTranslationSettings: () -> Unit,
    onClear: () -> Unit,
) {
    val context = LocalContext.current
    val visibleVoiceSource = if (editor.voiceSource == VoiceSources.SERVER_TTS) {
        VoiceSources.TTS_PROFILE
    } else {
        editor.voiceSource
    }
    val readyProfiles = voiceProfiles.filter { it.status == null || it.status == "ready" }
    val readyFamilyVoices = familyVoices.filter {
        (it.status == null || it.status == "ready") && it.isShared != false
    }
    val profileOptions = readyProfiles.map {
        VoiceProfileOption(
            id = it.id,
            name = it.name,
            detail = ownedVoiceDetail(context, it),
        )
    } +
        readyFamilyVoices.map { profile ->
            VoiceProfileOption(
                id = profile.id,
                name = profile.name,
                detail = sharedVoiceDetail(context, profile),
                sharedProfile = profile,
            )
        }
    LaunchedEffect(editor.voiceSource) {
        if (editor.voiceSource == VoiceSources.SERVER_TTS) {
            editor.voiceSource = VoiceSources.TTS_PROFILE
            editor.clearTtsMeta()
        }
    }

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
            OptionChips(
                options = listOf(
                    VoiceSources.TTS_PROFILE to stringResource(R.string.editor_voice_source_tts),
                    VoiceSources.LOCAL_AUDIO to stringResource(R.string.editor_voice_source_local),
                ),
                selected = visibleVoiceSource,
                onSelect = {
                    if (freeVoiceTier && it == VoiceSources.LOCAL_AUDIO) {
                        onLockedFeature()
                        return@OptionChips
                    }
                    editor.voiceSource = it
                    if (it == VoiceSources.TTS_PROFILE) {
                        editor.clearAudio()
                        editor.clearTtsMeta()
                    } else {
                        editor.clearTtsMeta()
                    }
                },
            )

            if (visibleVoiceSource == VoiceSources.TTS_PROFILE) {
                LaunchedEffect(visibleVoiceSource, voiceProfileBusy, profileOptions, editor.voiceProfileId) {
                    if (
                        visibleVoiceSource == VoiceSources.TTS_PROFILE &&
                        !voiceProfileBusy &&
                        profileOptions.isNotEmpty()
                    ) {
                        val selectedProfileAvailable = profileOptions.any { it.id == editor.voiceProfileId }
                        if (editor.voiceProfileId.isNullOrBlank() || !selectedProfileAvailable) {
                            editor.voiceProfileId = profileOptions.first().id
                            editor.clearTtsMeta()
                        }
                    }
                }
                val selectedProfileUnavailable = !voiceProfileBusy &&
                    !editor.voiceProfileId.isNullOrBlank() &&
                    profileOptions.none { it.id == editor.voiceProfileId }
                Text(stringResource(R.string.editor_voice_to_hear), fontWeight = FontWeight.SemiBold)
                if (voiceProfileBusy) {
                    MutedText(stringResource(R.string.editor_voice_loading))
                } else if (profileOptions.isEmpty()) {
                    NoUsableVoiceProfileCallout(onCreateVoiceProfileClick)
                } else {
                    VoiceProfileSelector(
                        options = profileOptions,
                        selectedId = editor.voiceProfileId ?: "",
                        onSelect = { option ->
                            val sharedProfile = option.sharedProfile
                            if (sharedProfile?.requiresViewerInfo() == true) {
                                onSharedVoiceInfoRequired(sharedProfile)
                                return@VoiceProfileSelector
                            }
                            editor.voiceProfileId = option.id
                            editor.clearTtsMeta()
                        },
                    )
                }
                // 유료 플랜은 랜덤 문구/직접 입력으로 충분하므로 기본 제공(스톡) 음성은
                // 무료 플랜에서만 노출한다.
                if (freeVoiceTier) {
                    StockClipDropdown(
                        clips = stockClips.filter {
                            it.voiceProfileId == editor.voiceProfileId &&
                                it.category != com.alarmtalk.app.data.STOCK_GREETING_CATEGORY
                        },
                        isSystemVoice = com.alarmtalk.app.data.isSystemVoiceId(editor.voiceProfileId),
                        selectedStockMessageId = selectedStockMessageId,
                        previewingStockMessageId = previewingStockMessageId,
                        onPreviewStockClip = onPreviewStockClip,
                        onSelectStockClip = onSelectStockClip,
                    )
                }
                if (selectedProfileUnavailable) {
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = WakerChipShape,
                        color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.58f),
                    ) {
                        Column(
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Text(
                                text = stringResource(R.string.editor_voice_deleted_title),
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onErrorContainer,
                            )
                            Text(
                                text = stringResource(R.string.editor_voice_deleted_desc),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onErrorContainer.copy(alpha = 0.78f),
                            )
                        }
                    }
                }
                if (profileOptions.isNotEmpty()) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(stringResource(R.string.editor_random_prompt_use), fontWeight = FontWeight.SemiBold)
                        }
                        AlarmTalkSwitch(
                            checked = editor.voiceRandomPrompt,
                            onCheckedChange = { checked ->
                                if (checked) {
                                    onOpenRandomPromptSettings()
                                } else if (freeVoiceTier) {
                                    // 직접 입력은 유료 — 무료는 프리셋 랜덤 문구로 고정.
                                    onLockedFeature()
                                } else {
                                    editor.voiceRandomPrompt = false
                                    editor.clearAudio()
                                    editor.clearTtsMeta()
                                }
                            },
                        )
                    }
                    if (!editor.voiceRandomPrompt) {
                        ManualVoiceMessageField(
                            text = editor.voiceText,
                            translationEnabled = editor.voiceTranslationEnabled,
                            language = editor.voiceLanguage,
                            onTextChange = {
                                editor.voiceText = it.take(200)
                                editor.clearTtsMeta()
                            },
                            onTranslationEnabledChange = { enabled ->
                                editor.voiceTranslationEnabled = enabled
                                if (enabled && editor.voiceLanguage == "ko") {
                                    editor.voiceLanguage = "en"
                                }
                                editor.clearTtsMeta()
                            },
                            onOpenTranslationSettings = onOpenVoiceTranslationSettings,
                        )
                    } else {
                        RandomPromptSummaryRow(
                            language = editor.voiceLanguage,
                            randomContext = editor.voiceRandomContext,
                            // 동적(날씨/운세) 문구·언어 설정은 유료 — 무료는 기본 프리셋 고정.
                            onClick = if (freeVoiceTier) onLockedFeature else onOpenRandomPromptSettings,
                        )
                    }
                }
            } else {
                VoiceCaptureModeSelector(
                    selected = localInputMode,
                    enabled = !isRecording,
                    onSelect = onLocalInputModeChange,
                )
                if (localInputMode == VoiceCaptureMode.Record) {
                    VoiceRecordControls(
                        isRecording = isRecording,
                        elapsedMillis = recordingElapsedMillis,
                        maxDurationMillis = AlarmAudioLimits.MAX_DURATION_MILLIS,
                        levels = recordingLevels,
                        enabled = true,
                        notice = stringResource(R.string.editor_audio_max_duration, AlarmAudioLimits.MAX_DURATION_MILLIS / 1000),
                        onRecordClick = onRecord,
                    )
                } else {
                    VoiceFileControls(
                        durationMillis = selectedFileDurationMillis,
                        cropStartMillis = cropStartMillis,
                        cropEndMillis = cropEndMillis,
                        minDurationMillis = 1_000L,
                        maxDurationMillis = AlarmAudioLimits.MAX_DURATION_MILLIS,
                        enabled = !isRecording,
                        uploadLabel = stringResource(R.string.editor_audio_upload_file),
                        notice = stringResource(R.string.editor_audio_max_duration, AlarmAudioLimits.MAX_DURATION_MILLIS / 1000),
                        isPreviewActive = isCropPreviewActive,
                        isPreviewPreparing = isCropPreviewActive && isPreviewPreparing,
                        onPickFile = onPick,
                        onCropChange = onCropChange,
                        onPreviewCrop = onPreviewCrop,
                    )
                }
                if (editor.localAudioUri != null && !isRecording) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        OutlinedButton(
                            onClick = onPreviewAudio,
                            modifier = Modifier.weight(1f),
                        ) {
                            VoicePreviewButtonIcon(
                                active = isCachedAudioPreviewActive,
                                preparing = isCachedAudioPreviewActive && isPreviewPreparing,
                            )
                        }
                        OutlinedButton(
                            onClick = onClear,
                            modifier = Modifier.weight(1f),
                        ) {
                            Icon(Icons.Outlined.Delete, contentDescription = stringResource(R.string.editor_audio_clear))
                        }
                    }
                }
                if (
                    editor.localAudioUri == null &&
                    selectedFileDurationMillis == null &&
                    !isRecording
                ) {
                    Text(
                        text = stringResource(R.string.editor_audio_record_or_upload),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            // 목소리 크기·반복 재생은 "세부 설정 > 음성 소리" 모달로 옮겼다.
            if (audioMessage != null) {
                Text(
                    text = audioMessage,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (isRecording) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                )
            }
        }
}

// "세부 설정 > 음성 소리" 전체화면 모달. 목소리 크기·반복 재생을 여기로 모아
// 음성 카드 본문을 짧게 유지한다. (스누즈·진동·알람음 모달과 같은 패턴)
@Composable
internal fun VoiceOutputSettingsPane(
    volumePercent: Int,
    onVolumeChange: (Int) -> Unit,
    showRepeat: Boolean,
    repeat: Boolean,
    onRepeatChange: (Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 8.dp, top = 4.dp, end = 16.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onDismiss) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                        contentDescription = stringResource(R.string.editor_back),
                    )
                }
                Spacer(Modifier.width(8.dp))
                Text(
                    text = stringResource(R.string.editor_voice_output_title),
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                )
            }
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 12.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                VoiceVolumeSelector(
                    volumePercent = volumePercent,
                    onVolumeChange = onVolumeChange,
                )
                if (showRepeat) {
                    VoiceRepeatSelector(
                        repeat = repeat,
                        onRepeatChange = onRepeatChange,
                    )
                }
            }
        }
    }
}

private data class VoiceProfileOption(
    val id: String,
    val name: String,
    val detail: String,
    val sharedProfile: FamilyVoiceProfile? = null,
)

@Composable
private fun NoUsableVoiceProfileCallout(
    onCreateVoiceProfileClick: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = WakerPanelShape,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.42f),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = stringResource(R.string.editor_no_voice_profile),
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Button(
                onClick = onCreateVoiceProfileClick,
                shape = WakerButtonShape,
            ) {
                Text(stringResource(R.string.editor_create_voice))
            }
        }
    }
}

// 목소리가 여러 개(내 목소리 + 공유받은 + 기본 제공)면 목록이 길어지므로,
// 평소엔 선택된 목소리 1줄만 보여주고 누르면 펼쳐서 전체에서 고르는 접이식 선택기.
@Composable
private fun VoiceProfileSelector(
    options: List<VoiceProfileOption>,
    selectedId: String,
    onSelect: (VoiceProfileOption) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val selectedOption = options.firstOrNull { it.id == selectedId } ?: options.firstOrNull()
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = WakerChipShape,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f),
    ) {
        Column {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                    ) { expanded = !expanded }
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    Text(
                        text = selectedOption?.name ?: stringResource(R.string.editor_voice_select),
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.SemiBold,
                    )
                    if (selectedOption != null) {
                        MutedText(selectedOption.detail)
                    }
                }
                Spacer(Modifier.width(12.dp))
                Icon(
                    imageVector = if (expanded) {
                        Icons.Outlined.KeyboardArrowUp
                    } else {
                        Icons.Outlined.KeyboardArrowDown
                    },
                    contentDescription = if (expanded) stringResource(R.string.editor_collapse) else stringResource(R.string.editor_expand),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (expanded) {
                Column(
                    modifier = Modifier.padding(start = 8.dp, end = 8.dp, bottom = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    options.forEach { option ->
                        VoiceProfileOptionRow(
                            option = option,
                            selected = option.id == selectedId,
                            onClick = {
                                onSelect(option)
                                expanded = false
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun VoiceProfileOptionRow(
    option: VoiceProfileOption,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = WakerChipShape,
        color = if (selected) {
            MaterialTheme.colorScheme.secondaryContainer
        } else {
            MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)
        },
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 11.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Text(
                    text = option.name,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = if (selected) {
                        MaterialTheme.colorScheme.onSecondaryContainer
                    } else {
                        MaterialTheme.colorScheme.onSurface
                    },
                )
                Text(
                    text = option.detail,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (selected) {
                        MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.74f)
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                )
            }
            Spacer(Modifier.width(12.dp))
            VoiceSelectionDot(selected = selected)
        }
    }
}

@Composable
private fun StockClipDropdown(
    clips: List<com.alarmtalk.app.network.StockClip>,
    isSystemVoice: Boolean,
    selectedStockMessageId: String?,
    previewingStockMessageId: String?,
    onPreviewStockClip: (com.alarmtalk.app.network.StockClip) -> Unit,
    onSelectStockClip: (com.alarmtalk.app.network.StockClip) -> Unit,
) {
    if (!isSystemVoice || clips.isEmpty()) return
    val context = LocalContext.current
    var expanded by remember { mutableStateOf(false) }
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = WakerChipShape,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f),
    ) {
        Column {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                    ) { expanded = !expanded }
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    Text(stringResource(R.string.editor_stock_clip_title), fontWeight = FontWeight.SemiBold)
                    MutedText(stringResource(R.string.editor_stock_clip_subtitle))
                }
                Spacer(Modifier.width(12.dp))
                Icon(
                    imageVector = if (expanded) {
                        Icons.Outlined.KeyboardArrowUp
                    } else {
                        Icons.Outlined.KeyboardArrowDown
                    },
                    contentDescription = if (expanded) stringResource(R.string.editor_collapse) else stringResource(R.string.editor_expand),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (expanded) {
                // 언어를 먼저 고른 뒤, 해당 언어의 카테고리별 알람 클립을 모두 보여준다.
                val langs = remember(clips) {
                    clips.mapNotNull { it.language }
                        .distinct()
                        .sortedBy {
                            val i = StockClipLanguageOrder.indexOf(it)
                            if (i < 0) Int.MAX_VALUE else i
                        }
                }
                val selectedClipLang = clips.firstOrNull { it.messageId == selectedStockMessageId }?.language
                var selectedLang by remember(clips) {
                    mutableStateOf(
                        selectedClipLang ?: langs.firstOrNull { it == "ko" } ?: langs.firstOrNull().orEmpty(),
                    )
                }
                // 선택 언어의 클립을 앱 카테고리 순서(기상→점심→…)대로 노출한다.
                // 언어 매칭이 하나도 없으면 최소한 첫 클립이라도 보여준다.
                val activeClips = remember(clips, selectedLang) {
                    clips.filter { it.language == selectedLang }
                        .sortedBy { stockClipCategoryOrder(it.category) }
                        .ifEmpty { clips.firstOrNull()?.let { listOf(it) } ?: emptyList() }
                }
                Column(
                    modifier = Modifier.padding(start = 14.dp, end = 14.dp, bottom = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        langs.forEach { lang ->
                            FilterChip(
                                selected = lang == selectedLang,
                                onClick = { selectedLang = lang },
                                label = { Text(stockClipLanguageLabel(context, lang)) },
                            )
                        }
                    }
                    activeClips.forEach { clip ->
                        StockClipRow(
                            clip = clip,
                            selected = clip.messageId == selectedStockMessageId,
                            previewing = clip.messageId == previewingStockMessageId,
                            onPreview = { onPreviewStockClip(clip) },
                            onSelect = { onSelectStockClip(clip) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun StockClipRow(
    clip: com.alarmtalk.app.network.StockClip,
    selected: Boolean,
    previewing: Boolean,
    onPreview: () -> Unit,
    onSelect: () -> Unit,
) {
    Surface(
        onClick = onSelect,
        modifier = Modifier.fillMaxWidth(),
        shape = WakerChipShape,
        color = if (selected) {
            MaterialTheme.colorScheme.secondaryContainer
        } else {
            MaterialTheme.colorScheme.surface.copy(alpha = 0.6f)
        },
    ) {
        Row(
            modifier = Modifier.padding(start = 14.dp, end = 6.dp, top = 8.dp, bottom = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                stockClipCategoryLabelRes(clip.category)?.let { labelRes ->
                    Text(
                        text = stringResource(labelRes),
                        style = MaterialTheme.typography.labelSmall,
                        color = if (selected) {
                            MaterialTheme.colorScheme.onSecondaryContainer
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                }
                Text(
                    text = clip.text,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                    color = if (selected) {
                        MaterialTheme.colorScheme.onSecondaryContainer
                    } else {
                        MaterialTheme.colorScheme.onSurface
                    },
                )
            }
            Spacer(Modifier.width(8.dp))
            IconButton(onClick = onPreview) {
                Icon(
                    imageVector = if (previewing) {
                        Icons.Outlined.Stop
                    } else {
                        Icons.Outlined.PlayArrow
                    },
                    contentDescription = if (previewing) stringResource(R.string.editor_stop) else stringResource(R.string.editor_preview),
                    tint = MaterialTheme.colorScheme.primary,
                )
            }
            if (selected) {
                Icon(
                    imageVector = Icons.Outlined.Check,
                    contentDescription = stringResource(R.string.editor_selected_done),
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(Modifier.width(8.dp))
            }
        }
    }
}

private val StockClipLanguageOrder = listOf("ko", "en", "ja")

private fun stockClipLanguageLabel(context: android.content.Context, language: String?): String = when (language) {
    "ko" -> context.getString(R.string.r3ed_stock_clip_lang_ko)
    "en" -> context.getString(R.string.r3ed_stock_clip_lang_en)
    "ja" -> context.getString(R.string.r3ed_stock_clip_lang_ja)
    else -> language.orEmpty()
}

// 스톡 클립을 앱 카테고리 순서(TtsCategories)대로 정렬·표기한다. 알 수 없는
// 카테고리(예: greeting)는 목록 끝으로 보내고 라벨은 숨긴다.
private fun stockClipCategoryOrder(category: String?): Int {
    val i = TtsCategories.indexOfFirst { (key, _) -> key == category }
    return if (i < 0) Int.MAX_VALUE else i
}

private fun stockClipCategoryLabelRes(category: String?): Int? =
    TtsCategories.firstOrNull { (key, _) -> key == category }?.second

@Composable
private fun ManualVoiceMessageField(
    text: String,
    translationEnabled: Boolean,
    language: String,
    onTextChange: (String) -> Unit,
    onTranslationEnabledChange: (Boolean) -> Unit,
    onOpenTranslationSettings: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(stringResource(R.string.editor_manual_input), fontWeight = FontWeight.SemiBold)
            Text(
                text = "${text.length}/200",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        OutlinedTextField(
            value = text,
            onValueChange = onTextChange,
            placeholder = { Text(stringResource(R.string.editor_manual_input_placeholder)) },
            minLines = 3,
            maxLines = 5,
            shape = WakerInputShape,
            colors = wakerOutlinedTextFieldColors(),
            modifier = Modifier.fillMaxWidth(),
        )
        ManualTranslationRow(
            enabled = translationEnabled,
            language = language,
            onEnabledChange = onTranslationEnabledChange,
            onOpenSettings = onOpenTranslationSettings,
        )
    }
}

@Composable
private fun ManualTranslationRow(
    enabled: Boolean,
    language: String,
    onEnabledChange: (Boolean) -> Unit,
    onOpenSettings: () -> Unit,
) {
    val languageLabel = voiceOptionLabelRes(TtsTranslationLanguages, language)?.let { stringResource(it) }.orEmpty()
    Surface(
        onClick = {
            if (enabled) onOpenSettings()
        },
        modifier = Modifier.fillMaxWidth(),
        shape = WakerChipShape,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 11.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Text(stringResource(R.string.editor_translation), fontWeight = FontWeight.SemiBold)
                MutedText(if (enabled) languageLabel else stringResource(R.string.editor_translation_off))
            }
            Spacer(Modifier.width(12.dp))
            if (enabled) {
                Text(
                    text = stringResource(R.string.editor_change),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.width(10.dp))
            }
            AlarmTalkSwitch(
                checked = enabled,
                onCheckedChange = onEnabledChange,
            )
        }
    }
}

@Composable
private fun RandomPromptSummaryRow(
    language: String,
    randomContext: String,
    onClick: () -> Unit,
) {
    val languageLabel = voiceOptionLabelRes(TtsLanguages, language)?.let { stringResource(it) }.orEmpty()
    val contextLabel = voiceOptionLabelRes(
        RandomPromptContexts,
        normalizedRandomPromptContext(randomContext),
    )?.let { stringResource(it) }.orEmpty()
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = WakerChipShape,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Text(stringResource(R.string.editor_random_prompt_settings), fontWeight = FontWeight.SemiBold)
                MutedText("$contextLabel · $languageLabel")
            }
            Spacer(Modifier.width(12.dp))
            Text(
                text = stringResource(R.string.editor_change),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

@Composable
private fun VoiceRepeatSelector(
    repeat: Boolean,
    onRepeatChange: (Boolean) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.editor_voice_repeat_title), fontWeight = FontWeight.SemiBold)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            VoiceRepeatChoice(
                label = stringResource(R.string.editor_voice_repeat_once),
                selected = !repeat,
                onClick = { onRepeatChange(false) },
                modifier = Modifier.weight(1f),
            )
            VoiceRepeatChoice(
                label = stringResource(R.string.editor_voice_repeat_on),
                selected = repeat,
                onClick = { onRepeatChange(true) },
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun VoiceRepeatChoice(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        onClick = onClick,
        modifier = modifier,
        shape = WakerTileShape,
        color = if (selected) {
            MaterialTheme.colorScheme.secondaryContainer
        } else {
            MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)
        },
    ) {
        Text(
            text = label,
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 11.dp),
            style = MaterialTheme.typography.bodyMedium,
            color = if (selected) {
                MaterialTheme.colorScheme.onSecondaryContainer
            } else {
                MaterialTheme.colorScheme.onSurface
            },
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun VoiceVolumeSelector(
    volumePercent: Int,
    onVolumeChange: (Int) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(stringResource(R.string.editor_voice_volume), fontWeight = FontWeight.SemiBold)
            Text(
                text = "${volumePercent.coerceIn(MinVoiceVolumePercent, 100)}%",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontWeight = FontWeight.SemiBold,
            )
        }
        Slider(
            value = volumePercent.coerceIn(MinVoiceVolumePercent, 100).toFloat(),
            onValueChange = { onVolumeChange(it.toInt().coerceIn(MinVoiceVolumePercent, 100)) },
            valueRange = MinVoiceVolumePercent.toFloat()..100f,
            steps = 6,
        )
    }
}

@Composable
private fun VoiceSelectionDot(selected: Boolean) {
    Box(
        modifier = Modifier
            .size(18.dp)
            .background(
                color = if (selected) MaterialTheme.colorScheme.primary else Color.Transparent,
                shape = CircleShape,
            ),
        contentAlignment = Alignment.Center,
    ) {
        if (selected) {
            Box(
                modifier = Modifier
                    .size(6.dp)
                    .background(MaterialTheme.colorScheme.onPrimary, CircleShape),
            )
        } else {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .background(MaterialTheme.colorScheme.outline, CircleShape),
            )
        }
    }
}

private fun voiceOptionLabelRes(options: List<Pair<String, Int>>, value: String): Int? =
    options.firstOrNull { it.first == value }?.second ?: options.firstOrNull()?.second

private fun sharedVoiceDetail(context: android.content.Context, profile: FamilyVoiceProfile): String {
    val owner = profile.ownerName?.takeIf { it.isNotBlank() }
    return if (owner == null) {
        context.getString(R.string.editor2_voice_detail_shared)
    } else {
        context.getString(R.string.editor2_voice_detail_shared_from, owner)
    }
}

private fun ownedVoiceDetail(context: android.content.Context, profile: VoiceProfile): String = when {
    profile.isSystem == true -> context.getString(R.string.editor2_voice_detail_default)
    profile.isShared == true -> context.getString(R.string.editor2_voice_detail_mine_sharing)
    else -> context.getString(R.string.editor2_voice_detail_mine)
}

internal fun FamilyVoiceProfile.requiresViewerInfo(): Boolean =
    needsViewerInfo == true || relationshipLabel.isNullOrBlank() || listenerTitle.isNullOrBlank()
