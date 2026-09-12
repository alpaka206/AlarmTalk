package com.alarmtalk.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CloudDownload
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/**
 * **기본 목소리 교체가 아직 안 끝났을 때** 앱 진입을 막는 화면(2026-09-03 지시).
 *
 * 교체 회차에는 순서가 있다 — **다 받고 → 다 묶고 → 그 다음에 지운다.** 중간 상태로 앱을
 * 쓰면 알람이 **이름은 새 이름인데 소리는 옛 목소리**로 울 수 있어서, 남은 것이 있으면
 * 막고 다시 시도하게 한다. 삭제 실패는 막지 않는다 — 그때는 교체가 이미 끝나 있다.
 *
 * ⚠ **탈출구는 재시도 버튼 하나다.** 그래서 `UpdateRequiredScreen` 과 같은 이유로
 *   **스크롤을 뺄 수 없다** — 큰 글꼴에서 내용이 넘치면 버튼이 화면 밖으로 나가 앱이
 *   벽돌이 된다. 버튼 높이도 고정이 아니라 최소치여야 두 줄이 안 잘린다.
 *
 * 판정과 기본값은 `sync/StockReplacementStatus` 주석 참조 — **기본값은 막지 않는 쪽**이다.
 */
@Composable
internal fun StockReplacementScreen(
    contentPadding: PaddingValues,
    working: Boolean,
    onRetry: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(contentPadding)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            imageVector = Icons.Outlined.CloudDownload,
            contentDescription = null,
            modifier = Modifier.size(72.dp),
            tint = MaterialTheme.colorScheme.primary,
        )
        Spacer(Modifier.height(24.dp))
        Text(
            text = stringResource(R.string.r3app_stock_replacement_title),
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(12.dp))
        Text(
            text = stringResource(R.string.r3app_stock_replacement_body),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(32.dp))
        Button(
            onClick = onRetry,
            enabled = !working,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 50.dp),
        ) {
            if (working) {
                CircularProgressIndicator(
                    modifier = Modifier.size(18.dp),
                    strokeWidth = 2.dp,
                    color = MaterialTheme.colorScheme.onPrimary,
                )
                Spacer(Modifier.size(10.dp))
                Text(stringResource(R.string.r3app_stock_replacement_working))
            } else {
                Text(stringResource(R.string.r3app_stock_replacement_button))
            }
        }
    }
}
