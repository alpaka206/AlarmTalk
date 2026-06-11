package com.alarmtalk.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Message
import androidx.compose.material.icons.outlined.People
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
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

    LazyColumn(
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
                item {
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
                        onRenameVoiceProfile = onRenameVoiceProfile,
                        onShareVoiceProfile = onShareVoiceProfile,
                        onUpdateSharedVoiceInfo = onUpdateSharedVoiceInfo,
                        onDeleteVoiceProfile = onDeleteVoiceProfile,
                        onOpenBilling = { onSelectTab(NativeTab.Billing) },
                    )
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
}
