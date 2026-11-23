package com.alarmtalk.app

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource

/**
 * **뒤로가기 버튼** — 앱의 유일한 뒤로가기 모양이다. 화살표 하나다(2026-11-15 오너: "동그라미 빼고").
 *
 * 2026-08-11 ~ 11-15 에는 옅은 채움 + 얇은 테두리의 원 안에 화살표를 그렸다(로그인 화면에만 있던 것을 공용으로 뺐었다).
 * 어두운 배경에서 누르는 자리가 보이게 하려던 것인데, 흰 화살표만으로 충분히 보여 원을 걷었다. iOS `WakerBackButton` 도 같다.
 *
 * ⚠ **누르는 범위는 48 이다.** `IconButton` 이 48 터치 타깃을 갖는다 — 원이 없어졌다고 범위를 줄이지 말 것(안드로이드 최소
 * 터치 타깃이 48 이다. iOS 는 44).
 */
@Composable
internal fun WakerBackButton(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    tint: Color = MaterialTheme.colorScheme.onSurface,
    enabled: Boolean = true,
) {
    IconButton(onClick = onBack, enabled = enabled, modifier = modifier) {
        Icon(
            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
            contentDescription = stringResource(R.string.auth_back),
            tint = tint,
        )
    }
}
