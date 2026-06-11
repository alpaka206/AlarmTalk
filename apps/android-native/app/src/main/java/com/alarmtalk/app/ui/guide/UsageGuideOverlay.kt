package com.alarmtalk.app.ui.guide

import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

/** 사용 가이드 한 단계의 내용. */
data class UsageGuideStep(
    val icon: ImageVector,
    val title: String,
    val body: String,
)

/**
 * 첫 사용 단계 가이드 오버레이.
 *
 * handoff 프로토타입의 코치마크(어두운 스크림 + "가이드 n/N" 팁 카드 +
 * 건너뛰기/다음/시작하기)를 폼이 긴 화면에 맞게 단계 카드로 옮긴 것.
 * 화면 전체를 덮는 부모(Box) 안에서 마지막 자식으로 그려야 한다.
 * 노출 이력은 호출자가 `UsageGuideStore` 로 관리한다.
 */
@Composable
fun UsageGuideOverlay(
    steps: List<UsageGuideStep>,
    onFinish: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (steps.isEmpty()) return
    var index by remember { mutableStateOf(0) }
    val isLast = index >= steps.lastIndex

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(SCRIM_COLOR)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = {},
            ),
        contentAlignment = Alignment.Center,
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 28.dp),
            shape = RoundedCornerShape(24.dp),
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 3.dp,
        ) {
            Column(
                modifier = Modifier.padding(horizontal = 22.dp, vertical = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text(
                    text = "가이드 ${index + 1} / ${steps.size}",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary,
                )
                AnimatedContent(targetState = index, label = "usage_guide_step") { stepIndex ->
                    val step = steps[stepIndex]
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        Box(
                            modifier = Modifier
                                .size(76.dp)
                                .background(MaterialTheme.colorScheme.primaryContainer, CircleShape),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                imageVector = step.icon,
                                contentDescription = null,
                                modifier = Modifier.size(34.dp),
                                tint = MaterialTheme.colorScheme.primary,
                            )
                        }
                        Text(
                            text = step.title,
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                            textAlign = TextAlign.Center,
                        )
                        Text(
                            text = step.body,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                        )
                    }
                }
                Row(
                    horizontalArrangement = Arrangement.spacedBy(7.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    steps.indices.forEach { dot ->
                        Box(
                            modifier = Modifier
                                .size(if (dot == index) 9.dp else 7.dp)
                                .background(
                                    if (dot == index) {
                                        MaterialTheme.colorScheme.primary
                                    } else {
                                        MaterialTheme.colorScheme.outlineVariant
                                    },
                                    CircleShape,
                                ),
                        )
                    }
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TextButton(onClick = onFinish) {
                        Text("건너뛰기", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Button(onClick = { if (isLast) onFinish() else index += 1 }) {
                        Text(if (isLast) "시작하기" else "다음")
                    }
                }
            }
        }
    }
}

/**
 * 전체 화면 Dialog 위에서도 쓸 수 있는 가이드 — 목소리 만들기처럼 이미 Dialog 인
 * 화면에서는 오버레이를 직접 얹을 수 없어 가이드를 별도 Dialog 로 띄운다.
 */
@Composable
fun UsageGuideDialog(
    steps: List<UsageGuideStep>,
    onFinish: () -> Unit,
) {
    Dialog(
        onDismissRequest = onFinish,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        UsageGuideOverlay(steps = steps, onFinish = onFinish)
    }
}

/** handoff 프로토타입 코치마크 스크림 rgba(5,8,14,.74) 과 같은 농도. */
private val SCRIM_COLOR = Color(0xBD05080E)
