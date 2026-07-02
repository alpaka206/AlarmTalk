package com.alarmtalk.app

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * 로그인 후 필수 약관/개인정보 동의를 받는 게이트 화면.
 * 신규 가입자뿐 아니라 기존 가입자도 미동의 시 이 화면을 통과해야 앱을 쓸 수 있다.
 *
 * 필수: 만14세 이상 / 이용약관 / 개인정보 처리방침 / 음성 생체정보 / 국외 이전
 * 선택: 광고성 정보 수신(마케팅)
 */
@Composable
internal fun ConsentScreen(
    contentPadding: PaddingValues,
    busy: Boolean,
    onAgree: (
        marketingAgreed: Boolean,
        voiceBiometricAgreed: Boolean,
        overseasTransferAgreed: Boolean,
    ) -> Unit,
    onOpenTerms: () -> Unit,
    onOpenPrivacy: () -> Unit,
) {
    var age14 by remember { mutableStateOf(false) }
    var terms by remember { mutableStateOf(false) }
    var privacy by remember { mutableStateOf(false) }
    var voiceBiometric by remember { mutableStateOf(false) }
    var overseasTransfer by remember { mutableStateOf(false) }
    var marketing by remember { mutableStateOf(false) }

    val allRequiredChecked = age14 && terms && privacy && voiceBiometric && overseasTransfer
    val allChecked = allRequiredChecked && marketing

    fun setAll(value: Boolean) {
        age14 = value
        terms = value
        privacy = value
        voiceBiometric = value
        overseasTransfer = value
        marketing = value
    }

    AuthBackdrop {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(contentPadding)
                .padding(horizontal = 24.dp),
        ) {
            Spacer(Modifier.height(24.dp))
            Text(
                text = stringResource(R.string.auth_consent_title),
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                color = TextOnScene,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = stringResource(R.string.auth_consent_subtitle),
                style = MaterialTheme.typography.bodyMedium,
                color = TextOnSceneDim,
            )

            Column(
                modifier = Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState()),
            ) {
                Spacer(Modifier.height(24.dp))
                ConsentRow(
                    checked = allChecked,
                    onCheckedChange = ::setAll,
                    label = stringResource(R.string.auth_consent_agree_all),
                    emphasized = true,
                )
                Spacer(Modifier.height(4.dp))
                HorizontalDivider(color = AuthLineSoft)
                Spacer(Modifier.height(4.dp))
                ConsentRow(
                    checked = age14,
                    onCheckedChange = { age14 = it },
                    label = stringResource(R.string.auth_consent_age14),
                )
                ConsentRow(
                    checked = terms,
                    onCheckedChange = { terms = it },
                    label = stringResource(R.string.auth_consent_terms),
                    onOpenDetail = onOpenTerms,
                )
                ConsentRow(
                    checked = privacy,
                    onCheckedChange = { privacy = it },
                    label = stringResource(R.string.auth_consent_privacy),
                    onOpenDetail = onOpenPrivacy,
                )
                ConsentRow(
                    checked = voiceBiometric,
                    onCheckedChange = { voiceBiometric = it },
                    label = stringResource(R.string.auth_consent_voice_biometric),
                    description = stringResource(R.string.auth_consent_voice_biometric_desc),
                )
                ConsentRow(
                    checked = overseasTransfer,
                    onCheckedChange = { overseasTransfer = it },
                    label = stringResource(R.string.auth_consent_overseas_transfer),
                    description = stringResource(R.string.auth_consent_overseas_transfer_desc),
                )
                ConsentRow(
                    checked = marketing,
                    onCheckedChange = { marketing = it },
                    label = stringResource(R.string.auth_consent_marketing),
                )
            }

            Box(Modifier.padding(vertical = 16.dp)) {
                GradientCta(
                    text = if (busy) {
                        stringResource(R.string.auth_consent_processing)
                    } else {
                        stringResource(R.string.auth_consent_agree_and_start)
                    },
                    onClick = { onAgree(marketing, voiceBiometric, overseasTransfer) },
                    enabled = allRequiredChecked && !busy,
                )
            }
        }
    }
}

/**
 * 로그인 직후 서버에 필수 동의 여부를 확인하는 동안 잠깐 보여주는 로딩 화면.
 * 이 게이트 덕분에 동의가 필요한 사용자에게 온보딩·홈이 먼저 깜빡이지 않고
 * 동의 화면이 항상 먼저 뜬다.
 */
@Composable
internal fun ConsentCheckLoadingScreen(contentPadding: PaddingValues) {
    AuthBackdrop {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(contentPadding),
            contentAlignment = Alignment.Center,
        ) {
            CircularProgressIndicator(color = BrandAccentOnScene)
        }
    }
}

@Composable
private fun ConsentRow(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    label: String,
    description: String? = null,
    emphasized: Boolean = false,
    onOpenDetail: (() -> Unit)? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onCheckedChange(!checked) }
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(
            checked = checked,
            onCheckedChange = onCheckedChange,
            colors = CheckboxDefaults.colors(
                checkedColor = BrandAccentOnScene,
                checkmarkColor = Color(0xFF0A1428),
                uncheckedColor = AuthLine,
            ),
        )
        Spacer(Modifier.height(0.dp))
        Column(
            modifier = Modifier.weight(1f),
        ) {
            Text(
                text = label,
                style = if (emphasized) MaterialTheme.typography.titleMedium else MaterialTheme.typography.bodyLarge,
                fontWeight = if (emphasized) FontWeight.Bold else FontWeight.Normal,
                color = TextOnScene,
            )
            if (description != null) {
                Spacer(Modifier.height(2.dp))
                Text(
                    text = description,
                    style = MaterialTheme.typography.bodySmall,
                    color = AuthTextMuted,
                )
            }
        }
        if (onOpenDetail != null) {
            TextButton(onClick = onOpenDetail, colors = authTextButtonColors()) {
                Text(stringResource(R.string.auth_consent_view))
            }
        }
    }
}
