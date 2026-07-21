package com.alarmtalk.app

import android.Manifest
import android.content.pm.PackageManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.alarmtalk.app.R
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.data.AlarmAudioStore
import com.alarmtalk.app.data.AlarmVoiceRecorder
import com.alarmtalk.app.data.CachedAlarmAudio
import com.alarmtalk.app.data.VoiceProfileAudioLimits
import com.alarmtalk.app.data.VoiceProfileCreationDraft
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.FamilyGroupCurrentResponse
import com.alarmtalk.app.network.FamilyVoiceProfile
import com.alarmtalk.app.network.TtsGenerateRequest
import com.alarmtalk.app.network.TtsGenerateResponse
import com.alarmtalk.app.network.VoiceProfile
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val AndroidEdgeToEdgeNavigationExtraPadding = 24.dp

// 클론 사전렌더 알람 버킷 4종(잠금화면 발사용). greeting 은 미리듣기 전용이라 준비 게이트에서 제외.
private val CloneAlarmBucketCategories = listOf("weather", "fortune", "love", "medication")

@Composable
private fun androidNavigationBarHeightPadding(): Dp {
    val context = LocalContext.current
    val density = LocalDensity.current
    val navigationBarHeightPx = remember(context) {
        val resourceId = context.resources.getIdentifier("navigation_bar_height", "dimen", "android")
        if (resourceId > 0) context.resources.getDimensionPixelSize(resourceId) else 0
    }
    return with(density) { navigationBarHeightPx.toDp() }
}

private fun voiceProfileDurationError(context: android.content.Context, durationMillis: Long?): String? = when {
    durationMillis == null -> context.getString(R.string.voices2_audio_duration_unknown)
    durationMillis < VoiceProfileAudioLimits.MIN_DURATION_MILLIS ->
        context.getString(R.string.voices2_record_at_least_one_minute)
    durationMillis > VoiceProfileAudioLimits.MAX_DURATION_MILLIS +
        VoiceProfileAudioLimits.MAX_DURATION_TOLERANCE_MILLIS ->
        context.getString(R.string.voices2_register_under_two_minutes)
    else -> null
}

private fun voiceProfileFileDurationError(context: android.content.Context, durationMillis: Long?): String? = when {
    durationMillis == null -> context.getString(R.string.voices2_audio_duration_unknown)
    durationMillis < VoiceProfileAudioLimits.MIN_DURATION_MILLIS ->
        context.getString(R.string.voices2_select_file_at_least_one_minute)
    else -> null
}

// 파일에서 잘라낸 구간 길이 검증 — 파일 흐름에서는 녹음 문구("~녹음해 주세요") 대신
// 구간 선택 문구로 안내한다.
private fun voiceProfileCropDurationError(context: android.content.Context, durationMillis: Long?): String? = when {
    durationMillis == null -> context.getString(R.string.voices2_audio_duration_unknown)
    durationMillis < VoiceProfileAudioLimits.MIN_DURATION_MILLIS ||
        durationMillis > VoiceProfileAudioLimits.MAX_DURATION_MILLIS +
        VoiceProfileAudioLimits.MAX_DURATION_TOLERANCE_MILLIS ->
        context.getString(R.string.voices_crop_duration_notice)
    else -> null
}

/**
 * 추천 대사 카드. [fillHeight] 가 true 면 호출부(스크롤 없는 Column)의 weight 와 짝을 이뤄
 * 남은 화면 높이만큼 펼치고 넘칠 때만 내부 스크롤, false(짧은 창 폴백)면 페이지가
 * 스크롤되므로 기존처럼 240dp 캡 + 내부 스크롤을 쓴다.
 */
@Composable
private fun VoiceRecordScriptCard(
    fillHeight: Boolean,
    modifier: Modifier = Modifier,
) {
    OutlinedCard(
        modifier = modifier,
        shape = WakerCardShape,
        border = wakerCardBorder(),
        colors = CardDefaults.outlinedCardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
        ),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = stringResource(R.string.voices_record_script_title),
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
            )
            // 녹음하며 읽는 본문이라 항상 펼쳐 둔다(토글로 접으면 녹음 도중 다시 펼쳐야 한다).
            Text(
                text = stringResource(R.string.voices2_record_script),
                modifier = Modifier
                    .then(
                        if (fillHeight) {
                            Modifier.weight(1f, fill = false)
                        } else {
                            Modifier.heightIn(max = 240.dp)
                        },
                    )
                    .verticalScroll(rememberScrollState()),
                style = MaterialTheme.typography.bodyMedium,
                lineHeight = MaterialTheme.typography.bodyLarge.lineHeight,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

@Composable
internal fun VoiceProfileManagementPanel(
    voiceProfiles: List<VoiceProfile>,
    pendingVoiceDraft: VoiceProfile?,
    familyVoices: List<FamilyVoiceProfile>,
    voiceProfileBusy: Boolean,
    subscriptionResponse: BillingSubscriptionResponse?,
    familyGroup: FamilyGroupCurrentResponse?,
    authSession: AuthSession?,
    // 반환값: 클론 생성 요청을 실제로 시작했는지 — false 면 '만드는 중' 스텝에 진입하지 않는다.
    onCreateVoiceProfile: (String, CachedAlarmAudio, Boolean, String, String, String) -> Boolean,
    onCreateVoiceProfiles: (List<VoiceProfileCreationDraft>) -> Unit,
    onGenerateTts: suspend (TtsGenerateRequest) -> TtsGenerateResponse,
    stockClips: List<com.alarmtalk.app.network.StockClip>,
    onDownloadStockAudio: suspend (String) -> com.alarmtalk.app.network.TtsMessageAudioResponse,
    onRenameVoiceProfile: (String, String, String, String) -> Unit,
    onShareVoiceProfile: (String, Boolean) -> Unit,
    onDeleteVoiceProfile: (String) -> Unit,
    onConfirmVoicePreviewPlayed: suspend (String, String) -> Unit,
    onUpdateVoicePreviewText: suspend (String, String) -> String,
    onPromoteVoiceDraft: (String) -> Unit,
    onDeleteVoiceDraft: (String) -> Unit,
    onOpenBilling: () -> Unit,
    defaultVoiceId: String? = null,
    onSetDefaultVoice: (String) -> Unit = {},
    // 기본 목소리 무료 버킷 프리페치 진행(다운로드 n to 전체). null = 진행 중 아님.
    voicePrefetchProgress: Pair<Int, Int>? = null,
    // 유료 클론 사전렌더(R2 21클립) 상태 조회/재시도 — 목소리 탭 준비 표시가 폴링한다.
    onGetVoicePrerenderStatus: suspend (String) -> com.alarmtalk.app.network.VoicePrerenderStatusResponse =
        { com.alarmtalk.app.network.VoicePrerenderStatusResponse() },
    onRetryVoicePrerender: suspend (String) -> Boolean = { false },
    // 말투 분석 재시도 — 성공 시 ViewModel 이 프로필 speech_style_status 를 갱신한다.
    onRetryVoiceSpeechStyle: suspend (String) -> Boolean = { false },
    // 서버 사전렌더 완료를 감지했을 때 stockClips 매니페스트를 강제 재조회.
    onReloadStockClips: () -> Unit = {},
    // promote 직후 사전렌더 드라이브(즉시 생성→기기 다운로드). 드라이브는 ViewModel 스코프라
    // '생성 중' 화면을 닫아도 계속되고, 앱이 죽으면 서버 cron 이 이어받는다.
    prerenderDrive: PrerenderDriveState? = null,
    onStartPrerenderDrive: (String) -> Unit = {},
) {
    val context = LocalContext.current
    val previewLanguage = com.alarmtalk.app.data.appVoiceLanguageOf(
        LocalConfiguration.current.locales[0].language,
    )
    val appContext = context.applicationContext
    val audioStore = remember(appContext) { AlarmAudioStore(appContext) }
    val recorder = remember(appContext) { AlarmVoiceRecorder(appContext, audioStore) }
    val scope = rememberCoroutineScope()
    var profileName by remember { mutableStateOf("") }
    var relationshipSelection by remember { mutableStateOf(RelationshipSelection()) }
    var profileListenerTitle by remember { mutableStateOf("") }
    var shareVoice by remember { mutableStateOf(false) }
    var currentStep by remember { mutableStateOf(VoiceRegistrationStep.Source) }
    var selectedAudio by remember { mutableStateOf<CachedAlarmAudio?>(null) }
    var localMessage by remember { mutableStateOf<String?>(null) }
    var inputMode by remember { mutableStateOf(VoiceCaptureMode.Record) }
    var isRecording by remember { mutableStateOf(false) }
    var recordingElapsedMillis by remember { mutableStateOf(0L) }
    // 실제 마이크 입력 진폭(0~1) — 녹음 카드의 미니 레벨 바가 소비한다.
    var recordingLevel by remember { mutableStateOf(0f) }
    var selectedFileUri by remember { mutableStateOf<Uri?>(null) }
    var selectedFileDurationMillis by remember { mutableStateOf<Long?>(null) }
    var cropStartMillis by remember { mutableStateOf(0L) }
    var cropEndMillis by remember { mutableStateOf(VoiceProfileAudioLimits.MAX_DURATION_MILLIS) }
    var createPreparing by remember { mutableStateOf(false) }
    var createSubmitAttempted by remember { mutableStateOf(false) }
    var showCreateForm by remember { mutableStateOf(false) }
    // 등록 결정 구간(만드는 중/미리듣기)에서 나가려 할 때 띄우는 '임시 목소리 삭제' 경고.
    var draftExitWarningOpen by remember { mutableStateOf(false) }
    // 미리듣기·사전렌더 문구 언어 — 기본은 앱 로케일(ko/en/ja 외엔 ko).
    val configuration = LocalConfiguration.current
    val defaultVoiceLanguage = remember(configuration) {
        com.alarmtalk.app.data.appVoiceLanguageOf(
            configuration.locales.takeIf { !it.isEmpty }?.get(0)?.language
                ?: java.util.Locale.getDefault().language,
        )
    }
    var profileVoiceLanguage by remember { mutableStateOf(defaultVoiceLanguage) }
    var voicePlanGateOpen by remember { mutableStateOf(false) }
    var renameTarget by remember { mutableStateOf<VoiceProfile?>(null) }
    var renameName by remember { mutableStateOf("") }
    var renameRelationship by remember { mutableStateOf("") }
    var renameListenerTitle by remember { mutableStateOf("") }
    var renameSubmitAttempted by remember { mutableStateOf(false) }
    var deleteTarget by remember { mutableStateOf<VoiceProfile?>(null) }
    var mediaPlayer by remember { mutableStateOf<MediaPlayer?>(null) }
    var filePreviewPreparing by remember { mutableStateOf(false) }
    var filePreviewPlaying by remember { mutableStateOf(false) }
    // 방금 녹음한 클립의 미리듣기 재생 상태 (녹음 완료 배지의 ▶ 버튼).
    var recordPreviewPlaying by remember { mutableStateOf(false) }
    // 기본 목소리 선택 시트 — 시트 안 탭 = 선택 + 인사말 미리듣기(닫기는 드래그/스크림).
    var defaultVoiceSheetOpen by remember { mutableStateOf(false) }
    // 지금 인사말 샘플을 재생 중인 기본 목소리 id (재생 아이콘 토글용).
    var playingGreetingVoiceId by remember { mutableStateOf<String?>(null) }
    var greetingPreviewRequestId by remember { mutableIntStateOf(0) }
    // 방금 등록한 목소리 확인(미리듣기·유지·삭제) 다이얼로그. 목소리는 한 달에 한 번만
    // 바꿀 수 있어, 등록 직후 어떤 목소리로 깨워줄지 들어보고 결정하게 한다.
    var confirmNewVoice by remember { mutableStateOf<VoiceProfile?>(null) }
    // '이 목소리로 할게요'를 눌러 승격한 보이스 id — draft 소멸이 삭제가 아니라 승격에서
    // 왔음을 구분해, 플로우를 닫는 대신 '목소리 생성 중' 스텝으로 잇는다.
    var promotedForPrerenderId by remember { mutableStateOf<String?>(null) }
    var confirmPreviewBusy by remember { mutableStateOf(false) }
    var confirmPreviewPlaying by remember { mutableStateOf(false) }
    var confirmPreviewCompleted by remember { mutableStateOf(false) }
    // 미리듣기 생성 코루틴 — 다이얼로그를 닫으면 취소해 늦은 재생/오디오 유출을 막는다.
    var confirmPreviewJob by remember { mutableStateOf<Job?>(null) }
    // 미리듣기 문구(서버가 관계·호칭 톤으로 생성/사용자가 수정) — Preview 스텝에 표시하고
    // 수정하면 이후 미리듣기와 매일 사전렌더 문구의 말투 기준이 된다.
    var confirmPreviewText by remember { mutableStateOf<String?>(null) }
    var confirmPreviewEditing by remember { mutableStateOf(false) }
    var confirmPreviewEditText by remember { mutableStateOf("") }
    var confirmPreviewSaving by remember { mutableStateOf(false) }
    // 시스템 스톡 보이스는 "내 목소리" 수 제한·관리 액션에서 제외한다.
    // 매 리컴포지션마다 재계산하지 않도록 voiceProfiles 가 바뀔 때만 다시 분류한다.
    val systemVoices = remember(voiceProfiles) { voiceProfiles.filter { it.isSystem == true } }
    val canCreateVoice = hasPaidVoiceAccess(subscriptionResponse)
    // 무료 강등 시 클론 데이터는 서버에 보존되지만(30일 유예·재유료 시 복구) UI 에는
    // 노출하지 않는다 — 유료 요금제여야 사용 가능하므로 리스트에서 숨긴다.
    val ownVoices = remember(voiceProfiles, canCreateVoice) {
        if (canCreateVoice) voiceProfiles.filter { it.isSystem != true } else emptyList()
    }
    val isLimitReached = ownVoices.size >= MAX_VOICE_PROFILES || pendingVoiceDraft != null
    val canOpenCreateForm = canCreateVoice && !isLimitReached
    // 생성~결정(만드는 중/미리듣기) 구간 — 이 동안은 다이얼로그를 닫거나 밖으로 나갈 수 없다
    // (유지/삭제를 골라야만 끝난다). draft 가 생겨 isLimitReached 가 돼도 다이얼로그를 유지한다.
    val inDraftDecisionFlow = currentStep == VoiceRegistrationStep.Creating ||
        currentStep == VoiceRegistrationStep.Preview
    // promote 직후 사전렌더 진행 화면 — 등록 완료로 isLimitReached 가 돼도 다이얼로그를 유지해야
    // 진행 UI·'백그라운드에서 계속'이 보인다(닫기는 자유 — 드라이브는 ViewModel 에서 계속된다).
    val inPrerenderingFlow = currentStep == VoiceRegistrationStep.Prerendering
    val canShareVoice = canShareVoiceWithOthers(subscriptionResponse, familyGroup, authSession)
    val paidVoiceRequiredMessage = stringResource(R.string.voices_paid_required)

    fun stopMediaPreview(invalidateGreetingPreview: Boolean = true) {
        if (invalidateGreetingPreview) greetingPreviewRequestId += 1
        mediaPlayer?.release()
        mediaPlayer = null
        filePreviewPreparing = false
        filePreviewPlaying = false
        recordPreviewPlaying = false
        playingGreetingVoiceId = null
    }

    // greeting 은 3개 언어가 있으므로 앱 언어로 골라야 한다(무필터 firstOrNull 이면 항상 en).
    fun greetingClipFor(profile: VoiceProfile) =
        com.alarmtalk.app.data.greetingStockClipFor(stockClips, profile.id, previewLanguage)

    // greeting 클립을 캐시에서 찾고, 없으면 내려받아 캐시한다(탭 재생·시트 프리페치 공용).
    suspend fun ensureGreetingCached(clip: com.alarmtalk.app.network.StockClip): CachedAlarmAudio {
        val cacheKey = "greeting_${clip.messageId}"
        withContext(Dispatchers.IO) { audioStore.getCachedAudio(cacheKey) }?.let { return it }
        val response = onDownloadStockAudio(clip.messageId)
        return withContext(Dispatchers.IO) {
            // base64 디코딩도 메인 스레드가 아닌 IO 디스패처에서 수행한다.
            val bytes = Base64.decode(response.audioBase64, Base64.DEFAULT)
            audioStore.cacheGeneratedAudio(
                bytes = bytes,
                format = response.audioFormat,
                rawAudioUri = response.audioUrl,
                displayName = cacheKey,
                cacheKey = cacheKey,
                messageId = clip.messageId,
            )
        }
    }

    // 기본 목소리 시트를 여는 순간 인사말 클립을 미리 받아 둔다 — 행 탭 시 지연 없이 재생되게.
    // 실패는 조용히 넘긴다(탭 시 재시도 경로가 그대로 있음).
    fun prefetchGreetingPreviews() {
        scope.launch {
            systemVoices.forEach { profile ->
                // 내장 인사말이 있는 보이스는 다운로드가 필요 없다.
                if (com.alarmtalk.app.data.bundledSystemGreetingRes(profile.id, previewLanguage) != null) {
                    return@forEach
                }
                val clip = greetingClipFor(profile) ?: return@forEach
                runCatching { ensureGreetingCached(clip) }
            }
        }
    }

    // 기본 목소리 행을 누르면 그 목소리의 인사말 샘플을 들려준다 — 내장(res/raw) 우선,
    // 내장이 없는 새 시스템 보이스만 greeting 스톡 클립 다운로드로 폴백.
    fun playGreeting(profile: VoiceProfile) {
        if (playingGreetingVoiceId == profile.id) {
            stopMediaPreview()
            return
        }
        val bundledRes = com.alarmtalk.app.data.bundledSystemGreetingRes(profile.id, previewLanguage)
        if (bundledRes != null) {
            greetingPreviewRequestId += 1
            stopMediaPreview(invalidateGreetingPreview = false)
            val player = MediaPlayer.create(context, bundledRes)
            if (player == null) {
                localMessage = context.getString(R.string.voices_preview_play_failed)
                return
            }
            playingGreetingVoiceId = profile.id
            mediaPlayer = player.apply {
                setOnCompletionListener {
                    it.release()
                    if (mediaPlayer === it) mediaPlayer = null
                    if (playingGreetingVoiceId == profile.id) playingGreetingVoiceId = null
                }
                start()
            }
            return
        }
        val clip = greetingClipFor(profile)
        if (clip == null) {
            localMessage = context.getString(R.string.voices_greeting_preview_preparing)
            return
        }
        val requestId = greetingPreviewRequestId + 1
        greetingPreviewRequestId = requestId
        scope.launch {
            stopMediaPreview(invalidateGreetingPreview = false)
            playingGreetingVoiceId = profile.id
            runCatching {
                val cached = ensureGreetingCached(clip)
                val player = MediaPlayer.create(context, Uri.parse(cached.localAudioUri))
                    ?: error("Failed to create greeting preview player.")
                if (greetingPreviewRequestId != requestId) {
                    player.release()
                    return@runCatching
                }
                mediaPlayer = player.apply {
                    setOnCompletionListener {
                        it.release()
                        if (mediaPlayer === it) mediaPlayer = null
                        if (playingGreetingVoiceId == profile.id) playingGreetingVoiceId = null
                    }
                    start()
                }
            }.onFailure { error ->
                AlarmTalkLog.reportError("Failed to play greeting preview", error)
                if (greetingPreviewRequestId == requestId) {
                    if (playingGreetingVoiceId == profile.id) playingGreetingVoiceId = null
                    localMessage = userFacingError(error, context.getString(R.string.voices_preview_play_failed))
                }
            }
        }
    }

    // 방금 등록한 목소리로 기본 모닝콜(고정 프리셋)을 즉석 생성해 들려준다. 다시 누르면 정지.
    // random preset 이라 직접 입력 미터링을 소비하지 않고 서버 캐시로 재생성도 저렴하다.
    fun previewRegisteredVoice(voice: VoiceProfile) {
        if (confirmPreviewPlaying) {
            stopMediaPreview(invalidateGreetingPreview = false)
            confirmPreviewPlaying = false
            return
        }
        if (confirmPreviewBusy) return
        confirmPreviewJob = scope.launch {
            stopMediaPreview(invalidateGreetingPreview = false)
            confirmPreviewBusy = true
            runCatching {
                val response = onGenerateTts(
                    TtsGenerateRequest(
                        voiceProfileId = voice.id,
                        category = "morning",
                        language = previewLanguage,
                        draftPreview = true,
                        listenerTitle = voice.listenerTitle,
                    ),
                )
                // 합성된 실제 문구 — Preview 스텝에 표시하고 수정의 기준이 된다.
                if (response.text.isNotBlank()) confirmPreviewText = response.text
                // 이전 시도의 실패 메시지가 성공한 화면에 남지 않게 지운다.
                localMessage = null
                val cached = withContext(Dispatchers.IO) {
                    val bytes = Base64.decode(response.audioBase64, Base64.DEFAULT)
                    audioStore.cacheGeneratedAudio(
                        bytes = bytes,
                        format = response.audioFormat,
                        rawAudioUri = response.audioUrl ?: response.audioObjectKey?.let { "r2://$it" },
                        displayName = "confirm_${voice.id}",
                        cacheKey = "confirm_${response.messageId}",
                        messageId = response.messageId,
                    )
                }
                val player = MediaPlayer.create(context, Uri.parse(cached.localAudioUri))
                    ?: error("Failed to create preview player.")
                mediaPlayer = player.apply {
                    setOnCompletionListener {
                        it.release()
                        if (mediaPlayer === it) {
                            mediaPlayer = null
                            confirmPreviewPlaying = false
                            scope.launch {
                                runCatching {
                                    val token = response.previewPlaybackToken
                                    if (token != null) {
                                        onConfirmVoicePreviewPlayed(voice.id, token)
                                    } else if (!response.previewPlaybackConfirmed) {
                                        error("Preview playback confirmation token missing")
                                    }
                                }.onSuccess {
                                    confirmPreviewCompleted = true
                                }.onFailure { error ->
                                    AlarmTalkLog.reportError("Failed to confirm preview playback", error)
                                    localMessage = userFacingError(
                                        error,
                                        context.getString(R.string.voices_preview_play_failed),
                                    )
                                }
                            }
                        }
                    }
                    start()
                }
                confirmPreviewPlaying = true
            }.onFailure { error ->
                // 다이얼로그를 닫아 코루틴이 취소된 경우는 오류가 아니다 — 취소는 되던져
                // 허위 "미리듣기 실패" 메시지가 뜨지 않게 한다.
                if (error is kotlin.coroutines.cancellation.CancellationException) throw error
                AlarmTalkLog.reportError("Failed to preview registered voice", error)
                localMessage = userFacingError(error, context.getString(R.string.voices_preview_play_failed))
            }
            confirmPreviewBusy = false
        }
    }

    // 미리듣기 문구 수정 저장: 서버에 반영(재청취 게이트 리셋) 후 수정본으로 즉시 재합성·재생.
    // 수정한 문구는 이후 매일 사전렌더 문구의 말투(스타일) 기준으로도 쓰인다.
    fun savePreviewTextEdit(voice: VoiceProfile) {
        val newText = confirmPreviewEditText.trim()
        if (newText.isBlank()) {
            localMessage = context.getString(R.string.voices_preview_edit_empty)
            return
        }
        if (confirmPreviewSaving) return
        if (newText == confirmPreviewText) {
            confirmPreviewEditing = false
            return
        }
        scope.launch {
            confirmPreviewSaving = true
            localMessage = null
            // 진행 중 재생/합성을 멈춘다 — 이후 재생은 수정본 기준이어야 한다.
            confirmPreviewJob?.cancel()
            confirmPreviewJob = null
            stopMediaPreview(invalidateGreetingPreview = false)
            confirmPreviewPlaying = false
            confirmPreviewBusy = false
            runCatching {
                onUpdateVoicePreviewText(voice.id, newText)
            }.onSuccess { normalized ->
                confirmPreviewText = normalized
                confirmPreviewCompleted = false
                confirmPreviewEditing = false
                confirmPreviewEditText = ""
                // 수정본을 바로 들려준다(끝까지 들으면 keep 버튼이 다시 열린다).
                previewRegisteredVoice(voice)
            }.onFailure { error ->
                if (error is kotlin.coroutines.cancellation.CancellationException) throw error
                AlarmTalkLog.reportError("Failed to update voice preview text", error)
                localMessage = userFacingError(
                    error,
                    context.getString(R.string.voices_preview_edit_failed),
                )
            }
            confirmPreviewSaving = false
        }
    }

    fun applySelectedAudio(audio: CachedAlarmAudio) {
        stopMediaPreview()
        selectedAudio = audio
        localMessage = voiceProfileDurationError(context, audio.durationMillis)
    }

    fun prepareSelectedFile(uri: Uri) {
        stopMediaPreview()
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) { audioStore.readDurationMillis(uri) }
                    ?: throw IllegalArgumentException(context.getString(R.string.voices_file_duration_unknown))
            }.onSuccess { durationMillis ->
                selectedAudio = null
                selectedFileUri = uri
                selectedFileDurationMillis = durationMillis
                cropStartMillis = 0L
                cropEndMillis = durationMillis.coerceAtMost(VoiceProfileAudioLimits.MAX_DURATION_MILLIS)
                localMessage = voiceProfileFileDurationError(context, durationMillis)
            }
                .onFailure { error ->
                    AlarmTalkLog.reportError("Failed to cache voice profile audio", error)
                    localMessage = userFacingError(error, context.getString(R.string.voices_selected_audio_unusable))
                }
        }
    }

    fun stopRecording() {
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) { recorder.stop() }
            }.onSuccess { audio ->
                isRecording = false
                val duration = audio.durationMillis
                val error = voiceProfileDurationError(context, duration)
                if (error == null) {
                    applySelectedAudio(audio)
                } else {
                    // 짧아서 버려진 녹음은 타이머도 0으로 되돌린다 — 지난 시간이 남아 있으면
                    // 저장된 것처럼 보인다.
                    selectedAudio = null
                    recordingElapsedMillis = 0L
                    // 1분 미만 안내는 마이크 카드의 대기 문구("1분 이상 녹음해 주세요")와
                    // 중복이라 대사 밑에 또 띄우지 않는다. 길이 확인 실패 등 다른 원인만 알린다.
                    val tooShort = duration != null && duration < VoiceProfileAudioLimits.MIN_DURATION_MILLIS
                    localMessage = if (tooShort) null else error
                }
            }.onFailure { error ->
                isRecording = false
                AlarmTalkLog.reportError("Failed to stop voice profile recording", error)
                localMessage = userFacingError(error, context.getString(R.string.voices_recording_stop_failed))
            }
        }
    }

    fun startRecording() {
        // 미리듣기(방금 녹음 클립 등)가 재생 중이면 먼저 멈춘다 — 스피커 소리가
        // 새 녹음(클론 원본)에 섞여 들어가는 것을 막는다.
        stopMediaPreview()
        runCatching {
            recorder.start(maxDurationMillis = VoiceProfileAudioLimits.MAX_DURATION_MILLIS)
            recordingElapsedMillis = 0L
            recordingLevel = 0f
            isRecording = true
            localMessage = null
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to start voice profile recording", error)
            localMessage = userFacingError(error, context.getString(R.string.voices_recording_start_failed))
        }
    }

    fun closeCreateDialog() {
        if (recorder.isRecording) recorder.cancel()
        isRecording = false
        recordingElapsedMillis = 0L
        recordingLevel = 0f
        stopMediaPreview()
        selectedFileUri = null
        selectedFileDurationMillis = null
        cropStartMillis = 0L
        cropEndMillis = VoiceProfileAudioLimits.MAX_DURATION_MILLIS
        createPreparing = false
        createSubmitAttempted = false
        profileName = ""
        profileVoiceLanguage = defaultVoiceLanguage
        relationshipSelection = RelationshipSelection()
        profileListenerTitle = ""
        shareVoice = false
        currentStep = VoiceRegistrationStep.Source
        selectedAudio = null
        mediaPlayer?.release()
        mediaPlayer = null
        showCreateForm = false
        localMessage = null
        // 미리듣기 스텝 상태 정리 — 진행 중 합성 코루틴을 취소해 늦은 재생을 막는다.
        confirmPreviewJob?.cancel()
        confirmPreviewJob = null
        confirmPreviewBusy = false
        confirmPreviewPlaying = false
        confirmPreviewText = null
        confirmPreviewEditing = false
        confirmPreviewEditText = ""
        confirmPreviewSaving = false
    }

    // 등록 요청을 보낸 뒤에도 다이얼로그를 닫지 않고 '만드는 중' 스텝으로 전환한다 —
    // 유지/삭제를 결정할 때까지 플로우 밖으로 나가지 않는다(사용자 요구).
    fun enterCreatingStep() {
        if (recorder.isRecording) recorder.cancel()
        isRecording = false
        recordingElapsedMillis = 0L
        recordingLevel = 0f
        stopMediaPreview()
        selectedAudio = null
        selectedFileUri = null
        selectedFileDurationMillis = null
        createPreparing = false
        createSubmitAttempted = false
        localMessage = null
        currentStep = VoiceRegistrationStep.Creating
    }

    LaunchedEffect(pendingVoiceDraft?.id, pendingVoiceDraft?.status) {
        val draft = pendingVoiceDraft
        when {
            // 생성 완료 → 만들기 다이얼로그 안 미리듣기 스텝으로. 앱 재시작/재로그인으로
            // ready draft 가 남아 있으면 이 스텝으로 바로 복귀한다(결정 전 이탈 방지).
            draft != null && (draft.status == null || draft.status == "ready") -> {
                if (confirmNewVoice?.id != draft.id) {
                    confirmPreviewCompleted = false
                    confirmPreviewText = null
                    confirmPreviewEditing = false
                    confirmPreviewEditText = ""
                }
                confirmNewVoice = draft
                showCreateForm = true
                currentStep = VoiceRegistrationStep.Preview
            }

            // 아직 클론 생성 중(서버 processing) → 만드는 중 스텝 유지/복귀.
            draft != null && draft.status == "processing" -> {
                showCreateForm = true
                if (currentStep != VoiceRegistrationStep.Creating) {
                    currentStep = VoiceRegistrationStep.Creating
                }
            }

            // 생성 실패 draft → 플로우를 닫고 목록/메시지로 처리하게 한다.
            draft != null && draft.status == "failed" -> {
                if (showCreateForm) closeCreateDialog()
            }

            // draft 소멸(삭제/승격) → 미리듣기 상태 정리. 승격이면 플로우를 닫는 대신
            // '목소리 생성 중' 스텝으로 이어 알람 문구 생성·다운로드까지 끝낸다.
            draft == null && confirmNewVoice?.isDraft == true -> {
                val promotedId = promotedForPrerenderId
                    ?.takeIf { requested -> requested == confirmNewVoice?.id }
                    ?.takeIf { requested -> voiceProfiles.any { it.id == requested } }
                confirmPreviewJob?.cancel()
                confirmPreviewJob = null
                stopMediaPreview(invalidateGreetingPreview = false)
                confirmPreviewBusy = false
                confirmPreviewPlaying = false
                confirmNewVoice = null
                if (promotedId != null) {
                    // 드라이브는 ViewModel 스코프에서 시작 — 화면은 진행 관찰만 한다.
                    onStartPrerenderDrive(promotedId)
                    currentStep = VoiceRegistrationStep.Prerendering
                } else if (showCreateForm) {
                    closeCreateDialog()
                }
            }
        }
    }

    // '목소리 생성 중' 화면은 ViewModel 드라이브의 진행을 관찰만 한다 — 드라이브가 끝나면
    // (완료/실패 모두 prerenderDrive 가 null 로 걷힘) 목소리 리스트로 돌아간다. 화면을 먼저
    // 닫아도 드라이브는 계속되고, 앱 종료 시엔 서버 cron 이 이어받는다.
    LaunchedEffect(currentStep, prerenderDrive?.voiceId) {
        if (currentStep != VoiceRegistrationStep.Prerendering) return@LaunchedEffect
        val watchedId = promotedForPrerenderId
        if (prerenderDrive == null || (watchedId != null && prerenderDrive.voiceId != watchedId)) {
            promotedForPrerenderId = null
            onReloadStockClips()
            closeCreateDialog()
        }
    }

    // 미리듣기 스텝 진입 시 문구·오디오를 자동 준비(합성+재생) — 문구가 화면에 뜨고
    // 끝까지 들으면 '이 목소리로 할게요' 가 열린다.
    LaunchedEffect(currentStep, confirmNewVoice?.id) {
        val voice = confirmNewVoice
        if (currentStep == VoiceRegistrationStep.Preview && voice != null &&
            confirmPreviewText == null && !confirmPreviewBusy && !confirmPreviewSaving
        ) {
            previewRegisteredVoice(voice)
        }
    }

    // 만드는 중 스텝에서 생성 요청이 draft 행도 못 만들고 실패하면(업로드/클론 오류)
    // 세부 정보 스텝으로 되돌린다. Creating 진입은 요청 수락(busy=true 동기 설정) 후에만
    // 일어나므로, busy 도 아니고 draft 도 없으면 생성이 끝났는데 실패한 것이다.
    // 오류 메시지는 ViewModel 이 전역 message 로 띄운다.
    LaunchedEffect(voiceProfileBusy, pendingVoiceDraft?.id, currentStep) {
        if (currentStep != VoiceRegistrationStep.Creating) return@LaunchedEffect
        if (!voiceProfileBusy && pendingVoiceDraft == null) {
            currentStep = VoiceRegistrationStep.Details
        }
    }

    val pickAudioLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) prepareSelectedFile(uri)
    }
    val recordPermissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            startRecording()
        } else {
            localMessage = context.getString(R.string.voices_mic_permission_required)
        }
    }

    LaunchedEffect(isRecording) {
        if (isRecording) {
            val startedAt = System.currentTimeMillis()
            while (isRecording) {
                recordingElapsedMillis = (System.currentTimeMillis() - startedAt)
                    .coerceAtMost(VoiceProfileAudioLimits.MAX_DURATION_MILLIS)
                recordingLevel = (recorder.maxAmplitude().toFloat() / 32767f).coerceIn(0f, 1f)
                if (recordingElapsedMillis >= VoiceProfileAudioLimits.MAX_DURATION_MILLIS) {
                    stopRecording()
                    break
                }
                delay(250)
            }
        }
    }

    LaunchedEffect(canShareVoice) {
        if (!canShareVoice) shareVoice = false
    }

    LaunchedEffect(canCreateVoice) {
        // 결정 구간에선 구독 상태가 흔들려도 플로우를 강제 종료하지 않는다(결정이 먼저).
        if (!canCreateVoice && showCreateForm &&
            currentStep != VoiceRegistrationStep.Creating &&
            currentStep != VoiceRegistrationStep.Preview
        ) {
            closeCreateDialog()
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            if (recorder.isRecording) recorder.cancel()
            stopMediaPreview()
        }
    }

    // ── 유료 클론 알람 음성 준비 상태(서버 사전렌더 + 로컬 다운로드) ──
    // '준비 완료'는 서버 21/21(status=done) && 로컬 알람 버킷 완전 다운로드일 때만(표시 제거).
    // 준비 중이어도 기존 캐시/프리셋은 삭제하지 않는다 — 새 버전이 준비될 때까지 기존 버전이 동작한다.
    var prerenderStatuses by remember {
        mutableStateOf<Map<String, com.alarmtalk.app.network.VoicePrerenderStatusResponse>>(emptyMap())
    }
    var cloneLocalReadyIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    var prerenderRetryBusyIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    var speechStyleRetryBusyIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    // 실패 후 [다시 시도] 수락 시 증가 — 멈춘 폴링 루프를 재시작한다.
    var prerenderPollTick by remember { mutableIntStateOf(0) }

    // 클론 클립 언어 선택: 앱 언어 클립이 있으면 앱 언어, 없으면 그 보이스가 가진 언어
    // (=등록 때 고른 언어). 편집기 bucketClipLanguageFor 와 동일 규칙 — 일본어로 만든
    // 클론이 한국어 기기에서 '다운로드 중'에 영원히 갇히지 않게 한다.
    fun cloneClipLanguageFor(profileId: String, category: String): String {
        val langs = stockClips.asSequence()
            .filter { it.voiceProfileId == profileId && it.category == category }
            .map { it.language ?: "ko" }
            .toSet()
        return if (previewLanguage in langs) previewLanguage else langs.firstOrNull() ?: previewLanguage
    }

    // 알람 버킷 4종이 매니페스트에 풀셋으로 존재하는지 — AlarmEditorScreen.hasCompleteCloneBucket
    // 과 동일한 variant 절대 인덱스 판정. greeting 은 미리듣기 전용이라 게이트에서 제외한다.
    fun cloneManifestComplete(profileId: String): Boolean = CloneAlarmBucketCategories.all { category ->
        val fullCount = expectedCloneBucketVariantCount(category) ?: return@all false
        val clipLanguage = cloneClipLanguageFor(profileId, category)
        val variants = stockClips
            .filter {
                it.voiceProfileId == profileId && it.category == category &&
                    (it.language ?: "ko") == clipLanguage
            }
            .map { it.variant }
            .toSet()
        variants == (0 until fullCount).toSet()
    }

    // 매니페스트의 알람 버킷 클립을 전부 로컬 캐시(있으면 재사용, 편집기와 같은 stock_ 키).
    // true = 로컬 완전 다운로드 완료.
    suspend fun downloadCloneBuckets(profileId: String): Boolean = withContext(Dispatchers.IO) {
        var allCached = true
        CloneAlarmBucketCategories.forEach { category ->
            val clipLanguage = cloneClipLanguageFor(profileId, category)
            stockClips
                .filter {
                    it.voiceProfileId == profileId && it.category == category &&
                        (it.language ?: "ko") == clipLanguage
                }
                .forEach { clip ->
                    val cacheKey = "stock_${clip.messageId}"
                    if (audioStore.getCachedAudio(cacheKey) == null) {
                        runCatching {
                            val response = onDownloadStockAudio(clip.messageId)
                            audioStore.cacheGeneratedAudio(
                                bytes = Base64.decode(response.audioBase64, Base64.DEFAULT),
                                format = response.audioFormat,
                                rawAudioUri = response.audioUrl,
                                displayName = cacheKey,
                                cacheKey = cacheKey,
                                messageId = clip.messageId,
                            )
                        }.onFailure { error ->
                            if (error is kotlin.coroutines.cancellation.CancellationException) throw error
                            allCached = false
                        }
                    }
                }
        }
        allCached && cloneManifestComplete(profileId)
    }

    // 매니페스트의 알람 버킷 클립이 전부 로컬 캐시에 있는지 — 다운로드 없이 캐시만 본다.
    suspend fun cloneBucketsFullyCached(profileId: String): Boolean = withContext(Dispatchers.IO) {
        cloneManifestComplete(profileId) && CloneAlarmBucketCategories.all { category ->
            val clipLanguage = cloneClipLanguageFor(profileId, category)
            stockClips
                .filter {
                    it.voiceProfileId == profileId && it.category == category &&
                        (it.language ?: "ko") == clipLanguage
                }
                .all { audioStore.getCachedAudio("stock_${it.messageId}") != null }
        }
    }

    // 준비 상태 폴링 — 목소리 탭이 보이는 동안만 짧은 주기로(화면 이탈 시 이펙트가 취소된다).
    val cloneReadinessIds = ownVoices.filter { it.status == null || it.status == "ready" }.map { it.id }
    LaunchedEffect(cloneReadinessIds, stockClips, prerenderPollTick) {
        if (cloneReadinessIds.isEmpty()) return@LaunchedEffect
        // 이미 전부 캐시된 목소리는 서버 상태 조회 전에 곧장 ready 처리 — 탭에 들어올 때마다
        // '다운로드 중' 배지가 한 박자 떴다 사라지는 깜빡임을 없앤다.
        cloneReadinessIds.forEach { voiceId ->
            if (voiceId !in cloneLocalReadyIds &&
                runCatching { cloneBucketsFullyCached(voiceId) }.getOrDefault(false)
            ) {
                cloneLocalReadyIds = cloneLocalReadyIds + voiceId
            }
        }
        var manifestReloadRequested = false
        while (true) {
            var anyPending = false
            cloneReadinessIds.forEach { voiceId ->
                if (voiceId in cloneLocalReadyIds) return@forEach
                val status = runCatching { onGetVoicePrerenderStatus(voiceId) }
                    .onFailure { if (it is kotlin.coroutines.cancellation.CancellationException) throw it }
                    .getOrNull()
                if (status == null) {
                    // 일시 네트워크 실패 — 다음 틱에 재시도.
                    anyPending = true
                    return@forEach
                }
                prerenderStatuses = prerenderStatuses + (voiceId to status)
                when (status.status) {
                    "pending" -> anyPending = true
                    "done" -> {
                        if (cloneManifestComplete(voiceId)) {
                            val ready = runCatching { downloadCloneBuckets(voiceId) }
                                .onFailure {
                                    if (it is kotlin.coroutines.cancellation.CancellationException) throw it
                                }
                                .getOrDefault(false)
                            if (ready) {
                                cloneLocalReadyIds = cloneLocalReadyIds + voiceId
                            } else {
                                anyPending = true
                            }
                        } else {
                            // 서버는 완료인데 세션 매니페스트가 옛것 — 한 번 새로 받는다.
                            // stockClips 가 갱신되면 이 이펙트가 재시작돼 다시 판정한다.
                            if (!manifestReloadRequested) {
                                manifestReloadRequested = true
                                onReloadStockClips()
                            }
                            anyPending = true
                        }
                    }
                    // "failed" → 실패 표시 + [다시 시도] 대기(폴링 중단). "none"/기타 → 표시 없음.
                }
            }
            if (!anyPending) break
            delay(5_000)
        }
    }

    fun retryPrerender(profileId: String) {
        if (profileId in prerenderRetryBusyIds) return
        prerenderRetryBusyIds = prerenderRetryBusyIds + profileId
        scope.launch {
            val accepted = runCatching { onRetryVoicePrerender(profileId) }
                .onFailure { if (it is kotlin.coroutines.cancellation.CancellationException) throw it }
                .getOrDefault(false)
            if (accepted) {
                val current = prerenderStatuses[profileId]
                prerenderStatuses = prerenderStatuses + (
                    profileId to (
                        current?.copy(status = "pending")
                            ?: com.alarmtalk.app.network.VoicePrerenderStatusResponse(status = "pending")
                        )
                    )
                prerenderPollTick += 1
            }
            prerenderRetryBusyIds = prerenderRetryBusyIds - profileId
        }
    }

    fun retrySpeechStyle(profileId: String) {
        if (profileId in speechStyleRetryBusyIds) return
        speechStyleRetryBusyIds = speechStyleRetryBusyIds + profileId
        scope.launch {
            // 성공 시 ViewModel 이 프로필 speech_style_status 를 갱신해 안내가 사라진다.
            // 실패 메시지도 ViewModel 이 전역 message 로 띄운다.
            runCatching { onRetryVoiceSpeechStyle(profileId) }
                .onFailure { if (it is kotlin.coroutines.cancellation.CancellationException) throw it }
            speechStyleRetryBusyIds = speechStyleRetryBusyIds - profileId
        }
    }

    suspend fun croppedFileAudio(): CachedAlarmAudio {
        val uri = selectedFileUri ?: throw IllegalStateException(context.getString(R.string.voices_select_file_first))
        val cropDurationMillis = (cropEndMillis - cropStartMillis)
            .coerceIn(1_000L, VoiceProfileAudioLimits.MAX_DURATION_MILLIS)
        return withContext(Dispatchers.IO) {
            audioStore.cacheFromUri(
                sourceUri = uri,
                maxDurationMillis = cropDurationMillis,
                startMillis = cropStartMillis,
            )
        }
    }

    // 공유받은 목소리 행의 ▶ — 소유자가 등록할 때 만들어진 인사말 사전렌더 클립을 들려준다
    // (stock-clips 매니페스트가 같은 그룹에 공유 중인 클론 클립도 포함). 다시 누르면 정지.
    fun playSharedGreeting(profile: FamilyVoiceProfile) {
        if (playingGreetingVoiceId == profile.id) {
            stopMediaPreview()
            return
        }
        val clip = com.alarmtalk.app.data.greetingStockClipFor(stockClips, profile.id, previewLanguage)
        if (clip == null) {
            localMessage = context.getString(R.string.voices_greeting_preview_preparing)
            return
        }
        val requestId = greetingPreviewRequestId + 1
        greetingPreviewRequestId = requestId
        scope.launch {
            stopMediaPreview(invalidateGreetingPreview = false)
            playingGreetingVoiceId = profile.id
            runCatching {
                val cached = ensureGreetingCached(clip)
                val player = MediaPlayer.create(context, Uri.parse(cached.localAudioUri))
                    ?: error("Failed to create greeting preview player.")
                if (greetingPreviewRequestId != requestId) {
                    player.release()
                    return@runCatching
                }
                mediaPlayer = player.apply {
                    setOnCompletionListener {
                        it.release()
                        if (mediaPlayer === it) mediaPlayer = null
                        if (playingGreetingVoiceId == profile.id) playingGreetingVoiceId = null
                    }
                    start()
                }
            }.onFailure { error ->
                AlarmTalkLog.reportError("Failed to play shared greeting preview", error)
                if (greetingPreviewRequestId == requestId) {
                    if (playingGreetingVoiceId == profile.id) playingGreetingVoiceId = null
                    localMessage = userFacingError(error, context.getString(R.string.voices_preview_play_failed))
                }
            }
        }
    }

    fun playFileCropPreview() {
        if (filePreviewPreparing) return
        if (filePreviewPlaying) {
            stopMediaPreview()
            return
        }
        scope.launch {
            filePreviewPreparing = true
            filePreviewPlaying = false
            runCatching {
                croppedFileAudio()
            }.onSuccess { audio ->
                mediaPlayer?.release()
                val player = MediaPlayer.create(context, Uri.parse(audio.localAudioUri))
                if (player == null) {
                    filePreviewPreparing = false
                    localMessage = context.getString(R.string.voices_preview_play_failed)
                    return@onSuccess
                }
                mediaPlayer = player.apply {
                    setOnCompletionListener {
                        it.release()
                        if (mediaPlayer === it) {
                            mediaPlayer = null
                            filePreviewPreparing = false
                            filePreviewPlaying = false
                        }
                    }
                    start()
                }
                filePreviewPreparing = false
                filePreviewPlaying = true
            }.onFailure { error ->
                AlarmTalkLog.reportError("Failed to play cropped voice preview", error)
                filePreviewPreparing = false
                filePreviewPlaying = false
                localMessage = userFacingError(error, context.getString(R.string.voices_preview_play_failed))
            }
        }
    }

    // 방금 녹음한 클립을 들어본다 (녹음 완료 배지의 ▶/⏸ 토글).
    fun playRecordedPreview() {
        if (recordPreviewPlaying) {
            stopMediaPreview()
            return
        }
        val audio = selectedAudio ?: return
        stopMediaPreview()
        runCatching {
            val player = MediaPlayer.create(context, Uri.parse(audio.localAudioUri))
                ?: error("Failed to create recorded preview player.")
            mediaPlayer = player.apply {
                setOnCompletionListener {
                    it.release()
                    // 이전 플레이어의 늦은 completion 이 새 재생 상태를 끄지 않도록 가드.
                    if (mediaPlayer === it) {
                        mediaPlayer = null
                        recordPreviewPlaying = false
                    }
                }
                start()
            }
            recordPreviewPlaying = true
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to play recorded voice preview", error)
            localMessage = userFacingError(error, context.getString(R.string.voices_preview_play_failed))
        }
    }

    fun submitCreateProfile(name: String) {
        createSubmitAttempted = true
        val trimmedName = name.trim()
        // 관계·호칭은 선택 입력 — 비어 있으면 빈 값 그대로 넘기고 ViewModel 이 미전송 처리한다.
        val trimmedRelationship = relationshipSelection.resolved
        val trimmedListener = profileListenerTitle.trim()
        if (trimmedName.isBlank()) {
            localMessage = null
            return
        }
        if (!canCreateVoice) {
            localMessage = paidVoiceRequiredMessage
            return
        }
        if (createPreparing) return
        if (inputMode == VoiceCaptureMode.Record) {
            val audio = selectedAudio ?: run {
                localMessage = context.getString(R.string.voices_prepare_recording_first)
                return
            }
            if (voiceProfileDurationError(context, audio.durationMillis) != null) return
            // 검증을 다 통과해 실제로 등록을 보낼 때만 확인창 감지를 무장한다(중단/검증실패 후
            // 스냅샷이 남아 엉뚱한 목소리에 확인창이 뜨는 것을 막는다).
            // ViewModel 이 요청을 시작하지 못했으면(false — 스테일 세션/플랜/개수 상태 등)
            // '만드는 중' 스텝에 진입하지 않는다 — 못 닫는 화면에 갇히는 것을 막는다.
            val accepted = onCreateVoiceProfile(
                trimmedName,
                audio,
                shareVoice,
                trimmedRelationship,
                trimmedListener,
                profileVoiceLanguage,
            )
            if (accepted) enterCreatingStep()
            return
        }
        scope.launch {
            createPreparing = true
            localMessage = null
            runCatching {
                croppedFileAudio()
            }.onSuccess { audio ->
                val error = voiceProfileCropDurationError(context, audio.durationMillis)
                if (error != null) {
                    localMessage = error
                } else {
                    val accepted = onCreateVoiceProfile(
                        trimmedName,
                        audio,
                        shareVoice,
                        trimmedRelationship,
                        trimmedListener,
                        profileVoiceLanguage,
                    )
                    if (accepted) enterCreatingStep()
                }
            }.onFailure { error ->
                AlarmTalkLog.reportError("Failed to prepare selected voice file", error)
                localMessage = userFacingError(error, context.getString(R.string.voices_prepare_selected_failed))
            }
            createPreparing = false
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = stringResource(R.string.voices_my_voices_title),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Button(
                onClick = {
                    if (canOpenCreateForm) showCreateForm = true
                },
                enabled = canOpenCreateForm,
            ) {
                Text(stringResource(R.string.voices_add))
            }
        }

        if (localMessage != null && !showCreateForm && localMessage != paidVoiceRequiredMessage) {
            MutedText(localMessage.orEmpty())
        }

        if (ownVoices.isEmpty() && canCreateVoice) {
            MutedText(stringResource(R.string.voices_no_voices_yet))
        } else if (ownVoices.isEmpty() && authSession != null) {
            // 무료 플랜 — 빈 자리로 두지 않고, 내 목소리 클론이 유료 기능임을 조용히 알린다.
            MutedText(stringResource(R.string.voices_clone_requires_paid_hint))
        } else if (ownVoices.isNotEmpty()) {
            ownVoices.forEach { profile ->
                // 준비 상태 표시: 서버 사전렌더 중 "준비 중 n/21" → 서버 완료 후 로컬 다운로드 중
                // "다운로드 중" → 둘 다 완료(준비 완료)면 표시 없음. 조회 전에도 표시하지 않는다.
                val prerenderStatus = prerenderStatuses[profile.id]
                val readiness = when {
                    profile.id in cloneLocalReadyIds -> null
                    prerenderStatus == null -> null
                    prerenderStatus.status == "failed" -> CloneVoiceReadiness.Failed
                    prerenderStatus.status == "done" -> CloneVoiceReadiness.Downloading
                    prerenderStatus.status == "pending" && prerenderStatus.total > 0 ->
                        CloneVoiceReadiness.Preparing(prerenderStatus.generated, prerenderStatus.total)
                    else -> null
                }
                VoiceProfileRow(
                    profile = profile,
                    enabled = !voiceProfileBusy,
                    canShareVoice = canShareVoice,
                    onRename = {
                        renameTarget = profile
                        renameName = profile.name
                        renameRelationship = profile.relationshipLabel.orEmpty()
                        renameListenerTitle = profile.listenerTitle.orEmpty()
                        renameSubmitAttempted = false
                    },
                    onShareChange = { shared -> onShareVoiceProfile(profile.id, shared) },
                    onDelete = { deleteTarget = profile },
                    readiness = readiness,
                    onRetryPrerender = { retryPrerender(profile.id) },
                    retryPrerenderBusy = profile.id in prerenderRetryBusyIds,
                    speechStyleFailed = profile.speechStyleStatus == "failed",
                    onRetrySpeechStyle = { retrySpeechStyle(profile.id) },
                    retrySpeechStyleBusy = profile.id in speechStyleRetryBusyIds,
                )
            }
        }

        if (canShareVoice && familyVoices.isNotEmpty()) {
            Text(
                text = stringResource(R.string.voices_shared_voices_title),
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
            )
            familyVoices.forEach { profile ->
                SharedVoiceProfileRow(
                    profile = profile,
                    isPlaying = playingGreetingVoiceId == profile.id,
                    onPlay = { playSharedGreeting(profile) },
                )
            }
        }

        // 기본 목소리는 맨 아래 — 내 목소리·공유받은 목소리(개인화된 것들)가 먼저 온다.
        if (systemVoices.isNotEmpty()) {
            Row(
                // 토스식 [제목 … 값 + 셰브론] 행 — 탭하면 기본 목소리 선택 시트를 연다.
                // 눌림 리플(indication) 없이 조용히 동작.
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                    ) {
                        // 이전 화면 흐름의 안내가 시트 안에 엉뚱하게 보이지 않게 비우고 연다.
                        localMessage = null
                        prefetchGreetingPreviews()
                        defaultVoiceSheetOpen = true
                    }
                    .padding(vertical = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = stringResource(R.string.voices_default_voice_row_title),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                )
                Row(
                    horizontalArrangement = Arrangement.spacedBy(2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        // 정해진 기본 목소리 이름이 값. 아직 없으면 '선택하기'로 행동을 유도한다.
                        text = systemVoices.firstOrNull { it.id == defaultVoiceId }?.name
                            ?: stringResource(R.string.voices_default_voice_choose),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Icon(
                        imageVector = Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            // 기본 목소리 변경 직후 무료 버킷 클립 프리페치 진행 — 완료/실패 시 자동으로 사라진다
            // (실패해도 편집기 온디맨드 다운로드가 폴백하므로 별도 안내는 하지 않는다).
            voicePrefetchProgress?.let { (done, total) ->
                VoiceProgressMessage(
                    stringResource(R.string.voices_default_voice_prefetching, done, total),
                )
            }
            // 기본(시스템) 목소리는 별도 호칭 없이 계정 닉네임으로 부른다
            // (AlarmEditorScreen.resolvedVoiceListenerTitle). 관계·호칭은 내/공유 목소리에만 있다.
        }
    }

    if (voicePlanGateOpen) {
        PlanGateDialog(
            title = stringResource(R.string.voices_create_paid_title),
            message = stringResource(R.string.voices_create_paid_notice),
            onConfirm = {
                voicePlanGateOpen = false
                onOpenBilling()
            },
            onDismiss = { voicePlanGateOpen = false },
        )
    }

    // 시트가 열린 채 시스템 보이스 목록이 비면(세션 초기화·재로딩) 재생을 멈추고 시트를 정리한다.
    LaunchedEffect(systemVoices.isEmpty()) {
        if (systemVoices.isEmpty() && defaultVoiceSheetOpen) {
            stopMediaPreview()
            defaultVoiceSheetOpen = false
        }
    }

    if (defaultVoiceSheetOpen && systemVoices.isNotEmpty()) {
        // 다른 선택 시트와 달리 탭해도 닫지 않는다 — 탭 = 선택 + 인사말 미리듣기(재탭 시 정지)라
        // 여러 목소리를 이어 들어보며 고르는 흐름. 닫기는 드래그/스크림.
        WakerSelectionSheet(
            title = stringResource(R.string.voices_default_voice_row_title),
            onDismiss = {
                stopMediaPreview()
                defaultVoiceSheetOpen = false
            },
        ) { _ ->
            WakerSheetOptionGroup {
                systemVoices.forEachIndexed { index, profile ->
                    WakerSheetOptionRow(
                        title = profile.name,
                        selected = profile.id == defaultVoiceId,
                        onClick = {
                            onSetDefaultVoice(profile.id)
                            playGreeting(profile)
                        },
                        trailing = if (playingGreetingVoiceId == profile.id) {
                            { PlayingEqualizer() }
                        } else {
                            null
                        },
                        divider = index != systemVoices.lastIndex,
                    )
                }
            }
            // 미리듣기 준비중/실패 안내 — 패널 본문의 MutedText 는 시트 스크림에 가려지므로
            // 시트가 열려 있는 동안엔 여기서 보여준다(열 때 localMessage 를 비워 회귀 방지).
            // 시트 콘텐츠는 풀블리드(민짜 행)라 텍스트에는 좌우 패딩을 직접 준다.
            if (localMessage != null) {
                Box(modifier = Modifier.padding(horizontal = 20.dp)) {
                    MutedText(localMessage.orEmpty())
                }
            }
        }
    }

    // 만드는 중/미리듣기/사전렌더 스텝에선 draft·등록 완료로 isLimitReached 가 돼도 다이얼로그를 유지한다.
    if (showCreateForm && (inDraftDecisionFlow || inPrerenderingFlow || (!isLimitReached && canCreateVoice))) {
        val useManualSystemInsets = Build.VERSION.SDK_INT >= 35
        val actionBottomPadding = 10.dp + if (useManualSystemInsets) {
            androidNavigationBarHeightPadding() + AndroidEdgeToEdgeNavigationExtraPadding
        } else {
            0.dp
        }
        val dialogSurfaceModifier = if (useManualSystemInsets) {
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
        } else {
            Modifier.fillMaxSize()
        }
        val resolvedProfileName = profileName.trim()
        val nameRequiredError = createSubmitAttempted && resolvedProfileName.isBlank()
        // 1분 미만이면 "다음" 으로 넘어가지 못하게 막는다. 녹음은 selectedAudio 길이,
        // 파일은 실제 업로드되는 crop 구간 길이로 판정(백엔드 MIN_UPLOAD_DURATION_MS 와 동일 기준).
        val canSubmitRecord = inputMode == VoiceCaptureMode.Record &&
            (selectedAudio?.durationMillis ?: 0L) >= VoiceProfileAudioLimits.MIN_DURATION_MILLIS
        val canSubmitSingleFile = inputMode == VoiceCaptureMode.File &&
            selectedFileUri != null &&
            (cropEndMillis - cropStartMillis) >= VoiceProfileAudioLimits.MIN_DURATION_MILLIS
        Dialog(
            onDismissRequest = {
                when {
                    // 업로드/클론 생성 등 API 호출이 나가는 순간만 잠시 차단(통신 무결성).
                    voiceProfileBusy -> Unit
                    // 결정 구간(만드는 중/미리듣기) — 그냥 닫지 않고 '임시 목소리 삭제' 경고를 띄운다.
                    inDraftDecisionFlow -> draftExitWarningOpen = true
                    else -> closeCreateDialog()
                }
            },
            properties = DialogProperties(
                usePlatformDefaultWidth = false,
                decorFitsSystemWindows = !useManualSystemInsets,
            ),
        ) {
            Surface(
                modifier = dialogSurfaceModifier,
                color = MaterialTheme.colorScheme.background,
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .imePadding(),
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 20.dp, vertical = 18.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = stringResource(R.string.voices_create_dialog_title),
                            modifier = Modifier.weight(1f),
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                        )
                        IconButton(
                            onClick = {
                                // 결정 구간에서도 닫기는 가능 — 대신 '임시 목소리 삭제' 경고를 거친다.
                                if (inDraftDecisionFlow) {
                                    draftExitWarningOpen = true
                                } else {
                                    closeCreateDialog()
                                }
                            },
                            enabled = !voiceProfileBusy,
                            modifier = Modifier.size(42.dp),
                        ) {
                            Icon(Icons.Outlined.Close, contentDescription = stringResource(R.string.voices_close))
                        }
                    }

                    // 녹음 모드(첫 스텝)는 대사 카드가 남은 화면 높이를 채우고 카드 안에서만
                    // 스크롤하므로 페이지 스크롤을 끈다. 파일 모드·다른 스텝은 콘텐츠가
                    // 길어질 수 있어 기존 페이지 스크롤을 유지한다.
                    // 분할 화면·팝업 뷰처럼 창이 짧으면 잔여 높이가 대사 카드를 못 담아
                    // 슬리버가 되므로, 그 경우도 페이지 스크롤 + 카드 높이 캡으로 폴백한다.
                    val scriptFillsRemainingHeight = currentStep == VoiceRegistrationStep.Source &&
                        inputMode == VoiceCaptureMode.Record &&
                        LocalConfiguration.current.screenHeightDp >= 560
                    val contentScrollState = rememberScrollState()
                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .then(
                                if (scriptFillsRemainingHeight) {
                                    Modifier
                                } else {
                                    Modifier.verticalScroll(contentScrollState)
                                },
                            )
                            .padding(horizontal = 20.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        when (currentStep) {
                            VoiceRegistrationStep.Source -> {
                                VoiceCaptureModeSelector(
                                    selected = inputMode,
                                    enabled = !isRecording && !createPreparing,
                                    onSelect = {
                                        if (inputMode != it) {
                                            stopMediaPreview()
                                            localMessage = null
                                        }
                                        inputMode = it
                                    },
                                )

                                if (inputMode == VoiceCaptureMode.Record) {
                                    // 녹음 카드를 위에 — 대사를 읽는 동안에도 시간/버튼이 보인다.
                                    VoiceRecordControls(
                                        isRecording = isRecording,
                                        elapsedMillis = recordingElapsedMillis,
                                        maxDurationMillis = VoiceProfileAudioLimits.MAX_DURATION_MILLIS,
                                        level = recordingLevel,
                                        enabled = !voiceProfileBusy && !createPreparing,
                                        // 마이크 버튼이 행동을 설명하므로 "눌러서 녹음 시작" 대신
                                        // 이 흐름의 핵심 제약(최소 1분)을 대기 상태 문구로 쓴다.
                                        idleStatusText = stringResource(R.string.voices_record_status_min_duration),
                                        onRecordClick = {
                                            if (isRecording) {
                                                stopRecording()
                                            } else if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) ==
                                                PackageManager.PERMISSION_GRANTED
                                            ) {
                                                startRecording()
                                            } else {
                                                recordPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                                            }
                                        },
                                        recordedDurationMillis = selectedAudio?.durationMillis,
                                        isRecordedPreviewActive = recordPreviewPlaying,
                                        onPreviewRecording = ::playRecordedPreview,
                                    )
                                    // 남은 화면 높이를 대사 카드가 채운다(내용이 짧으면 그만큼만).
                                    // 짧은 창 폴백에선 페이지가 스크롤되므로 weight 대신 높이 캡.
                                    VoiceRecordScriptCard(
                                        fillHeight = scriptFillsRemainingHeight,
                                        modifier = if (scriptFillsRemainingHeight) {
                                            Modifier.weight(1f, fill = false)
                                        } else {
                                            Modifier
                                        },
                                    )
                                } else {
                                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                        VoiceFileControls(
                                            durationMillis = selectedFileDurationMillis,
                                            cropStartMillis = cropStartMillis,
                                            cropEndMillis = cropEndMillis,
                                            minDurationMillis = VoiceProfileAudioLimits.MIN_DURATION_MILLIS,
                                            maxDurationMillis = VoiceProfileAudioLimits.MAX_DURATION_MILLIS,
                                            enabled = !voiceProfileBusy && !isRecording && !createPreparing,
                                            uploadLabel = stringResource(R.string.voices_upload_file_or_video),
                                            notice = stringResource(R.string.voices_crop_duration_notice),
                                            noticeAfterUpload = true,
                                            uploadSubtitle = stringResource(R.string.voices_upload_zone_subtitle),
                                            isPreviewActive = filePreviewPlaying,
                                            isPreviewPreparing = filePreviewPreparing,
                                            onPickFile = { pickAudioLauncher.launch(arrayOf("audio/*", "video/*")) },
                                            onCropChange = { start, end ->
                                                if (start != cropStartMillis || end != cropEndMillis) {
                                                    stopMediaPreview()
                                                    cropStartMillis = start
                                                    cropEndMillis = end
                                                }
                                            },
                                            onPreviewCrop = { playFileCropPreview() },
                                        )
                                        // 여러 명이 섞인 오디오는 클론 품질이 떨어진다 — 파일을 고르면
                                        // 한 사람 목소리만 넣도록 안내한다.
                                        if (selectedFileDurationMillis != null) {
                                            MutedText(stringResource(R.string.voices_single_speaker_hint))
                                        }
                                    }
                                }
                            }

                            VoiceRegistrationStep.Details -> {
                                OutlinedTextField(
                                    value = profileName,
                                    onValueChange = { profileName = it.take(50) },
                                    label = { Text(stringResource(R.string.voices_name_label)) },
                                    placeholder = { Text(stringResource(R.string.voices_name_placeholder)) },
                                    singleLine = true,
                                    isError = nameRequiredError,
                                    // supportingText 람다를 항상 넘기면 에러가 없어도 그 자리(약 16dp)가
                                    // 예약돼 이름↔관계 간격만 넓어진다 — 에러일 때만 붙여 3개 필드의
                                    // 간격(부모 spacedBy 14dp)을 균일하게 유지한다.
                                    supportingText = if (nameRequiredError) {
                                        { Text(stringResource(R.string.voices_required_field)) }
                                    } else {
                                        null
                                    },
                                    shape = WakerInputShape,
                                    colors = wakerOutlinedTextFieldColors(),
                                    modifier = Modifier.fillMaxWidth(),
                                )
                                // 관계·호칭은 선택 입력 — 비워도 다음 단계로 진행할 수 있다.
                                RelationshipDropdownField(
                                    selection = relationshipSelection,
                                    onSelectionChange = { relationshipSelection = it },
                                )
                                OutlinedTextField(
                                    value = profileListenerTitle,
                                    onValueChange = { profileListenerTitle = it.take(30) },
                                    label = { Text(stringResource(R.string.voices_listener_title_label)) },
                                    placeholder = { Text(stringResource(R.string.voices_listener_title_placeholder)) },
                                    singleLine = true,
                                    shape = WakerInputShape,
                                    colors = wakerOutlinedTextFieldColors(),
                                    modifier = Modifier.fillMaxWidth(),
                                )
                                // 문구 언어 — 미리듣기와 매일 사전렌더 문구가 이 언어로 만들어진다.
                                Text(
                                    text = stringResource(R.string.voices_language_label),
                                    style = MaterialTheme.typography.titleSmall,
                                    fontWeight = FontWeight.SemiBold,
                                    modifier = Modifier.padding(top = 4.dp),
                                )
                                EditorSegmentedSelector(
                                    options = listOf(
                                        "ko" to stringResource(R.string.voices_lang_ko),
                                        "en" to stringResource(R.string.voices_lang_en),
                                        "ja" to stringResource(R.string.voices_lang_ja),
                                    ),
                                    selected = profileVoiceLanguage,
                                    onSelect = { profileVoiceLanguage = it },
                                )
                                // 공유 설정 — 토글 하나뿐이라 단독 단계를 없애고 세부 정보에 합쳤다.
                                Text(
                                    text = stringResource(R.string.voices_step_sharing),
                                    style = MaterialTheme.typography.titleSmall,
                                    fontWeight = FontWeight.SemiBold,
                                    modifier = Modifier.padding(top = 4.dp),
                                )
                                ShareVoiceToggleCard(
                                    enabled = canShareVoice,
                                    checked = shareVoice && canShareVoice,
                                    title = stringResource(R.string.voices_sharing_shared_title),
                                    description = if (canShareVoice) {
                                        stringResource(R.string.voices_sharing_shared_desc_enabled)
                                    } else {
                                        stringResource(R.string.voices_sharing_shared_desc_disabled)
                                    },
                                    onCheckedChange = { shareVoice = it },
                                )
                            }

                            VoiceRegistrationStep.Creating -> {
                                Column(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(vertical = 72.dp),
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                    verticalArrangement = Arrangement.spacedBy(18.dp),
                                ) {
                                    CircularProgressIndicator()
                                    Text(
                                        text = stringResource(R.string.voices_creating_title),
                                        style = MaterialTheme.typography.titleMedium,
                                        fontWeight = FontWeight.SemiBold,
                                    )
                                    Text(
                                        text = stringResource(R.string.voices_creating_body),
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        textAlign = TextAlign.Center,
                                    )
                                }
                            }

                            VoiceRegistrationStep.Prerendering -> {
                                Column(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(vertical = 72.dp),
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                    verticalArrangement = Arrangement.spacedBy(18.dp),
                                ) {
                                    Text(
                                        text = if (prerenderDrive?.downloading == true) {
                                            stringResource(R.string.voices_prerender_downloading_title)
                                        } else {
                                            stringResource(R.string.voices_prerender_generating_title)
                                        },
                                        style = MaterialTheme.typography.titleMedium,
                                        fontWeight = FontWeight.SemiBold,
                                    )
                                    // 'n/21 준비' 카운트 텍스트 대신 진행 로딩바만 — 총량을 알면
                                    // 확정 진행률, 아직 모르면(시작 직후) 인디터미넌트.
                                    val drive = prerenderDrive
                                    if (drive != null && drive.total > 0) {
                                        LinearProgressIndicator(
                                            progress = {
                                                drive.generated.toFloat() / drive.total.toFloat()
                                            },
                                            modifier = Modifier.fillMaxWidth(0.72f),
                                        )
                                    } else {
                                        LinearProgressIndicator(
                                            modifier = Modifier.fillMaxWidth(0.72f),
                                        )
                                    }
                                    // 하단 고정 대신 로딩 블록에서 조금 떨어져 바로 아래에 둔다 —
                                    // 닫아도 드라이브는 ViewModel 에서 계속된다.
                                    Spacer(Modifier.height(10.dp))
                                    TextButton(
                                        onClick = {
                                            promotedForPrerenderId = null
                                            closeCreateDialog()
                                        },
                                    ) {
                                        Text(stringResource(R.string.voices_prerender_continue_background_action))
                                    }
                                }
                            }

                            VoiceRegistrationStep.Preview -> {
                                val previewVoice = confirmNewVoice
                                if (previewVoice != null) {
                                    Text(
                                        text = stringResource(R.string.voices_confirm_new_title, previewVoice.name),
                                        style = MaterialTheme.typography.titleMedium,
                                        fontWeight = FontWeight.SemiBold,
                                    )
                                    Text(
                                        text = stringResource(R.string.voices_confirm_new_body),
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                    OutlinedCard(
                                        shape = WakerPanelShape,
                                        border = wakerCardBorder(),
                                    ) {
                                        Column(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .padding(16.dp),
                                            verticalArrangement = Arrangement.spacedBy(8.dp),
                                        ) {
                                            if (confirmPreviewEditing) {
                                                OutlinedTextField(
                                                    value = confirmPreviewEditText,
                                                    onValueChange = { confirmPreviewEditText = it.take(200) },
                                                    minLines = 2,
                                                    enabled = !confirmPreviewSaving,
                                                    shape = WakerInputShape,
                                                    colors = wakerOutlinedTextFieldColors(),
                                                    modifier = Modifier.fillMaxWidth(),
                                                )
                                                Row(
                                                    modifier = Modifier.fillMaxWidth(),
                                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                                ) {
                                                    OutlinedButton(
                                                        onClick = {
                                                            confirmPreviewEditing = false
                                                            confirmPreviewEditText = ""
                                                        },
                                                        enabled = !confirmPreviewSaving,
                                                        modifier = Modifier.weight(1f),
                                                        shape = WakerButtonShape,
                                                        border = wakerCardBorder(),
                                                        colors = wakerOutlinedButtonColors(),
                                                    ) {
                                                        Text(stringResource(R.string.voices_preview_edit_cancel))
                                                    }
                                                    // 재생성 — 수정한 문구로 저장하고 바로 다시 합성해 들려준다.
                                                    Button(
                                                        onClick = { savePreviewTextEdit(previewVoice) },
                                                        enabled = !confirmPreviewSaving && confirmPreviewEditText.isNotBlank(),
                                                        modifier = Modifier.weight(1f),
                                                        shape = WakerButtonShape,
                                                    ) {
                                                        Text(
                                                            if (confirmPreviewSaving) {
                                                                stringResource(R.string.voices_preview_edit_saving)
                                                            } else {
                                                                stringResource(R.string.voices_preview_edit_save)
                                                            },
                                                        )
                                                    }
                                                }
                                            } else {
                                                Row(
                                                    modifier = Modifier.fillMaxWidth(),
                                                    verticalAlignment = Alignment.CenterVertically,
                                                ) {
                                                    Text(
                                                        text = when {
                                                            confirmPreviewText != null -> "“$confirmPreviewText”"
                                                            confirmPreviewBusy -> stringResource(R.string.voices_preview_text_loading)
                                                            // 자동 준비 실패(잠시 후 재시도 가능한 409 등) — 준비 중이라고
                                                            // 속이지 않고 다시 듣기로 재시도하게 안내한다.
                                                            else -> stringResource(R.string.voices_preview_text_retry_hint)
                                                        },
                                                        modifier = Modifier.weight(1f),
                                                        style = MaterialTheme.typography.bodyLarge,
                                                        color = if (confirmPreviewText != null) {
                                                            MaterialTheme.colorScheme.onSurface
                                                        } else {
                                                            MaterialTheme.colorScheme.onSurfaceVariant
                                                        },
                                                    )
                                                    Spacer(modifier = Modifier.width(8.dp))
                                                    // 연필 — 문구 수정 모드로 전환.
                                                    IconButton(
                                                        onClick = {
                                                            confirmPreviewEditText = confirmPreviewText.orEmpty()
                                                            confirmPreviewEditing = true
                                                        },
                                                        enabled = confirmPreviewText != null && !confirmPreviewBusy && !confirmPreviewSaving,
                                                        modifier = Modifier.size(36.dp),
                                                    ) {
                                                        Icon(
                                                            imageVector = Icons.Outlined.Edit,
                                                            contentDescription = stringResource(R.string.voices_preview_edit_action),
                                                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                                            modifier = Modifier.size(20.dp),
                                                        )
                                                    }
                                                    // 다시 듣기 — 준비된 문구를 다시 재생(합성 실패 시 재시도 겸용).
                                                    IconButton(
                                                        onClick = { previewRegisteredVoice(previewVoice) },
                                                        enabled = !confirmPreviewBusy && !confirmPreviewSaving,
                                                        modifier = Modifier.size(36.dp),
                                                    ) {
                                                        if (confirmPreviewBusy) {
                                                            CircularProgressIndicator(
                                                                modifier = Modifier.size(18.dp),
                                                                strokeWidth = 2.dp,
                                                            )
                                                        } else {
                                                            Icon(
                                                                imageVector = if (confirmPreviewPlaying) {
                                                                    Icons.Rounded.Stop
                                                                } else {
                                                                    Icons.Rounded.PlayArrow
                                                                },
                                                                contentDescription = stringResource(R.string.voices_confirm_new_preview),
                                                                tint = MaterialTheme.colorScheme.primary,
                                                                modifier = Modifier.size(22.dp),
                                                            )
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    Text(
                                        text = stringResource(R.string.voices_preview_edit_hint),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }

                        if (createPreparing) {
                            VoiceProgressMessage(stringResource(R.string.voices_preparing_audio))
                        }
                        if (localMessage != null) {
                            MutedText(localMessage.orEmpty())
                        }
                        Spacer(modifier = Modifier.height(4.dp))
                    }

                    val canAdvanceFromSource = !voiceProfileBusy && !isRecording && !createPreparing &&
                        (canSubmitRecord || canSubmitSingleFile)
                    // 관계·호칭은 선택 입력 — 이름만 있으면 등록으로 진행할 수 있다.
                    val identityComplete = profileName.trim().isNotBlank()
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(
                                start = 16.dp,
                                top = 10.dp,
                                end = 16.dp,
                                bottom = actionBottomPadding,
                            ),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (currentStep == VoiceRegistrationStep.Details) {
                            OutlinedButton(
                                onClick = {
                                    currentStep = VoiceRegistrationStep.Source
                                    createSubmitAttempted = false
                                    localMessage = null
                                },
                                enabled = !voiceProfileBusy && !createPreparing,
                                modifier = Modifier.weight(1f),
                                shape = WakerButtonShape,
                                border = wakerCardBorder(),
                                colors = wakerOutlinedButtonColors(),
                            ) {
                                Icon(
                                    imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                                    contentDescription = null,
                                    modifier = Modifier.size(18.dp),
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Text(stringResource(R.string.voices_previous))
                            }
                        }
                        when (currentStep) {
                            VoiceRegistrationStep.Source -> {
                                Button(
                                    onClick = {
                                        localMessage = null
                                        currentStep = VoiceRegistrationStep.Details
                                    },
                                    enabled = canAdvanceFromSource,
                                    modifier = Modifier.weight(1f),
                                    shape = WakerButtonShape,
                                ) {
                                    Text(
                                        if (createPreparing) {
                                            stringResource(R.string.voices_preparing)
                                        } else {
                                            stringResource(R.string.voices_next)
                                        },
                                    )
                                }
                            }

                            VoiceRegistrationStep.Details -> {
                                Button(
                                    onClick = {
                                        createSubmitAttempted = true
                                        if (identityComplete) {
                                            localMessage = null
                                            createSubmitAttempted = false
                                            submitCreateProfile(resolvedProfileName)
                                        }
                                    },
                                    enabled = !voiceProfileBusy && !isRecording && !createPreparing &&
                                        (canSubmitRecord || canSubmitSingleFile),
                                    modifier = Modifier.weight(1f),
                                    shape = WakerButtonShape,
                                ) {
                                    Text(
                                        if (createPreparing) {
                                            stringResource(R.string.voices_preparing)
                                        } else {
                                            stringResource(R.string.voices_register)
                                        },
                                    )
                                }
                            }

                            // 만드는 중 — 결정할 것이 없어 하단 액션이 없다(닫기도 불가).
                            VoiceRegistrationStep.Creating -> Unit

                            // 생성/다운로드 중 — '백그라운드에서 계속'은 하단 고정이 아니라
                            // 로딩 블록 바로 아래(본문)에 있다. 하단 액션 없음.
                            VoiceRegistrationStep.Prerendering -> Unit

                            VoiceRegistrationStep.Preview -> {
                                TextButton(
                                    onClick = { confirmNewVoice?.let { onDeleteVoiceDraft(it.id) } },
                                    enabled = !voiceProfileBusy && !confirmPreviewSaving,
                                ) {
                                    Text(
                                        text = stringResource(R.string.voices_confirm_new_delete),
                                        color = MaterialTheme.colorScheme.error,
                                    )
                                }
                                Button(
                                    onClick = {
                                        confirmNewVoice?.let {
                                            promotedForPrerenderId = it.id
                                            onPromoteVoiceDraft(it.id)
                                        }
                                    },
                                    enabled = confirmPreviewCompleted && !voiceProfileBusy &&
                                        !confirmPreviewEditing && !confirmPreviewSaving,
                                    modifier = Modifier.weight(1f),
                                    shape = WakerButtonShape,
                                ) {
                                    // 승격 API 가 나가는 동안(voiceProfileBusy) 버튼에 진행 표시를 남겨
                                    // "눌러도 아무 반응 없다"는 인상을 없앤다. 성공하면 다이얼로그가 닫히고
                                    // 스낵바로 완료를 알린다.
                                    if (voiceProfileBusy) {
                                        CircularProgressIndicator(
                                            modifier = Modifier.size(18.dp),
                                            strokeWidth = 2.dp,
                                            color = MaterialTheme.colorScheme.onPrimary,
                                        )
                                        Spacer(modifier = Modifier.width(8.dp))
                                        Text(stringResource(R.string.voices_confirm_new_keep_saving))
                                    } else {
                                        Text(stringResource(R.string.voices_confirm_new_keep))
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 등록 결정 구간(만드는 중/미리듣기)에서 나가려 할 때 — 나가면 임시 목소리(초안)가 삭제됨을 경고.
    if (draftExitWarningOpen) {
        val exitDraftId = (confirmNewVoice ?: pendingVoiceDraft)?.id
        Dialog(
            onDismissRequest = { draftExitWarningOpen = false },
            properties = DialogProperties(usePlatformDefaultWidth = false),
        ) {
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                shape = WakerDialogShape,
                color = MaterialTheme.colorScheme.surface,
                tonalElevation = 0.dp,
                shadowElevation = 18.dp,
                border = wakerCardBorder(),
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(
                            text = stringResource(R.string.voices_draft_exit_title),
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                        )
                        MutedText(stringResource(R.string.voices_draft_exit_body))
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        TextButton(
                            onClick = {
                                draftExitWarningOpen = false
                                // 명시적 '삭제' 버튼과 동일한 draft 삭제 경로를 태운 뒤 플로우를 닫는다.
                                exitDraftId?.let(onDeleteVoiceDraft)
                                closeCreateDialog()
                            },
                            enabled = !voiceProfileBusy,
                        ) {
                            Text(
                                text = stringResource(R.string.voices_draft_exit_leave),
                                color = MaterialTheme.colorScheme.error,
                            )
                        }
                        Button(
                            onClick = { draftExitWarningOpen = false },
                            modifier = Modifier.weight(1f),
                            shape = WakerButtonShape,
                        ) {
                            Text(stringResource(R.string.voices_draft_exit_stay))
                        }
                    }
                }
            }
        }
    }

    renameTarget?.let { profile ->
        val resolvedRenameName = renameName.trim()
        val renameNameError = renameSubmitAttempted && resolvedRenameName.isBlank()
        VoiceProfileEditDialog(
            title = stringResource(R.string.voices_edit_info_title),
            description = stringResource(R.string.voices_edit_info_desc),
            name = renameName,
            relationship = renameRelationship,
            listenerTitle = renameListenerTitle,
            nameError = renameNameError,
            onNameChange = { renameName = it.take(50) },
            onRelationshipChange = { renameRelationship = it.take(30) },
            onListenerTitleChange = { renameListenerTitle = it.take(30) },
            onDismiss = { renameTarget = null },
            onConfirm = {
                renameSubmitAttempted = true
                // 관계·호칭은 선택 입력 — 이름만 채워지면 저장한다.
                if (resolvedRenameName.isNotBlank()) {
                    onRenameVoiceProfile(
                        profile.id,
                        resolvedRenameName,
                        renameRelationship.trim(),
                        renameListenerTitle.trim(),
                    )
                    renameTarget = null
                }
            },
        )
    }

    deleteTarget?.let { profile ->
        VoiceProfileDeleteDialog(
            profileName = profile.name,
            onDismiss = { deleteTarget = null },
            onDelete = {
                onDeleteVoiceProfile(profile.id)
                deleteTarget = null
            },
        )
    }
}

