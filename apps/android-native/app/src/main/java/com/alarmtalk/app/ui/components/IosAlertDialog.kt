package com.alarmtalk.app

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

/**
 * iOS 시스템 알럿(UIAlertController) 스타일의 공용 다이얼로그.
 *
 * 디자인 출처: Figma "Alert" 컴포넌트 세트 (양 플랫폼 모달 통일 기준), 수치는 변형
 * `2018:456`(Dark·Title·2 horizontal) 기준으로 정밀 정렬.
 *   - 컨테이너: radius 14, 화면 적응 폭(최대 300; Figma 270 ~ 큰 폰 대응 절충)
 *   - content: 가로 16 / 세로 20 패딩, 가운데 정렬, 타이틀↔설명 2dp
 *   - 타이틀 17/Semibold(라인 22, 자간 -0.4), 설명 13/Regular(라인 18, 자간 -0.08, 보조색)
 *   - 액션: 행 높이 44, 0.5dp 구분선(onSurface 20%)으로 분리된 텍스트 버튼
 *           왼쪽=Regular / 강조=Semibold, 17/라인22/자간-0.4. 2개는 가로(가운데 세로 구분선).
 *   - X 닫기·채운 알약 버튼 없음
 *
 * 색은 Figma 의 iOS 블루(#007AFF) 대신 앱 브랜드 색(`primary`)을 써서 다크모드까지
 * 자동 대응한다. 폰트는 앱 표준 Pretendard(Figma 는 SF Pro) — iOS 에선 SF Pro 로 동일.
 */
internal data class IosAlertAction(
    val label: String,
    val emphasized: Boolean = false,
    val destructive: Boolean = false,
    val onClick: () -> Unit,
)

@Composable
internal fun IosAlertDialog(
    title: String?,
    message: String?,
    actions: List<IosAlertAction>,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val scheme = MaterialTheme.colorScheme
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = modifier
                .fillMaxWidth()
                .padding(horizontal = 40.dp)
                .widthIn(max = 300.dp),
            shape = RoundedCornerShape(14.dp),
            // iOS 알럿은 어두운 글래스 패널 느낌 — 배경보다 한 단계 밝은 surfaceVariant 로 분리감을 준다.
            color = scheme.surfaceVariant,
            tonalElevation = 0.dp,
            shadowElevation = 18.dp,
            border = BorderStroke(0.5.dp, scheme.onSurface.copy(alpha = 0.12f)),
        ) {
            Column(modifier = Modifier.fillMaxWidth()) {
                val hasContent = !title.isNullOrBlank() || !message.isNullOrBlank()
                if (hasContent) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 20.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        if (!title.isNullOrBlank()) {
                            Text(
                                text = title,
                                color = scheme.onSurface,
                                textAlign = TextAlign.Center,
                                fontSize = 17.sp,
                                lineHeight = 22.sp,
                                letterSpacing = (-0.4).sp,
                                fontWeight = FontWeight.SemiBold,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        if (!title.isNullOrBlank() && !message.isNullOrBlank()) {
                            Spacer(Modifier.height(2.dp))
                        }
                        if (!message.isNullOrBlank()) {
                            Text(
                                text = message,
                                color = scheme.onSurfaceVariant,
                                textAlign = TextAlign.Center,
                                fontSize = 13.sp,
                                lineHeight = 18.sp,
                                letterSpacing = (-0.08).sp,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    }
                }
                IosAlertActionRow(actions = actions, scheme = scheme)
            }
        }
    }
}

@Composable
private fun IosAlertActionRow(actions: List<IosAlertAction>, scheme: ColorScheme) {
    val separator = scheme.onSurface.copy(alpha = 0.20f)
    if (actions.size == 2) {
        Column(modifier = Modifier.fillMaxWidth()) {
            HorizontalDivider(thickness = 0.5.dp, color = separator)
            Row(modifier = Modifier.fillMaxWidth().height(44.dp)) {
                IosAlertButton(
                    action = actions[0],
                    scheme = scheme,
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                )
                VerticalDivider(thickness = 0.5.dp, color = separator)
                IosAlertButton(
                    action = actions[1],
                    scheme = scheme,
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                )
            }
        }
    } else {
        Column(modifier = Modifier.fillMaxWidth()) {
            actions.forEach { action ->
                HorizontalDivider(thickness = 0.5.dp, color = separator)
                IosAlertButton(
                    action = action,
                    scheme = scheme,
                    modifier = Modifier.fillMaxWidth().height(44.dp),
                )
            }
        }
    }
}

@Composable
private fun IosAlertButton(
    action: IosAlertAction,
    scheme: ColorScheme,
    modifier: Modifier = Modifier,
) {
    val color = if (action.destructive) scheme.error else scheme.primary
    Box(
        modifier = modifier.clickable(onClick = action.onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = action.label,
            color = color,
            fontSize = 17.sp,
            lineHeight = 22.sp,
            letterSpacing = (-0.4).sp,
            fontWeight = if (action.emphasized) FontWeight.SemiBold else FontWeight.Normal,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
