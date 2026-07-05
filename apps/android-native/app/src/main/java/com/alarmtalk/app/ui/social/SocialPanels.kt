package com.alarmtalk.app

import android.content.Intent
import android.media.MediaPlayer
import android.net.Uri
import android.util.Base64
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.alarmtalk.app.R
import com.alarmtalk.app.WakerChipShape
import com.alarmtalk.app.WakerPanelShape
import com.alarmtalk.app.WakerTileShape
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.network.apiErrorCode
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.FamilyGroupCurrentResponse
import com.alarmtalk.app.network.FamilyGroupMember
import com.alarmtalk.app.network.FamilyVoiceProfile
import com.alarmtalk.app.network.NoteAudioResponse
import com.alarmtalk.app.network.ReceivedNote
import com.alarmtalk.app.network.VoiceProfile
import com.alarmtalk.app.network.VoucherItem
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal fun FamilyConnectionPanel(
    socialBusy: Boolean,
    billingBusy: Boolean,
    familyGroup: FamilyGroupCurrentResponse?,
    subscriptionResponse: BillingSubscriptionResponse?,
    vouchers: List<VoucherItem>,
    onLeaveFamilyGroup: (String) -> Unit,
    onRegisterCode: (String) -> Unit,
    onEnsureFamilyShareCode: () -> Unit,
) {
    val currentGroup = familyGroup?.group
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val activePlanKey = subscriptionResponse?.plan?.key
    val sharedPlanLabel = when (activePlanKey) {
        "couple" -> stringResource(R.string.social_plan_label_couple)
        "family" -> stringResource(R.string.social_plan_label_family)
        else -> stringResource(R.string.social_plan_label_shared)
    }
    val familyShareCodes = remember(vouchers, activePlanKey) {
        vouchers.filter { voucher ->
            voucher.code.startsWith("INV-") &&
                voucher.planType == "family" &&
                (activePlanKey == null || voucher.planKey == activePlanKey) &&
                voucher.status !in listOf("expired", "revoked", "cancelled")
        }
    }
    val canManageShareCode = currentGroup != null &&
        familyGroup?.role == "owner" &&
        subscriptionResponse?.plan?.planType == "family"

    val activePlanName = subscriptionResponse?.plan?.takeIf { subscriptionResponse.subscription != null }?.name
    val hasActivePlan = activePlanName != null
    var showCodeInputs by remember(hasActivePlan) { mutableStateOf(!hasActivePlan) }
    var pendingRegisterCode by remember { mutableStateOf<String?>(null) }
    var showLeaveDialog by remember { mutableStateOf(false) }

    fun shareCode(code: String) {
        clipboard.setText(AnnotatedString(code))
        val sendIntent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, code)
        }
        context.startActivity(Intent.createChooser(sendIntent, context.getString(R.string.social_share_code_chooser_title)))
    }

    OutlinedCard {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            val isSharedMember = currentGroup != null && familyGroup?.role == "member"

            if (canManageShareCode) {
                MutedText(stringResource(R.string.social_managing_shared_plan))
                return@Column
            }

            if (hasActivePlan && !showCodeInputs) {
                MutedText(stringResource(R.string.social_active_plan_in_use, activePlanName))
                if (isSharedMember) {
                    OutlinedButton(
                        onClick = { showLeaveDialog = true },
                        enabled = !socialBusy,
                        modifier = Modifier.fillMaxWidth(),
                        shape = WakerChipShape,
                    ) {
                        Text(
                            text = stringResource(R.string.social_leave_and_register_new_code),
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                } else {
                    OutlinedButton(
                        onClick = { showCodeInputs = true },
                        enabled = !socialBusy,
                        modifier = Modifier.fillMaxWidth(),
                        shape = WakerChipShape,
                    ) {
                        Text(stringResource(R.string.social_register_other_code))
                    }
                }
            } else {
                if (hasActivePlan) {
                    MutedText(stringResource(R.string.social_register_will_change_plan, activePlanName))
                }
                // 통합 입력: 초대·이용권 선물·프로모션 코드를 한 필드로 받고 서버가 판별한다.
                Text(stringResource(R.string.social_code_input_label), fontWeight = FontWeight.SemiBold)
                MutedText(stringResource(R.string.social_code_input_hint))
                CodeRedeemField(
                    busy = socialBusy || billingBusy,
                    onSubmit = { pendingRegisterCode = it },
                )
            }
        }
    }

    if (showLeaveDialog && currentGroup != null) {
        AlertDialog(
            onDismissRequest = { showLeaveDialog = false },
            title = {
                ModalDialogTitle(
                    title = stringResource(R.string.social_leave_dialog_title),
                    onDismiss = { showLeaveDialog = false },
                )
            },
            text = {
                MutedText(stringResource(R.string.social_leave_dialog_message))
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showLeaveDialog = false
                        showCodeInputs = true
                        onLeaveFamilyGroup(currentGroup.id)
                    },
                ) {
                    Text(
                        text = stringResource(R.string.social_leave_and_register_button),
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            },
        )
    }

    pendingRegisterCode?.let { code ->
        AlertDialog(
            onDismissRequest = { pendingRegisterCode = null },
            title = {
                ModalDialogTitle(
                    title = stringResource(R.string.social_register_dialog_title),
                    onDismiss = { pendingRegisterCode = null },
                )
            },
            text = {
                MutedText(
                    if (hasActivePlan) {
                        stringResource(R.string.social_register_dialog_message_active, activePlanName)
                    } else {
                        stringResource(R.string.social_register_dialog_message)
                    },
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        onRegisterCode(code)
                        pendingRegisterCode = null
                    },
                ) {
                    Text(stringResource(R.string.social_register_button))
                }
            },
        )
    }

}

@Composable
internal fun VoiceMessagePanel(
    authSession: AuthSession,
    noteBusy: Boolean,
    familyGroup: FamilyGroupCurrentResponse?,
    subscriptionResponse: BillingSubscriptionResponse?,
    voiceProfiles: List<VoiceProfile>,
    familyVoices: List<FamilyVoiceProfile>,
    voiceProfileBusy: Boolean,
    receivedNotes: List<ReceivedNote>,
    onRefresh: () -> Unit,
    onSendNote: (String, String) -> Unit,
    onSendTtsNote: (String, String, String) -> Unit,
    onDownloadNoteAudio: suspend (String) -> NoteAudioResponse,
    onMarkNoteRead: (String) -> Unit,
    onOpenFamily: () -> Unit,
    onOpenBilling: () -> Unit,
) {
    val context = LocalContext.current
    val isAvailable = hasCoupleOrFamilyAccess(subscriptionResponse, familyGroup)
    val recipients = remember(familyGroup, authSession.user.id, authSession.user.email) {
        familyGroup?.members.orEmpty().filterNot { member ->
            member.userId == authSession.user.id || member.email == authSession.user.email
        }
    }
    var selectedRecipientId by remember(recipients) { mutableStateOf(recipients.firstOrNull()?.userId) }
    var text by remember { mutableStateOf("") }
    val voiceOptions = remember(voiceProfiles, familyVoices, context) {
        val readyProfiles = voiceProfiles
            .filter { it.status == null || it.status == "ready" }
            .map { it.id to it.name }
        val readyFamilyVoices = familyVoices
            .filter { (it.status == null || it.status == "ready") && it.isShared != false }
            .map { it.id to sharedNoteVoiceLabel(context, it) }
        readyProfiles + readyFamilyVoices
    }
    var sendMode by remember { mutableStateOf(VoiceMessageSendMode.Text) }
    var selectedVoiceProfileId by remember(voiceOptions) { mutableStateOf(voiceOptions.firstOrNull()?.first) }
    val maxTextLength = if (sendMode == VoiceMessageSendMode.Tts) 200 else 500
    val scope = rememberCoroutineScope()
    var notePlayer by remember { mutableStateOf<MediaPlayer?>(null) }
    var playingNoteId by remember { mutableStateOf<String?>(null) }
    var loadingNoteId by remember { mutableStateOf<String?>(null) }
    var unavailableAudioNoteIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    var showComposer by remember { mutableStateOf(false) }

    LaunchedEffect(receivedNotes) {
        unavailableAudioNoteIds = unavailableAudioNoteIds.filter { noteId ->
            receivedNotes.any { note ->
                note.id == noteId &&
                    note.audioUrl != null &&
                    note.audioAvailable == false
            }
        }.toSet()
    }

    LaunchedEffect(sendMode, maxTextLength) {
        if (text.length > maxTextLength) text = text.take(maxTextLength)
    }

    LaunchedEffect(sendMode, voiceOptions) {
        if (sendMode == VoiceMessageSendMode.Tts && selectedVoiceProfileId.isNullOrBlank()) {
            selectedVoiceProfileId = voiceOptions.firstOrNull()?.first
        }
    }

    fun stopNoteAudio() {
        notePlayer?.release()
        notePlayer = null
        playingNoteId = null
    }

    suspend fun cachedNoteAudioFile(response: NoteAudioResponse): File = withContext(Dispatchers.IO) {
        val extension = when (response.audioFormat.lowercase()) {
            "wav" -> "wav"
            "m4a", "aac", "mp4" -> "m4a"
            else -> "mp3"
        }
        val dir = File(context.cacheDir, "note-audio").apply { mkdirs() }
        File(dir, "${response.noteId}.$extension").also { file ->
            file.writeBytes(Base64.decode(response.audioBase64, Base64.DEFAULT))
        }
    }

    fun startNotePlayer(noteId: String, player: MediaPlayer) {
        stopNoteAudio()
        notePlayer = player.apply {
            setOnCompletionListener {
                it.release()
                if (notePlayer === it) notePlayer = null
                if (playingNoteId == noteId) playingNoteId = null
            }
            start()
        }
        playingNoteId = noteId
        onMarkNoteRead(noteId)
    }

    fun playNoteAudio(note: ReceivedNote) {
        if (playingNoteId == note.id) {
            stopNoteAudio()
            return
        }
        scope.launch {
            loadingNoteId = note.id
            runCatching {
                val directUrl = note.audioUrl?.takeIf {
                    it.startsWith("https://", ignoreCase = true) ||
                        it.startsWith("file:", ignoreCase = true) ||
                        it.startsWith("content:", ignoreCase = true)
                }
                if (directUrl != null) {
                    MediaPlayer.create(context, Uri.parse(directUrl))
                        ?: error("Unable to open note audio.")
                } else {
                    val file = cachedNoteAudioFile(onDownloadNoteAudio(note.id))
                    MediaPlayer().apply {
                        setDataSource(file.absolutePath)
                        prepare()
                    }
                }
            }.onSuccess { player ->
                startNotePlayer(note.id, player)
            }.onFailure { error ->
                if (apiErrorCode(error) in setOf("NOTE_AUDIO_MISSING", "NOTE_AUDIO_NOT_FOUND")) {
                    unavailableAudioNoteIds = unavailableAudioNoteIds + note.id
                }
            }
            loadingNoteId = null
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            stopNoteAudio()
        }
    }

    if (!isAvailable) {
        OutlinedCard {
            Column(
                modifier = Modifier.padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                MutedText(stringResource(R.string.social_message_requires_plan))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = onOpenFamily,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text(stringResource(R.string.social_connect_button))
                    }
                    Button(
                        onClick = onOpenBilling,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text(stringResource(R.string.social_view_plan_button))
                    }
                }
            }
        }
    } else {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = stringResource(R.string.social_received_messages_title),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    IconButton(onClick = onRefresh, enabled = !noteBusy) {
                        Icon(Icons.Outlined.Refresh, contentDescription = stringResource(R.string.social_refresh_cd))
                    }
                    Button(
                        onClick = { showComposer = true },
                        enabled = recipients.isNotEmpty() && !noteBusy,
                        shape = WakerTileShape,
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.Add,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(Modifier.size(6.dp))
                        Text(stringResource(R.string.social_compose_button))
                    }
                }
            }
            if (recipients.isEmpty()) {
                MutedText(stringResource(R.string.social_no_connected_partner))
            }
            if (receivedNotes.isEmpty()) {
                MutedText(stringResource(R.string.social_no_received_messages))
            } else {
                receivedNotes.take(8).forEach { note ->
                    NoteRow(
                        note = note,
                        isPlaying = playingNoteId == note.id,
                        isLoading = loadingNoteId == note.id,
                        hasAudio = note.audioUrl != null &&
                            note.audioAvailable != false &&
                            note.id !in unavailableAudioNoteIds,
                        onMarkRead = { onMarkNoteRead(note.id) },
                        onPlayClick = { playNoteAudio(note) },
                    )
                }
            }
        }
    }

    if (showComposer) {
        val composerScrollState = rememberScrollState()
        val canSend = selectedRecipientId != null &&
            text.isNotBlank() &&
            !noteBusy &&
            (sendMode == VoiceMessageSendMode.Text || !selectedVoiceProfileId.isNullOrBlank())
        fun sendComposerMessage() {
            val recipientId = selectedRecipientId ?: return
            if (sendMode == VoiceMessageSendMode.Tts) {
                selectedVoiceProfileId?.let { profileId ->
                    onSendTtsNote(recipientId, text, profileId)
                }
            } else {
                onSendNote(recipientId, text)
            }
            text = ""
            showComposer = false
        }

        Dialog(
            onDismissRequest = { showComposer = false },
            properties = DialogProperties(usePlatformDefaultWidth = false),
        ) {
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
                    .widthIn(max = 520.dp),
                shape = WakerDialogShape,
                color = MaterialTheme.colorScheme.surface,
                tonalElevation = 0.dp,
                shadowElevation = 18.dp,
                border = wakerCardBorder(),
            ) {
                Column(
                    modifier = Modifier.padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    ModalDialogTitle(
                        title = stringResource(R.string.social_new_message_title),
                        onDismiss = { showComposer = false },
                    )
                    Column(
                        modifier = Modifier
                            .heightIn(max = 520.dp)
                            .verticalScroll(composerScrollState),
                        verticalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        ComposerSection(title = stringResource(R.string.social_composer_recipient)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                recipients.take(3).forEach { member ->
                                    val selected = selectedRecipientId == member.userId
                                    FilterChip(
                                        selected = selected,
                                        onClick = { selectedRecipientId = member.userId },
                                        colors = FilterChipDefaults.filterChipColors(
                                            selectedContainerColor = MaterialTheme.colorScheme.secondaryContainer,
                                            selectedLabelColor = MaterialTheme.colorScheme.onSecondaryContainer,
                                        ),
                                        label = {
                                            Text(
                                                text = member.name ?: member.email ?: stringResource(R.string.social_member_fallback),
                                                maxLines = 1,
                                            )
                                        },
                                    )
                                }
                            }
                        }
                        ComposerSection(title = stringResource(R.string.social_composer_send_method)) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                FilterChip(
                                    selected = sendMode == VoiceMessageSendMode.Text,
                                    onClick = { sendMode = VoiceMessageSendMode.Text },
                                    colors = FilterChipDefaults.filterChipColors(
                                        selectedContainerColor = MaterialTheme.colorScheme.secondaryContainer,
                                        selectedLabelColor = MaterialTheme.colorScheme.onSecondaryContainer,
                                    ),
                                    label = { Text(stringResource(R.string.social_send_mode_text)) },
                                )
                                FilterChip(
                                    selected = sendMode == VoiceMessageSendMode.Tts,
                                    onClick = { sendMode = VoiceMessageSendMode.Tts },
                                    colors = FilterChipDefaults.filterChipColors(
                                        selectedContainerColor = MaterialTheme.colorScheme.secondaryContainer,
                                        selectedLabelColor = MaterialTheme.colorScheme.onSecondaryContainer,
                                    ),
                                    label = { Text(stringResource(R.string.social_send_mode_voice)) },
                                )
                            }
                        }
                        if (sendMode == VoiceMessageSendMode.Tts) {
                            ComposerSection(title = stringResource(R.string.social_composer_voice)) {
                                when {
                                    voiceProfileBusy -> MutedText(stringResource(R.string.social_loading_voices))
                                    voiceOptions.isEmpty() -> MutedText(stringResource(R.string.social_no_available_voices))
                                    else -> ChipGrid(
                                        options = voiceOptions,
                                        selected = selectedVoiceProfileId.orEmpty(),
                                        onSelect = { selectedVoiceProfileId = it },
                                        selectedContainerColor = MaterialTheme.colorScheme.secondaryContainer,
                                        selectedLabelColor = MaterialTheme.colorScheme.onSecondaryContainer,
                                    )
                                }
                            }
                        }
                        ComposerSection(title = stringResource(R.string.social_composer_message)) {
                            OutlinedTextField(
                                value = text,
                                onValueChange = { text = it.take(maxTextLength) },
                                placeholder = { Text(stringResource(R.string.social_message_placeholder)) },
                                minLines = 4,
                                maxLines = 6,
                                shape = WakerInputShape,
                                colors = wakerOutlinedTextFieldColors(),
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Text(
                                text = "${text.length}/$maxTextLength",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.align(Alignment.End),
                            )
                        }
                    }
                    Button(
                        onClick = ::sendComposerMessage,
                        enabled = canSend,
                        modifier = Modifier.fillMaxWidth(),
                        shape = WakerButtonShape,
                    ) {
                        Text(if (noteBusy) stringResource(R.string.social_sending) else stringResource(R.string.social_send_button))
                    }
                }
            }
        }
    }
}

@Composable
private fun ComposerSection(
    title: String,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = WakerPanelShape,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.34f),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface,
            )
            content()
        }
    }
}

@Composable
internal fun NoteRow(
    note: ReceivedNote,
    isPlaying: Boolean,
    isLoading: Boolean,
    hasAudio: Boolean,
    onMarkRead: () -> Unit,
    onPlayClick: () -> Unit,
) {
    val unread = note.readAt == null
    Card(
        onClick = onMarkRead,
        shape = WakerChipShape,
        colors = CardDefaults.cardColors(
            containerColor = if (unread) {
                MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.62f)
            } else {
                MaterialTheme.colorScheme.surface
            },
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = note.senderName ?: note.senderEmail ?: stringResource(R.string.social_sender_fallback),
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold,
                )
                if (unread) {
                    Surface(
                        modifier = Modifier.size(9.dp),
                        color = MaterialTheme.colorScheme.secondary,
                        shape = CircleShape,
                    ) {}
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(
                        text = note.text,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    formatNoteCreatedAt(note.createdAt)?.let { MutedText(it) }
                }
                if (hasAudio) {
                    IconButton(
                        onClick = onPlayClick,
                        enabled = !isLoading,
                        modifier = Modifier
                            .size(48.dp)
                            .background(
                                color = if (isPlaying) {
                                    MaterialTheme.colorScheme.secondary
                                } else {
                                    MaterialTheme.colorScheme.secondaryContainer
                                },
                                shape = CircleShape,
                            ),
                    ) {
                        if (isLoading) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                strokeWidth = 2.dp,
                                color = MaterialTheme.colorScheme.onSecondaryContainer,
                            )
                        } else {
                            Icon(
                                imageVector = if (isPlaying) Icons.Outlined.Stop else Icons.Outlined.PlayArrow,
                                contentDescription = if (isPlaying) stringResource(R.string.social_stop_cd) else stringResource(R.string.social_play_cd),
                                tint = if (isPlaying) {
                                    MaterialTheme.colorScheme.onSecondary
                                } else {
                                    MaterialTheme.colorScheme.onSecondaryContainer
                                },
                                modifier = Modifier.size(24.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

private enum class VoiceMessageSendMode {
    Text,
    Tts,
}

private fun sharedNoteVoiceLabel(context: android.content.Context, profile: FamilyVoiceProfile): String {
    val owner = profile.ownerName?.takeIf { it.isNotBlank() }
    return if (owner == null) {
        context.getString(R.string.misc2_shared_voice_label, profile.name)
    } else {
        "${profile.name} · $owner"
    }
}
