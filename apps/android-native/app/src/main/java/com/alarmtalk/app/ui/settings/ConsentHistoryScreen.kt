package com.alarmtalk.app

import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.R
import com.alarmtalk.app.WakerPanelShape
import com.alarmtalk.app.network.ConsentRecord

// 약관 및 개인정보 처리 동의 — 토스 패턴: 항목별로 '동의한 날짜'를 보여주고 문서로 드릴인.
@Composable
internal fun ConsentHistoryScreen(
    contentPadding: PaddingValues,
    onBack: () -> Unit,
    onLoadConsents: suspend () -> List<ConsentRecord>,
    onOpenTerms: () -> Unit,
    onOpenPrivacy: () -> Unit,
    marketingConsentAgreed: Boolean?,
    marketingConsentBusy: Boolean,
    marketingConsentLoadFailed: Boolean,
    onLoadMarketingConsent: () -> Unit,
    onChangeMarketingConsent: (Boolean) -> Unit,
) {
    var records by remember { mutableStateOf<Map<String, ConsentRecord>>(emptyMap()) }
    var loadFailed by remember { mutableStateOf(false) }
    var retryTick by remember { mutableIntStateOf(0) }

    LaunchedEffect(retryTick) {
        runCatching { onLoadConsents() }
            .onSuccess { list ->
                records = list.associateBy { it.consentType }
                loadFailed = false
            }
            .onFailure { loadFailed = true }
    }

    // 선택 동의(마케팅) 토글은 서버 최신값을 별도로 읽어 두 방향 반영한다(쓰기 시 낙관·롤백은 뷰모델이 관리).
    LaunchedEffect(Unit) { onLoadMarketingConsent() }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            // 탭·설정과 같은 그라데이션 배경 + 좌우 20dp·간격 16dp 공통 규격.
            .background(homeGradientBrush())
            .padding(contentPadding),
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onBack) {
                    Icon(
                        Icons.AutoMirrored.Outlined.ArrowBack,
                        contentDescription = stringResource(R.string.hs_settings_back),
                    )
                }
                Text(
                    text = stringResource(R.string.consent_screen_title),
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                )
            }
        }

        if (loadFailed) {
            item {
                Text(
                    text = stringResource(R.string.consent_load_failed),
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { retryTick++ }
                        .padding(horizontal = 4.dp, vertical = 8.dp),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        item {
            ConsentSectionCard(title = stringResource(R.string.consent_section_required)) {
                ConsentRow(
                    label = stringResource(R.string.hs_settings_terms_of_service),
                    record = records["terms"],
                    onOpen = onOpenTerms,
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                ConsentRow(
                    label = stringResource(R.string.hs_settings_privacy_policy),
                    record = records["privacy"],
                    onOpen = onOpenPrivacy,
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                ConsentRow(
                    label = stringResource(R.string.consent_type_age14),
                    record = records["age14"],
                    onOpen = null,
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                ConsentRow(
                    label = stringResource(R.string.consent_type_voice_biometric),
                    record = records["voice_biometric"],
                    onOpen = onOpenPrivacy,
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                ConsentRow(
                    label = stringResource(R.string.consent_type_overseas),
                    record = records["overseas_transfer"],
                    onOpen = onOpenPrivacy,
                )
            }
        }

        item {
            ConsentSectionCard(title = stringResource(R.string.consent_section_optional)) {
                // 읽기전용 이력이 아니라 실제 켜고 끄는 토글 — 설정에 있던 마케팅 카드를 이 법적 정보 화면으로 통합했다.
                ConsentToggleRow(
                    label = stringResource(R.string.consent_type_marketing),
                    agreed = marketingConsentAgreed,
                    busy = marketingConsentBusy,
                    loadFailed = marketingConsentLoadFailed,
                    onRetry = onLoadMarketingConsent,
                    onChange = onChangeMarketingConsent,
                )
            }
        }
    }
}

// 동의 이력 행과 같은 레이아웃이되, 우측이 날짜·화살표 대신 스위치다(선택 동의 켜고 끄기).
@Composable
private fun ConsentToggleRow(
    label: String,
    agreed: Boolean?,
    busy: Boolean,
    loadFailed: Boolean,
    onRetry: () -> Unit,
    onChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = label,
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface,
        )
        // 로드 실패(값 미확보)면 'off'로 오인되지 않게 스위치 대신 다시 시도 행을 보여준다.
        if (loadFailed && agreed == null) {
            Text(
                text = stringResource(R.string.settings_marketing_load_failed),
                modifier = Modifier.clickable(onClick = onRetry),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            // 로드 전(null)엔 비활성, 쓰기 진행 중(busy)엔 연속 토글로 인한 opt-out 유실 방지로 비활성.
            AlarmTalkSwitch(
                checked = agreed == true,
                onCheckedChange = onChange,
                enabled = agreed != null && !busy,
            )
        }
    }
}

@Composable
private fun ConsentSectionCard(
    title: String,
    content: @Composable () -> Unit,
) {
    Surface(
        shape = WakerPanelShape,
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(modifier = Modifier.padding(8.dp)) {
            Text(
                text = title,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface,
            )
            content()
        }
    }
}

@Composable
private fun ConsentRow(
    label: String,
    record: ConsentRecord?,
    onOpen: (() -> Unit)?,
) {
    val statusText = when {
        record == null -> "—"
        !record.agreed -> stringResource(R.string.consent_not_agreed)
        else -> formatConsentDate(record.agreedAt) ?: "—"
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .let { if (onOpen != null) it.clickable(onClick = onOpen) else it }
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = label,
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Text(
            text = statusText,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (onOpen != null) {
            Icon(
                imageVector = Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                contentDescription = null,
                modifier = Modifier.size(20.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

// "2026-07-06 04:12:33"(UTC) → "26. 07. 06." (KST 보정, 토스식 날짜 표기)
private fun formatConsentDate(value: String?): String? {
    if (value.isNullOrBlank()) return null
    return runCatching {
        val normalized = value.trim().replace(' ', 'T')
        val kst = java.time.LocalDateTime.parse(normalized.take(19)).plusHours(9)
        String.format(
            java.util.Locale.US,
            "%02d. %02d. %02d.",
            kst.year % 100,
            kst.monthValue,
            kst.dayOfMonth,
        )
    }.getOrNull()
}
