package com.voicealarm.nativeapp

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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.voicealarm.nativeapp.data.AlarmEntity
import com.voicealarm.nativeapp.data.CachedAlarmAudio
import com.voicealarm.nativeapp.data.CharacterEventEntity
import com.voicealarm.nativeapp.network.AuthSession
import com.voicealarm.nativeapp.network.BillingSubscriptionResponse
import com.voicealarm.nativeapp.network.CharacterResponse
import com.voicealarm.nativeapp.network.FamilyGroupCurrentResponse
import com.voicealarm.nativeapp.network.FamilyVoiceProfile
import com.voicealarm.nativeapp.network.ReceivedNote
import com.voicealarm.nativeapp.network.VoiceProfile
import com.voicealarm.nativeapp.network.VoiceSpeakerSegment
import com.voicealarm.nativeapp.network.VoucherItem

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
    onRegister: (String, String, String) -> Unit,
    onGoogleSignIn: () -> Unit,
    onSyncNow: () -> Unit,
    onLogout: () -> Unit,
    onCreateVoiceProfile: (String, CachedAlarmAudio, Boolean) -> Unit,
    onCreateVoiceProfiles: (List<Triple<String, CachedAlarmAudio, Boolean>>) -> Unit,
    onSeparateVoiceSpeakers: suspend (CachedAlarmAudio) -> List<VoiceSpeakerSegment>,
    onRenameVoiceProfile: (String, String) -> Unit,
    onShareVoiceProfile: (String, Boolean) -> Unit,
    onDeleteVoiceProfile: (String) -> Unit,
    onRefreshSocial: () -> Unit,
    onLeaveFamilyGroup: (String) -> Unit,
    onRefreshCharacterBilling: () -> Unit,
    onSyncCharacterEvents: () -> Unit,
    onRegisterCode: (String) -> Unit,
    onEnsureFamilyShareCode: () -> Unit,
    onRefreshNotes: () -> Unit,
    onSendNote: (String, String) -> Unit,
    onMarkNoteRead: (String) -> Unit,
    onCheckoutPlan: (String, Boolean) -> Unit,
    onCancelSubscription: (Boolean) -> Unit,
    onChangePlan: (String, Boolean) -> Unit,
    onCreateAlarm: () -> Unit,
    onCreateFamilyAlarm: () -> Unit,
    onToggleEnabled: (String, Boolean) -> Unit,
    onEditAlarm: (AlarmEntity) -> Unit,
    onDeleteAlarm: (String) -> Unit,
    onRequestPermissionGate: (PermissionTarget) -> Unit,
) {
    val sortedAlarms = remember(alarms) {
        alarms.sortedWith(
            compareByDescending<AlarmEntity> { it.enabled }
                .thenBy { it.fireAtMillis },
        )
    }
    val nextAlarm = remember(alarms) {
        alarms.filter { it.enabled }.minByOrNull { it.fireAtMillis }
    }
    val canCreateFamilyAlarm = authSession != null &&
        hasCoupleOrFamilyAccess(subscriptionResponse, familyGroup) &&
        familyAlarmRecipients(familyGroup, authSession).isNotEmpty()
    val context = LocalContext.current
    val voiceLocked = !context.hasRecordAudioPermission()
    val alarmLocked = !context.hasAlarmPermissions()

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
                    CharacterMiniCard(
                        characterResponse = characterResponse,
                        onClick = { onSelectTab(NativeTab.Growth) },
                    )
                }
                item {
                    QuickStartGrid(
                        onRecordVoice = {
                            if (voiceLocked) onRequestPermissionGate(PermissionTarget.RecordAudio)
                            else onSelectTab(NativeTab.Voices)
                        },
                        onAddAlarm = onCreateAlarm,
                        canCreateFamilyAlarm = canCreateFamilyAlarm,
                        onAddFamilyAlarm = onCreateFamilyAlarm,
                        voiceLocked = voiceLocked,
                        alarmLocked = alarmLocked,
                    )
                }
            }

            NativeTab.Voices -> {
                item {
                    ScreenHeader(
                        title = "음성",
                        subtitle = "내 목소리를 AI 음성 프로필로 만들고 관리해요.",
                    )
                }
                item {
                    VoiceProfileManagementPanel(
                        voiceProfiles = voiceProfiles,
                        familyVoices = familyVoices,
                        voiceProfileBusy = voiceProfileBusy,
                        subscriptionResponse = subscriptionResponse,
                        familyGroup = familyGroup,
                        onCreateVoiceProfile = onCreateVoiceProfile,
                        onCreateVoiceProfiles = onCreateVoiceProfiles,
                        onSeparateVoiceSpeakers = onSeparateVoiceSpeakers,
                        onRenameVoiceProfile = onRenameVoiceProfile,
                        onShareVoiceProfile = onShareVoiceProfile,
                        onDeleteVoiceProfile = onDeleteVoiceProfile,
                    )
                }
            }

            NativeTab.Alarms -> {
                item { AlarmsHeader(onCreateAlarm = onCreateAlarm) }
                if (nextAlarm != null) {
                    item { CountdownBanner(nextAlarm = nextAlarm) }
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
                    ScreenHeader(
                        title = "코드 등록",
                        subtitle = "초대 코드 및 이용권을 등록하세요.",
                    )
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
                    ScreenHeader(
                        title = "음성 메시지",
                        subtitle = "소중한 사람들에게 응원의 메시지를 보내봐요.",
                    )
                }
                if (authSession != null) item {
                    VoiceMessagePanel(
                        authSession = authSession,
                        noteBusy = noteBusy,
                        familyGroup = familyGroup,
                        subscriptionResponse = subscriptionResponse,
                        receivedNotes = receivedNotes,
                        onRefresh = {
                            onRefreshSocial()
                            onRefreshNotes()
                        },
                        onSendNote = onSendNote,
                        onMarkNoteRead = onMarkNoteRead,
                        onOpenFamily = { onSelectTab(NativeTab.People) },
                        onOpenBilling = { onSelectTab(NativeTab.Billing) },
                    )
                }
            }

            NativeTab.Growth -> {
                item {
                    ScreenHeader(
                        title = "캐릭터",
                        subtitle = "알람을 제대로 끄면 캐릭터가 성장해요!",
                    )
                }
                item {
                    CharacterBillingPanel(
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
                    ScreenHeader(title = "구독")
                }
                item {
                    SubscriptionPanel(
                        billingBusy = billingBusy,
                        subscriptionResponse = subscriptionResponse,
                        vouchers = vouchers,
                        onRefresh = onRefreshCharacterBilling,
                        onRegisterCode = onRegisterCode,
                        onCheckoutPlan = onCheckoutPlan,
                        onCancelSubscription = onCancelSubscription,
                        onChangePlan = onChangePlan,
                    )
                }
            }
        }
    }
}
