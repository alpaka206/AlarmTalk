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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
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

// 로그인 배경(AuthBackdrop)의 딥 네이비 감성을 탭 화면 전체에 가져온다 — 라이트/다크 두 버전.
// 알람 홈에만 깔면 탭 전환(알람↔목소리↔더보기)마다 배경 분위기가 뚝 바뀌어 어색해서,
// 같은 그라데이션을 모든 탭에 깔아 앱을 한 공간으로 묶는다.
// 생 Color 리터럴은 로그인/랜딩과 같은 '브랜드 비주얼' 예외(CLAUDE.md 색 토큰 규약의 문서화된 예외).
private val HomeGradientDark = Brush.verticalGradient(
    0f to Color(0xFF1A2A52),
    0.55f to Color(0xFF0E1938),
    1f to Color(0xFF070C1D),
)
private val HomeGradientLight = Brush.verticalGradient(
    0f to Color(0xFFF4F7FD),
    0.5f to Color(0xFFDBE6F7),
    1f to Color(0xFFBED2EF),
)

@Composable
internal fun AlarmListScreen(
    contentPadding: PaddingValues,
    selectedTab: NativeTab,
    onSelectTab: (NativeTab) -> Unit,
    alarms: List<AlarmEntity>,
    authSession: AuthSession?,
    voiceProfiles: List<VoiceProfile>,
    pendingVoiceDraft: VoiceProfile?,
    voiceProfileBusy: Boolean,
    socialBusy: Boolean,
    familyGroup: FamilyGroupCurrentResponse?,
    familyVoices: List<FamilyVoiceProfile>,
    billingBusy: Boolean,
    subscriptionResponse: BillingSubscriptionResponse?,
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
    onUpdateSharedVoiceInfo: (String, String, String) -> Unit,
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
    onOpenConsentHistory: () -> Unit,
    onOpenOssLicenses: () -> Unit,
    onDeleteAccount: () -> Unit,
    themeMode: ThemeMode,
    onChangeTheme: (ThemeMode) -> Unit,
    onToggleEnabled: (String, Boolean) -> Unit,
    onEditAlarm: (AlarmEntity) -> Unit,
    onDeleteAlarm: (String) -> Unit,
    onRequestPermissionGate: (PermissionTarget) -> Unit,
    onRequestAllPermissions: () -> Unit,
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

    // 그라데이션 명암은 시스템 값이 아니라 앱이 실제 쓰는 테마(현재 컬러스킴)에 맞춘다.
    val homeGradient = if (MaterialTheme.colorScheme.background.luminance() < 0.5f) {
        HomeGradientDark
    } else {
        HomeGradientLight
    }
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
            start = if (selectedTab == NativeTab.Alarms) 20.dp else 24.dp,
            top = 24.dp,
            end = if (selectedTab == NativeTab.Alarms) 20.dp else 24.dp,
            // 알람 탭은 우하단 FAB(＋)가 마지막 알람 행을 가리지 않게 하단 여유를 더 준다.
            bottom = if (selectedTab == NativeTab.Alarms) 96.dp else 32.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(if (selectedTab == NativeTab.Alarms) 14.dp else 16.dp),
    ) {
        when (selectedTab) {
            NativeTab.Voices -> {
                item {
                    ScreenHeader(title = stringResource(R.string.common_tab_voices))
                }
                item {
                    VoiceProfileManagementPanel(
                        voiceProfiles = voiceProfiles,
                        pendingVoiceDraft = pendingVoiceDraft,
                        familyVoices = familyVoices,
                        voiceProfileBusy = voiceProfileBusy,
                        subscriptionResponse = subscriptionResponse,
                        familyGroup = familyGroup,
                        authSession = authSession,
                        onCreateVoiceProfile = onCreateVoiceProfile,
                        onCreateVoiceProfiles = onCreateVoiceProfiles,
                        onGenerateTts = onGenerateTts,
                        stockClips = stockClips,
                        onDownloadStockAudio = onDownloadStockAudio,
                        onRenameVoiceProfile = onRenameVoiceProfile,
                        onShareVoiceProfile = onShareVoiceProfile,
                        onUpdateSharedVoiceInfo = onUpdateSharedVoiceInfo,
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
                item { HomeHeader(nextAlarm = nextAlarm, hasAnyAlarm = hasAnyAlarm) }
                if (!hasAnyAlarm) {
                    item {
                        EmptyAlarmHeroCard(onCreateAlarm = onCreateAlarm)
                    }
                }
                // 권한 안내는 '이미 알람이 있는데 권한이 없어 조용히 안 울리는' 경우에만 남긴다.
                // 새 유저(알람 없음)에겐 홈에서 권한을 미리 조르지 않는다 — 알람 만들기 시점에 요청.
                if (hasAnyAlarm && !permissions.alarmReady) {
                    item {
                        PermissionPanel(
                            permissions = permissions,
                            onRequestPermission = onRequestPermissionGate,
                            onRequestAllPermissions = onRequestAllPermissions,
                        )
                    }
                }
                items(sortedAlarms, key = { it.id }) { alarm ->
                    // TTS 알람만 프로필 이름을 찾는다(녹음·파일 알람은 이름 없이 날짜만).
                    val voiceName = alarm.voiceProfileId
                        ?.takeIf { alarm.voiceSource != VoiceSources.LOCAL_AUDIO }
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
                item {
                    ScreenHeader(title = stringResource(R.string.r3app_bottom_tab_menu))
                }
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
                        onOpenConsentHistory = onOpenConsentHistory,
                        onOpenOssLicenses = onOpenOssLicenses,
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
