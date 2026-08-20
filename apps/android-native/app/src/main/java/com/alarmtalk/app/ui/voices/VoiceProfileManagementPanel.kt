package com.alarmtalk.app

import android.Manifest
import android.content.pm.PackageManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
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
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.KeyboardArrowUp
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.graphics.StrokeCap
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
        context.getString(R.string.voices2_record_min_duration)
    durationMillis > VoiceProfileAudioLimits.MAX_DURATION_MILLIS +
        VoiceProfileAudioLimits.MAX_DURATION_TOLERANCE_MILLIS ->
        context.getString(R.string.voices2_register_under_two_minutes)
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
    var scriptExpanded by rememberSaveable { mutableStateOf(false) }
    OutlinedCard(
        modifier = modifier,
        shape = WakerCardShape,
        border = wakerCardBorder(),
        colors = CardDefaults.outlinedCardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
        ),
    ) {
        Column {
            // **대사는 예시일 뿐 필수가 아니다.** 항상 펼쳐 두면 화면 절반을 차지해
            // '이걸 그대로 읽어야 하는 것' 처럼 보인다. 필요한 사람만 펼치게 접어 둔다.
            //
            // ⚠ **여백을 `clickable` **안쪽**에 둔다.** 예전에는 카드 `Column` 이
            // `padding(16)` 을 갖고 `clickable` 은 그 안의 `Row` 에만 걸려 있어서,
            // **제목 주변 여백을 눌러도 아무 일이 없었다**(2026-08-11 지적).
            // 행처럼 생긴 것은 행 전체가 눌려야 한다 — 글자를 정확히 겨냥하게 만들지 말 것.
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { scriptExpanded = !scriptExpanded }
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = stringResource(R.string.voices_record_script_title),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                )
                Icon(
                    imageVector = if (scriptExpanded) {
                        Icons.Outlined.KeyboardArrowUp
                    } else {
                        Icons.Outlined.KeyboardArrowDown
                    },
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (scriptExpanded) {
            Text(
                text = stringResource(R.string.voices2_record_script),
                modifier = Modifier
                    // 헤더가 제 여백을 가져갔으니 본문도 제 여백을 갖는다.
                    .padding(start = 16.dp, end = 16.dp, bottom = 16.dp)
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
}

@Composable
internal fun VoiceProfileManagementPanel(
    voiceProfiles: List<VoiceProfile>,
    pendingVoiceDraft: VoiceProfile?,
    familyVoices: List<FamilyVoiceProfile>,
    voiceProfileBusy: Boolean,
    subscriptionResponse: BillingSubscriptionResponse?,
    // 이번 달 목소리 생성 횟수 소진 여부 — 삭제 시 '지금 지우면 이번 달엔 다시 못 만든다' 경고 게이트.
    voiceDraftQuotaExhausted: Boolean = false,
    familyGroup: FamilyGroupCurrentResponse?,
    authSession: AuthSession?,
    // 반환값: 클론 생성 요청을 실제로 시작했는지 — false 면 '만드는 중' 스텝에 진입하지 않는다.
    // 마지막 인자는 인라인 동의 체크 여부(아래 sensitiveConsentMissing 참고).
    onCreateVoiceProfile: (String, CachedAlarmAudio, Boolean, String, String, String, Boolean) -> Boolean,
    onCreateVoiceProfiles: (List<VoiceProfileCreationDraft>) -> Unit,
    onGenerateTts: suspend (TtsGenerateRequest) -> TtsGenerateResponse,
    stockClips: List<com.alarmtalk.app.network.StockClip>,
    /** 카테고리별 완전한 세트 크기(서버 제공). 앱에 개수를 박지 않는다. */
    expectedVariants: com.alarmtalk.app.network.ExpectedVariantCounts? = null,
    onDownloadStockAudio: suspend (String) -> com.alarmtalk.app.network.TtsMessageAudioResponse,
    onRenameVoiceProfile: (String, String) -> Unit,
    onShareVoiceProfile: (String, Boolean) -> Unit,
    onDeleteVoiceProfile: (String) -> Unit,
    onConfirmVoicePreviewPlayed: suspend (String, String) -> Unit,
    onUpdateVoicePreviewText: suspend (String, String) -> String,
    onPromoteVoiceDraft: (String, Boolean) -> Unit,
    onDeleteVoiceDraft: (String) -> Unit,
    onOpenBilling: () -> Unit,
    // 이번 달 목소리 생성 쿼터 — 추가 버튼 옆에 '남은/전체'로 보여준다.
    voiceDraftQuota: com.alarmtalk.app.network.VoiceDraftQuotaResponse? = null,
    // 유료 안내 모달의 '쿠폰이 있어요' 입력에 쓴다.
    onRegisterCode: (String) -> Unit = {},
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
    // 아직 없는 민감 동의. 가입 화면에서 음성 생체정보(선택)를 거절한 사람만 비어 있지 않다 —
    // 그 사람에게만 '세부 정보' 단계 아래에 인라인 동의 항목을 그리고, 체크해야 등록이 눌린다.
    // 한 번 동의하면 서버 기록이 남아 이 목록이 비고 다음 등록부터는 보이지 않는다.
    sensitiveConsentMissing: List<String> = emptyList(),
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
    // 인라인 동의 체크. 등록 요청이 나가기 전 단계에서만 의미가 있으므로 다이얼로그를 닫을 때
    // 함께 초기화한다(closeCreateDialog).
    var voiceBiometricAgreed by remember { mutableStateOf(false) }
    var currentStep by remember { mutableStateOf(VoiceRegistrationStep.Source) }
    // 가입 화면에서 음성 생체정보(선택)를 거절한 사람에게만 인라인 동의 항목을 그린다.
    // 한 번 동의하면 서버 기록이 남아 sensitiveConsentMissing 이 비고 다시 뜨지 않는다.
    val needsBiometricConsent = "voice_biometric" in sensitiveConsentMissing
    // 등록(=draft 생성=실제 클론 생성)을 눌러도 되는지 — **법정 동의만** 본다.
    // 권리 보증 확인은 약관 제7조가 담당하므로 체크박스가 아니라 안내 문구다
    // (VoiceRegistrationAttestation 주석 참조).
    val registrationConsentSatisfied = !needsBiometricConsent || voiceBiometricAgreed
    var selectedAudio by remember { mutableStateOf<CachedAlarmAudio?>(null) }
    var localMessage by remember { mutableStateOf<String?>(null) }
    var inputMode by remember { mutableStateOf(VoiceCaptureMode.Record) }
    var isRecording by remember { mutableStateOf(false) }

    // 하한(12초) 미달로 버려진 녹음이 있었는지. 버려지면 selectedAudio 가 null 이라 길이만
    // 봐서는 "아직 녹음 안 함" 과 구분되지 않는데, 이 둘의 안내는 달라야 한다 —
    // 전자는 '12초 이상 녹음해 주세요', 후자는 '다음'(흐림).
    var recordTooShort by remember { mutableStateOf(false) }
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
    var voiceLimitNoticeOpen by remember { mutableStateOf(false) }
    // 섹션 접힘 상태 — 기본은 모두 펼침(접힌 채 시작하면 쓸 수 있는 목소리가 가려진다).
    var ownSectionExpanded by remember { mutableStateOf(true) }
    var sharedSectionExpanded by remember { mutableStateOf(true) }
    var systemSectionExpanded by remember { mutableStateOf(true) }
    var renameTarget by remember { mutableStateOf<VoiceProfile?>(null) }
    var renameName by remember { mutableStateOf("") }
    var renameSubmitAttempted by remember { mutableStateOf(false) }
    var deleteTarget by remember { mutableStateOf<VoiceProfile?>(null) }
    var mediaPlayer by remember { mutableStateOf<MediaPlayer?>(null) }
    var filePreviewPreparing by remember { mutableStateOf(false) }
    var filePreviewPlaying by remember { mutableStateOf(false) }
    // 방금 녹음한 클립의 미리듣기 재생 상태 (녹음 완료 배지의 ▶ 버튼).
    var recordPreviewPlaying by remember { mutableStateOf(false) }
    // 기본 목소리 선택 시트 — 시트 안 탭 = 선택 + 인사말 미리듣기(닫기는 드래그/스크림).
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
    // 등록 확정의 **교체 체크**. 이미 등록된 목소리가 있을 때만 낸다.
    var replaceExistingChecked by remember { mutableStateOf(false) }
    // 시스템 스톡 보이스는 "내 목소리" 수 제한·관리 액션에서 제외한다.
    // 매 리컴포지션마다 재계산하지 않도록 voiceProfiles 가 바뀔 때만 다시 분류한다.
    val systemVoices = remember(voiceProfiles) { voiceProfiles.filter { it.isSystem == true } }
    val canCreateVoice = hasPaidVoiceAccess(subscriptionResponse)
    // 무료 강등 시 클론 데이터는 서버에 보존되지만(30일 유예·재유료 시 복구) UI 에는
    // 노출하지 않는다 — 유료 요금제여야 사용 가능하므로 리스트에서 숨긴다.
    val ownVoices = remember(voiceProfiles, canCreateVoice) {
        if (canCreateVoice) voiceProfiles.filter { it.isSystem != true } else emptyList()
    }
    // 등록 확정에서 교체 대상이 되는 **이미 등록된** 목소리(초안·실패 제외).
    // 있으면 저장이 한도에 걸리므로 교체 체크를 낸다.
    val replaceTargetVoice = remember(ownVoices, confirmNewVoice) {
        ownVoices.firstOrNull {
            it.id != confirmNewVoice?.id && it.isDraft != true &&
                it.status?.trim()?.lowercase() != "failed"
        }
    }
    val isLimitReached = ownVoices.size >= MAX_VOICE_PROFILES || pendingVoiceDraft != null
    // ⚠ **슬롯이 찼다고 폼을 막지 않는다**(2026-08-12 확정).
    // 이미 목소리가 있으면 등록을 끝까지 진행시키고, **마지막 확정 화면**에서
    // "기존 목소리를 교체할까요"(`replaceExistingChecked`)를 묻는다. 예전에는 여기서
    // 막아 그 체크에 도달할 수 없었고, 교체 갈래가 **죽은 코드**였다.
    //
    // 막는 기준은 **월 등록 한도 하나**다(아래 `monthlyExhausted`) — 그건 교체해도 풀리지
    // 않으므로, 녹음을 다 시킨 뒤 거절하지 않도록 입구에서 알린다.
    // 다만 **초안이 이미 떠 있으면**(pendingVoiceDraft) 새로 시작하지 않는다 — 그건 한도가
    // 아니라 '결정을 안 끝낸 등록이 하나 있다' 는 뜻이라 그 결정부터 마쳐야 한다.
    val canOpenCreateForm = canCreateVoice && pendingVoiceDraft == null
    // 생성~결정(만드는 중/미리듣기) 구간 — 이 동안은 다이얼로그를 닫거나 밖으로 나갈 수 없다
    // (유지/삭제를 골라야만 끝난다). draft 가 생겨 isLimitReached 가 돼도 다이얼로그를 유지한다.
    val inDraftDecisionFlow = currentStep == VoiceRegistrationStep.Creating ||
        currentStep == VoiceRegistrationStep.Preview
    // promote 직후 사전렌더 진행 화면 — 등록 완료로 isLimitReached 가 돼도 다이얼로그를 유지해야
    // 진행 UI·'백그라운드에서 계속'이 보인다(닫기는 자유 — 드라이브는 ViewModel 에서 계속된다).
    val inPrerenderingFlow = currentStep == VoiceRegistrationStep.Prerendering
    val canShareVoice = canShareVoiceWithOthers(subscriptionResponse, familyGroup, authSession)
    val paidVoiceRequiredMessage = stringResource(R.string.plan_gate_paid_message)
    val maxProfilesReachedMessage =
        stringResource(R.string.msg_voice_max_profiles_reached, MAX_VOICE_PROFILES)

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
    // 목록에 미리듣기 버튼이 상시 노출되므로 화면에 들어올 때 미리 받아 둔다
    // (예전에는 기본 목소리 시트를 열 때만 받았다).
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

    // stockClips 가 채워지면(세션 첫 로드·재조회) 미리듣기 클립을 받아 둔다.
    LaunchedEffect(stockClips.size, previewLanguage) {
        if (stockClips.isNotEmpty()) prefetchGreetingPreviews()
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
                // 짧은 파일도 배너로 나무라지 않는다 — 못 넘어가는 이유는 '다음' 버튼 자리에서
                // 말한다(녹음과 같은 규칙).
                localMessage = null
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
                    // 짧아서 버려졌으면 그렇다고 말한다. 위에서 오디오와 타이머를 되돌리므로
                    // 아무 말도 안 하면 화면에는 아무 일도 일어나지 않은 것처럼 보인다.
                    // 다만 **하한 미달은 배너로 띄우지 않는다** — 그 말이 필요한 곳은 못 넘어가는
                    // '다음' 버튼 자리다. 화면 위쪽 배너는 버튼에서 멀어 왜 안 눌리는지 이어지지
                    // 않는다. 길이를 못 읽는 등 다른 실패만 배너로 남긴다.
                    if (duration != null && duration < VoiceProfileAudioLimits.MIN_DURATION_MILLIS) {
                        recordTooShort = true
                    } else {
                        localMessage = error
                    }
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
            recordTooShort = false
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
        recordTooShort = false
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
        voiceBiometricAgreed = false
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
    // 다운로드 진행(받은 수 to 전체). 클립을 하나 받을 때마다 갱신해 "n/전체" 로 보여준다 —
    // 21개를 1분 넘게 받는 동안 '다운로드 중' 만 떠 있으면 멈춘 것과 구분되지 않는다.
    var cloneDownloadProgress by remember { mutableStateOf<Map<String, Pair<Int, Int>>>(emptyMap()) }
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
        // 서버가 내려준 값을 쓴다(앱 상수 금지). 클론 프로필이므로 clone 쪽을 본다.
        val fullCount = expectedVariants?.countFor(category = category, isSystemVoice = false)
            ?: return@all false
        if (fullCount <= 0) return@all false
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
        // 전체 개수를 먼저 세어 두고, 받을 때마다 캐시된 수를 올린다.
        val allClips = CloneAlarmBucketCategories.flatMap { category ->
            val clipLanguage = cloneClipLanguageFor(profileId, category)
            stockClips.filter {
                it.voiceProfileId == profileId && it.category == category &&
                    (it.language ?: "ko") == clipLanguage
            }
        }
        val total = allClips.size
        var done = allClips.count { audioStore.getCachedAudio("stock_${it.messageId}") != null }
        if (total > 0) cloneDownloadProgress = cloneDownloadProgress + (profileId to (done to total))
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
                        }.onSuccess {
                            // 한 개 받을 때마다 알린다 — 21개를 1분 넘게 받는 동안 진행이
                            // 안 보이면 사용자는 멈춘 것으로 읽는다.
                            done += 1
                            if (total > 0) {
                                cloneDownloadProgress =
                                    cloneDownloadProgress + (profileId to (done to total))
                            }
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
        // 버튼이 이미 비활성이지만, 파일 경로의 비동기 크롭을 거쳐 다시 들어올 수 있어
        // 여기서도 막는다 — 확인·동의 없이 녹음이 나가는 경로가 하나도 없어야 한다.
        if (!registrationConsentSatisfied) return
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
                voiceBiometricAgreed,
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
                        voiceBiometricAgreed,
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
        // 세 묶음(내 목소리 · 공유받은 목소리 · 기본 목소리)을 접었다 펼 수 있는 섹션으로.
        // 기본값은 모두 펼침 — 접힌 채로 시작하면 무료 사용자가 쓸 수 있는 기본 목소리가
        // 다시 가려지는데, 이 화면을 고친 이유가 그거였다.
        VoiceCatalogSectionHeader(
            title = stringResource(R.string.voices_my_voices_title),
            expanded = ownSectionExpanded,
            onToggle = { ownSectionExpanded = !ownSectionExpanded },
        ) {
            // 이번 달 남은 생성 횟수 — 버튼을 누르기 전에 몇 번 남았는지 먼저 보인다.
            // 유료 사용자에게만 의미가 있다(무료는 눌렀을 때 이용권 안내로 간다).
            // 유료만 숫자를 본다. 무료에게 '이번 달 0/1'은 마치 이용권만 있으면 이미 다 쓴
            // 것처럼 읽혀 거짓말이 된다 — 무료는 숫자 없이 버튼만 두고 눌렀을 때 안내한다.
            val monthlyQuota = voiceDraftQuota?.takeIf { canCreateVoice && it.registrationLimit > 0 }
            monthlyQuota?.let { quota ->
                MutedText(
                    stringResource(
                        R.string.voices_monthly_quota,
                        quota.registrationRemaining.coerceAtLeast(0),
                        quota.registrationLimit,
                    ),
                )
                Spacer(modifier = Modifier.width(10.dp))
            }
            // 유료인데 이번 달을 다 썼으면 버튼을 끈다 — 바로 옆에 '이번 달 0/1'이 있어
            // 왜 흐린지가 그 자리에서 읽힌다. 무료는 숫자가 없으니 끄지 않고(왜 흐린지 알 길이
            // 없다) 항상 눌리게 두어 이용권 안내 모달로 보낸다.
            val monthlyExhausted = monthlyQuota != null && monthlyQuota.registrationRemaining <= 0
            Button(
                onClick = {
                    when {
                        !canCreateVoice -> voicePlanGateOpen = true
                        canOpenCreateForm -> showCreateForm = true
                        else -> voiceLimitNoticeOpen = true
                    }
                },
                enabled = !voiceProfileBusy && !monthlyExhausted,
                colors = wakerButtonColors(),
            ) {
                Text(stringResource(R.string.voices_add))
            }
        }

        if (localMessage != null && !showCreateForm && localMessage != paidVoiceRequiredMessage) {
            MutedText(localMessage.orEmpty())
        }

        if (ownSectionExpanded) {
            VoiceCatalogGroup(
                ownVoices.map { profile ->
                    {
                        // 준비 상태 표시: 서버 사전렌더 중 "준비 중 n/21" → 서버 완료 후 로컬
                        // 다운로드 중 "다운로드 중" → 둘 다 완료면 표시 없음.
                        val prerenderStatus = prerenderStatuses[profile.id]
                        val readiness = when {
                            profile.id in cloneLocalReadyIds -> null
                            prerenderStatus == null -> null
                            prerenderStatus.status == "failed" -> CloneVoiceReadiness.Failed
                            // **진행 중인 상태에서만** 진행률을 만든다. 서버는 `none`(큐 행이
                            // 아직 없거나 지워짐)도 돌려주는데, 폴링 루프는 그걸 pending 으로
                            // 치지 않아 곧바로 멈춘다 — catch-all 로 받으면 "준비 중 0%" 가
                            // 영영 남는다(Codex #673 P2). 모르는 값은 표시하지 않는다.
                            prerenderStatus.status != "pending" && prerenderStatus.status != "done" -> null
                            // 아직 전체 개수를 모르는 pending 은 표시할 게 없다.
                            prerenderStatus.status == "pending" && prerenderStatus.total <= 0 -> null
                            else -> {
                                // 생성과 다운로드를 **하나의 진행률**로 잇는다(0~50 생성,
                                // 50~100 다운로드). 단계마다 n/21 을 따로 세면 생성이 끝나는
                                // 순간 100% 에서 0% 로 되돌아가 후퇴한 것처럼 보인다.
                                val serverDone = prerenderStatus.status == "done"
                                val total = prerenderStatus.total
                                val generatedPart = when {
                                    serverDone -> 50
                                    total > 0 ->
                                        (prerenderStatus.generated.coerceIn(0, total) * 50) / total
                                    else -> 0
                                }
                                val (downloaded, downloadTotal) =
                                    cloneDownloadProgress[profile.id] ?: (0 to 0)
                                val downloadPart = if (serverDone && downloadTotal > 0) {
                                    (downloaded.coerceIn(0, downloadTotal) * 50) / downloadTotal
                                } else {
                                    0
                                }
                                CloneVoiceReadiness.Progress(
                                    (generatedPart + downloadPart).coerceIn(0, 100),
                                )
                            }
                        }
                        VoiceProfileRow(
                            profile = profile,
                            enabled = !voiceProfileBusy,
                            canShareVoice = canShareVoice,
                            isPlaying = playingGreetingVoiceId == profile.id,
                            onPreview = { playGreeting(profile) },
                            onRename = {
                                renameTarget = profile
                                renameName = profile.name
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
                },
            )
        }

        if (canShareVoice && familyVoices.isNotEmpty()) {
            VoiceCatalogSectionHeader(
                title = stringResource(R.string.voices_shared_voices_title),
                expanded = sharedSectionExpanded,
                onToggle = { sharedSectionExpanded = !sharedSectionExpanded },
            )
            if (sharedSectionExpanded) {
                VoiceCatalogGroup(
                    familyVoices.map { profile ->
                        {
                            SharedVoiceProfileRow(
                                profile = profile,
                                isPlaying = playingGreetingVoiceId == profile.id,
                                onPlay = { playSharedGreeting(profile) },
                            )
                        }
                    },
                )
            }
        }

        // 기본 제공 목소리는 맨 아래 — 개인화된 목소리(내 것·공유받은 것)가 먼저 온다.
        // 내 목소리·공유받은 목소리가 하나도 없어도 이 섹션은 항상 나온다.
        if (systemVoices.isNotEmpty()) {
            VoiceCatalogSectionHeader(
                title = stringResource(R.string.voices_system_voices_title),
                expanded = systemSectionExpanded,
                onToggle = { systemSectionExpanded = !systemSectionExpanded },
            )
            if (systemSectionExpanded) {
                VoiceCatalogGroup(
                    systemVoices.map { profile ->
                        {
                            // 부가설명은 두지 않는다 — 섹션 이름이 이미 '기본 목소리'라고 말한다.
                            VoiceCatalogRow(
                                name = profile.name,
                                subtitle = null,
                                isPlaying = playingGreetingVoiceId == profile.id,
                                onPreview = { playGreeting(profile) },
                            )
                        }
                    },
                )
            }
        }
        // 기본 목소리 클립 프리페치 진행 — 완료/실패 시 자동으로 사라진다(실패해도 편집기
        // 온디맨드 다운로드가 폴백하므로 별도 안내는 하지 않는다).
        //
        // 온보딩의 '백그라운드에서 계속 받기' 로 화면을 닫아도 워커는 계속 도는데, 그때
        // 진행을 볼 곳이 여기뿐이다. 클론 목소리와 **같은 퍼센트 문구**를 쓴다 — 사용자에겐
        // 둘 다 "알람 음성이 준비되는 중" 한 가지다.
        voicePrefetchProgress
            ?.takeIf { (done, total) -> total > 0 && done < total }
            ?.let { (done, total) ->
                VoiceProgressMessage(
                    stringResource(
                        R.string.voicesr_prerender_progress,
                        (done.coerceIn(0, total) * 100) / total,
                    ),
                )
            }
    }

    if (voiceLimitNoticeOpen) {
        IosAlertDialog(
            title = stringResource(R.string.voices_limit_title),
            message = stringResource(R.string.voices_limit_message),
            actions = listOf(
                IosAlertAction(
                    label = stringResource(R.string.r3dlg_modal_dialog_close),
                    onClick = { voiceLimitNoticeOpen = false },
                ),
            ),
            onDismiss = { voiceLimitNoticeOpen = false },
        )
    }

    if (voicePlanGateOpen) {
        PlanGateDialog(
            title = stringResource(R.string.voices_create_paid_title),
            message = stringResource(R.string.plan_gate_paid_message),
            onConfirm = {
                voicePlanGateOpen = false
                onOpenBilling()
            },
            onDismiss = { voicePlanGateOpen = false },
            onRedeemCode = onRegisterCode,
            redeemBusy = voiceProfileBusy,
        )
    }

    // 시스템 보이스 목록이 비면(세션 초기화·재로딩) 재생 중이던 미리듣기를 멈춘다.
    LaunchedEffect(systemVoices.isEmpty()) {
        if (systemVoices.isEmpty()) stopMediaPreview()
    }

    // 만드는 중/미리듣기/사전렌더 스텝에선 draft·등록 완료로 상태가 바뀌어도 다이얼로그를 유지한다.
    //
    // ⚠ **여는 조건과 그리는 조건은 반드시 같은 값이어야 한다.**
    // 2026-08-12 에 버튼 쪽(`canOpenCreateForm`)만 열어 두고 여기는 옛 `!isLimitReached` 를
    // 그대로 두어서, 목소리가 이미 하나 있으면 **버튼을 눌러도 아무 일도 일어나지 않았다** —
    // `showCreateForm` 은 true 가 되는데 그릴 조건이 false 라 화면이 그대로였다.
    // 눌러도 아무 반응이 없는 것이 가장 나쁜 형태다(막혔다는 것조차 알 수 없다).
    if (showCreateForm && (inDraftDecisionFlow || inPrerenderingFlow || canOpenCreateForm)) {
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
        // 하한(12초) 미만이면 "다음" 으로 넘어가지 못하게 막는다. 녹음은 selectedAudio 길이,
        // 파일은 실제 업로드되는 crop 구간 길이로 판정한다. 짝이 되는 서버 게이트는 이 화면이
        // 부르는 POST /voice/clone 의 **MIN_CLONE_DURATION_MS**(voice-profile.ts, 12초)다.
        // voice-upload.ts 의 MIN_UPLOAD_DURATION_MS(60초)와 헷갈리지 말 것 — 그쪽은 가족 알람
        // 음성 메시지를 올리는 POST /voice/upload 전용이고 값도 다르다.
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
                        // ⚠ **사전 생성 단계에는 X 를 두지 않는다**(2026-08-20).
                        // 그 단계는 아래에 '백그라운드에서 계속' 버튼이 있고, X 도 같은
                        // `closeCreateDialog()` 를 부른다 — 같은 일을 하는 컨트롤이 둘이면
                        // 어느 쪽이 취소인지 매번 읽어야 한다(CLAUDE.md 「모달」: 닫기(X)를
                        // 버튼과 같이 두지 말 것). 무엇을 하는지 말해 주는 쪽을 남긴다.
                        if (!inPrerenderingFlow) {
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
                                            recordTooShort = false
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
                                        // ⚠ **`idleStatusText = ""` 로 비우지 말 것**(2026-08-18 되돌림).
                                        // 빈 문자열은 `?:` 를 통과해 **빈 `Text` 가 한 줄을 차지**하므로,
                                        // 카드에 이유 없는 빈 칸이 남는다("녹음하기 글자가 안 보인다"로
                                        // 보고됨). 기본값 "녹음하기" 를 그대로 쓴다 — 알람 편집기의
                                        // 직접 녹음도 같은 컴포넌트를 기본값으로 쓰고 문제가 없다.
                                        // (두 줄로 접힌다던 옛 근거는 실기기에서 재현되지 않는다.)
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
                                    // 곁에 없는 사람의 목소리를 등록하려는 경우가 흔하다.
                                    // 업로드할 파일이 없어도 방법이 있다는 걸 알려 준다.
                                    // 두 안내를 마침표마다 줄을 나눠 둔다 — 한 문단으로 붙이면
                                    // 서로 다른 이야기가 한 덩어리로 읽힌다.
                                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                        MutedText(stringResource(R.string.voices_record_status_hint))
                                        MutedText(stringResource(R.string.voices_record_video_tip))
                                    }
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
                                            // ⚠ **길이 조건을 여기서 말하지 않는다**(2026-08-18 지시).
                                            // 고른 파일은 길이로 막지 않는다 — `prepareSelectedFile` 이
                                            // `cropEnd` 를 2분으로 잡아 **자르기 화면**으로 넘긴다(3분짜리
                                            // 영상도 된다). "12초 이상 2분 이하 파일이면 돼요" 는 **없는
                                            // 제약을 광고**하는 문구라, 쓸 수 있는 파일을 안 쓰게 만든다.
                                            // 실제 조건은 **잘라낸 구간**에만 있고, 그건 자르기 화면이
                                            // `voices_crop_duration_notice` 로 그 자리에서 말한다.
                                            uploadSubtitle = null,
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
                                    onValueChange = { profileName = sanitizeDisplayName(it, maxLength = VoiceNameMaxLength) },
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
                                    onValueChange = { profileListenerTitle = sanitizeDisplayName(it, maxLength = DisplayNameMaxLength) },
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
                                // 등록 직전 확인 — 이 단계에 두는 이유는 다음 버튼('등록')이
                                // draft 를 만들고, draft 생성이 곧 실제 ElevenLabs 클론 생성이기
                                // 때문이다. 마지막 '저장하기'(승격) 앞에 두면 이미 목소리를
                                // 만들어 놓고 사후 동의를 받는 꼴이 된다.
                                VoiceRegistrationAttestation(
                                    // 가입 화면에서 이미 동의했으면 그리지 않는다 — 한 번 받은
                                    // 동의를 등록할 때마다 다시 묻지 않는다.
                                    showBiometricConsent = needsBiometricConsent,
                                    biometricAgreed = voiceBiometricAgreed,
                                    onBiometricAgreedChange = { voiceBiometricAgreed = it },
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
                                // 생성(서버)→다운로드(기기 저장)를 한 화면·한 진행률로 합친다.
                                // 문구도 하나로 통일하고, 나가기=백그라운드는 부제로 안내한다(전용 버튼 없앰
                                // — 이 스텝은 voiceProfileBusy=false 라 X/뒤로가기로 닫으면 드라이브는
                                // viewModelScope 에서 그대로 계속된다).
                                val drive = prerenderDrive
                                // 생성 0~50%, 다운로드 50~100% 로 이어붙여 매끄러운 하나의 진행률.
                                val target = if (drive != null && drive.total > 0) {
                                    val frac = (drive.generated.toFloat() / drive.total.toFloat())
                                        .coerceIn(0f, 1f)
                                    if (drive.downloading) 0.5f + frac * 0.5f else frac * 0.5f
                                } else {
                                    null
                                }
                                val animatedProgress by animateFloatAsState(
                                    targetValue = target ?: 0f,
                                    animationSpec = tween(durationMillis = 550, easing = FastOutSlowInEasing),
                                    label = "prerenderProgress",
                                )
                                Column(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(vertical = 72.dp, horizontal = 24.dp),
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                    verticalArrangement = Arrangement.spacedBy(12.dp),
                                ) {
                                    Text(
                                        text = stringResource(R.string.voices_prerender_ready_title),
                                        style = MaterialTheme.typography.titleMedium,
                                        fontWeight = FontWeight.SemiBold,
                                    )
                                    Text(
                                        text = stringResource(R.string.voices_prerender_ready_body),
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        textAlign = TextAlign.Center,
                                    )
                                    Spacer(Modifier.height(6.dp))
                                    if (target != null) {
                                        LinearProgressIndicator(
                                            progress = { animatedProgress },
                                            modifier = Modifier
                                                .fillMaxWidth(0.78f)
                                                .height(8.dp),
                                            strokeCap = StrokeCap.Round,
                                            trackColor = MaterialTheme.colorScheme.surfaceVariant,
                                            gapSize = 0.dp,
                                            drawStopIndicator = {},
                                        )
                                    } else {
                                        // 시작 직후(총량 미상): 흐르는 인디터미넌트 바.
                                        LinearProgressIndicator(
                                            modifier = Modifier
                                                .fillMaxWidth(0.78f)
                                                .height(8.dp),
                                            strokeCap = StrokeCap.Round,
                                            trackColor = MaterialTheme.colorScheme.surfaceVariant,
                                        )
                                    }
                                    // ⚠ **나가는 길을 X 에만 맡기지 말 것**(2026-08-20 지시).
                                    // 예전에는 전용 버튼 없이 부제로만 "지금 닫아도 계속
                                    // 만들어져요" 라고 안내했다. 그런데 이 대기는 서버 cron
                                    // 배치라 십수 분이 걸리는데, 화면에는 누를 것이 오른쪽 위
                                    // X 뿐이라 "닫으면 취소되는 것 아닌가" 로 읽힌다.
                                    // 최초 기본 목소리 다운로드 화면과 **같은 낱말·같은 자리**로
                                    // 맞춘다(`onb_voice_download_background`) — 두 화면이 하는
                                    // 일이 같으니 말도 같아야 한다.
                                    Spacer(Modifier.height(6.dp))
                                    TextButton(onClick = { closeCreateDialog() }) {
                                        Text(
                                            text = stringResource(R.string.onb_voice_download_background),
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }
                            }

                            VoiceRegistrationStep.Preview -> {
                                val previewVoice = confirmNewVoice
                                if (previewVoice != null) {
                                    Text(
                                        text = stringResource(R.string.voices_confirm_new_title),
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
                                                    onValueChange = {
                                        confirmPreviewEditText =
                                            sanitizeUserText(it, allowNewlines = true)
                                                .takeWithoutSplittingPairs(200)
                                    },
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
                                                        colors = wakerButtonColors(),
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

                                    // ⚠ **공유 설정은 여기(확정 단계)에 둔다**(2026-08-13 지시).
                                    // 앞 단계에서 물으면 아직 **초안**일 뿐인 것에 공유 여부를
                                    // 정하게 된다 — '다시 만들기' 로 버리면 그 답도 함께 사라진다.
                                    // 실제 등록은 이 화면의 '저장하기' 이므로, 남과 나눠 쓸지도
                                    // 여기서 정하는 것이 맞다.
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

                                    // 교체 안내 + 체크. **이미 등록된 목소리가 있을 때만** 낸다 —
                                    // 없으면 그냥 저장되므로 체크를 보여 줄 이유가 없다.
                                    //
                                    // ⚠ 문구가 곧 계약이다. 체크하면 실제로 이 두 가지가 일어난다:
                                    //  - 이전 목소리는 목록에서 사라진다(서버는 그 행을 지우지 않고
                                    //    **재사용**한다 — 지우면 그 목소리를 쓰던 알람이 전부 기본
                                    //    알람음으로 떨어진다).
                                    //  - 직접 입력 문구로 만든 알람만 기본 알람음이 된다. 나머지
                                    //    알람은 그대로 살아 새 목소리로 운다.
                                    replaceTargetVoice?.let { targetVoice ->
                                        OutlinedCard(
                                            onClick = { replaceExistingChecked = !replaceExistingChecked },
                                            enabled = !voiceProfileBusy && !confirmPreviewSaving,
                                            shape = WakerPanelShape,
                                            border = wakerCardBorder(),
                                        ) {
                                            Row(
                                                modifier = Modifier
                                                    .fillMaxWidth()
                                                    .padding(14.dp),
                                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                                            ) {
                                                AlarmTalkCheckbox(
                                                    checked = replaceExistingChecked,
                                                    onCheckedChange = { checked -> replaceExistingChecked = checked },
                                                    enabled = !voiceProfileBusy && !confirmPreviewSaving,
                                                )
                                                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                                    Text(
                                                        text = stringResource(
                                                            R.string.voices_replace_existing_title,
                                                            targetVoice.name,
                                                        ),
                                                        style = MaterialTheme.typography.bodyMedium,
                                                        fontWeight = FontWeight.SemiBold,
                                                    )
                                                    Text(
                                                        text = stringResource(R.string.voices_replace_existing_desc),
                                                        style = MaterialTheme.typography.bodySmall,
                                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                                    )
                                                }
                                            }
                                        }
                                    }
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
                                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
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
                                    colors = wakerButtonColors(),
                                    modifier = Modifier.weight(1f),
                                    shape = WakerButtonShape,
                                ) {
                                    // 못 넘어가는 이유를 **버튼 자리에서** 말한다. 예전에는
                                    // '다음' 이 흐린 채로만 있어, 왜 안 눌리는지 알 수 없었다.
                                    // 녹음은 하한 미달이면 클립을 버리므로(selectedAudio = null)
                                    // 길이가 아니라 recordTooShort 로 판정한다.
                                    val blocked = !canAdvanceFromSource && !createPreparing
                                    val tooShortRes = when {
                                        !blocked -> null
                                        inputMode == VoiceCaptureMode.Record && recordTooShort ->
                                            R.string.voices_record_too_short
                                        inputMode == VoiceCaptureMode.File && selectedFileUri != null ->
                                            R.string.voices2_select_file_min_duration
                                        else -> null
                                    }
                                    Text(
                                        when {
                                            createPreparing -> stringResource(R.string.voices_preparing)
                                            tooShortRes != null -> stringResource(tooShortRes)
                                            else -> stringResource(R.string.voices_next)
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
                                    // 확인·동의를 체크해야 등록이 눌린다. 서버도 같은 지점에서
                                    // 403 으로 막지만, 요청을 보내 튕기기 전에 무엇에 동의하는지
                                    // 부터 보여준다.
                                    enabled = !voiceProfileBusy && !isRecording && !createPreparing &&
                                        (canSubmitRecord || canSubmitSingleFile) &&
                                        registrationConsentSatisfied,
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
                                    // 지우는 동안은 **이 버튼**이 진행을 말한다 — 옆의 저장 버튼이
                                    // 아니라(위 주석 참조).
                                    if (voiceProfileBusy && promotedForPrerenderId == null) {
                                        CircularProgressIndicator(
                                            modifier = Modifier.size(18.dp),
                                            strokeWidth = 2.dp,
                                            color = MaterialTheme.colorScheme.error,
                                        )
                                    } else {
                                        Text(
                                            text = stringResource(R.string.voices_confirm_new_delete),
                                            color = MaterialTheme.colorScheme.error,
                                        )
                                    }
                                }
                                Button(
                                    onClick = {
                                        confirmNewVoice?.let {
                                            promotedForPrerenderId = it.id
                                            onPromoteVoiceDraft(it.id, replaceExistingChecked)
                                        }
                                    },
                                    // ⚠ 이미 등록된 목소리가 있으면 **교체에 동의해야** 저장이 열린다.
                                    // 서버가 어차피 VOICE_LIMIT_REACHED 로 막으므로, 열어 두면 눌러도
                                    // 실패하는 버튼이 된다 — 무엇을 해야 저장되는지도 알 수 없다.
                                    enabled = confirmPreviewCompleted && !voiceProfileBusy &&
                                        !confirmPreviewEditing && !confirmPreviewSaving &&
                                        (replaceTargetVoice == null || replaceExistingChecked),
                                    modifier = Modifier.weight(1f),
                                    shape = WakerButtonShape,
                                ) {
                                    // 승격 API 가 나가는 동안 버튼에 진행 표시를 남겨 "눌러도 아무
                                    // 반응 없다"는 인상을 없앤다. 성공하면 다이얼로그가 닫히고
                                    // 스낵바로 완료를 알린다.
                                    //
                                    // ⚠ **`voiceProfileBusy` 하나만 보지 말 것.** 그 플래그는 초안을
                                    // **지울 때도** 켜진다 — 그래서 '다시 만들기' 를 눌렀는데 옆
                                    // 버튼이 '저장 중…' 이라고 말했다(2026-08-13 지적 "저장한 거야?").
                                    // 지우는 중인데 저장한다고 하면 되돌릴 수 없는 일을 한 줄 안다.
                                    // 승격이 실제로 나갔을 때만(`promotedForPrerenderId`) 표시한다.
                                    if (voiceProfileBusy && promotedForPrerenderId != null) {
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
        // 확인형 모달은 전부 공용 알럿으로. 나가면 초안이 지워지므로 '나가기' 는 destructive,
        // 머무르기가 기본(강조)이다 — 되돌릴 수 없는 쪽이 기본이 되면 안 된다.
        IosAlertDialog(
            title = stringResource(R.string.voices_draft_exit_title),
            message = stringResource(R.string.voices_draft_exit_body),
            onDismiss = { draftExitWarningOpen = false },
            actions = listOf(
                IosAlertAction(
                    label = stringResource(R.string.voices_draft_exit_leave),
                    destructive = true,
                    enabled = !voiceProfileBusy,
                    onClick = {
                        draftExitWarningOpen = false
                        // 명시적 '삭제' 버튼과 동일한 draft 삭제 경로를 태운 뒤 플로우를 닫는다.
                        exitDraftId?.let(onDeleteVoiceDraft)
                        closeCreateDialog()
                    },
                ),
                IosAlertAction(
                    label = stringResource(R.string.voices_draft_exit_stay),
                    emphasized = true,
                    onClick = { draftExitWarningOpen = false },
                ),
            ),
        )
    }

    renameTarget?.let { profile ->
        val resolvedRenameName = renameName.trim()
        val renameNameError = renameSubmitAttempted && resolvedRenameName.isBlank()
        VoiceProfileEditDialog(
            title = stringResource(R.string.voices_edit_name_title),
            description = stringResource(R.string.voices_edit_name_desc),
            name = renameName,
            nameError = renameNameError,
            onNameChange = { renameName = sanitizeDisplayName(it, maxLength = VoiceNameMaxLength) },
            onDismiss = { renameTarget = null },
            onConfirm = {
                renameSubmitAttempted = true
                if (resolvedRenameName.isNotBlank()) {
                    onRenameVoiceProfile(profile.id, resolvedRenameName)
                    renameTarget = null
                }
            },
        )
    }

    deleteTarget?.let { profile ->
        if (voiceDraftQuotaExhausted) {
            // 이번 달 생성 횟수를 다 썼으면 iOS 스타일 경고 모달 — 지워도 이번 달엔 다시 못 만든다는
            // 안내. 그래도 본인 목소리이므로 삭제 자체는 허용한다(경고형).
            IosAlertDialog(
                title = stringResource(R.string.voices_delete_quota_title),
                message = stringResource(R.string.voices_delete_quota_message),
                actions = listOf(
                    IosAlertAction(
                        label = stringResource(R.string.editor_cancel),
                        onClick = { deleteTarget = null },
                    ),
                    IosAlertAction(
                        label = stringResource(R.string.voicesr_delete),
                        destructive = true,
                        onClick = {
                            onDeleteVoiceProfile(profile.id)
                            deleteTarget = null
                        },
                    ),
                ),
                onDismiss = { deleteTarget = null },
            )
        } else {
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
}

