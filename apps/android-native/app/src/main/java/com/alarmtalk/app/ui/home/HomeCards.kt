package com.alarmtalk.app

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.R

@Composable
internal fun EmptyAlarmHeroCard(
    onCreateAlarm: () -> Unit,
) {
    val interactionSource = remember { MutableInteractionSource() }
    Card(
        onClick = onCreateAlarm,
        modifier = Modifier.wakerPressScale(interactionSource),
        interactionSource = interactionSource,
        shape = WakerHeroShape,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = wakerCardBorder(),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        // 좌측 텍스트 블록 / 우측 액션의 2단 구도 — + 를 문장 줄이 아니라 카드 전체에
        // 세로 중앙 정렬해, 버튼이 '카드의 액션'으로 읽히고 무게중심이 가운데로 온다.
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                // '아직 알람이 없어요' 같은 상황 라벨은 두지 않는다 — 빈 화면이 이미 말해주고,
                // 제목의 '첫'이 상황 설명을 겸한다(라벨+제목+설명+CTA 템플릿 인상 제거).
                Text(
                    text = stringResource(R.string.hs_create_alarm_button),
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                // 기능 설명 대신 제품 약속 — '목소리로 깨우는 앱'이라는 정체성을
                // 첫 화면부터 말한다. 특정 목소리 이름은 쓰지 않는다(처음 온 사용자가
                // 모르는 이름을 만나 당황하지 않게; 이름은 실제 알람 카드에서만).
                Text(
                    text = stringResource(R.string.hs_empty_card_helper),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            // FAB(+)와 같은 아이콘·색 — 같은 액션은 같은 생김새. 알람이 생기면
            // 이 +가 우하단 FAB 로 자리만 옮겨가는 연속성을 만든다.
            Surface(
                modifier = Modifier.padding(start = 12.dp),
                shape = WakerPillShape,
                color = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            ) {
                Box(
                    modifier = Modifier.size(40.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Add,
                        contentDescription = stringResource(R.string.r3app_bottom_create_alarm_desc),
                        modifier = Modifier.size(22.dp),
                    )
                }
            }
        }
    }
}
