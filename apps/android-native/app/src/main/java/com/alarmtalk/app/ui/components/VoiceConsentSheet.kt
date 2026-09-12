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
    types: List<String>,
    registeringVoice: Boolean,
    onAgree: () -> Unit,
    onDismiss: () -> Unit,
) {
    val asksBiometric = "voice_biometric" in types
    val asksOverseas = "overseas_transfer" in types
    // '목소리 등록' 문맥인지는 **무엇을 묻는가**가 아니라 **동의 직후 무엇을 하는가**로 정한다.
    // 생체정보 동의는 이미 유효하고 국외 이전만 빠진 상태(그 동의의 최소 정책 버전만 올라간
    // 경우)에서도 등록은 그대로 이어진다 — 묻는 항목으로 문맥을 파생하면 그 자리에서 TTS 카피가
    // 떠서, 사용자는 '문구 생성 동의'인 줄 알고 눌렀는데 실제로는 녹음이 올라가고 클론이
    // 만들어진다(Codex #660). 반대로 국외 이전만 받는 TTS 자리에서는 등록 이야기를 꺼내면
    // 안 된다 — 등록하지도 않는 사용자에게 등록 책임 확인을 받는 꼴이 된다.
    val registrationContext = asksBiometric || registeringVoice

    var ownership by remember { mutableStateOf(false) }
    var liability by remember { mutableStateOf(false) }
    var biometric by remember { mutableStateOf(false) }
    var overseas by remember { mutableStateOf(false) }
    // 소유·책임 확인은 등록 문맥이면 받는다. 생체정보 동의 체크는 그 동의를 실제로 요구할
    // 때만 — 이미 유효한 동의를 다시 묻지 않는다.
    val allChecked = (!registrationContext || (ownership && liability)) &&
        (!asksBiometric || biometric) &&
        (!asksOverseas || overseas)

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
                    text = stringResource(
                        if (registrationContext) R.string.voice_consent_title else R.string.tts_consent_title,
                    ),
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
                        text = stringResource(
                            if (registrationContext) R.string.voice_consent_body else R.string.tts_consent_body,
                        ),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (registrationContext) {
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
                    }
                    if (asksBiometric) {
                        VoiceConsentCheck(
                            checked = biometric,
                            onCheckedChange = { biometric = it },
                            label = stringResource(R.string.voice_consent_check_biometric),
                        )
                    }
                    if (asksOverseas) {
                        VoiceConsentCheck(
                            checked = overseas,
                            onCheckedChange = { overseas = it },
                            label = stringResource(R.string.voice_consent_check_overseas),
                        )
                    }
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
                            // 동의 뒤에 이어서 만들 등록 요청이 없으면 '목소리 만들기' 라고
                            // 하면 안 한 일을 했다고 말하는 셈이다. 반대로 등록이 이어지면
                            // 반드시 그렇게 말해야 한다.
                            text = stringResource(
                                if (registrationContext) {
                                    R.string.voice_consent_agree
                                } else {
                                    R.string.voice_consent_agree_continue
                                },
                            ),
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
        AlarmTalkCheckbox(checked = checked, onCheckedChange = onCheckedChange)
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}
