package com.alarmtalk.app

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp

/**
 * **원형 뒤로가기 버튼** — 앱의 유일한 뒤로가기 모양이다.
 *
 * 옅은 채움 + 얇은 테두리의 원 안에 셰브론. 아이폰 로그인 화면의 뒤로가기와 같은 스펙이고,
 * 2026-08-11 에 로그인 화면에만 있던 것을 **공용으로 빼서** 하위 화면(이용권·코드 등록)도
 * 같이 쓰게 했다.
 *
 * ⚠ **민짜 `IconButton` 으로 되돌리지 말 것.** 어두운 배경 위에서 셰브론 하나만 두면
 * 눌리는 자리인지 안 보인다 — 원형 채움이 터치 타깃을 눈에 보이게 만든다.
 *
 * ⚠ **44 가 아니라 48 이다.** iOS 는 44 를 쓰지만 안드로이드 최소 터치 타깃은 48 이라,
 * iOS 치수를 그대로 가져오면 오히려 규격을 깬다(로그인 화면 주석에 있던 판단 그대로다).
 * `IconButton` 이 이미 48 터치 타깃을 갖고, 원은 그 안에 44 로 그린다.
 */
@Composable
internal fun WakerBackButton(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    tint: Color = MaterialTheme.colorScheme.onSurface,
) {
    IconButton(onClick = onBack, modifier = modifier) {
        Icon(
            painter = painterResource(R.drawable.ic_chevron_back),
            contentDescription = stringResource(R.string.auth_back),
            tint = tint,
            modifier = Modifier
                .size(44.dp)
                .background(WakerBackCircleFill, CircleShape)
                .border(1.dp, WakerBackCircleStroke, CircleShape)
                .padding(10.dp),
        )
    }
}

/** 원형 뒤로가기의 채움·테두리. 로그인 화면(고정 팔레트)과 본문 화면 양쪽에서 같은 값을 쓴다. */
internal val WakerBackCircleFill = Color(0x1FFFFFFF)
internal val WakerBackCircleStroke = Color(0x5CA6D2FF)
