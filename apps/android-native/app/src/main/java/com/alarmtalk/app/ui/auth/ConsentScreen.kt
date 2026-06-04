package com.alarmtalk.app

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * 로그인 후 필수 약관/개인정보 동의를 받는 게이트 화면.
 * 신규 가입자뿐 아니라 기존 가입자도 미동의 시 이 화면을 통과해야 앱을 쓸 수 있다.
 *
 * 필수: 만14세 이상 / 이용약관 / 개인정보 처리방침
 * 선택: 광고성 정보 수신(마케팅)
 */
@Composable
internal fun ConsentScreen(
    contentPadding: PaddingValues,
    busy: Boolean,
    onAgree: (marketingAgreed: Boolean) -> Unit,
    onOpenTerms: () -> Unit,
    onOpenPrivacy: () -> Unit,
) {
    var age14 by remember { mutableStateOf(false) }
    var terms by remember { mutableStateOf(false) }
    var privacy by remember { mutableStateOf(false) }
    var marketing by remember { mutableStateOf(false) }

    val allRequiredChecked = age14 && terms && privacy
    val allChecked = allRequiredChecked && marketing

    fun setAll(value: Boolean) {
        age14 = value
        terms = value
        privacy = value
        marketing = value
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(contentPadding)
            .padding(horizontal = 24.dp),
    ) {
        Spacer(Modifier.height(24.dp))
        Text(
            text = "서비스 이용을 위해\n약관에 동의해 주세요",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = "원활한 서비스 제공을 위해 아래 약관에 대한 동의가 필요해요.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
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
                label = "약관 전체 동의",
                emphasized = true,
            )
            Spacer(Modifier.height(4.dp))
            HorizontalDivider()
            Spacer(Modifier.height(4.dp))
            ConsentRow(
                checked = age14,
                onCheckedChange = { age14 = it },
                label = "[필수] 만 14세 이상입니다",
            )
            ConsentRow(
                checked = terms,
                onCheckedChange = { terms = it },
                label = "[필수] 이용약관 동의",
                onOpenDetail = onOpenTerms,
            )
            ConsentRow(
                checked = privacy,
                onCheckedChange = { privacy = it },
                label = "[필수] 개인정보 처리방침 동의",
                onOpenDetail = onOpenPrivacy,
            )
            ConsentRow(
                checked = marketing,
                onCheckedChange = { marketing = it },
                label = "[선택] 광고성 정보 수신 동의",
            )
        }

        Button(
            onClick = { onAgree(marketing) },
            enabled = allRequiredChecked && !busy,
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 16.dp)
                .height(50.dp),
        ) {
            Text(if (busy) "처리 중…" else "동의하고 시작하기")
        }
    }
}

@Composable
private fun ConsentRow(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    label: String,
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
        Checkbox(checked = checked, onCheckedChange = onCheckedChange)
        Spacer(Modifier.height(0.dp))
        Text(
            text = label,
            modifier = Modifier.weight(1f),
            style = if (emphasized) MaterialTheme.typography.titleMedium else MaterialTheme.typography.bodyLarge,
            fontWeight = if (emphasized) FontWeight.Bold else FontWeight.Normal,
        )
        if (onOpenDetail != null) {
            TextButton(onClick = onOpenDetail) { Text("보기") }
        }
    }
}
