package com.alarmtalk.app

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
 * 문구는 `docs/legal/consent-and-permission-copy.ko.md` §2 를 따른다. 목소리 권리 확인도 여기서 함께 받는다 — **앞으로
 * 등록하는 목소리 전부**에 대한 확인을 계정마다 한 번(서버 `voice_rights` 기록, 2026-11-15). 예전에는 '추가' 입구 모달이
 * 등록마다 따로 물었다.
 */
@Composable
internal fun VoiceConsentSheet(
    busy: Boolean,
    types: List<String>,
    registeringVoice: Boolean,
    onAgree: () -> Unit,
    // 목소리 권리 확인(계정마다 한 번)도 함께 받는가. 체크해야 동의 버튼이 눌린다.
    asksRights: Boolean = false,
    onDismiss: () -> Unit,
    // 기록이 안 됐다는 이유 — 버튼 바로 위에 빨간 글자로 그린다. 이 시트는 자기 창이라 스낵바는 그 아래에 깔린다(2026-10-29).
    errorText: String? = null,
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

    var biometric by remember { mutableStateOf(false) }
    var overseas by remember { mutableStateOf(false) }
    var rights by remember { mutableStateOf(false) }
    // 이미 유효한 법정 동의·이미 받은 권리 확인은 다시 묻지 않는다.
    val allChecked = (!asksBiometric || biometric) && (!asksOverseas || overseas) && (!asksRights || rights)

    // 자기 창을 여는 모달 — 진입 안내가 이 위에 겹치지 않게 적어 둔다(`OpenModalRegistry`).
    TrackOpenModal()
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
                // ⚠ **높이 상한을 박지 말 것**(2026-11-15). 예전에는 320dp 였는데, 등록 자리에서 생체정보(부연 세 줄)와 권리
                // 확인을 함께 받으면 그 높이를 넘어 맨 아래 권리 확인이 가려진 채 '동의하고 목소리 만들기' 가 꺼져 있었다.
                // 남은 높이만큼 늘고 넘칠 때만 스크롤한다 — M3 `AlertDialog` 본문과 같은 방식이다. iOS 는 `ViewThatFits`.
                Column(
                    modifier = Modifier
                        .weight(1f, fill = false)
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
                    if (asksBiometric) {
                        // 목소리 등록 자리에서는 예전 이름 화면 체크칸의 문구(법무 문서 §2② — 라벨 + 부연 세 문단)를 그대로 쓴다.
                        // 이름 화면 체크칸을 없애고 이 시트로 옮겼기 때문이다(2026-11-15). 등록이 아닌 자리는 종전 문구.
                        VoiceConsentCheck(
                            checked = biometric,
                            onCheckedChange = { biometric = it },
                            label = stringResource(
                                if (registrationContext) R.string.voices_register_biometric_consent else R.string.voice_consent_check_biometric,
                            ),
                            description = if (registrationContext) stringResource(R.string.voices_register_biometric_desc) else null,
                        )
                    }
                    if (asksOverseas) {
                        VoiceConsentCheck(
                            checked = overseas,
                            onCheckedChange = { overseas = it },
                            label = stringResource(R.string.voice_consent_check_overseas),
                        )
                    }
                    if (asksRights) {
                        VoiceConsentCheck(
                            checked = rights,
                            onCheckedChange = { rights = it },
                            label = stringResource(R.string.voice_consent_check_rights),
                        )
                    }
                }
                errorText?.let { text ->
                    Text(
                        text = text,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
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
    // 체크 문구 아래의 부연(법정 고지 — `docs/legal/consent-and-permission-copy.ko.md` §2). 문단은 `\n` 으로 나뉜다.
    description: String? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onCheckedChange(!checked) },
        verticalAlignment = if (description == null) Alignment.CenterVertically else Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        AlarmTalkCheckbox(checked = checked, onCheckedChange = onCheckedChange)
        Column(
            modifier = Modifier.padding(top = if (description == null) 0.dp else 12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurface,
            )
            description?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
