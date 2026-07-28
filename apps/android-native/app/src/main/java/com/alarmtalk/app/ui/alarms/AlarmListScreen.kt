package com.alarmtalk.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.People
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.R
import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.CachedAlarmAudio
import com.alarmtalk.app.data.VoiceSources
import com.alarmtalk.app.data.VoiceProfileCreationDraft
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.FamilyGroupCurrentResponse
import com.alarmtalk.app.network.FamilyVoiceProfile
import com.alarmtalk.app.network.TtsGenerateRequest
import com.alarmtalk.app.network.TtsGenerateResponse
import com.alarmtalk.app.network.VoiceProfile
import com.alarmtalk.app.network.VoucherItem

// 홈 그라데이션(로그인 딥 네이비 감성)의 단일 출처는 WakerDesign.kt 의
// HomeGradientDark/Light·homeGradientBrush() — 모든 탭과 설정/구성원 관리/약관 동의 등
// 하위 전체화면이 같은 브러시를 써서 화면 전환 시 배경 톤이 튀지 않는다.

@Composable
internal fun AlarmListScreen(
    contentPadding: PaddingValues,
    selectedTab: NativeTab,
    onSelectTab: (NativeTab) -> Unit,
    alarms: List<AlarmEntity>,
    // Room 첫 방출 여부 — false 인 동안 알람 탭은 빈 상태를 그리지 않는다(콜드 스타트 번쩍임 방지).
    alarmsLoaded: Boolean,
    authSession: AuthSession?,
    voiceProfiles: List<VoiceProfile>,
    pendingVoiceDraft: VoiceProfile?,
    voiceProfileBusy: Boolean,
    socialBusy: Boolean,
    familyGroup: FamilyGroupCurrentResponse?,
    familyVoices: List<FamilyVoiceProfile>,
    billingBusy: Boolean,
    subscriptionResponse: BillingSubscriptionResponse?,
    voiceDraftQuotaExhausted: Boolean = false,
    vouchers: List<VoucherItem>,
    onCreateVoiceProfile: (String, CachedAlarmAudio, Boolean, String, String, String) -> Boolean,
    onCreateVoiceProfiles: (List<VoiceProfileCreationDraft>) -> Unit,
    onGenerateTts: suspend (TtsGenerateRequest) -> TtsGenerateResponse,
    stockClips: List<com.alarmtalk.app.network.StockClip>,
    defaultVoiceId: String? = null,
    onSetDefaultVoice: (String) -> Unit = {},
    // 기본 목소리 무료 버킷 프리페치 진행(다운로드 n to 전체). null = 진행 중 아님.
    voicePrefetchProgress: Pair<Int, Int>? = null,
    // 유료 클론 사전렌더 준비 상태 조회/재시도 + 매니페스트 강제 재조회(목소리 탭 준비 표시용).
    onGetVoicePrerenderStatus: suspend (String) -> com.alarmtalk.app.network.VoicePrerenderStatusResponse =
        { com.alarmtalk.app.network.VoicePrerenderStatusResponse() },
    onRetryVoicePrerender: suspend (String) -> Boolean = { false },
    onRetryVoiceSpeechStyle: suspend (String) -> Boolean = { false },
    onReloadStockClips: () -> Unit = {},
    // promote 직후 사전렌더 드라이브(ViewModel 스코프) 진행/시작.
    prerenderDrive: PrerenderDriveState? = null,
    onStartPrerenderDrive: (String) -> Unit = {},
    onDownloadStockAudio: suspend (String) -> com.alarmtalk.app.network.TtsMessageAudioResponse,
    onRenameVoiceProfile: (String, String, String, String) -> Unit,
    onShareVoiceProfile: (String, Boolean) -> Unit,
    onDeleteVoiceProfile: (String) -> Unit,
    onConfirmVoicePreviewPlayed: suspend (String, String) -> Unit,
    onUpdateVoicePreviewText: suspend (String, String) -> String,
    onPromoteVoiceDraft: (String) -> Unit,
    onDeleteVoiceDraft: (String) -> Unit,
    onRefreshSocial: () -> Unit,
    onLeaveFamilyGroup: (String) -> Unit,
    onRegisterCode: (String) -> Unit,
    onEnsureFamilyShareCode: () -> Unit,
    onCheckoutPlan: (String, Boolean) -> Unit,
    planPrices: Map<String, String>,
    onPurchasePlay: (android.app.Activity, String) -> Unit,
    onCancelSubscription: (Boolean) -> Unit,
    onChangePlan: (String, Boolean) -> Unit,
    onRefreshShareCodeData: suspend () -> List<VoucherItem>,
    permissions: PermissionSnapshot,
    onCreateAlarm: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenMemberManagement: () -> Unit,
    onDeleteAccount: () -> Unit,
    themeMode: ThemeMode,
    onChangeTheme: (ThemeMode) -> Unit,
    onToggleEnabled: (String, Boolean) -> Unit,
    onEditAlarm: (AlarmEntity) -> Unit,
    onDeleteAlarm: (String) -> Unit,
    onRequestAlarmPermissions: () -> Unit,
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

    val listState = rememberLazyListState()

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

    Box(
        modifier = Modifier
            .fillMaxSize()
            // 모든 탭에 같은 그라데이션 배경 — 탭 전환 시 배경 톤이 튀지 않게 한 공간으로.
            .background(homeGradient),
    ) {
    LazyColumn(
        state = listState,
        modifier = Modifier
            .fillMaxSize()
            .padding(contentPadding),
        contentPadding = PaddingValues(
            // 좌우 여백은 모든 탭 20dp 로 통일 — 탭 전환 시 콘텐츠 폭이 미세하게 널뛰지 않게.
            start = 20.dp,
            top = 24.dp,
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
                        voiceProfiles = voiceProfiles,
                        pendingVoiceDraft = pendingVoiceDraft,
                        familyVoices = familyVoices,
                        voiceProfileBusy = voiceProfileBusy,
                        subscriptionResponse = subscriptionResponse,
                        voiceDraftQuotaExhausted = voiceDraftQuotaExhausted,
                        familyGroup = familyGroup,
                        authSession = authSession,
                        onCreateVoiceProfile = onCreateVoiceProfile,
                        onCreateVoiceProfiles = onCreateVoiceProfiles,
                        onGenerateTts = onGenerateTts,
                        stockClips = stockClips,
                        onDownloadStockAudio = onDownloadStockAudio,
                        onRenameVoiceProfile = onRenameVoiceProfile,
                        onShareVoiceProfile = onShareVoiceProfile,
                        onDeleteVoiceProfile = onDeleteVoiceProfile,
                        onConfirmVoicePreviewPlayed = onConfirmVoicePreviewPlayed,
                        onUpdateVoicePreviewText = onUpdateVoicePreviewText,
                        onPromoteVoiceDraft = onPromoteVoiceDraft,
                        onDeleteVoiceDraft = onDeleteVoiceDraft,
                        onOpenBilling = { onSelectTab(NativeTab.Billing) },
                        defaultVoiceId = defaultVoiceId,
                        onSetDefaultVoice = onSetDefaultVoice,
                        voicePrefetchProgress = voicePrefetchProgress,
                        onGetVoicePrerenderStatus = onGetVoicePrerenderStatus,
                        onRetryVoicePrerender = onRetryVoicePrerender,
                        onRetryVoiceSpeechStyle = onRetryVoiceSpeechStyle,
                        onReloadStockClips = onReloadStockClips,
                        prerenderDrive = prerenderDrive,
                        onStartPrerenderDrive = onStartPrerenderDrive,
                    )
                }
            }

            NativeTab.Alarms -> {
                // Room 첫 방출 전(alarmsLoaded=false)에는 헤더/빈 상태를 그리지 않는다 —
                // 알람이 있어도 콜드 스타트 첫 프레임에 '알람이 없습니다'가 번쩍이는 것 방지.
                if (alarmsLoaded) {
                    item {
                        // 선택 모드에선 같은 자리를 [n개 선택 · 취소 · 삭제] 바가 대신한다.
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
                            HomeHeader(nextAlarm = nextAlarm, hasAnyAlarm = hasAnyAlarm)
                        }
                    }
                }
                if (alarmsLoaded && !hasAnyAlarm) {
                    item {
                        EmptyAlarmHeroCard(onCreateAlarm = onCreateAlarm)
                    }
                }
                // 권한 안내는 '이미 알람이 있는데 권한이 없어 조용히 안 울리는' 경우에만 남긴다.
                // 새 유저(알람 없음)에겐 홈에서 권한을 미리 조르지 않는다 — 알람 만들기 시점에 요청.
                if (hasAnyAlarm && !permissions.alarmReady) {
                    item {
                        AlarmPermissionWarningBanner(onClick = onRequestAlarmPermissions)
                    }
                }
                items(sortedAlarms, key = { it.id }) { alarm ->
                    // TTS 알람만 프로필 이름을 찾는다(녹음·파일 알람은 이름 없이 날짜만).
                    // 무료 전환으로 사운드온리 잠금된 알람(preLockPlayMode≠null)은 더는 그 목소리로
                    // 울리지 않으므로 목소리 이름을 숨긴다(대신 '기본 알람으로 변환' 배지가 뜬다).
                    val voiceName = alarm.voiceProfileId
                        ?.takeIf { alarm.voiceSource != VoiceSources.LOCAL_AUDIO && alarm.preLockPlayMode == null }
                        ?.let { profileId ->
                            voiceProfiles.firstOrNull { it.id == profileId }?.name
                                ?: familyVoices.firstOrNull { it.id == profileId }?.name
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

            NativeTab.People -> {
                item {
                    ScreenHeader(title = stringResource(R.string.common_tab_code_register))
                }
                item {
                    FamilyConnectionPanel(
                        socialBusy = socialBusy,
                        billingBusy = billingBusy,
                        familyGroup = familyGroup,
                        subscriptionResponse = subscriptionResponse,
                        vouchers = vouchers,
                        onLeaveFamilyGroup = onLeaveFamilyGroup,
                        onRegisterCode = onRegisterCode,
                        onEnsureFamilyShareCode = onEnsureFamilyShareCode,
                    )
                }
            }

            NativeTab.Menu -> {
                // '더보기' 대제목 생략 — 하단 탭 라벨과 중복. 프로필 카드가 바로 시작한다.
                item {
                    MenuTabPanel(
                        authSession = authSession,
                        hasSharedPass = familyGroup?.group != null,
                        themeMode = themeMode,
                        onChangeTheme = onChangeTheme,
                        onOpenPeople = { onSelectTab(NativeTab.People) },
                        onOpenBilling = { onSelectTab(NativeTab.Billing) },
                        onOpenMemberManagement = onOpenMemberManagement,
                        onOpenSettings = onOpenSettings,
                        onDeleteAccount = onDeleteAccount,
                    )
                }
            }

            NativeTab.Billing -> {
                item {
                    ScreenHeader(title = stringResource(R.string.common_tab_billing))
                }
                item {
                    SubscriptionPanel(
                        billingBusy = billingBusy,
                        subscriptionResponse = subscriptionResponse,
                        familyGroup = familyGroup,
                        vouchers = vouchers,
                        planPrices = planPrices,
                        onCheckoutPlan = onCheckoutPlan,
                        onPurchasePlay = onPurchasePlay,
                        onCancelSubscription = onCancelSubscription,
                        onChangePlan = onChangePlan,
                        onLeaveFamilyGroup = onLeaveFamilyGroup,
                        onRefreshShareCodeData = onRefreshShareCodeData,
                    )
                }
            }
        }
    }
    }
}

/**
 * 선택 모드 헤더 — HomeHeader 자리를 그대로 차지한다.
 * 왼쪽에 취소, 가운데에 선택 개수, 오른쪽에 삭제. 삭제는 되돌릴 수 없으므로 강조색으로 둔다.
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
    ) {
        TextButton(onClick = onCancel) {
            Text(stringResource(R.string.editor_cancel))
        }
        Spacer(Modifier.width(4.dp))
        Text(
            text = stringResource(R.string.alarms_selected_count, count),
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
        )
        TextButton(onClick = onDelete) {
            Text(
                text = stringResource(R.string.common_alarm_delete),
                color = MaterialTheme.colorScheme.error,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}
