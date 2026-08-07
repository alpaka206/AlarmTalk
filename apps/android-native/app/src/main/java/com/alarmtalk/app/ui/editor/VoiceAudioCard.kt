package com.alarmtalk.app

import androidx.compose.foundation.background
import androidx.compose.foundation.LocalIndication
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
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.KeyboardArrowUp
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Save
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
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
import androidx.compose.ui.text.style.TextOverflow

@Composable
internal fun VoiceAudioCard(
    editor: AlarmEditorState,
    voiceEnabled: Boolean,
    onVoiceEnabledChange: (Boolean) -> Unit,
    voiceProfiles: List<VoiceProfile>,
    familyVoices: List<FamilyVoiceProfile>,
    voiceProfileBusy: Boolean,
    stockClips: List<com.alarmtalk.app.network.StockClip>,
    lastUsedVoiceId: String? = null,
    /** 선택 시트에서 목소리를 들어볼 때 — 목소리 선택 화면과 같은 미리듣기를 쓴다. */
    onPreviewVoice: (String) -> Unit = {},
    previewPlayingVoiceId: String? = null,
    previewPreparingVoiceId: String? = null,
    // 날씨+약 문구로 제한하는 모드 — 무료 플랜이거나 시스템(기본) 보이스 선택 시 true.
    // TTS 문구를 무료 버킷 UI(날씨/약)로 제한한다.
    restrictToWeatherMedication: Boolean,
    audioMessage: String?,
    isRecording: Boolean,
    recordingElapsedMillis: Long,
    recordingLevel: Float,
    isCachedAudioPreviewActive: Boolean,
    isPreviewPreparing: Boolean,
    onRecord: () -> Unit,
    onPreviewAudio: () -> Unit,
    // '다시 녹음' — 재생 중인 미리듣기를 멈추고 기존 녹음을 비워 대기(멈춘) 상태로 되돌린다.
    onDiscardRecording: () -> Unit,
    onCreateVoiceProfileClick: () -> Unit,
    onOpenRandomPromptSettings: () -> Unit,
    // 무료 문구 행 — 테마(버킷) 선택 pane 을 연다(유료의 문구 pane 과 같은 자리).
    onOpenFreeBucketSettings: () -> Unit,
    onOpenVoiceOutputSettings: () -> Unit,
) {
    val context = LocalContext.current
    val visibleVoiceSource = if (editor.voiceSource == VoiceSources.SERVER_TTS) {
        VoiceSources.TTS_PROFILE
    } else {
        editor.voiceSource
    }
    // 알람별로 목소리를 자유롭게 바꾼다 — 내 목소리·공유받은 목소리·기본(시스템) 목소리 순.
    // 기본 목소리로 바꾸면 직접 입력 문구를 잃는 경우, 확인받기 전까지 보류해 둔 선택.
    var pendingVoiceSwitch by remember { mutableStateOf<VoiceProfileOption?>(null) }
    val applyVoiceSelection: (VoiceProfileOption) -> Unit = { option ->
        // 목소리를 고르면 꺼져 있던 목소리를 자동으로 켠다(잠금 시엔 게이트로 유도).
        if (!voiceEnabled) onVoiceEnabledChange(true)
        if (option.id == VoiceSources.LOCAL_AUDIO) {
            editor.voiceSource = VoiceSources.LOCAL_AUDIO
            editor.clearTtsMeta()
        } else {
            editor.voiceSource = VoiceSources.TTS_PROFILE
            editor.clearAudio()
            editor.clearTtsMeta()
            editor.selectVoiceProfile(option.id)
        }
    }
    val readyOwnProfiles = voiceProfiles.filter {
        (it.status == null || it.status == "ready") && it.isSystem != true
    }
    val readySystemProfiles = voiceProfiles.filter {
        (it.status == null || it.status == "ready") && it.isSystem == true
    }
    // 기본(시스템) 목소리는 전부 노출한다. 예전에는 '기본으로 설정해 둔 1개'만 보여줬는데,
    // 이제 4개를 모두 미리 받아 두므로 알람마다 자유롭게 고를 수 있어야 한다.
    // 목록이 길어져도 선택 시트가 내부 스크롤을 갖고 있다(WakerSelectionSheet).
    val visibleSystemProfiles = readySystemProfiles
    val readyFamilyVoices = familyVoices.filter {
        (it.status == null || it.status == "ready") && it.isShared != false
    }
    val profileOptions = readyOwnProfiles.map {
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
            )
        } +
        visibleSystemProfiles.map {
            VoiceProfileOption(
                id = it.id,
                name = it.name,
                detail = ownedVoiceDetail(context, it),
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
        // 목소리 선택 행 — 내 목소리·공유받은·기본 + '직접 녹음'(시트 마지막)을 한 목록에서 고른다.
        // on/off 토글이 이 행 안에 있고(알람음 행과 대칭), 목소리를 고르면 자동으로 켜진다.
        val recordingOption = VoiceProfileOption(
            id = VoiceSources.LOCAL_AUDIO,
            name = stringResource(R.string.editor_voice_source_local),
            detail = stringResource(R.string.editor_voice_local_detail),
        )
        val selectorSelectedId = if (visibleVoiceSource == VoiceSources.LOCAL_AUDIO) {
            VoiceSources.LOCAL_AUDIO
        } else {
            editor.voiceProfileId ?: ""
        }
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = WakerCardShape,
            color = MaterialTheme.colorScheme.surface,
            border = wakerCardBorder(),
        ) {
            VoiceProfileSelector(
                options = profileOptions + recordingOption,
                selectedId = selectorSelectedId,
                onSelect = { option ->
                    // 기본(시스템) 목소리로 바꾸면 직접 입력 문구를 쓸 수 없어 편집기가 문구를
                    // 비운다. 조용히 지우면 '문구가 사라졌다'가 되므로 한 번 확인받는다.
                    val losesManualText = readySystemProfiles.any { it.id == option.id } &&
                        editor.voiceText.isNotBlank() &&
                        !editor.voiceRandomPrompt &&
                        !editor.isActiveBucketAlarm()
                    if (losesManualText) {
                        pendingVoiceSwitch = option
                    } else {
                        applyVoiceSelection(option)
                    }
                },
                onPreview = { option -> onPreviewVoice(option.id) },
                playingVoiceId = previewPlayingVoiceId,
                preparingVoiceId = previewPreparingVoiceId,
            )
        }
        if (voiceEnabled) {
            if (visibleVoiceSource == VoiceSources.TTS_PROFILE) {
                LaunchedEffect(visibleVoiceSource, voiceProfileBusy, profileOptions, editor.voiceProfileId) {
                    if (
                        visibleVoiceSource == VoiceSources.TTS_PROFILE &&
                        !voiceProfileBusy &&
                        profileOptions.isNotEmpty()
                    ) {
                        val selectedProfileAvailable = profileOptions.any { it.id == editor.voiceProfileId }
                        if (editor.voiceProfileId.isNullOrBlank() || !selectedProfileAvailable) {
                            // 처음 고르는 목소리: 마지막에 쓴 목소리가 **어느 그룹이든 최우선**이다.
                            // 그룹을 먼저 보면(내 클론 우선) 클론을 가진 사람이 마지막에 기본
                            // 목소리나 공유받은 목소리를 썼을 때 그 선택이 매번 무시된다 —
                            // 사용자에겐 '고른 게 유지되지 않는' 리셋으로 보인다.
                            // 마지막에 쓴 게 없을 때만 내 목소리 → 공유받은 목소리 → 목록 첫째.
                            editor.selectVoiceProfile(
                                profileOptions.firstOrNull { it.id == lastUsedVoiceId }?.id
                                    ?: readyOwnProfiles.firstOrNull()?.id
                                    ?: readyFamilyVoices.firstOrNull()?.id
                                    ?: profileOptions.first().id,
                            )
                        }
                    }
                }
                val selectedProfileUnavailable = !voiceProfileBusy &&
                    !editor.voiceProfileId.isNullOrBlank() &&
                    profileOptions.none { it.id == editor.voiceProfileId }
                // 무료·유료 모두 같은 '카드 + 구분선 행'(목소리/문구/목소리 크기) 구조를 쓴다.
                // 무료는 문구 행이 개별 문구 대신 "테마(버킷)"를 고르는 pane 을 연다 — 버킷 안
                // 여러 문구는 매 울림마다 순차 회전되며 내용은 노출하지 않는다.
                if (voiceProfileBusy) {
                    MutedText(stringResource(R.string.editor_voice_loading))
                } else if (profileOptions.isEmpty()) {
                    NoUsableVoiceProfileCallout(onCreateVoiceProfileClick)
                } else {
                    // 문구·목소리 크기를 하나의 카드+구분선으로 묶는다(목소리 선택은 위 카드로 분리).
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = WakerCardShape,
                        color = MaterialTheme.colorScheme.surface,
                        border = wakerCardBorder(),
                    ) {
                        Column {
                            if (restrictToWeatherMedication) {
                                FreeThemeSummaryRow(
                                    selectedBucket = editor.selectedBucket,
                                    weatherCity = editor.voiceWeatherCity,
                                    onClick = onOpenFreeBucketSettings,
                                )
                            } else {
                                MessageModeSummaryRow(
                                    isManual = !editor.voiceRandomPrompt && !editor.isActiveBucketAlarm(),
                                    randomContext = editor.voiceRandomContext,
                                    manualText = editor.voiceText,
                                    onClick = onOpenRandomPromptSettings,
                                )
                            }
                            AlarmSettingDivider(modifier = Modifier.padding(horizontal = 14.dp))
                            VoiceVolumeSummaryRow(
                                volumePercent = editor.voiceVolumePercent,
                                onClick = onOpenVoiceOutputSettings,
                            )
                        }
                    }
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
                // 문구(MessageModeSummaryRow)는 위 목소리 카드 안으로 옮겨 구분선으로 묶었다(개별 박스 제거).
            } else {
                // 알람 설정에서는 임의 포맷 파일 업로드(코덱·디코드·크롭이 불안정)를 빼고 녹음만 둔다.
                // 포맷이 통제된 녹음(MPEG4/AAC)만 남겨 안정성을 확보한다. 파일·영상 업로드는
                // '목소리 만들기'(음성 클로닝)에만 있고, 그 경로는 그대로 유지된다.
                // 녹음이 끝나면 마이크→재생 버튼, 우측 시간→'다시 녹음' 아이콘으로 바꾼다.
                // 미리듣기·지우기 별도 버튼은 두지 않는다(재생/다시 녹음이 대신한다).
                if (editor.localAudioUri != null && !isRecording) {
                    RecordedPlaybackControls(
                        isPreviewActive = isCachedAudioPreviewActive,
                        isPreparing = isPreviewPreparing,
                        onPlay = onPreviewAudio,
                        // '다시 녹음'은 즉시 녹음을 시작하지 않고 재생 중인 미리듣기를 멈춘 뒤 기존 녹음을
                        // 비워 대기(멈춘) 상태로 되돌린다 → VoiceRecordControls(마이크 대기)로 전환.
                        onRedo = onDiscardRecording,
                    )
                } else {
                    VoiceRecordControls(
                        isRecording = isRecording,
                        elapsedMillis = recordingElapsedMillis,
                        maxDurationMillis = AlarmAudioLimits.MAX_DURATION_MILLIS,
                        level = recordingLevel,
                        enabled = true,
                        onRecordClick = onRecord,
                    )
                }
                // 녹음 모드에도 목소리 크기를 녹음 박스 바로 아래에 둔다(세부설정엔 두지 않음).
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = WakerCardShape,
                    color = MaterialTheme.colorScheme.surface,
                    border = wakerCardBorder(),
                ) {
                    VoiceVolumeSummaryRow(
                        volumePercent = editor.voiceVolumePercent,
                        onClick = onOpenVoiceOutputSettings,
                    )
                }
            }
            // 목소리 반복 재생은 목소리 크기 상세(목소리 출력 pane)에 함께 있다.
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
    pendingVoiceSwitch?.let { pending ->
        IosAlertDialog(
            title = stringResource(R.string.editor_voice_switch_drops_text_title),
            message = stringResource(R.string.editor_voice_switch_drops_text_message),
            onDismiss = { pendingVoiceSwitch = null },
            actions = listOf(
                IosAlertAction(
                    label = stringResource(R.string.r3dlg_modal_dialog_close),
                    onClick = { pendingVoiceSwitch = null },
                ),
                IosAlertAction(
                    label = stringResource(R.string.editor_voice_switch_drops_text_confirm),
                    emphasized = true,
                    onClick = {
                        applyVoiceSelection(pending)
                        pendingVoiceSwitch = null
                    },
                ),
            ),
        )
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

// 목소리 행 — 탭하면 바텀시트가 올라와 내 목소리·공유받은 목소리·기본 목소리 전체에서
// 고른다(문구·목소리 크기 행과 같은 [제목/값 + 셰브론] 문법).
@Composable
private fun VoiceProfileSelector(
    options: List<VoiceProfileOption>,
    selectedId: String,
    onSelect: (VoiceProfileOption) -> Unit,
    /** 행의 재생 버튼 — 고르기 전에 목소리를 들어볼 수 있게 한다(목소리 선택 화면과 동일). */
    onPreview: (VoiceProfileOption) -> Unit,
    playingVoiceId: String?,
    preparingVoiceId: String?,
) {
    var sheetOpen by remember { mutableStateOf(false) }
    val selectedOption = options.firstOrNull { it.id == selectedId } ?: options.firstOrNull()
    // 상위 목소리 카드 안에 놓이므로 자체 박스를 그리지 않는다(투명).
    Surface(
        onClick = { sheetOpen = true },
        modifier = Modifier.fillMaxWidth(),
        shape = WakerChipShape,
        color = Color.Transparent,
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
                // 알람음 행과 대칭: 제목 '목소리' + 값(선택된 목소리 / 꺼짐).
                Text(
                    text = stringResource(R.string.editor_voice_output_title),
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold,
                )
                // ⚠ **스위치를 다시 넣지 말 것.** 목소리를 쓸지는 위 '재생 방식' 세그먼트가
                // 소유한다. 여기 스위치를 두면 같은 상태를 조종하는 컨트롤이 둘이 되고,
                // 이 카드는 목소리 모드에서만 그려지므로 스위치를 끄는 순간 **자기 자신이
                // 사라진다**.
                MutedText(selectedOption?.name ?: stringResource(R.string.editor_voice_select))
            }
            Spacer(Modifier.width(12.dp))
            Icon(
                imageVector = Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(20.dp),
            )
        }
    }
    if (sheetOpen) {
        WakerSelectionSheet(
            title = stringResource(R.string.editor_voice_select),
            onDismiss = { sheetOpen = false },
        ) { dismiss ->
            options.forEachIndexed { index, option ->
                WakerSheetOptionRow(
                    title = option.name,
                    description = option.detail,
                    selected = option.id == selectedOption?.id,
                    onClick = {
                        onSelect(option)
                        dismiss()
                    },
                    trailing = {
                        // ⚠ '직접 녹음' 에는 재생 버튼을 달지 않는다. 아직 녹음한 것이 없어
                        // `previewVoice` 가 조용히 return 하므로, 눌러도 아무 소리가 안 나는
                        // 버튼이 된다(못 움직이는 컨트롤은 두지 않는다 — CLAUDE.md).
                        if (option.id != VoiceSources.LOCAL_AUDIO) {
                            VoicePreviewButton(
                                playing = playingVoiceId == option.id,
                                preparing = preparingVoiceId == option.id,
                                onClick = { onPreview(option) },
                            )
                        }
                    },
                    divider = index != options.lastIndex,
                )
            }
        }
    }
}

/** 선택 시트 행의 재생 버튼. 행 자체를 누르면 '선택', 이 버튼은 '들어보기'로 나눈다. */
@Composable
private fun VoicePreviewButton(
    playing: Boolean,
    preparing: Boolean,
    onClick: () -> Unit,
) {
    IconButton(onClick = onClick) {
        VoicePreviewButtonIcon(active = playing, preparing = preparing)
    }
}

// 무료 문구 행 — 현재 테마(기상/약 …)를 값으로 보여주고 누르면 테마 선택 pane 을 연다.
// 유료의 문구 행(MessageModeSummaryRow)과 같은 문법(제목/값 + 셰브론)으로 UI 를 통일한다.
@Composable
private fun FreeThemeSummaryRow(
    selectedBucket: String?,
    weatherCity: String,
    onClick: () -> Unit,
) {
    // 오프라인이면 '준비 중'이라고 속이지 않고 연결이 필요함을 알린다(복구 시 자동 재시도).
    val isOnline by rememberIsOnline()
    val valueLabel = when {
        // 날씨 버킷은 어느 도시 기준인지 함께 보여준다(예: "날씨 · 서울").
        selectedBucket == "weather" && weatherCity.isNotBlank() ->
            "${stringResource(freeBucketLabelRes(selectedBucket))} · $weatherCity"
        selectedBucket != null -> stringResource(freeBucketLabelRes(selectedBucket))
        !isOnline -> stringResource(R.string.editor_free_bucket_offline)
        else -> stringResource(R.string.editor_free_bucket_loading)
    }
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = WakerChipShape,
        color = Color.Transparent,
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
                Text(stringResource(R.string.editor_msg_section), fontWeight = FontWeight.SemiBold)
                MutedText(valueLabel)
            }
            Spacer(Modifier.width(12.dp))
            Icon(
                imageVector = Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(20.dp),
            )
        }
    }
}

/**
 * 무료 테마(버킷) 선택 pane — 진동·스누즈와 같은 드릴인 서브페이지 문법.
 * 버킷 안 개별 문구는 노출하지 않고, 선택하면 그 버킷의 N개 클립이 캐시되어
 * 매 울림마다 순차 회전한다.
 */
@Composable
internal fun FreeBucketSettingsPane(
    buckets: List<String>,
    selectedBucket: String?,
    onSelectBucket: (String) -> Unit,
    onDismiss: () -> Unit,
    /** 잠긴 '직접 입력'을 눌렀을 때 — 호출부가 이용권 안내를 띄운다. */
    onManualLocked: () -> Unit,
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
                    text = stringResource(R.string.editor_msg_section),
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                )
            }
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                SnoozeOptionSection {
                    buckets.forEach { bucket ->
                        SnoozeRadioRow(
                            label = stringResource(freeBucketLabelRes(bucket)),
                            selected = selectedBucket == bucket,
                            onClick = { onSelectBucket(bucket) },
                        )
                        SnoozeOptionDivider()
                    }
                    // 무료에게도 '직접 입력'이 존재한다는 걸 보여준다. 목록에서 아예 빼면
                    // 이런 기능이 있는지조차 모르고, 유료 전환 동기 중 가장 강한 것을 잃는다.
                    SnoozeLockedRow(
                        label = stringResource(R.string.editor_msg_mode_manual),
                        onClick = onManualLocked,
                    )
                }
            }
        }
    }
}

// '문구' 단일 선택기 요약 행 — 현재 선택(직접 입력 / 기본 인사말 / 동적 문구)을 보여주고
// 누르면 선택 pane 을 연다. 옛 랜덤/직접입력 토글을 대체한다.
@Composable
internal fun MessageModeSummaryRow(
    isManual: Boolean,
    randomContext: String,
    // 직접 입력일 때 이 알람이 실제로 읽어 줄 문구. 새 알람이 직전 문구를 이어받게 되면서
    // **여기 보여 주지 않으면 안 된다** — 종류만 '직접 입력' 이라고 적혀 있으면, 어제 넣은
    // 문구를 그대로 물고 온 새 알람을 사용자가 알아챌 방법이 없다(생성형은 내용이 매번 새로
    // 만들어져 이 위험이 없다). 전문은 문구 화면의 상세 카드에서 본다.
    manualText: String = "",
    onClick: () -> Unit,
) {
    val valueLabel = when {
        isManual -> {
            val label = stringResource(R.string.editor_msg_mode_manual)
            manualText.trim().takeIf { it.isNotBlank() }?.let { "$label · $it" } ?: label
        }
        // preset 은 목록에 없는 보이지 않는 기본값 → '기본 인사말'로 표기.
        normalizedRandomPromptContext(randomContext) == DefaultRandomPromptContext ->
            stringResource(R.string.editor_msg_mode_preset)
        else -> voiceOptionLabelRes(RandomPromptContexts, normalizedRandomPromptContext(randomContext))
            ?.let { stringResource(it) }.orEmpty()
    }
    // 상위 목소리 카드 안에 놓이므로 자체 박스를 그리지 않는다(투명).
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = WakerChipShape,
        color = Color.Transparent,
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
                Text(stringResource(R.string.editor_msg_section), fontWeight = FontWeight.SemiBold)
                // 문구가 길어도 행을 늘리지 않는다 — 두 줄로 접히면 아래 행들이 밀려
                // 카드 전체가 들썩인다. 한 줄로 자르고 전문은 문구 화면에서 본다.
                Text(
                    text = valueLabel,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Spacer(Modifier.width(12.dp))
            Icon(
                imageVector = Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(20.dp),
            )
        }
    }
}

// 녹음 완료 상태 — 마이크 자리는 재생(▶/■), 우측 시간 자리는 '다시 녹음'(↻) 아이콘.
// 미리듣기·지우기 별도 버튼을 없애고 이 카드가 재생·재녹음을 모두 담당한다.
@Composable
private fun RecordedPlaybackControls(
    isPreviewActive: Boolean,
    isPreparing: Boolean,
    onPlay: () -> Unit,
    onRedo: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = WakerCardShape,
        color = MaterialTheme.colorScheme.surface,
        border = wakerCardBorder(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Button(
                onClick = onPlay,
                // 캐시 오디오 준비 중엔 눌러도 소용없으므로 비활성으로 로딩을 알린다.
                enabled = !isPreparing,
                modifier = Modifier.size(48.dp),
                shape = CircleShape,
                contentPadding = PaddingValues(0.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                ),
            ) {
                Icon(
                    imageVector = if (isPreviewActive) Icons.Rounded.Stop else Icons.Rounded.PlayArrow,
                    contentDescription = stringResource(
                        if (isPreviewActive) R.string.editor_audio_preview_stop else R.string.editor_audio_preview_play,
                    ),
                    modifier = Modifier.size(26.dp),
                )
            }
            Text(
                text = stringResource(R.string.editor_recorded_done),
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
            )
            IconButton(
                onClick = onRedo,
                modifier = Modifier.size(44.dp),
            ) {
                Icon(
                    imageVector = Icons.Outlined.Refresh,
                    contentDescription = stringResource(R.string.editor_record_again),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

// '목소리 크기' 요약 행 — 현재 볼륨(%)을 보여주고 누르면 목소리 출력 pane(볼륨·반복)을 연다.
// 목소리 카드 안에 놓이므로 자체 박스를 그리지 않는다(투명). 볼륨을 세부설정에서 이 카드로 옮겼다.
@Composable
private fun VoiceVolumeSummaryRow(volumePercent: Int, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = WakerChipShape,
        color = Color.Transparent,
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
                Text(stringResource(R.string.editor_voice_volume), fontWeight = FontWeight.SemiBold)
                MutedText("$volumePercent%")
            }
            Spacer(Modifier.width(12.dp))
            Icon(
                imageVector = Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(20.dp),
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
        // ⚠ **눈금은 10단위다**(10/20/…/100 = 10구간 → 중간 마크 9개).
        // `steps = 6` 이던 시절에는 구간이 (100-10)/7 = 12.857 이라 22%·48%·74% 같은
        // 값이 나왔다 — 알람음 볼륨은 10단위인데 목소리만 어중간한 숫자가 찍혔다.
        Slider(
            value = volumePercent.coerceIn(MinVoiceVolumePercent, 100).toFloat(),
            onValueChange = { onVolumeChange(it.toInt().coerceIn(MinVoiceVolumePercent, 100)) },
            valueRange = MinVoiceVolumePercent.toFloat()..100f,
            steps = 9,
        )
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
