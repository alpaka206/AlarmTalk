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
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.ui.guide.CoachMarkOverlay
import com.alarmtalk.app.ui.guide.CoachMarkRegistry
import com.alarmtalk.app.ui.guide.CoachMarkStep
import com.alarmtalk.app.ui.guide.UsageGuideStore
import com.alarmtalk.app.ui.guide.coachMarkTarget
import kotlinx.coroutines.delay
import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.CachedAlarmAudio
import com.alarmtalk.app.data.CharacterEventEntity
import com.alarmtalk.app.data.VoiceProfileCreationDraft
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.CharacterResponse
import com.alarmtalk.app.network.FamilyGroupCurrentResponse
import com.alarmtalk.app.network.FamilyVoiceProfile
import com.alarmtalk.app.network.NoteAudioResponse
import com.alarmtalk.app.network.ReceivedNote
import com.alarmtalk.app.network.TtsGenerateRequest
import com.alarmtalk.app.network.TtsGenerateResponse
import com.alarmtalk.app.network.VoiceProfile
import com.alarmtalk.app.network.VoiceSpeakerSegment
import com.alarmtalk.app.network.VoucherItem

// 홈 첫 방문 안내 — 다음 알람 히어로 / 빠른 시작 타일에 스포트라이트.
private const val GUIDE_TARGET_HOME_HERO = "home_next_alarm"
private const val GUIDE_TARGET_HOME_QUICK = "home_quick_start"

private val homeCoachSteps = listOf(
    CoachMarkStep(
        targetKey = GUIDE_TARGET_HOME_HERO,
        title = "다음 알람을 한눈에",
        body = "다음에 울릴 알람을 여기서 바로 확인하고, 눌러서 시각이나 목소리를 바꿀 수 있어요.",
    ),
    CoachMarkStep(
        targetKey = GUIDE_TARGET_HOME_QUICK,
        title = "여기서 바로 시작해요",
        body = "‘목소리 만들기’로 깨워줄 목소리를 등록하고, ‘새 알람’으로 알람을 추가할 수 있어요.",
    ),
)

// 목소리 등록 첫 방문 안내 — 내 목소리 만들기 버튼에 스포트라이트.
private const val GUIDE_TARGET_VOICE_CREATE = "voice_register_create"

private val voiceRegisterCoachSteps = listOf(
    CoachMarkStep(
        targetKey = GUIDE_TARGET_VOICE_CREATE,
        title = "내 목소리를 만들어요",
        body = "여기서 1분 남짓 녹음하거나 음성 파일을 올리면, 그 목소리로 알람을 깨워줘요. 만든 목소리는 가족·연인과 공유할 수도 있어요.",
    ),
)

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
    characterEvents: List<CharacterEventEntity>,
    characterBusy: Boolean,
    characterResponse: CharacterResponse?,
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
    onCreateVoiceProfile: (String, CachedAlarmAudio, Boolean, String, String) -> Unit,
    onCreateVoiceProfiles: (List<VoiceProfileCreationDraft>) -> Unit,
    onSeparateVoiceSpeakers: suspend (CachedAlarmAudio) -> List<VoiceSpeakerSegment>,
    onCloneSpeakerDraft: suspend (String, CachedAlarmAudio) -> VoiceProfile,
    onPromoteDraftVoice: suspend (String) -> Unit,
    onDeleteDraftVoice: suspend (String) -> Unit,
    onGenerateTts: suspend (TtsGenerateRequest) -> TtsGenerateResponse,
    stockClips: List<com.alarmtalk.app.network.StockClip>,
    onDownloadStockAudio: suspend (String) -> com.alarmtalk.app.network.TtsMessageAudioResponse,
    onRenameVoiceProfile: (String, String, String, String) -> Unit,
    onShareVoiceProfile: (String, Boolean) -> Unit,
    onUpdateSharedVoiceInfo: (String, String, String) -> Unit,
    onDeleteVoiceProfile: (String) -> Unit,
    onRefreshSocial: () -> Unit,
    onLeaveFamilyGroup: (String) -> Unit,
    onRefreshCharacterBilling: () -> Unit,
    onSyncCharacterEvents: () -> Unit,
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
    onCreateFamilyAlarm: () -> Unit,
    onToggleEnabled: (String, Boolean) -> Unit,
    onEditAlarm: (AlarmEntity) -> Unit,
    onDeleteAlarm: (String) -> Unit,
    onRequestPermissionGate: (PermissionTarget) -> Unit,
    onRequestAllPermissions: () -> Unit,
    profileMenu: (@Composable () -> Unit)? = null,
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
    val canCreateFamilyAlarm = authSession != null &&
        hasCoupleOrFamilyAccess(subscriptionResponse, familyGroup) &&
        familyAlarmRecipients(familyGroup, authSession).isNotEmpty()
    // 시스템 스톡 보이스 도입으로 음성 기능은 로그인만 하면 열린다 (무료는 스톡 보이스 한정).
    val voicePlanLocked = authSession == null
    val voiceLocked = voicePlanLocked || !permissions.recordAudio
    val alarmLocked = !permissions.alarmReady

    val appContext = LocalContext.current.applicationContext
    val usageGuideStore = remember(appContext) { UsageGuideStore(appContext) }
    val coachMarkRegistry = remember { CoachMarkRegistry() }
    val listState = rememberLazyListState()

    // 홈/목소리 탭 첫 방문 시 한 번만 자동 노출. 온보딩 직후 화면·권한과 한꺼번에
    // 겹쳐 버벅이지 않도록, 화면이 자리잡을 시간을 살짝 둔 뒤 부드럽게 띄운다.
    var homeGuideVisible by remember { mutableStateOf(false) }
    var voiceGuideVisible by remember { mutableStateOf(false) }
    LaunchedEffect(selectedTab, authSession) {
        if (selectedTab == NativeTab.Home && authSession != null &&
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
            NativeTab.Home -> {
                item { HomeHeader() }
                item {
                    Box(modifier = Modifier.coachMarkTarget(coachMarkRegistry, GUIDE_TARGET_HOME_HERO)) {
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
                item {
                    Box(modifier = Modifier.coachMarkTarget(coachMarkRegistry, GUIDE_TARGET_HOME_QUICK)) {
                    QuickStartGrid(
                        onRecordVoice = {
                            when {
                                voicePlanLocked -> onSelectTab(NativeTab.Voices)
                                !permissions.recordAudio -> onRequestPermissionGate(PermissionTarget.RecordAudio)
                                else -> onSelectTab(NativeTab.Voices)
                            }
                        },
                        onAddAlarm = onCreateAlarm,
                        canCreateFamilyAlarm = canCreateFamilyAlarm,
                        onAddFamilyAlarm = onCreateFamilyAlarm,
                        voiceLocked = voiceLocked,
                        alarmLocked = alarmLocked,
                    )
                    }
                }
                item {
                    CharacterMiniCard(
                        characterResponse = characterResponse,
                        onClick = { onSelectTab(NativeTab.Growth) },
                    )
                }
            }

            NativeTab.Voices -> {
                item {
                    ScreenHeader(title = "목소리")
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
                    )
                    }
                }
            }

            NativeTab.Alarms -> {
                item { AlarmsHeader(onCreateAlarm = onCreateAlarm, profileMenu = profileMenu) }
                if (!permissions.alarmReady) {
                    item {
                        PermissionPanel(
                            permissions = permissions,
                            onRequestPermission = onRequestPermissionGate,
                            onRequestAllPermissions = onRequestAllPermissions,
                        )
                    }
                }
                if (sortedAlarms.isEmpty()) {
                    item { EmptyAlarmCard(onCreateAlarm = onCreateAlarm) }
                } else {
                    items(sortedAlarms, key = { it.id }) { alarm ->
                        AlarmRow(
                            alarm = alarm,
                            onToggleEnabled = { enabled -> onToggleEnabled(alarm.id, enabled) },
                            onEditAlarm = { onEditAlarm(alarm) },
                            onDeleteAlarm = { onDeleteAlarm(alarm.id) },
                        )
                    }
                }
            }

            NativeTab.People -> {
                item {
                    ScreenHeader(title = "코드 등록")
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
                    ScreenHeader(title = "메시지")
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

            NativeTab.Growth -> {
                item {
                    ScreenHeader(title = "캐릭터")
                }
                item {
                    CharacterBillingPanel(
                        alarms = alarms,
                        characterEvents = characterEvents,
                        characterBusy = characterBusy,
                        characterResponse = characterResponse,
                        billingBusy = billingBusy,
                        subscriptionResponse = subscriptionResponse,
                        vouchers = vouchers,
                        onRefresh = onRefreshCharacterBilling,
                        onSyncEvents = onSyncCharacterEvents,
                        onRegisterCode = onRegisterCode,
                    )
                }
            }

            NativeTab.Billing -> {
                item {
                    ScreenHeader(title = "이용권")
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

        if (homeGuideVisible && selectedTab == NativeTab.Home) {
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
