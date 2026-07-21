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
import androidx.compose.material3.AlertDialog
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

@Composable
internal fun VoiceAudioCard(
    editor: AlarmEditorState,
    voiceProfiles: List<VoiceProfile>,
    familyVoices: List<FamilyVoiceProfile>,
    voiceProfileBusy: Boolean,
    stockClips: List<com.alarmtalk.app.network.StockClip>,
    defaultVoiceId: String? = null,
    // 날씨+약 문구로 제한하는 모드 — 무료 플랜이거나 시스템(기본) 보이스 선택 시 true.
    // TTS 문구를 무료 버킷 UI(날씨/약)로 제한한다.
    restrictToWeatherMedication: Boolean,
    // 무료 플랜 여부 — 녹음(직접 녹음)은 유료 게이트라 무료에서만 소스 토글을 감춘다.
    // 유료는 시스템(기본) 보이스를 골랐어도 직접 녹음으로 전환할 수 있다.
    freeVoiceTier: Boolean,
    onLockedFeature: () -> Unit,
    audioMessage: String?,
    isRecording: Boolean,
    recordingElapsedMillis: Long,
    recordingLevel: Float,
    isCachedAudioPreviewActive: Boolean,
    isPreviewPreparing: Boolean,
    onRecord: () -> Unit,
    onPreviewAudio: () -> Unit,
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
    // 기본(시스템) 목소리는 전부 나열하지 않고 '기본 목소리로 설정해 둔 것'만 노출한다
    // (편집 중 알람이 다른 시스템 보이스로 저장돼 있으면 그것도 함께 — 열자마자 목소리가
    // 바뀌는 사고 방지). 설정된 기본이 없으면 이전처럼 전부 보여준다.
    val readyOwnProfiles = voiceProfiles.filter {
        (it.status == null || it.status == "ready") && it.isSystem != true
    }
    val readySystemProfiles = voiceProfiles.filter {
        (it.status == null || it.status == "ready") && it.isSystem == true
    }
    val visibleSystemProfiles = readySystemProfiles.filter {
        it.id == defaultVoiceId || it.id == editor.voiceProfileId
    }.ifEmpty { readySystemProfiles }
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
    // 공유받은 목소리는 TTS 전용 — 토글 숨김과 함께, 예전 UI 로 '공유 목소리 + 녹음/파일'로
    // 저장된 레거시 알람도 편집 진입 시 TTS 로 되돌리고 잔여 로컬 오디오를 비운다
    // (숨기기만 하면 visibleVoiceSource 가 local 로 남아 녹음기가 그대로 보이고 저장도 됨).
    val sharedVoiceSelected = readyFamilyVoices.any { it.id == editor.voiceProfileId }
    LaunchedEffect(editor.voiceSource, sharedVoiceSelected) {
        if (editor.voiceSource == VoiceSources.SERVER_TTS) {
            editor.voiceSource = VoiceSources.TTS_PROFILE
            editor.clearTtsMeta()
        }
        if (sharedVoiceSelected && editor.voiceSource == VoiceSources.LOCAL_AUDIO) {
            editor.voiceSource = VoiceSources.TTS_PROFILE
            editor.clearAudio()
            editor.clearTtsMeta()
        }
    }

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
            // 무료 플랜은 녹음이 잠겨 있어 소스 토글이 사실상 페이월 미끼라 감춘다(항상 TTS).
            // 유료는 시스템(기본) 보이스를 골랐어도 직접 녹음으로 전환할 수 있게 노출한다.
            // 공유받은 목소리는 TTS 전용 — 녹음·파일로 전환하면 공유 보이스 밑에 로컬 오디오
            // 알람이 저장되는 계약 위반이 생기므로 토글을 감춘다(프리셋+직접 입력만).
            if (!freeVoiceTier && !sharedVoiceSelected) {
                // 바로 위 '재생 방식'과 같은 세그먼트 트랙으로 통일(크기·선택색 일치).
                EditorSegmentedSelector(
                    options = listOf(
                        VoiceSources.TTS_PROFILE to stringResource(R.string.editor_voice_source_tts),
                        VoiceSources.LOCAL_AUDIO to stringResource(R.string.editor_voice_source_local),
                    ),
                    selected = visibleVoiceSource,
                    onSelect = {
                        editor.voiceSource = it
                        if (it == VoiceSources.TTS_PROFILE) {
                            editor.clearAudio()
                            editor.clearTtsMeta()
                        } else {
                            editor.clearTtsMeta()
                        }
                    },
                )
            }

            if (visibleVoiceSource == VoiceSources.TTS_PROFILE) {
                LaunchedEffect(visibleVoiceSource, voiceProfileBusy, profileOptions, editor.voiceProfileId) {
                    if (
                        visibleVoiceSource == VoiceSources.TTS_PROFILE &&
                        !voiceProfileBusy &&
                        profileOptions.isNotEmpty()
                    ) {
                        val selectedProfileAvailable = profileOptions.any { it.id == editor.voiceProfileId }
                        if (editor.voiceProfileId.isNullOrBlank() || !selectedProfileAvailable) {
                            // 기본 선택 우선순위: 내 목소리 → 공유받은 목소리 → 기본 목소리로
                            // 설정해 둔 것 → 목록 첫 번째. 각 그룹 안에서는 기본 목소리로
                            // 지정해 둔 프로필이 있으면 그것을 우선한다.
                            editor.selectVoiceProfile(
                                readyOwnProfiles.firstOrNull { it.id == defaultVoiceId }?.id
                                    ?: readyOwnProfiles.firstOrNull()?.id
                                    ?: readyFamilyVoices.firstOrNull { it.id == defaultVoiceId }?.id
                                    ?: readyFamilyVoices.firstOrNull()?.id
                                    ?: profileOptions.firstOrNull { it.id == defaultVoiceId }?.id
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
                    // 목소리(미나)와 문구를 개별 박스로 흩지 않고 하나의 카드+구분선으로 묶는다(삼성 설정식).
                    // 모서리는 일정·세부설정 카드와 같은 WakerCardShape 로 통일한다.
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = WakerCardShape,
                        color = MaterialTheme.colorScheme.surface,
                        border = wakerCardBorder(),
                    ) {
                        Column {
                            VoiceProfileSelector(
                                options = profileOptions,
                                selectedId = editor.voiceProfileId ?: "",
                                onSelect = { option -> editor.selectVoiceProfile(option.id) },
                            )
                            AlarmSettingDivider(modifier = Modifier.padding(horizontal = 14.dp))
                            if (restrictToWeatherMedication) {
                                FreeThemeSummaryRow(
                                    selectedBucket = editor.selectedBucket,
                                    weatherCity = editor.voiceWeatherCity,
                                    onClick = onOpenFreeBucketSettings,
                                )
                            } else {
                                MessageModeSummaryRow(
                                    isManual = !editor.voiceRandomPrompt,
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
                if (editor.localAudioUri != null && !isRecording) {
                    RecordedPlaybackControls(
                        isPreviewActive = isCachedAudioPreviewActive,
                        isPreparing = isPreviewPreparing,
                        onPlay = onPreviewAudio,
                        onRedo = onRecord,
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
                    divider = index != options.lastIndex,
                )
            }
        }
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
                    buckets.forEachIndexed { index, bucket ->
                        SnoozeRadioRow(
                            label = stringResource(freeBucketLabelRes(bucket)),
                            selected = selectedBucket == bucket,
                            onClick = { onSelectBucket(bucket) },
                        )
                        if (index != buckets.lastIndex) {
                            SnoozeOptionDivider()
                        }
                    }
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
        // 직접 입력은 문구 내용을 어디에도 노출하지 않는다 — 값은 '직접 입력'으로만 표기.
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
        Slider(
            value = volumePercent.coerceIn(MinVoiceVolumePercent, 100).toFloat(),
            onValueChange = { onVolumeChange(it.toInt().coerceIn(MinVoiceVolumePercent, 100)) },
            valueRange = MinVoiceVolumePercent.toFloat()..100f,
            steps = 6,
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
