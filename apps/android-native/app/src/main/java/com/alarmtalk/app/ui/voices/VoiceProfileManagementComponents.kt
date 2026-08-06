package com.alarmtalk.app

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.alarmtalk.app.R
import com.alarmtalk.app.WakerPanelShape
import com.alarmtalk.app.WakerPillShape

// VoiceProfileManagementPanel 에서 분리한 하위 컴포넌트/다이얼로그.
// 동작/디자인 변경 없음 — top-level private→internal 가시성만 조정.

@Composable
internal fun VoiceProgressMessage(text: String) {
    Surface(
        shape = WakerPillShape,
        color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.58f),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CircularProgressIndicator(
                modifier = Modifier.size(14.dp),
                strokeWidth = 2.dp,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
            Text(
                text = text,
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
        }
    }
}

/**
 * 등록이 끝난 목소리의 '이름 수정' 다이얼로그.
 *
 * 이름만 받는다. 관계·호칭 입력도 예전에는 여기 있었지만 실제로 저장된 적이 없다 — 클라가
 * 요청에 싣지 않았고, 서버도 등록 완료 후엔 페르소나 변경을 409(VOICE_PERSONA_LOCKED)로
 * 거부하며, 알람 클립은 등록 시점에 이미 전부 렌더돼 있다. 입력이 조용히 사라지는 필드였다.
 * 등록 플로우의 관계·호칭 입력은 그대로다(그때는 실제로 반영된다).
 */
@Composable
internal fun VoiceProfileEditDialog(
    title: String,
    description: String,
    name: String,
    nameError: Boolean,
    onNameChange: (String) -> Unit,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    // 공용 알럿으로 통일한다. 예전에는 이것만을 위한 `VoiceFormDialog` 껍데기가 따로 있었는데,
    // 입력 하나짜리 모달이라 알럿과 다를 이유가 없어 껍데기를 걷어냈다.
    IosAlertDialog(
        title = title,
        message = description,
        onDismiss = onDismiss,
        actions = listOf(
            IosAlertAction(
                label = stringResource(R.string.voicesr_close),
                onClick = onDismiss,
            ),
            IosAlertAction(
                label = stringResource(R.string.voicesr_save),
                emphasized = true,
                // **여기서 비었는지 보고 삼키면 안 된다.** 빈 이름 검증은 부모가 하고,
                // 그 오류 문구를 켜는 '제출 시도' 플래그도 부모의 onConfirm 이 세운다 —
                // 여기서 막으면 플래그가 안 켜져 오류가 영영 안 뜨고, 저장 버튼은 멀쩡해
                // 보이는데 눌러도 아무 일이 없다(Codex #671 P2).
                onClick = onConfirm,
            ),
        ),
    ) {
        IosAlertField(
            value = name,
            onValueChange = onNameChange,
            placeholder = stringResource(R.string.voicesr_voice_name_label),
        )
        if (nameError) {
            Text(
                text = stringResource(R.string.voicesr_required_field),
                color = MaterialTheme.colorScheme.error,
                textAlign = TextAlign.Center,
                style = IosAlertType.Message,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 6.dp),
            )
        }
    }
}

@Composable
internal fun VoiceProfileDeleteDialog(
    profileName: String,
    onDismiss: () -> Unit,
    onDelete: () -> Unit,
) {
    // 확인형 모달은 전부 공용 알럿으로 — 되돌릴 수 없는 삭제는 destructive 로 붉게 둔다.
    // 두 문장(무엇을 지우는지 + 무엇이 함께 바뀌는지)을 한 본문으로 잇는다.
    IosAlertDialog(
        title = stringResource(R.string.voicesr_delete_dialog_title),
        message = stringResource(R.string.voicesr_delete_dialog_confirm, profileName) +
            "\n" + stringResource(R.string.voicesr_delete_dialog_warning),
        onDismiss = onDismiss,
        actions = listOf(
            IosAlertAction(
                label = stringResource(R.string.voicesr_close),
                onClick = onDismiss,
            ),
            IosAlertAction(
                label = stringResource(R.string.voicesr_delete),
                destructive = true,
                onClick = onDelete,
            ),
        ),
    )
}



/**
 * 목소리 등록 직전 확인·동의 블록. '세부 정보' 단계 맨 아래, **등록 버튼 바로 위**에 둔다.
 *
 * 왜 여기인가: 다음 버튼(등록)이 draft 를 만들고, draft 생성이 곧 실제 ElevenLabs 클론
 * 생성이다. 마지막 '저장하기'(승격) 앞에 두면 이미 목소리를 만들어 놓고 사후 동의를 받는
 * 꼴이라 동의의 의미가 없다.
 *
 * ⚠ **권리 보증은 체크박스로 받지 않는다 — 약관 제7조가 담당한다.**
 * 「본인의 목소리 또는 적법한 권한과 명시적 동의를 받은 사람의 목소리만 등록할 수 있습니다」
 * 「권한 없는 음성 등록으로 발생하는 책임은 해당 이용자가 부담합니다」가 이미 약관에 있고,
 * 약관은 가입 필수 동의라 이미 받았다. 등록마다 다시 체크받는 것은 계약상 중복이었다.
 * 여기서는 **업로드 시점 고지**만 비차단 안내로 남긴다.
 * 되돌리려면 약관 제7조를 먼저 확인할 것 — 그 조항이 사라졌다면 체크박스가 다시 필요하다.
 *
 * [showBiometricConsent] 는 가입 화면에서 음성 생체정보(선택)를 거절한 사람에게만 뜨는
 * 법정 동의다. 한 번 체크하면 서버에 기록돼 다음 등록부터는 아예 그리지 않는다.
 */
@Composable
internal fun VoiceRegistrationAttestation(
    showBiometricConsent: Boolean,
    biometricAgreed: Boolean,
    onBiometricAgreedChange: (Boolean) -> Unit,
) {
    Surface(
        shape = WakerPanelShape,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 4.dp),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                text = stringResource(R.string.voices_register_attest_notice),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (showBiometricConsent) {
                VoiceRegistrationCheck(
                    checked = biometricAgreed,
                    onCheckedChange = onBiometricAgreedChange,
                    label = stringResource(R.string.voices_register_biometric_consent),
                    description = stringResource(R.string.voices_register_biometric_desc),
                )
            }
        }
    }
}

@Composable
private fun VoiceRegistrationCheck(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    label: String,
    description: String? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onCheckedChange(!checked) },
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Checkbox(checked = checked, onCheckedChange = onCheckedChange)
        Column(modifier = Modifier.padding(top = 12.dp)) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            if (description != null) {
                Text(
                    text = description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
        }
    }
}
