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
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
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
    var inviteCode by remember { mutableStateOf("") }
    var voucherCode by remember { mutableStateOf("") }
    val currentGroup = familyGroup?.group
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val activePlanKey = subscriptionResponse?.plan?.key
    val sharedPlanLabel = when (activePlanKey) {
        "couple" -> "커플"
        "family" -> "가족"
        else -> "공유"
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
        context.startActivity(Intent.createChooser(sendIntent, "코드 공유"))
    }

    OutlinedCard {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            val isSharedMember = currentGroup != null && familyGroup?.role == "member"

            if (canManageShareCode) {
                MutedText("공유 이용권을 관리 중이에요.")
                return@Column
            }

            if (hasActivePlan && !showCodeInputs) {
                MutedText("$activePlanName 이용권 사용 중이에요. 등록은 이용권이 종료된 다음 가능해요.")
                if (isSharedMember) {
                    OutlinedButton(
                        onClick = { showLeaveDialog = true },
                        enabled = !socialBusy,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(14.dp),
                    ) {
                        Text(
                            text = "현재 이용권 나가고 새 코드 등록하기",
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                } else {
                    OutlinedButton(
                        onClick = { showCodeInputs = true },
                        enabled = !socialBusy,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(14.dp),
                    ) {
                        Text("다른 코드 등록하기")
                    }
                }
            } else {
                if (hasActivePlan) {
                    MutedText("등록하면 현재 $activePlanName 이용권이 변경돼요.")
                }
                Text("초대 코드", fontWeight = FontWeight.SemiBold)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    OutlinedTextField(
                        value = inviteCode,
                        onValueChange = { value ->
                            inviteCode = value
                                .uppercase()
                                .filter { it.isLetterOrDigit() || it == '-' }
                                .take(18)
                        },
                        placeholder = { Text("INV-XXXX-XXXX-XXXX") },
                        singleLine = true,
                        shape = WakerInputShape,
                        colors = wakerOutlinedTextFieldColors(),
                        modifier = Modifier.weight(1f),
                    )
                    Button(
                        onClick = { pendingRegisterCode = inviteCode },
                        enabled = inviteCode.isNotBlank() && !socialBusy,
                    ) {
                        Text("참여")
                    }
                }

                Text("이용권 코드", fontWeight = FontWeight.SemiBold)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    OutlinedTextField(
                        value = voucherCode,
                        onValueChange = { value ->
                            voucherCode = value
                                .uppercase()
                                .filter { it.isLetterOrDigit() || it == '-' }
                                .take(19)
                        },
                        placeholder = { Text("GIFT-XXXX-XXXX-XXXX") },
                        singleLine = true,
                        shape = WakerInputShape,
                        colors = wakerOutlinedTextFieldColors(),
                        modifier = Modifier.weight(1f),
                    )
                    Button(
                        onClick = { pendingRegisterCode = voucherCode },
                        enabled = voucherCode.isNotBlank() && !socialBusy,
                    ) {
                        Text("등록")
                    }
                }
            }
        }
    }

    if (showLeaveDialog && currentGroup != null) {
        AlertDialog(
            onDismissRequest = { showLeaveDialog = false },
            title = {
                ModalDialogTitle(
                    title = "현재 이용권 나가고 새 코드 등록",
                    onDismiss = { showLeaveDialog = false },
                )
            },
            text = {
                MutedText("현재 이용권에서 나가고 새 코드를 등록할까요?")
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
                        text = "나가고 등록하기",
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
                    title = "코드 등록",
                    onDismiss = { pendingRegisterCode = null },
                )
            },
            text = {
                MutedText(
                    if (hasActivePlan) {
                        "등록 가능한 코드라면 현재 $activePlanName 이용권은 종료되고 새 이용권으로 바뀌어요. 등록할까요?"
                    } else {
                        "이 코드를 등록할까요?"
                    },
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        onRegisterCode(code)
                        inviteCode = ""
                        voucherCode = ""
                        pendingRegisterCode = null
                    },
                ) {
                    Text("등록")
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
    val voiceOptions = remember(voiceProfiles, familyVoices) {
        val readyProfiles = voiceProfiles
            .filter { it.status == null || it.status == "ready" }
            .map { it.id to it.name }
        val readyFamilyVoices = familyVoices
            .filter { (it.status == null || it.status == "ready") && it.isShared != false }
            .map { it.id to sharedNoteVoiceLabel(it) }
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
                MutedText("메시지는 커플/가족 이용권에서 사용할 수 있어요.")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = onOpenFamily,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text("연결하기")
                    }
                    Button(
                        onClick = onOpenBilling,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text("이용권 보기")
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
                    text = "받은 메시지",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    IconButton(onClick = onRefresh, enabled = !noteBusy) {
                        Icon(Icons.Outlined.Refresh, contentDescription = "새로고침")
                    }
                    Button(
                        onClick = { showComposer = true },
                        enabled = recipients.isNotEmpty() && !noteBusy,
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.Add,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(Modifier.size(6.dp))
                        Text("작성")
                    }
                }
            }
            if (recipients.isEmpty()) {
                MutedText("연결된 상대가 없어요.")
            }
            if (receivedNotes.isEmpty()) {
                MutedText("받은 메시지가 없어요.")
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
                shape = WakerCardShape,
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
                        title = "새 메시지",
                        onDismiss = { showComposer = false },
                    )
                    Column(
                        modifier = Modifier
                            .heightIn(max = 520.dp)
                            .verticalScroll(composerScrollState),
                        verticalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        ComposerSection(title = "받는 사람") {
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
                                                text = member.name ?: member.email ?: "멤버",
                                                maxLines = 1,
                                            )
                                        },
                                    )
                                }
                            }
                        }
                        ComposerSection(title = "보내기 방식") {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                FilterChip(
                                    selected = sendMode == VoiceMessageSendMode.Text,
                                    onClick = { sendMode = VoiceMessageSendMode.Text },
                                    colors = FilterChipDefaults.filterChipColors(
                                        selectedContainerColor = MaterialTheme.colorScheme.secondaryContainer,
                                        selectedLabelColor = MaterialTheme.colorScheme.onSecondaryContainer,
                                    ),
                                    label = { Text("텍스트") },
                                )
                                FilterChip(
                                    selected = sendMode == VoiceMessageSendMode.Tts,
                                    onClick = { sendMode = VoiceMessageSendMode.Tts },
                                    colors = FilterChipDefaults.filterChipColors(
                                        selectedContainerColor = MaterialTheme.colorScheme.secondaryContainer,
                                        selectedLabelColor = MaterialTheme.colorScheme.onSecondaryContainer,
                                    ),
                                    label = { Text("음성 메시지") },
                                )
                            }
                        }
                        if (sendMode == VoiceMessageSendMode.Tts) {
                            ComposerSection(title = "보낼 목소리") {
                                when {
                                    voiceProfileBusy -> MutedText("목소리를 불러오는 중이에요.")
                                    voiceOptions.isEmpty() -> MutedText("사용 가능한 목소리가 없어요.")
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
                        ComposerSection(title = "메시지") {
                            OutlinedTextField(
                                value = text,
                                onValueChange = { text = it.take(maxTextLength) },
                                placeholder = { Text("전하고 싶은 말을 입력하세요") },
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
                        Text(if (noteBusy) "보내는 중" else "보내기")
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
        shape = RoundedCornerShape(18.dp),
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
        shape = RoundedCornerShape(14.dp),
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
                    text = note.senderName ?: note.senderEmail ?: "보낸 사람",
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
                                contentDescription = if (isPlaying) "정지" else "재생",
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

private fun sharedNoteVoiceLabel(profile: FamilyVoiceProfile): String {
    val owner = profile.ownerName?.takeIf { it.isNotBlank() }
    return if (owner == null) {
        "${profile.name} · 공유"
    } else {
        "${profile.name} · $owner"
    }
}
