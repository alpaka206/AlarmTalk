package com.alarmtalk.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import com.alarmtalk.app.data.systemVoiceDisplayName
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.VoiceSources
import com.alarmtalk.app.data.wasVoiceAlarmConvertedBySystem
import com.alarmtalk.app.data.VoiceProfileCreationDraft
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.TtsGenerateRequest
import com.alarmtalk.app.network.TtsGenerateResponse
import com.alarmtalk.app.network.VoiceProfile

// 홈 그라데이션(로그인 딥 네이비 감성)의 단일 출처는 WakerDesign.kt 의
// HomeGradientDark/Light·homeGradientBrush() — 모든 탭과 설정/약관 동의 등
// 하위 전체화면이 같은 브러시를 써서 화면 전환 시 배경 톤이 튀지 않는다.

@Composable
internal fun AlarmListScreen(
    contentPadding: PaddingValues,
    selectedTab: NativeTab,
    onSelectTab: (NativeTab) -> Unit,
    /**
     * 하위 화면(이용권)의 뒤로가기.
     *
     * ⚠ **`onSelectTab(Menu)` 로 되돌리지 말 것 — 뒤로가기는 '이동' 이 아니라 '팝' 이다.**
     * 탭 이동은 `popUpTo(알람) { saveState }` + `restoreState` 를 쓰는데, 이 조합은 팝한
     * 스택을 **통째로 저장했다가 통째로 복원**한다. 그래서 이용권에서 뒤로가기를 누르면
     * [알람, 더보기, 이용권] 을 저장했다가 그대로 되살려 **다시 이용권에 서 있었다**
     * (2026-08-11 실기기 확인 — 눌러도 아무 일이 없었다). 설정·라이선스 등 나머지
     * 하위 화면은 처음부터 `popBackStackOrHome()` 을 쓰고 있었다 — 같게 맞춘다.
     */
    onNavigateBack: () -> Unit,
    alarms: List<AlarmEntity>,
    // Room 첫 방출 여부 — false 인 동안 알람 탭은 빈 상태를 그리지 않는다(콜드 스타트 번쩍임 방지).
    alarmsLoaded: Boolean,
    authSession: AuthSession?,
    voiceProfiles: List<VoiceProfile>,
    pendingVoiceDraft: VoiceProfile?,
    voiceProfileBusy: Boolean,
    billingBusy: Boolean,
    subscriptionResponse: BillingSubscriptionResponse?,
    /** 스토어가 **지금** 유효하다고 확인해 준 상태인가(기한까지 반영된 값). */
    storeEntitledNow: Boolean,
    /**
     * 이용권 화면에 보일 프로모(`MainViewModel.planScreenPersonalPromo`) — 계정 응답과 구독 응답 중
     * **나중에 받은 답**의 것. 여기서 세션·구독 응답을 OR 로 다시 고르지 말 것. 개인 카드에 앉을지
     * 카드 위 한 줄일지는 이용권 화면이 정한다(`planScreenCurrentOf`).
     */
    planScreenPersonalPromo: com.alarmtalk.app.network.PersonalPromo?,
    voiceDraftQuotaExhausted: Boolean = false,
    // 이번 달 목소리 생성 쿼터(추가 버튼 옆 '남은/전체' 표시).
    voiceDraftQuota: com.alarmtalk.app.network.VoiceDraftQuotaResponse? = null,
    onCreateVoiceProfile: (VoiceProfileCreationDraft, Boolean) -> Boolean,
    // 목소리 등록 화면의 인라인 동의 항목에 그대로 넘긴다.
    sensitiveConsentMissing: List<String> = emptyList(),
    onGenerateTts: suspend (TtsGenerateRequest) -> TtsGenerateResponse,
    stockClips: List<com.alarmtalk.app.network.StockClip>,
    /** 카테고리별 완전한 세트 크기(서버 제공). 앱에 개수를 박지 않는다. */
    expectedVariants: com.alarmtalk.app.network.ExpectedVariantCounts? = null,
    // 알람에 마지막으로 쓴 목소리 — 편집기의 초기 선택에 쓴다.
    lastUsedVoiceId: String? = null,
    // 기본 목소리 무료 버킷 프리페치 진행(다운로드 n to 전체). null = 진행 중 아님.
    voicePrefetchProgress: Pair<Int, Int>? = null,
    // 유료 클론 사전렌더 준비 상태 조회/재시도 + 매니페스트 강제 재조회(목소리 탭 준비 표시용).
    onGetVoicePrerenderStatus: suspend (String) -> com.alarmtalk.app.network.VoicePrerenderStatusResponse =
        { com.alarmtalk.app.network.VoicePrerenderStatusResponse() },
    onRetryVoicePrerender: suspend (String) -> Boolean = { false },
    onRetryVoiceSpeechStyle: suspend (String) -> Boolean = { false },
    onReloadStockClips: () -> Unit = {},
    // 목소리 하나의 클립 캐시 — 목소리마다 한 벌만 돈다(드라이브와 나눠 쓴다).
    onCacheVoiceClips: suspend (String, List<com.alarmtalk.app.network.StockClip>, (Int, Int) -> Unit) -> Boolean =
        { _, _, _ -> false },
    // promote 직후 사전렌더 드라이브(ViewModel 스코프) 진행/시작.
    prerenderDrive: PrerenderDriveState? = null,
    onStartPrerenderDrive: (String) -> Unit = {},
    onDownloadStockAudio: suspend (String) -> com.alarmtalk.app.network.TtsMessageAudioResponse,
    onRenameVoiceProfile: (String, String) -> Unit,
    onDeleteVoiceProfile: (String) -> Unit,
    onConfirmVoicePreviewPlayed: suspend (String, String) -> Unit,
    onUpdateVoicePreviewText: suspend (String, String) -> String,
    onPromoteVoiceDraft: (String, Boolean, Float) -> Unit,
    onDeleteVoiceDraft: (String) -> Unit,
    // 월 한도로 등록 흐름을 끝내며 초안을 조용히 버린다(실패를 화면에 말하지 않는다) — 목소리 패널에 그대로 넘긴다.
    onDiscardVoiceDraftQuietly: (String) -> Unit,
    // 등록 흐름의 거절을 등록 창 안에 그리기 위한 세 가지 — 목소리 패널에 그대로 넘긴다
    // (`VoiceProfileManagementPanel` 의 같은 이름 인자 참고).
    voiceRegistrationFailure: VoiceRegistrationFailure? = null,
    onVoiceRegistrationFailureShown: () -> Unit = {},
    onRegistrationWindowOpenChange: (Boolean) -> Unit = {},
    planPrices: Map<String, String>,
    /** 플랜 key → 지금 받을 수 있는 무료 체험 기간(ISO 8601). 없으면 빈 표. */
    planTrials: Map<String, String> = emptyMap(),
    onPurchasePlay: (android.app.Activity, String) -> Unit,
    onCancelSubscription: (Boolean) -> Unit,
    onRestorePurchases: () -> Unit,
    permissions: PermissionSnapshot,
    onCreateAlarm: () -> Unit,
    /** 목소리 탭의 '이 목소리로 새 알람 만들기' — 그 목소리를 처음 고른 새 알람 편집기를 연다. */
    onCreateAlarmWithVoice: (String) -> Unit = {},
    onOpenSettings: () -> Unit,
    onDeleteAccount: () -> Unit,
    themeMode: ThemeMode,
    onChangeTheme: (ThemeMode) -> Unit,
    onToggleEnabled: (String, Boolean) -> Unit,
    onEditAlarm: (AlarmEntity) -> Unit,
    onDeleteAlarm: (String) -> Unit,
    /** 배너에서 곧장 그 권한 요청/설정으로 보낸다(모달을 거치지 않는다). */
    onRequestAlarmPermission: (PermissionTarget) -> Unit = {},
    // 선택 모드 진입/이탈을 알린다 — 상위 Scaffold 가 ＋ FAB 를 감추는 데 쓴다.
    onAlarmSelectionModeChange: (Boolean) -> Unit = {},
) {
    val sortedAlarms = remember(alarms) {
        alarms.sortedWith(
            compareBy<AlarmEntity> { it.hour }
                .thenBy { it.minute }
                .thenBy { it.createdAtMillis },
        )
    }
    val nextAlarm = remember(alarms) {
        alarms.filter { it.enabled }.minByOrNull { it.fireAtMillis }
    }
    val hasAnyAlarm = sortedAlarms.isNotEmpty()

    val context = LocalContext.current
    val listState = rememberLazyListState()
    // 결제 화면을 열었다(`paywall_viewed`, `docs/spec/usage-events.md` §7.1) — 이 탭에 들어온 순간 한 번.
    LaunchedEffect(selectedTab) {
        if (selectedTab == NativeTab.Billing) {
            com.alarmtalk.app.data.UsageSignals.record(
                context,
                com.alarmtalk.app.data.UsageEvents.PAYWALL_VIEWED,
                props = com.alarmtalk.app.data.UsageEventProps(surface = "billing"),
            )
        }
    }

    val homeGradient = homeGradientBrush()
    // 다중 선택 삭제 — 롱프레스로 들어가고, 하나도 안 남으면 자동으로 빠져나온다.
    var selectedAlarmIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    val selectionMode = selectedAlarmIds.isNotEmpty()
    // 목록에서 사라진 알람(삭제·동기화)은 선택에서도 빼 준다 — 안 그러면 '3개 선택'인데
    // 실제로는 2개만 지워진다.
    val presentAlarmIds = sortedAlarms.map { it.id }.toSet()
    if (selectionMode && !presentAlarmIds.containsAll(selectedAlarmIds)) {
        selectedAlarmIds = selectedAlarmIds intersect presentAlarmIds
    }
    // 탭을 옮기면 선택을 유지할 이유가 없다(다른 탭엔 삭제 바가 없어 빠져나올 길이 없다).
    if (selectedTab != NativeTab.Alarms && selectionMode) selectedAlarmIds = emptySet()
    BackHandler(enabled = selectionMode) { selectedAlarmIds = emptySet() }
    LaunchedEffect(selectionMode) { onAlarmSelectionModeChange(selectionMode) }
    // 화면을 떠날 때(탭 이동·로그아웃) FAB 가 숨은 채로 남지 않게 되돌린다.
    DisposableEffect(Unit) { onDispose { onAlarmSelectionModeChange(false) } }

    Box(
        modifier = Modifier
            .fillMaxSize()
            // 모든 탭에 같은 그라데이션 배경 — 탭 전환 시 배경 톤이 튀지 않게 한 공간으로.
            .background(homeGradient),
    ) {
    Column(modifier = Modifier.fillMaxSize().padding(contentPadding)) {
        // 알람 탭 헤더는 리스트 밖에 고정한다. 스크롤해도 '다음 알람까지' 안내가 남고, 무엇보다
        // 목록을 내린 상태에서 선택 모드에 들어가도 [취소·삭제]에 닿을 수 있다.
        // stickyHeader 가 아니라 Column 인 이유: HomeHeader 는 배경 없는 Text 한 개라 리스트
        // 안에 붙여두면 알람 카드가 글자 뒤로 그대로 지나간다. 헤더에 따로 배경을 깔면 화면
        // 전체 높이 기준 그라데이션(homeGradient)과 색이 어긋나고, 여기선 배경 Box 위에 그냥
        // 얹히므로 그 문제가 없다.
        if (selectedTab == NativeTab.Alarms && alarmsLoaded) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 20.dp, end = 20.dp, top = 24.dp, bottom = 16.dp)
                    // 헤더(≈32dp)와 선택 바(≈48dp)의 높이가 달라, 고정하지 않으면 선택 모드에
                    // 드나들 때마다 목록 전체가 위아래로 튄다.
                    .heightIn(min = 48.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                // 선택 모드에선 같은 자리를 [취소 · 삭제] 바가 대신한다.
                // 상단바(Scaffold topBar)를 새로 다는 대신 헤더를 바꿔 끼우는 이유:
                // 이 앱엔 TopAppBar 가 하나도 없고, topBar 를 달면 contentPadding 이
                // 5개 탭 전부에 흘러가 상단 여백·그라데이션 정렬이 전부 바뀐다.
                if (selectedAlarmIds.isNotEmpty()) {
                    AlarmSelectionBar(
                        count = selectedAlarmIds.size,
                        onCancel = { selectedAlarmIds = emptySet() },
                        onDelete = {
                            selectedAlarmIds.forEach(onDeleteAlarm)
                            selectedAlarmIds = emptySet()
                        },
                    )
                } else {
                    HomeHeader(
                        nextAlarm = nextAlarm,
                        hasAnyAlarm = hasAnyAlarm,
                    )
                }
            }
        }
        // ⚠ **하위 화면(이용권)의 상단바는 목록 밖에 고정한다.**
        // 목록 안(`item`)에 두면 스크롤과 함께 위로 사라져, 내려간 상태에서 뒤로가기에
        // 닿으려면 다시 맨 위로 올라와야 한다. iOS 는 이 화면들을 네비게이션 스택에
        // push 해서 상단 바가 **항상 남는다**(`AuxiliarySheetHost` 의 `navigationTitle`).
        // 배경은 깔지 않는다 — 그라데이션이 그대로 비쳐야 한 화면으로 읽힌다.
        if (selectedTab == NativeTab.Billing) {
            WakerTopBar(
                title = stringResource(R.string.common_tab_billing),
                onBack = onNavigateBack,
                modifier = Modifier.padding(top = 24.dp),
            )
        }
    // 상태 카드의 '기본 목소리 받는 중' — **기본 목소리만** 센다. 워커 진행(`voicePrefetchProgress`)에는 내 목소리 사전렌더도
    // 섞여 있어, 그것만 받는 중인데 기본 목소리 알람에 '받는 중' 이 뜨고 진짜 날씨 경고까지 가렸다. 워커 진행이 바뀔 때마다
    // 캐시를 다시 센다(디스크를 읽으니 IO 에서).
    val statusContext = androidx.compose.ui.platform.LocalContext.current
    // ⚠ **받기가 실제로 돌고 있을 때만**이다 — 재시도를 다 써서 멈췄는데 파일이 빠져 있다는 이유로 '받는 중' 을 띄우면 끝없이
    //   받는 중이라 하고 날씨 경고까지 가린다. `voicePrefetchProgress` 는 워커가 RUNNING 이고 덜 받았을 때만 값이 있다.
    var defaultVoicesDownloading by remember { mutableStateOf(false) }
    LaunchedEffect(voicePrefetchProgress, authSession?.user?.id) {
        defaultVoicesDownloading = voicePrefetchProgress != null &&
            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                runCatching {
                    com.alarmtalk.app.sync.StockClipPrefetchWorker.defaultVoiceProgress(statusContext, authSession?.user?.id)
                }.getOrNull()
            }?.let { (done, total) -> total > 0 && done < total } == true
    }
    LazyColumn(
        state = listState,
        modifier = Modifier
            .fillMaxWidth()
            .weight(1f),
        contentPadding = PaddingValues(
            // 좌우 여백은 모든 탭 20dp 로 통일 — 탭 전환 시 콘텐츠 폭이 미세하게 널뛰지 않게.
            start = 20.dp,
            // 알람 탭과 하위 화면(이용권)은 위 **고정 헤더/상단바**가 상단
            // 여백을 이미 냈다.
            top = when (selectedTab) {
                NativeTab.Alarms, NativeTab.Billing -> 0.dp
                else -> 24.dp
            },
            end = 20.dp,
            // 알람 탭은 우하단 FAB(＋)가 마지막 알람 행을 가리지 않게 하단 여유를 더 준다.
            bottom = if (selectedTab == NativeTab.Alarms) 96.dp else 32.dp,
        ),
        // 카드/행 간 간격도 전 화면 16dp 로 통일.
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        when (selectedTab) {
            NativeTab.Voices -> {
                // 페이지 대제목('목소리')은 두지 않는다 — 하단 탭 라벨이 이미 위치를 말해주고,
                // 첫 섹션 제목('내 목소리')이 곧바로 내용을 연다(알람 탭의 무제목과 일관).
                item {
                    VoiceProfileManagementPanel(
                        onCreateAlarmWithVoice = onCreateAlarmWithVoice,
                        voiceProfiles = voiceProfiles,
                        pendingVoiceDraft = pendingVoiceDraft,
                        voiceProfileBusy = voiceProfileBusy,
                        subscriptionResponse = subscriptionResponse,
                        voiceDraftQuotaExhausted = voiceDraftQuotaExhausted,
                        authSession = authSession,
                        onCreateVoiceProfile = onCreateVoiceProfile,
                        sensitiveConsentMissing = sensitiveConsentMissing,
                        onGenerateTts = onGenerateTts,
                        stockClips = stockClips,
                        expectedVariants = expectedVariants,
                        onDownloadStockAudio = onDownloadStockAudio,
                        onRenameVoiceProfile = onRenameVoiceProfile,
                        onDeleteVoiceProfile = onDeleteVoiceProfile,
                        onConfirmVoicePreviewPlayed = onConfirmVoicePreviewPlayed,
                        onUpdateVoicePreviewText = onUpdateVoicePreviewText,
                        onPromoteVoiceDraft = onPromoteVoiceDraft,
                        onDeleteVoiceDraft = onDeleteVoiceDraft,
                        onDiscardVoiceDraftQuietly = onDiscardVoiceDraftQuietly,
                        voiceRegistrationFailure = voiceRegistrationFailure,
                        onVoiceRegistrationFailureShown = onVoiceRegistrationFailureShown,
                        onRegistrationWindowOpenChange = onRegistrationWindowOpenChange,
                        onOpenBilling = { onSelectTab(NativeTab.Billing) },
                        voiceDraftQuota = voiceDraftQuota,
                        voicePrefetchProgress = voicePrefetchProgress,
                        onGetVoicePrerenderStatus = onGetVoicePrerenderStatus,
                        onRetryVoicePrerender = onRetryVoicePrerender,
                        onRetryVoiceSpeechStyle = onRetryVoiceSpeechStyle,
                        onReloadStockClips = onReloadStockClips,
                        onCacheVoiceClips = onCacheVoiceClips,
                        prerenderDrive = prerenderDrive,
                        onStartPrerenderDrive = onStartPrerenderDrive,
                        storeEntitledNow = storeEntitledNow,
                    )
                }
            }

            NativeTab.Alarms -> {
                // Room 첫 방출 전(alarmsLoaded=false)에는 헤더/빈 상태를 그리지 않는다 —
                // 알람이 있어도 콜드 스타트 첫 프레임에 '알람이 없습니다'가 번쩍이는 것 방지.
                if (alarmsLoaded && !hasAnyAlarm) {
                    item {
                        EmptyAlarmHeroCard(onCreateAlarm = onCreateAlarm)
                    }
                }
                // 권한 안내는 '이미 알람이 있는데 권한이 모자란' 경우에만. 새 유저에겐 홈에서
                // 미리 조르지 않는다 — 알람 만들기 시점에 요청한다.
                // 헤드라인이 이미 '안 울린다'를 말했으므로, 배너는 같은 말을 반복하지 않고
                // 각각 **왜 그런지 / 무엇을 하면 되는지**를 말한다.
                // **다음 알람 상태 카드**(2026-10-26 v1.3 W06) — 켜진 알람이 있으면 다음 알람에 대해 지금 할 일 하나를 말한다.
                // 권한 부족도 이 카드가 말한다(예전 권한 배너와 같은 문구·같은 동작). 켜진 알람이 없는데 권한이 모자라면
                // 예전처럼 배너만 둔다.
                val nowMillis = System.currentTimeMillis()
                // 저장된 예약 시각(`fireAtMillis`)으로 고른다 — 헤드라인과 같다. 시·분·반복으로 다시 계산하면 다시 울림(스누즈)으로
                // 5분 뒤에 울 알람을 내일 알람으로 읽는다(`AlarmRepository.snooze` 는 `fireAtMillis` 만 옮긴다).
                val nextAlarm = alarms.filter { it.enabled }
                    .map { it to it.fireAtMillis }
                    .minByOrNull { it.second }
                val missingPermission = permissions.firstMissingAlarmTarget()
                if (nextAlarm != null) {
                    val (alarm, fireAt) = nextAlarm
                    val limitedEndsAt = parseServerInstantMillis(authSession?.planPromoStamp()?.endsAt)
                    val status = nextAlarmStatus(
                        alarm = alarm,
                        nextFireAtMillis = fireAt,
                        missingPermission = missingPermission,
                        defaultVoiceDownloadInProgress = defaultVoicesDownloading,
                        limitedPlanEndsAtMillis = limitedEndsAt,
                        nowMillis = nowMillis,
                    )
                    item {
                        val context = androidx.compose.ui.platform.LocalContext.current
                        val voiceName = alarm.voiceProfileId
                            ?.takeIf {
                                alarm.voiceSource != VoiceSources.LOCAL_AUDIO &&
                                    com.alarmtalk.app.data.AlarmPlayModes.normalize(alarm.playMode) ==
                                    com.alarmtalk.app.data.AlarmPlayModes.VOICE_ONLY
                            }
                            ?.let { id ->
                                voiceProfiles.firstOrNull { it.id == id }
                                    ?.let { com.alarmtalk.app.data.systemVoiceDisplayName(context, it.id, it.name) }
                            }
                        NextAlarmStatusCard(
                            status = status,
                            voiceName = voiceName,
                            endsAtLabel = (status as? NextAlarmStatus.VoiceEnding)?.endsAtMillis?.let { ends ->
                                android.text.format.DateUtils.formatDateTime(
                                    context,
                                    ends - 1_000L,
                                    android.text.format.DateUtils.FORMAT_SHOW_DATE or android.text.format.DateUtils.FORMAT_NO_YEAR,
                                )
                            },
                            onRequestPermission = onRequestAlarmPermission,
                            modifier = Modifier.padding(top = 8.dp),
                        )
                    }
                } else {
                    missingPermission?.takeIf { hasAnyAlarm }?.let { missing ->
                        item {
                            AlarmPermissionWarningBanner(
                                modifier = Modifier.padding(top = 8.dp),
                                // **어떤 권한인지** 말한다. '권한' 이라고만 하면 어디를 켜야 하는지 모른 채 설정 화면에서 헤맨다.
                                textResId = when (missing) {
                                    PermissionTarget.Notifications -> R.string.hs_perm_banner_notifications
                                    PermissionTarget.ExactAlarms -> R.string.hs_perm_banner_exact_alarm
                                    else -> R.string.hs_perm_banner_full_screen
                                },
                                onClick = { onRequestAlarmPermission(missing) },
                            )
                        }
                    }
                }
                items(sortedAlarms, key = { it.id }) { alarm ->
                    // TTS 알람만 프로필 이름을 찾는다(녹음·파일 알람은 이름 없이 날짜만).
                    // 시스템이 '알람' 모드로 바꿔 둔 옛 잠금·강등 행은 더는 그 목소리로 울리지 않으므로
                    // 목소리 이름을 숨긴다. 2026-09-29 부터의 잠금은 행을 **기본 목소리 알람**으로
                    // 고쳐 쓰므로(billing-lifecycle.md 「목소리를 못 쓰게 되면」) 그 기본 목소리 이름이 보인다.
                    val voiceName = alarm.voiceProfileId
                        ?.takeIf { alarm.voiceSource != VoiceSources.LOCAL_AUDIO && !alarm.wasVoiceAlarmConvertedBySystem() }
                        ?.let { profileId ->
                            voiceProfiles.firstOrNull { it.id == profileId }?.let { systemVoiceDisplayName(context, it.id, it.name) }
                        }
                    AlarmRow(
                        alarm = alarm,
                        voiceName = voiceName,
                        onToggleEnabled = { enabled -> onToggleEnabled(alarm.id, enabled) },
                        onEditAlarm = { onEditAlarm(alarm) },
                        onDeleteAlarm = { onDeleteAlarm(alarm.id) },
                        selectionMode = selectionMode,
                        selected = alarm.id in selectedAlarmIds,
                        onToggleSelected = {
                            selectedAlarmIds = if (alarm.id in selectedAlarmIds) {
                                selectedAlarmIds - alarm.id
                            } else {
                                selectedAlarmIds + alarm.id
                            }
                        },
                        onEnterSelection = { selectedAlarmIds = setOf(alarm.id) },
                    )
                }
            }

            NativeTab.Menu -> {
                // '더보기' 대제목 생략 — 하단 탭 라벨과 중복. 프로필 카드가 바로 시작한다.
                item {
                    MenuTabPanel(
                        authSession = authSession,
                        themeMode = themeMode,
                        onChangeTheme = onChangeTheme,
                        onOpenBilling = { onSelectTab(NativeTab.Billing) },
                        onOpenSettings = onOpenSettings,
                        onDeleteAccount = onDeleteAccount,
                    )
                }
            }

            NativeTab.Billing -> {
                // 상단바는 목록 **밖**에 고정돼 있다(위 Column 참조).
                item {
                    SubscriptionPanel(
                        billingBusy = billingBusy,
                        subscriptionResponse = subscriptionResponse,
                        planPrices = planPrices,
                        planTrials = planTrials,
                        onPurchasePlay = onPurchasePlay,
                        onCancelSubscription = onCancelSubscription,
                        onRestorePurchases = onRestorePurchases,
                        personalPromo = planScreenPersonalPromo,
                        // 관리자 기간 지급의 끝 — 구독 응답이 있으면 그 값, 없으면 계정 응답의 값.
                        planGrantEndsAt = subscriptionResponse?.planGrant?.endsAt
                            ?: authSession?.user?.planGrant?.endsAt,
                    )
                }
            }
        }
    }
    }
    }
}

/**
 * 선택 모드 헤더 — HomeHeader 자리를 그대로 차지한다.
 * 오른쪽에 [취소][삭제] 둘만. 삭제는 되돌릴 수 없으므로 강조색으로 둔다.
 */
@Composable
private fun AlarmSelectionBar(
    count: Int,
    onCancel: () -> Unit,
    onDelete: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 4.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.End,
    ) {
        // 선택 개수는 행마다 체크 표시로 이미 보이므로 숫자를 따로 쓰지 않는다.
        // 취소·삭제를 오른쪽에 나란히 둬 엄지 이동을 줄인다(삭제가 바깥쪽).
        TextButton(onClick = onCancel) {
            Text(stringResource(R.string.editor_cancel))
        }
        TextButton(onClick = onDelete, enabled = count > 0) {
            Text(
                text = stringResource(R.string.common_alarm_delete),
                color = MaterialTheme.colorScheme.error,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}
