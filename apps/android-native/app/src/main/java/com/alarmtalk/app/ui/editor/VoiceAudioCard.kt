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
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.outlined.Refresh
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.R
import com.alarmtalk.app.WakerChipShape
import com.alarmtalk.app.WakerPanelShape
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
            // ⚠ **옮겨오기 전 오디오를 지운다**(2026-08-16 지적 "녹음 안 했는데 녹음 완료라고
            // 뜨고 알람 문구 소리가 난다"). `localAudioUri` 는 **녹음 전용이 아니라** 캐시된
            // 오디오 파일 일반이다 — `setGeneratedTtsAudio`·`setStockClipAudio` 도 여기에
            // 담는다. 안 지우면 방금 만든 TTS 파일이 남아 녹음 UI 가 '녹음 완료' 로 읽고,
            // 재생 버튼이 그 TTS 를 튼다.
            //
            // ⚠ **이미 녹음 상태였으면 지우지 않는다** — 같은 항목을 다시 골랐다고
            // 녹음물이 사라지면 안 된다.
            if (editor.voiceSource != VoiceSources.LOCAL_AUDIO) editor.clearAudio()
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
                                    // 표시 판정 — 재생 방식과 무관(`hasBucketMessageChoice` 주석).
                                    manualSelected = !editor.voiceRandomPrompt &&
                                        !editor.hasBucketMessageChoice(),
                                    onClick = onOpenFreeBucketSettings,
                                )
                            } else {
                                MessageModeSummaryRow(
                                    // 표시 판정 — 재생 방식과 무관(`hasBucketMessageChoice` 주석).
                                    isManual = !editor.voiceRandomPrompt && !editor.hasBucketMessageChoice(),
                                    randomContext = editor.voiceRandomContext,
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
                // ⚠ **녹음 UI 는 `VoiceRecordControls` 하나다**(2026-08-16 정리).
                // 예전에는 녹음 전/후로 컴포넌트가 갈려(`RecordedPlaybackControls`) 같은
                // 카드가 상태에 따라 다른 모양으로 바뀌었고, 목소리 등록 화면은 또 다른
                // 조합을 쓰고 있었다. 이제 두 화면이 같은 카드를 쓴다.
                VoiceRecordControls(
                    isRecording = isRecording,
                    elapsedMillis = recordingElapsedMillis,
                    maxDurationMillis = AlarmAudioLimits.MAX_DURATION_MILLIS,
                    level = recordingLevel,
                    enabled = true,
                    onRecordClick = onRecord,
                    // 녹음물이 있으면(그리고 녹음 중이 아니면) '저장됨' 상태로 그린다.
                    // 값은 방금 녹음한 길이다 — 기존 알람을 열어 온 경우엔 0 이고,
                    // 그때도 카드 제목이 "녹음을 저장했어요" 라고 상태를 말한다.
                    recordedDurationMillis = recordingElapsedMillis
                        .takeIf { editor.localAudioUri != null && !isRecording },
                    isRecordedPreviewActive = isCachedAudioPreviewActive,
                    isRecordedPreviewPreparing = isPreviewPreparing,
                    onPreviewRecording = onPreviewAudio.takeIf { editor.localAudioUri != null },
                    // '다시 녹음' 은 재생을 멈추고 녹음물을 비워 대기 상태로 되돌린다.
                    onRedoRecording = onDiscardRecording.takeIf { editor.localAudioUri != null },
                )
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
            // 상단바는 공용 `WakerTopBar` 하나다 — 화면마다 손으로 그리지 말 것
            // (알람 목록·설정·문구 pane 이 모두 이걸 쓴다).
            WakerTopBar(
                title = stringResource(R.string.editor_voice_output_title),
                onBack = onDismiss,
                modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 24.dp, bottom = 4.dp),
            )
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    // 다른 pane·iOS `PaneScaffold` 와 같은 여백.
                    .padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                // ⚠ **카드 밖으로 다시 꺼내지 말 것**(2026-08-16 통일). 편집기의 모든 설정은
                // 카드에 담긴다(세부 설정·다시 울림·진동·알람음·문구) — 여기만 맨몸으로
                // 나와 있어 같은 층위의 컨트롤이 화면마다 다르게 보였다. iOS 도 한 카드에
                // 담고 구분선으로 나눈다(`VoiceOutputSettingsPane`).
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = WakerPanelShape,
                    color = MaterialTheme.colorScheme.surface,
                    border = wakerCardBorder(),
                ) {
                    Column(modifier = Modifier.fillMaxWidth()) {
                        VoiceVolumeSelector(
                            volumePercent = volumePercent,
                            onVolumeChange = onVolumeChange,
                        )
                        if (showRepeat) {
                            AlarmSettingDivider()
                            VoiceRepeatSelector(
                                repeat = repeat,
                                onRepeatChange = onRepeatChange,
                            )
                        }
                    }
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
            // 시트 제목은 iOS `VoiceSelectionSheet` 와 같은 "목소리 고르기" 다.
            // ⚠ 아래 요약 행의 자리표시자(`editor_voice_select`, "목소리 선택")와 **다른
            // 문자열**이다 — 하나로 합치면 값 자리에 "고르기" 라는 동작이 들어간다.
            title = stringResource(R.string.editor_voice_select_title),
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
    /**
     * 직접 입력이 선택됐는가. 판정식은 CLAUDE.md 가 못 박은 일곱 자리와 **철자까지 같게**
     * `!voiceRandomPrompt && !isActiveBucketAlarm()` 이다.
     */
    manualSelected: Boolean,
    /** 직접 입력 문구. 선택됐으면 이 행에도 함께 보여준다. */
    onClick: () -> Unit,
) {
    // 오프라인이면 '준비 중'이라고 속이지 않고 연결이 필요함을 알린다(복구 시 자동 재시도).
    val isOnline by rememberIsOnline()
    val manualLabel = stringResource(R.string.editorp_random_manual_title)
    val valueLabel = when {
        // ⚠ **직접 입력을 '준비 중' 으로 말하지 말 것.** 직접 입력을 고르면 selectedBucket
        // 이 null 이 되는데, 예전에는 버킷만 보고 판정해서 문구를 넣어 놨는데도 행이
        // "문구를 준비하고 있어요" 라고 **거짓말**했다. 유료 요약 행
        // (`MessageModeSummaryRow`)과 같은 모양으로 문구까지 보여준다.
        // 위 `MessageModeSummaryRow` 와 같은 규약 — 종류만 말하고 문장은 싣지 않는다.
        manualSelected -> manualLabel
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
    /**
     * '직접 입력' 이 잠겨 있는가. **잠그는 기준은 무료 플랜뿐이다.**
     *
     * ⚠ **기본 목소리라고 잠그지 말 것**(2026-08-11). 유료 사용자는 기본 목소리로도 직접
     * 입력을 쓸 수 있고, 비용은 **직접 입력 월 한도**가 센다(서버 `tts.ts` 의
     * `manualTextOnSystemVoice`). 예전에는 유료여도 기본 목소리면 잠겨서, 이용권을 산
     * 사람이 **왜 안 되는지 알 수 없는 벽**을 만났다.
     * (동적 문구 — 날씨·운세 — 는 여전히 기본 목소리에서 막는다. 이 목록에 아예 없다.)
     */
    manualLocked: Boolean,
    /** 직접 입력이 선택됐는가(라디오 표시용). */
    manualSelected: Boolean = false,
    /** 잠기지 않았을 때 '직접 입력' 을 고른 경우. */
    onSelectManual: () -> Unit = {},
    /**
     * 날씨를 골랐을 때 보여줄 지역 요약. null 이면 행을 그리지 않는다.
     *
     * ⚠ 유료 pane(`AlarmRandomPromptSettings`)은 고른 값을 같은 자리에서 보여주고
     * 같은 자리에서 고치는데, 무료 pane 만 **고르고 나면 무엇을 골랐는지 볼 수 없었다**
     * (2026-08-11 지적). 등록한 값을 확인·변경할 길이 화면에 없으면 다시 고르는 것 말고는
     * 방법이 없다.
     */
    weatherRegionSummary: String? = null,
    onChangeWeatherRegion: (() -> Unit)? = null,
    /**
     * 직접 입력으로 넣은 문구. 선택돼 있으면 아래 상세 행에 보여준다.
     *
     * ⚠ **문구를 반드시 함께 보여준다.** 예전에는 이 pane 에 직접 입력 문구를 보여주는
     * 행이 아예 없어서, 문구를 넣고 확인해도 **무슨 문구인지 화면 어디에도 안 나왔다** —
     * 확인·수정하는 유일한 길이 '직접 입력' 행을 다시 누르는 것이었다.
     * 생성형은 내용이 매번 새로 만들어져 틀릴 일이 없지만 직접 입력은 글자가 그대로다.
     */
    manualText: String = "",
    onChangeManual: (() -> Unit)? = null,
) {
    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            // 상단바는 공용 `WakerTopBar` 하나다 — 화면마다 손으로 그리지 말 것
            // (알람 목록·설정·법무 문서가 모두 이걸 쓴다).
            WakerTopBar(
                title = stringResource(R.string.editor_msg_section),
                onBack = onDismiss,
                modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 24.dp, bottom = 4.dp),
            )
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    // 유료 pane·iOS `PaneScaffold` 와 같은 여백(위 주석 참조).
                    .padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 16.dp),
                // 선택 카드와 아래 상세 카드 사이 — iOS `FreeBucketSettingsPane` 의
                // `VStack(spacing: 16)` 과 같은 값이다(2026-08-15 지적 "안드로이드가 너무 좁다").
                verticalArrangement = Arrangement.spacedBy(16.dp),
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
                    if (manualLocked) {
                        SnoozeLockedRow(
                            label = stringResource(R.string.editor_msg_mode_manual),
                            onClick = onManualLocked,
                        )
                    } else {
                        SnoozeRadioRow(
                            label = stringResource(R.string.editor_msg_mode_manual),
                            selected = manualSelected,
                            onClick = onSelectManual,
                        )
                    }
                }
                // 고른 값을 유료 pane 과 **같은 모양**으로 보여주고 같은 자리에서 고친다.
                if (manualSelected && !manualLocked && onChangeManual != null) {
                    RandomPromptDetailRow(
                        title = stringResource(R.string.editorp_random_manual_title),
                        value = manualText.ifBlank {
                            stringResource(R.string.editorp_random_manual_empty)
                        },
                        onChange = onChangeManual,
                    )
                } else if (weatherRegionSummary != null && onChangeWeatherRegion != null) {
                    RandomPromptDetailRow(
                        title = stringResource(R.string.editorp_random_weather_region_title),
                        value = weatherRegionSummary,
                        onChange = onChangeWeatherRegion,
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
    onClick: () -> Unit,
) {
    val valueLabel = when {
        // ⚠ **문장을 여기 붙이지 말 것**(2026-08-15 지시 "요약 행이고, 가져오는 건
        // 가져오는 거고, 왜 화면에 띄워야 하냐"). 편집기 본문은 **무엇을 골랐는지**만
        // 말한다 — 알람이 읽어 줄 문장은 문구 화면에서 본다.
        // 예전에는 `"직접 입력 문구 · <문장>"` 으로 붙였고, 재생 방식을 바꿀 때 이 줄이
        // 사라지는 카드에 실려 잠깐 읽히는 것이 계속 지적됐다.
        isManual -> stringResource(R.string.editor_msg_mode_manual)
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

/// 목소리를 **끌 때까지 반복**할지. 켜기/끄기 두 값뿐이라 스위치 하나로 낸다.
///
/// ⚠ **두 칸짜리 세그먼트('한 번만' / '반복')로 되돌리지 말 것**(2026-08-10 결정).
/// 값이 둘인 것과 **선택지가 둘인 것은 다르다** — 반복은 켜고 끄는 성질이라 스위치가
/// 맞고, iOS 가 이미 그렇게 돼 있었다. 세그먼트는 켠 상태가 어느 쪽인지 라벨을 읽어야
/// 알 수 있는 반면 스위치는 한눈에 보인다.
@Composable
private fun VoiceRepeatSelector(
    repeat: Boolean,
    onRepeatChange: (Boolean) -> Unit,
) {
    Column(
        modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                // 스위치만이 아니라 **행 전체**가 눌린다 — 라벨을 눌러도 바뀌어야 한다.
                .clip(WakerChipShape)
                .clickable { onRepeatChange(!repeat) }
                .padding(vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = stringResource(R.string.editor_voice_repeat_title),
                modifier = Modifier.weight(1f),
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.width(12.dp))
            AlarmTalkSwitch(checked = repeat, onCheckedChange = onRepeatChange)
        }
    }
}

@Composable
private fun VoiceVolumeSelector(
    volumePercent: Int,
    onVolumeChange: (Int) -> Unit,
) {
    // 카드 안 여백 — 다른 카드 행과 같은 값(가로 14 · 세로 12).
    Column(
        modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
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
