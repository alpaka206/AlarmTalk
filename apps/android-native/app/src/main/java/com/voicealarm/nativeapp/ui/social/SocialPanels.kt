package com.voicealarm.nativeapp

import android.content.Intent
import android.media.MediaPlayer
import android.net.Uri
import android.util.Base64
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
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
import com.voicealarm.nativeapp.network.AuthSession
import com.voicealarm.nativeapp.network.BillingSubscriptionResponse
import com.voicealarm.nativeapp.network.FamilyGroupCurrentResponse
import com.voicealarm.nativeapp.network.FamilyGroupMember
import com.voicealarm.nativeapp.network.FamilyVoiceProfile
import com.voicealarm.nativeapp.network.NoteAudioResponse
import com.voicealarm.nativeapp.network.ReceivedNote
import com.voicealarm.nativeapp.network.VoiceProfile
import com.voicealarm.nativeapp.network.VoucherItem
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
                MutedText("공유 플랜을 관리 중이에요.")
                return@Column
            }

            if (hasActivePlan && !showCodeInputs) {
                MutedText("$activePlanName 플랜 사용중이라 등록은 플랜이 종료된 다음에 가능합니다.")
                if (isSharedMember) {
                    OutlinedButton(
                        onClick = { showLeaveDialog = true },
                        enabled = !socialBusy,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(14.dp),
                    ) {
                        Text(
                            text = "플랜에서 나가고 다른 코드 등록하기",
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
                    MutedText("등록하면 현재 $activePlanName 플랜이 변경돼요.")
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
            title = { Text("플랜에서 나가고 다른 코드 등록") },
            text = {
                MutedText("현재 플랜에서 나가고 새 코드를 등록할까요?")
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
            dismissButton = {
                TextButton(onClick = { showLeaveDialog = false }) {
                    Text("취소")
                }
            },
        )
    }

    pendingRegisterCode?.let { code ->
        AlertDialog(
            onDismissRequest = { pendingRegisterCode = null },
            title = { Text("코드 등록") },
            text = {
                MutedText(
                    if (hasActivePlan) {
                        "유효한 코드면 현재 $activePlanName 플랜은 해지되고 새 플랜으로 전환돼요. 등록하시겠어요?"
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
            dismissButton = {
                TextButton(onClick = { pendingRegisterCode = null }) {
                    Text("취소")
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
    var showComposer by remember { mutableStateOf(false) }

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
                    it.startsWith("http") || it.startsWith("file:") || it.startsWith("content:")
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
                MutedText("커플/가족 플랜에서 사용할 수 있어요.")
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
                        Text("플랜 보기")
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
                        onMarkRead = { onMarkNoteRead(note.id) },
                        onPlayClick = { playNoteAudio(note) },
                    )
                }
            }
        }
    }

    if (showComposer) {
        AlertDialog(
            onDismissRequest = { showComposer = false },
            title = { Text("새 메시지") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("받는 사람", fontWeight = FontWeight.SemiBold)
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
                    Text("보내기 방식", fontWeight = FontWeight.SemiBold)
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
                    if (sendMode == VoiceMessageSendMode.Tts) {
                        Text("음성", fontWeight = FontWeight.SemiBold)
                        when {
                            voiceProfileBusy -> MutedText("음성을 불러오는 중이에요.")
                            voiceOptions.isEmpty() -> MutedText("사용 가능한 음성이 없어요.")
                            else -> ChipGrid(
                                options = voiceOptions,
                                selected = selectedVoiceProfileId.orEmpty(),
                                onSelect = { selectedVoiceProfileId = it },
                                selectedContainerColor = MaterialTheme.colorScheme.secondaryContainer,
                                selectedLabelColor = MaterialTheme.colorScheme.onSecondaryContainer,
                            )
                        }
                    }
                    OutlinedTextField(
                        value = text,
                        onValueChange = { text = it.take(maxTextLength) },
                        label = { Text("메시지") },
                        placeholder = { Text("전하고 싶은 말을 입력하세요") },
                        minLines = 3,
                        maxLines = 5,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Text(
                        text = "${text.length}/$maxTextLength",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.align(Alignment.End),
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val recipientId = selectedRecipientId
                        if (recipientId != null) {
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
                    },
                    enabled = selectedRecipientId != null &&
                        text.isNotBlank() &&
                        !noteBusy &&
                        (sendMode == VoiceMessageSendMode.Text || !selectedVoiceProfileId.isNullOrBlank()),
                ) {
                    Text("보내기")
                }
            },
            dismissButton = {
                TextButton(onClick = { showComposer = false }) {
                    Text("취소")
                }
            },
        )
    }
}

@Composable
internal fun NoteRow(
    note: ReceivedNote,
    isPlaying: Boolean,
    isLoading: Boolean,
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
                        AssistChip(
                            onClick = onMarkRead,
                            label = { Text("새") },
                            colors = AssistChipDefaults.assistChipColors(
                                containerColor = MaterialTheme.colorScheme.secondary,
                                labelColor = MaterialTheme.colorScheme.onSecondary,
                            ),
                        )
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
                    note.createdAt?.let { MutedText(it.take(10)) }
                }
                if (note.audioUrl != null) {
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
