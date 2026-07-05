package com.alarmtalk.app

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
import androidx.compose.material.icons.outlined.Message
import androidx.compose.material.icons.outlined.People
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.R
import com.alarmtalk.app.ui.guide.CoachMarkOverlay
import com.alarmtalk.app.ui.guide.CoachMarkRegistry
import com.alarmtalk.app.ui.guide.CoachMarkStep
import com.alarmtalk.app.ui.guide.UsageGuideStore
import com.alarmtalk.app.ui.guide.coachMarkTarget
import kotlinx.coroutines.delay
import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.CachedAlarmAudio
import com.alarmtalk.app.data.VoiceProfileCreationDraft
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.FamilyGroupCurrentResponse
import com.alarmtalk.app.network.FamilyVoiceProfile
import com.alarmtalk.app.network.NoteAudioResponse
import com.alarmtalk.app.network.ReceivedNote
import com.alarmtalk.app.network.TtsGenerateRequest
import com.alarmtalk.app.network.TtsGenerateResponse
import com.alarmtalk.app.network.VoiceProfile
import com.alarmtalk.app.network.VoiceSpeakerSegment
import com.alarmtalk.app.network.VoucherItem

// 홈 첫 방문 안내 — 다음 알람 히어로에 스포트라이트.
private const val GUIDE_TARGET_HOME_HERO = "home_next_alarm"

// 목소리 등록 첫 방문 안내 — 내 목소리 만들기 버튼에 스포트라이트.
private const val GUIDE_TARGET_VOICE_CREATE = "voice_register_create"

@Composable
internal fun AlarmListScreen(
    contentPadding: PaddingValues,
    selectedTab: NativeTab,
    onSelectTab: (NativeTab) -> Unit,
    alarms: List<AlarmEntity>,
    authSession: AuthSession?,
    authBusy: Boolean,
    syncBusy: Boolean,
    voiceProfiles: List<VoiceProfile>,
    voiceProfileBusy: Boolean,
    socialBusy: Boolean,
    familyGroup: FamilyGroupCurrentResponse?,
    familyVoices: List<FamilyVoiceProfile>,
    billingBusy: Boolean,
    subscriptionResponse: BillingSubscriptionResponse?,
    vouchers: List<VoucherItem>,
    noteBusy: Boolean,
    receivedNotes: List<ReceivedNote>,
    onLogin: (String, String) -> Unit,
    onRegister: (String, String, String, String) -> Unit,
    onGoogleSignIn: () -> Unit,
    onSyncNow: () -> Unit,
    onLogout: () -> Unit,
    onCreateVoiceProfile: (String, CachedAlarmAudio, Boolean, String, String, String, String) -> Unit,
    onCreateVoiceProfiles: (List<VoiceProfileCreationDraft>) -> Unit,
    onSeparateVoiceSpeakers: suspend (CachedAlarmAudio) -> List<VoiceSpeakerSegment>,
    onCloneSpeakerDraft: suspend (String, CachedAlarmAudio) -> VoiceProfile,
    onPromoteDraftVoice: suspend (String) -> Unit,
    onDeleteDraftVoice: suspend (String) -> Unit,
    onGenerateTts: suspend (TtsGenerateRequest) -> TtsGenerateResponse,
    stockClips: List<com.alarmtalk.app.network.StockClip>,
    defaultVoiceId: String? = null,
    onSetDefaultVoice: (String) -> Unit = {},
    onDownloadStockAudio: suspend (String) -> com.alarmtalk.app.network.TtsMessageAudioResponse,
    onRenameVoiceProfile: (String, String, String, String) -> Unit,
    onShareVoiceProfile: (String, Boolean) -> Unit,
    onUpdateSharedVoiceInfo: (String, String, String) -> Unit,
    onDeleteVoiceProfile: (String) -> Unit,
    onRefreshSocial: () -> Unit,
    onLeaveFamilyGroup: (String) -> Unit,
    onRegisterCode: (String) -> Unit,
    onEnsureFamilyShareCode: () -> Unit,
    onRefreshNotes: () -> Unit,
    onSendNote: (String, String) -> Unit,
    onSendTtsNote: (String, String, String) -> Unit,
    onDownloadNoteAudio: suspend (String) -> NoteAudioResponse,
    onMarkNoteRead: (String) -> Unit,
    onCheckoutPlan: (String, Boolean) -> Unit,
    onPurchasePlay: (android.app.Activity, String) -> Unit,
    onCancelSubscription: (Boolean) -> Unit,
    onChangePlan: (String, Boolean) -> Unit,
    onRefreshShareCodeData: suspend () -> List<VoucherItem>,
    permissions: PermissionSnapshot,
    onCreateAlarm: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenMemberManagement: () -> Unit,
    onOpenConsentHistory: () -> Unit,
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

    val appContext = LocalContext.current.applicationContext
    val usageGuideStore = remember(appContext) { UsageGuideStore(appContext) }
    val coachMarkRegistry = remember { CoachMarkRegistry() }
    val listState = rememberLazyListState()

    val homeCoachSteps = listOf(
        CoachMarkStep(
            targetKey = GUIDE_TARGET_HOME_HERO,
            title = stringResource(R.string.misc2_coach_home_hero_title),
            body = stringResource(R.string.misc2_coach_home_hero_body),
        ),
    )
    val voiceRegisterCoachSteps = listOf(
        CoachMarkStep(
            targetKey = GUIDE_TARGET_VOICE_CREATE,
            title = stringResource(R.string.misc2_coach_voice_create_title),
            body = stringResource(R.string.misc2_coach_voice_create_body),
        ),
    )

    // 홈/목소리 탭 첫 방문 시 한 번만 자동 노출. 온보딩 직후 화면·권한과 한꺼번에
    // 겹쳐 버벅이지 않도록, 화면이 자리잡을 시간을 살짝 둔 뒤 부드럽게 띄운다.
    var homeGuideVisible by remember { mutableStateOf(false) }
    var voiceGuideVisible by remember { mutableStateOf(false) }
    LaunchedEffect(selectedTab, authSession) {
        if (selectedTab == NativeTab.Alarms && authSession != null &&
            !usageGuideStore.hasSeen(UsageGuideStore.GUIDE_HOME)
        ) {
            delay(700)
            homeGuideVisible = true
        }
    }
    LaunchedEffect(selectedTab, authSession) {
        if (selectedTab == NativeTab.Voices && authSession != null &&
            !usageGuideStore.hasSeen(UsageGuideStore.GUIDE_VOICE_REGISTER)
        ) {
            delay(700)
            voiceGuideVisible = true
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
    LazyColumn(
        state = listState,
        modifier = Modifier
            .fillMaxSize()
            .padding(contentPadding),
        contentPadding = PaddingValues(start = 24.dp, top = 24.dp, end = 24.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        when (selectedTab) {
            NativeTab.Voices -> {
                item {
                    ScreenHeader(title = stringResource(R.string.common_tab_voices))
                }
                item {
                    Box(modifier = Modifier.coachMarkTarget(coachMarkRegistry, GUIDE_TARGET_VOICE_CREATE)) {
                    VoiceProfileManagementPanel(
                        voiceProfiles = voiceProfiles,
                        familyVoices = familyVoices,
                        voiceProfileBusy = voiceProfileBusy,
                        subscriptionResponse = subscriptionResponse,
                        familyGroup = familyGroup,
                        authSession = authSession,
                        onCreateVoiceProfile = onCreateVoiceProfile,
                        onCreateVoiceProfiles = onCreateVoiceProfiles,
                        onSeparateVoiceSpeakers = onSeparateVoiceSpeakers,
                        onCloneSpeakerDraft = onCloneSpeakerDraft,
                        onPromoteDraftVoice = onPromoteDraftVoice,
                        onDeleteDraftVoice = onDeleteDraftVoice,
                        onGenerateTts = onGenerateTts,
                        stockClips = stockClips,
                        onDownloadStockAudio = onDownloadStockAudio,
                        onRenameVoiceProfile = onRenameVoiceProfile,
                        onShareVoiceProfile = onShareVoiceProfile,
                        onUpdateSharedVoiceInfo = onUpdateSharedVoiceInfo,
                        onDeleteVoiceProfile = onDeleteVoiceProfile,
                        onOpenBilling = { onSelectTab(NativeTab.Billing) },
                        defaultVoiceId = defaultVoiceId,
                        onSetDefaultVoice = onSetDefaultVoice,
                    )
                    }
                }
            }

            NativeTab.Alarms -> {
                item { HomeHeader() }
                item {
                    Box(modifier = Modifier.coachMarkTarget(coachMarkRegistry, GUIDE_TARGET_HOME_HERO, targetRadius = 24.dp)) {
                        NextAlarmHeroCard(
                            nextAlarm = nextAlarm,
                            onClick = {
                                if (nextAlarm == null) {
                                    onCreateAlarm()
                                } else {
                                    onEditAlarm(nextAlarm)
                                }
                            },
                        )
                    }
                }
                if (!permissions.alarmReady) {
                    item {
                        PermissionPanel(
                            permissions = permissions,
                            onRequestPermission = onRequestPermissionGate,
                            onRequestAllPermissions = onRequestAllPermissions,
                        )
                    }
                }
                // 알람이 없을 땐 히어로 카드가 생성 CTA를 겸한다. 생성 버튼은 하단바 중앙 ➕.
                items(sortedAlarms, key = { it.id }) { alarm ->
                    AlarmRow(
                        alarm = alarm,
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

            NativeTab.Messages -> {
                item {
                    ScreenHeader(title = stringResource(R.string.common_tab_messages))
                }
                if (authSession != null) item {
                    VoiceMessagePanel(
                        authSession = authSession,
                        noteBusy = noteBusy,
                        familyGroup = familyGroup,
                        subscriptionResponse = subscriptionResponse,
                        voiceProfiles = voiceProfiles,
                        familyVoices = familyVoices,
                        voiceProfileBusy = voiceProfileBusy,
                        receivedNotes = receivedNotes,
                        onRefresh = {
                            onRefreshSocial()
                            onRefreshNotes()
                        },
                        onSendNote = onSendNote,
                        onSendTtsNote = onSendTtsNote,
                        onDownloadNoteAudio = onDownloadNoteAudio,
                        onMarkNoteRead = onMarkNoteRead,
                        onOpenFamily = { onSelectTab(NativeTab.People) },
                        onOpenBilling = { onSelectTab(NativeTab.Billing) },
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
                        onRegisterCode = onRegisterCode,
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

        if (homeGuideVisible && selectedTab == NativeTab.Alarms) {
            CoachMarkOverlay(
                steps = homeCoachSteps,
                registry = coachMarkRegistry,
                listState = listState,
                onFinish = {
                    usageGuideStore.markSeen(UsageGuideStore.GUIDE_HOME)
                    homeGuideVisible = false
                },
            )
        }
        if (voiceGuideVisible && selectedTab == NativeTab.Voices) {
            CoachMarkOverlay(
                steps = voiceRegisterCoachSteps,
                registry = coachMarkRegistry,
                listState = listState,
                onFinish = {
                    usageGuideStore.markSeen(UsageGuideStore.GUIDE_VOICE_REGISTER)
                    voiceGuideVisible = false
                },
            )
        }
    }
}
