package com.voicealarm.nativeapp

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.voicealarm.nativeapp.network.AuthSession
import com.voicealarm.nativeapp.network.BillingSubscriptionResponse
import com.voicealarm.nativeapp.network.FamilyGroupCurrentResponse
import com.voicealarm.nativeapp.network.FamilyInvite
import com.voicealarm.nativeapp.network.FamilyVoiceProfile
import com.voicealarm.nativeapp.network.ReceivedNote

@Composable
internal fun FamilyConnectionPanel(
    socialBusy: Boolean,
    familyGroup: FamilyGroupCurrentResponse?,
    familyInvites: List<FamilyInvite>,
    familyVoices: List<FamilyVoiceProfile>,
    subscriptionResponse: BillingSubscriptionResponse?,
    onRefreshSocial: () -> Unit,
    onCreateFamilyInvite: () -> Unit,
    onAcceptFamilyInvite: (String) -> Unit,
    onRevokeFamilyInvite: (String) -> Unit,
    onOpenBilling: () -> Unit,
) {
    var inviteCode by remember { mutableStateOf("") }
    val group = familyGroup
    val isGroupReady = group?.group != null
    val plan = subscriptionResponse?.plan

    OutlinedCard {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            PanelHeader(
                title = "커플/가족",
                actionLabel = if (socialBusy) "불러오는 중" else "새로고침",
                enabled = !socialBusy,
                onAction = onRefreshSocial,
            )

            Text("현재 플랜", fontWeight = FontWeight.SemiBold)
            if (plan == null) {
                MutedText("무료 플랜 또는 활성 구독이 없어요.")
            } else {
                MutedText("${plan.name} - ${planTypeLabel(plan.planType)} - 최대 ${plan.maxMembers}명")
            }
            OutlinedButton(
                onClick = onOpenBilling,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("구독/이용권 관리")
            }

            Text("초대 코드 등록", fontWeight = FontWeight.SemiBold)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedTextField(
                    value = inviteCode,
                    onValueChange = { inviteCode = it },
                    label = { Text("초대 코드") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.weight(1f),
                )
                Button(
                    onClick = {
                        onAcceptFamilyInvite(inviteCode)
                        inviteCode = ""
                    },
                    enabled = inviteCode.isNotBlank() && !socialBusy,
                ) {
                    Text("참여")
                }
            }

            Text("연결된 멤버", fontWeight = FontWeight.SemiBold)
            if (!isGroupReady) {
                MutedText("아직 연결된 커플/가족 그룹이 없어요. 초대 코드를 등록하거나 구독 후 코드를 발급하세요.")
            } else {
                MutedText("${roleLabel(group.role)} - ${group.members.size}/${group.group.maxMembers}명")
                group.members.forEach { member ->
                    MutedText("${member.name ?: member.email ?: member.userId} (${roleLabel(member.role)})")
                }
            }

            OutlinedButton(
                onClick = onCreateFamilyInvite,
                enabled = !socialBusy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("초대 코드 만들기")
            }

            familyInvites.take(3).forEach { invite ->
                CompactActionRow(
                    title = invite.code,
                    subtitle = "${inviteStatusLabel(invite.status)} - 만료 ${invite.expiresAt ?: "알 수 없음"}",
                    actionLabel = "취소",
                    enabled = invite.status == "pending" && !socialBusy,
                    onAction = { onRevokeFamilyInvite(invite.code) },
                )
            }

            Text("공유 음성", fontWeight = FontWeight.SemiBold)
            if (familyVoices.isEmpty()) {
                MutedText("공유된 음성이 아직 없어요.")
            } else {
                familyVoices.forEach { voice ->
                    MutedText("${voice.name} - ${voice.ownerName ?: "가족"} (${voiceStatusLabel(voice.status)})")
                }
            }

            MutedText("커플/가족 연결 안에서 허용된 음성만 공유됩니다.")
        }
    }
}

@Composable
internal fun VoiceMessagePanel(
    authSession: AuthSession,
    noteBusy: Boolean,
    familyGroup: FamilyGroupCurrentResponse?,
    subscriptionResponse: BillingSubscriptionResponse?,
    receivedNotes: List<ReceivedNote>,
    onRefresh: () -> Unit,
    onSendNote: (String, String) -> Unit,
    onMarkNoteRead: (String) -> Unit,
    onOpenFamily: () -> Unit,
    onOpenBilling: () -> Unit,
) {
    val isAvailable = hasCoupleOrFamilyAccess(subscriptionResponse, familyGroup)
    val recipients = remember(familyGroup, authSession.user.id, authSession.user.email) {
        familyGroup?.members.orEmpty().filterNot { member ->
            member.userId == authSession.user.id || member.email == authSession.user.email
        }
    }
    var selectedRecipientId by remember(recipients) { mutableStateOf(recipients.firstOrNull()?.userId) }
    var text by remember { mutableStateOf("") }

    OutlinedCard {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            PanelHeader(
                title = "메시지",
                actionLabel = if (noteBusy) "불러오는 중" else "새로고침",
                enabled = !noteBusy,
                onAction = onRefresh,
            )

            if (!isAvailable) {
                MutedText("음성 메시지는 커플/가족 플랜에서만 사용할 수 있어요.")
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
                return@Column
            }

            Text("받는 사람", fontWeight = FontWeight.SemiBold)
            if (recipients.isEmpty()) {
                MutedText("같은 커플/가족 그룹에 보낼 사람이 없어요.")
                OutlinedButton(
                    onClick = onOpenFamily,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("초대 코드 관리")
                }
            } else {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    recipients.take(3).forEach { member ->
                        val selected = selectedRecipientId == member.userId
                        FilterChip(
                            selected = selected,
                            onClick = { selectedRecipientId = member.userId },
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

            OutlinedTextField(
                value = text,
                onValueChange = { text = it.take(500) },
                label = { Text("메시지") },
                placeholder = { Text("전하고 싶은 말을 입력하세요") },
                minLines = 3,
                maxLines = 5,
                modifier = Modifier.fillMaxWidth(),
            )
            Text(
                text = "${text.length}/500",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.align(Alignment.End),
            )
            Button(
                onClick = {
                    val recipientId = selectedRecipientId
                    if (recipientId != null) {
                        onSendNote(recipientId, text)
                        text = ""
                    }
                },
                enabled = selectedRecipientId != null && text.isNotBlank() && !noteBusy,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
            ) {
                Text("메시지 보내기")
            }
            MutedText("보낸 메시지는 상대의 메시지함에 표시돼요. 음성 파일이 첨부된 메시지는 목록에서 확인할 수 있어요.")

            HorizontalDivider()

            Text("받은 메시지", fontWeight = FontWeight.SemiBold)
            if (receivedNotes.isEmpty()) {
                MutedText("아직 받은 메시지가 없어요.")
            } else {
                receivedNotes.take(8).forEach { note ->
                    NoteRow(note = note, onClick = { onMarkNoteRead(note.id) })
                }
            }
        }
    }
}

@Composable
internal fun NoteRow(
    note: ReceivedNote,
    onClick: () -> Unit,
) {
    val unread = note.readAt == null
    Card(
        onClick = onClick,
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (unread) {
                MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.35f)
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
                        onClick = onClick,
                        label = { Text("새 메시지") },
                    )
                }
            }
            Text(
                text = note.text,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            val meta = buildList {
                if (note.audioUrl != null) add("음성 파일 있음")
                note.createdAt?.let { add(it.take(10)) }
            }.joinToString(" · ")
            if (meta.isNotBlank()) {
                MutedText(meta)
            }
        }
    }
}
