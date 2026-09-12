package com.alarmtalk.app

import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.SystemUpdate
import androidx.compose.material3.Button
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
 * 설치 버전이 백엔드 최소지원버전 미만일 때 표시되는 차단 화면.
 * 로그인 여부와 무관하게 앱 진입을 막고 스토어 업데이트만 유도한다.
 */
@Composable
internal fun UpdateRequiredScreen(
    contentPadding: PaddingValues,
    onUpdate: () -> Unit,
) {
        // ⚠ **스크롤을 빼지 말 것.** 이 화면의 탈출구는 아래 버튼 하나뿐이라,
        // 큰 글꼴(배율 1.5~2.0)에서 내용이 화면을 넘치면 버튼이 밖으로 나가
        // **누를 방법이 사라진다** — 탈퇴를 되돌리려던 사용자가 30일 뒤 계정·알람·
        // 목소리를 잃고, 강제 업데이트 화면에서는 앱이 벽돌이 된다.
        // 버튼 높이도 고정(height)이 아니라 최소치(heightIn)여야 두 줄이 안 잘린다.
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
            imageVector = Icons.Outlined.SystemUpdate,
            contentDescription = null,
            modifier = Modifier.size(72.dp),
            tint = MaterialTheme.colorScheme.primary,
        )
        Spacer(Modifier.height(24.dp))
        Text(
            text = stringResource(R.string.r3app_update_required_title),
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(12.dp))
        Text(
            text = stringResource(R.string.r3app_update_required_body),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(32.dp))
        Button(
            onClick = onUpdate,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 50.dp),
        ) {
            Text(stringResource(R.string.r3app_update_required_button))
        }
    }
}
