package com.alarmtalk.app

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog

/**
 * 목소리를 등록하려는 순간에 받는 음성 처리 동의.
 *
 * 가입 게이트에서 받지 않는 이유: 음성 생체정보(`voice_biometric`)와 국외 이전
 * (`overseas_transfer`)은 목소리를 등록하는 사람에게만 필요한 별도 동의다. 가입 필수로 묶으면
 * 목소리를 등록하지 않을 사용자에게까지 생체정보 처리 동의를 이용 조건으로 요구하게 된다.
 * 서버도 같은 지점(`voice-profile`·`tts` 라우트)에서만 강제한다.
 *
 * 문구·체크박스 구성은 `docs/legal/consent-and-permission-copy.ko.md` §2 를 따른다. 앞의 두
 * 체크는 이용자 확인(서버 동의 유형 없음), 뒤의 두 체크가 서버에 기록되는 동의다.
 */
@Composable
internal fun VoiceConsentSheet(
    busy: Boolean,
    onAgree: () -> Unit,
    onDismiss: () -> Unit,
) {
    var ownership by remember { mutableStateOf(false) }
    var liability by remember { mutableStateOf(false) }
    var biometric by remember { mutableStateOf(false) }
    var overseas by remember { mutableStateOf(false) }
    val allChecked = ownership && liability && biometric && overseas

    Dialog(onDismissRequest = { if (!busy) onDismiss() }) {
        Surface(
            shape = WakerDialogShape,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 2.dp,
        ) {
            Column(
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    text = stringResource(R.string.voice_consent_title),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Column(
                    modifier = Modifier
                        .heightIn(max = 320.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(
                        text = stringResource(R.string.voice_consent_body),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    VoiceConsentCheck(
                        checked = ownership,
                        onCheckedChange = { ownership = it },
                        label = stringResource(R.string.voice_consent_check_ownership),
                    )
                    VoiceConsentCheck(
                        checked = liability,
                        onCheckedChange = { liability = it },
                        label = stringResource(R.string.voice_consent_check_liability),
                    )
                    VoiceConsentCheck(
                        checked = biometric,
                        onCheckedChange = { biometric = it },
                        label = stringResource(R.string.voice_consent_check_biometric),
                    )
                    VoiceConsentCheck(
                        checked = overseas,
                        onCheckedChange = { overseas = it },
                        label = stringResource(R.string.voice_consent_check_overseas),
                    )
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                ) {
                    TextButton(onClick = onDismiss, enabled = !busy) {
                        Text(stringResource(R.string.voice_consent_cancel))
                    }
                    TextButton(onClick = onAgree, enabled = allChecked && !busy) {
                        Text(
                            text = stringResource(R.string.voice_consent_agree),
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun VoiceConsentCheck(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    label: String,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onCheckedChange(!checked) },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Checkbox(checked = checked, onCheckedChange = onCheckedChange)
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}
