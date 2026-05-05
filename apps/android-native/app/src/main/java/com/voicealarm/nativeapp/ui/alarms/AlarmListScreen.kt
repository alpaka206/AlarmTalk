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
import androidx.compose.ui.unit.dp
import com.voicealarm.nativeapp.data.AlarmEntity
import com.voicealarm.nativeapp.data.CachedAlarmAudio
import com.voicealarm.nativeapp.data.CharacterEventEntity
import com.voicealarm.nativeapp.network.AuthSession
import com.voicealarm.nativeapp.network.BillingSubscriptionResponse
import com.voicealarm.nativeapp.network.CharacterResponse
import com.voicealarm.nativeapp.network.FamilyGroupCurrentResponse
import com.voicealarm.nativeapp.network.FamilyInvite
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
    familyInvites: List<FamilyInvite>,
    familyVoices: List<FamilyVoiceProfile>,
    characterEvents: List<CharacterEventEntity>,
    characterBusy: Boolean,
    characterResponse: CharacterResponse?,
    billingBusy: Boolean,
    subscriptionResponse: BillingSubscriptionResponse?,
    vouchers: List<VoucherItem>,
    noteBusy: Boolean,
    receivedNotes: List<ReceivedNote>,
    message: String?,
    onClearMessage: () -> Unit,
    onLogin: (String, String) -> Unit,
    onRegister: (String, String, String) -> Unit,
    onGoogleSignIn: () -> Unit,
    onSyncNow: () -> Unit,
    onLogout: () -> Unit,
    onCreateVoiceProfile: (String, CachedAlarmAudio) -> Unit,
    onCreateVoiceProfiles: (List<Pair<String, CachedAlarmAudio>>) -> Unit,
    onSeparateVoiceSpeakers: suspend (CachedAlarmAudio) -> List<VoiceSpeakerSegment>,
    onRenameVoiceProfile: (String, String) -> Unit,
    onDeleteVoiceProfile: (String) -> Unit,
    onRefreshSocial: () -> Unit,
    onCreateFamilyInvite: () -> Unit,
    onAcceptFamilyInvite: (String) -> Unit,
    onRevokeFamilyInvite: (String) -> Unit,
    onRefreshCharacterBilling: () -> Unit,
    onSyncCharacterEvents: () -> Unit,
    onRegisterCode: (String) -> Unit,
    onRefreshNotes: () -> Unit,
    onSendNote: (String, String) -> Unit,
    onMarkNoteRead: (String) -> Unit,
    onCheckoutPlan: (String) -> Unit,
    onCreateAlarm: () -> Unit,
    onToggleEnabled: (String, Boolean) -> Unit,
    onEditAlarm: (AlarmEntity) -> Unit,
    onDeleteAlarm: (String) -> Unit,
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

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(contentPadding),
        contentPadding = PaddingValues(start = 24.dp, top = 24.dp, end = 24.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        when (selectedTab) {
            NativeTab.Home -> {
                item {
                    HomeHeader(
                        authSession = authSession,
                        syncBusy = syncBusy,
                        onSelectTab = onSelectTab,
                        onSyncNow = onSyncNow,
                        onLogout = onLogout,
                    )
                }
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
                if (message != null) {
                    item { StatusChip(message = message, onClearMessage = onClearMessage) }
                }
                item {
                    QuickStartGrid(
                        onRecordVoice = { onSelectTab(NativeTab.Voices) },
                        onAddAlarm = onCreateAlarm,
                    )
                }
                if (authSession == null) {
                    item {
                        AccountPanel(
                            authSession = authSession,
                            authBusy = authBusy,
                            syncBusy = syncBusy,
                            voiceProfiles = voiceProfiles,
                            voiceProfileBusy = voiceProfileBusy,
                            onLogin = onLogin,
                            onRegister = onRegister,
                            onGoogleSignIn = onGoogleSignIn,
                            onSyncNow = onSyncNow,
                            onLogout = onLogout,
                        )
                    }
                }
            }

            NativeTab.Voices -> {
                item {
                    ScreenHeader(
                        title = "음성",
                        subtitle = "내 목소리를 AI 음성 프로필로 만들고 관리해요.",
                    )
                }
                if (authSession == null) {
                    item { VoiceLoginRequiredCard() }
                } else {
                    item {
                        VoiceProfileManagementPanel(
                            voiceProfiles = voiceProfiles,
                            voiceProfileBusy = voiceProfileBusy,
                            onCreateVoiceProfile = onCreateVoiceProfile,
                            onCreateVoiceProfiles = onCreateVoiceProfiles,
                            onSeparateVoiceSpeakers = onSeparateVoiceSpeakers,
                            onRenameVoiceProfile = onRenameVoiceProfile,
                            onDeleteVoiceProfile = onDeleteVoiceProfile,
                        )
                    }
                }
            }

            NativeTab.Alarms -> {
                item { AlarmsHeader(onCreateAlarm = onCreateAlarm) }
                if (nextAlarm != null) {
                    item { CountdownBanner(nextAlarm = nextAlarm) }
                }
                if (message != null) {
                    item { StatusChip(message = message, onClearMessage = onClearMessage) }
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
                        title = "커플/가족 연결",
                        subtitle = "초대 코드로 연결하고, 공유 허용된 음성만 알람에 사용할 수 있어요.",
                    )
                }
                if (authSession == null) {
                    item {
                        AccountPanel(
                            authSession = authSession,
                            authBusy = authBusy,
                            syncBusy = syncBusy,
                            voiceProfiles = voiceProfiles,
                            voiceProfileBusy = voiceProfileBusy,
                            onLogin = onLogin,
                            onRegister = onRegister,
                            onGoogleSignIn = onGoogleSignIn,
                            onSyncNow = onSyncNow,
                            onLogout = onLogout,
                        )
                    }
                } else {
                    item {
                        FamilyConnectionPanel(
                            socialBusy = socialBusy,
                            familyGroup = familyGroup,
                            familyInvites = familyInvites,
                            familyVoices = familyVoices,
                            subscriptionResponse = subscriptionResponse,
                            onRefreshSocial = onRefreshSocial,
                            onCreateFamilyInvite = onCreateFamilyInvite,
                            onAcceptFamilyInvite = onAcceptFamilyInvite,
                            onRevokeFamilyInvite = onRevokeFamilyInvite,
                            onOpenBilling = { onSelectTab(NativeTab.Billing) },
                        )
                    }
                }
            }

            NativeTab.Messages -> {
                item {
                    ScreenHeader(
                        title = "음성 메시지",
                        subtitle = "커플/가족 플랜에서 연결된 사람에게 메시지를 보내고 받은 메시지를 확인해요.",
                    )
                }
                if (authSession == null) {
                    item {
                        AccountPanel(
                            authSession = authSession,
                            authBusy = authBusy,
                            syncBusy = syncBusy,
                            voiceProfiles = voiceProfiles,
                            voiceProfileBusy = voiceProfileBusy,
                            onLogin = onLogin,
                            onRegister = onRegister,
                            onGoogleSignIn = onGoogleSignIn,
                            onSyncNow = onSyncNow,
                            onLogout = onLogout,
                        )
                    }
                } else {
                    item {
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
            }

            NativeTab.Growth -> {
                item {
                    ScreenHeader(
                        title = "캐릭터",
                        subtitle = "알람을 끄고 다시 울릴 때마다 캐릭터가 자라요.",
                    )
                }
                if (authSession == null) {
                    item {
                        AccountPanel(
                            authSession = authSession,
                            authBusy = authBusy,
                            syncBusy = syncBusy,
                            voiceProfiles = voiceProfiles,
                            voiceProfileBusy = voiceProfileBusy,
                            onLogin = onLogin,
                            onRegister = onRegister,
                            onGoogleSignIn = onGoogleSignIn,
                            onSyncNow = onSyncNow,
                            onLogout = onLogout,
                        )
                    }
                } else {
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
            }

            NativeTab.Billing -> {
                item {
                    ScreenHeader(
                        title = "구독/이용권",
                        subtitle = "플랜을 확인하고 이용권 코드를 등록해요.",
                    )
                }
                if (authSession == null) {
                    item {
                        AccountPanel(
                            authSession = authSession,
                            authBusy = authBusy,
                            syncBusy = syncBusy,
                            voiceProfiles = voiceProfiles,
                            voiceProfileBusy = voiceProfileBusy,
                            onLogin = onLogin,
                            onRegister = onRegister,
                            onGoogleSignIn = onGoogleSignIn,
                            onSyncNow = onSyncNow,
                            onLogout = onLogout,
                        )
                    }
                } else {
                    item {
                        SubscriptionPanel(
                            billingBusy = billingBusy,
                            subscriptionResponse = subscriptionResponse,
                            vouchers = vouchers,
                            onRefresh = onRefreshCharacterBilling,
                            onRegisterCode = onRegisterCode,
                            onCheckoutPlan = onCheckoutPlan,
                        )
                    }
                }
            }
        }
    }
}
