package com.alarmtalk.app

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.SystemUpdate
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/**
 * 설치 버전이 백엔드 최소지원버전 미만일 때(또는 이 빌드로는 동의를 정직하게 받을 수 없을 때) 표시되는 차단 화면.
 * 로그인 여부와 무관하게 앱 진입을 막고 스토어 업데이트만 유도한다.
 *
 * 2026-11-15 다시 그렸다(오너) — 로그인 화면과 같은 밤하늘 배경(`AuthBackdrop`)에 유리 원 아이콘·제목·안내를 가운데 두고,
 * 버튼은 아래에 고정한 `GradientCta` 다. 예전에는 테마 바탕에 Material 기본 버튼이라 앱의 다른 첫 화면들과 결이 달랐다.
 * 안내는 **업데이트해도 알람과 목소리가 그대로 남는다**고 말한다 — 막힌 사람이 가장 먼저 걱정하는 것이다.
 * iOS 짝 `UpdateRequiredView`.
 */
@Composable
internal fun UpdateRequiredScreen(
    contentPadding: PaddingValues,
    onUpdate: () -> Unit,
) {
    AuthBackdrop {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(contentPadding)
                .padding(horizontal = 24.dp)
                .padding(bottom = 16.dp),
        ) {
            // ⚠ **버튼을 스크롤 밖 아래에 고정한다.** 이 화면의 탈출구는 그 버튼 하나뿐이라, 큰 글꼴(배율 1.5~2.0)에서 내용이
            //   화면을 넘쳐도 버튼은 늘 보여야 한다 — 밀려 나가면 앱이 벽돌이 된다. 넘치는 것은 위의 안내뿐이고 그건 스크롤한다.
            BoxWithConstraints(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
            ) {
                Column(
                    modifier = Modifier
                        .verticalScroll(rememberScrollState())
                        .fillMaxWidth()
                        // 짧을 때는 남는 높이의 가운데에 둔다(스크롤 안이라 최소 높이를 직접 준다).
                        .heightIn(min = maxHeight),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Surface(
                        modifier = Modifier.size(88.dp),
                        shape = CircleShape,
                        color = GlassFill,
                        border = BorderStroke(1.dp, GlassBorder),
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.SystemUpdate,
                            contentDescription = null,
                            modifier = Modifier.padding(24.dp),
                            tint = BrandAccentOnScene,
                        )
                    }
                    Spacer(Modifier.height(24.dp))
                    Text(
                        text = stringResource(R.string.r3app_update_required_title),
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                        color = TextOnScene,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(10.dp))
                    Text(
                        text = stringResource(R.string.r3app_update_required_body),
                        style = MaterialTheme.typography.bodyLarge,
                        color = TextOnSceneDim,
                        textAlign = TextAlign.Center,
                    )
                }
            }
            GradientCta(
                text = stringResource(R.string.r3app_update_required_button),
                onClick = onUpdate,
            )
        }
    }
}
