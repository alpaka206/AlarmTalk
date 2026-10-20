package com.alarmtalk.app

import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

// 더보기(MenuTabPanel) 패널과 같은 시각 규격: 제목을 카드 '안'에 넣은 패널 카드 +
// 텍스트/값/셰브론 행(높이 52·수평 12). 화면마다 카드/행 간격이 달라 보이던 문제의 단일 출처.
@Composable
internal fun SettingsCard(
    title: String?,
    content: @Composable () -> Unit,
) {
    Surface(
        shape = WakerPanelShape,
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(modifier = Modifier.padding(8.dp)) {
            if (title != null) {
                Text(
                    text = title,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
            content()
        }
    }
}

@Composable
internal fun SettingsRow(
    label: String,
    value: String?,
    onClick: () -> Unit,
    /**
     * 행 아래 작은 안내 한 줄(예: 목록에 없는 옛 지역 — "목록에서 다시 골라 주세요").
     * 값 칸에 붙이지 않는 이유: 값은 한 줄로 잘리는 자리라 안내가 먼저 잘려 사라진다.
     */
    supportingText: String? = null,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 52.dp)
                .padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // 라벨은 제 너비를 그대로 갖고, **남는 폭을 값이 가져간다.** 반대로(라벨에 weight)
            // 두면 값이 길 때 라벨이 밀려 "운세 / 정보" 처럼 두 줄로 접혔다 — 접혀야 할 쪽은
            // 항상 값이다. 값이 없는 행(로그아웃 등)은 Spacer 가 그 자리를 대신 채워
            // 오른쪽 셰브론이 늘 같은 자리에 온다.
            Text(
                text = label,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
            )
            if (value != null) {
                Text(
                    text = value,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary,
                    textAlign = TextAlign.End,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
            } else {
                Spacer(modifier = Modifier.weight(1f))
            }
            Icon(
                imageVector = Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                contentDescription = null,
                modifier = Modifier.size(20.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (supportingText != null) {
            // ⚠ **왼쪽 정렬, 라벨과 같은 시작선**(행 안쪽 12dp)이다. 오른쪽 정렬은 이 앱에서
            // **값**만의 자리다 — 보조 문장(동의 내역의 국외 이전 안내 `consent_overseas_withdraw_notice`,
            // 더보기 프로필의 부제 `menu_profile_subtitle`)은 전부 시작선에 붙는다. 값 밑에 오른쪽으로
            // 붙이면 값의 일부처럼 읽힌다. iOS `SettingsValueButton` 의 `note` 도 `.leading` 이다.
            Text(
                text = supportingText,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Start,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 12.dp, end = 12.dp, bottom = 8.dp),
            )
        }
    }
}

// 지역 고르기는 편집기 문구 pane 의 WeatherLocationDialog(AlarmRandomPromptSettings.kt)를
// 공유한다 — 나라 → 지역 목록, 직접 입력 없음(2026-09-30).

/**
 * 설정 '지역' 행에 보이는 값 — **지역 이름만** 쓴다(판정은 `weatherRegionDisplay` 한 곳).
 *
 * ⚠ **나라를 붙이지 말 것**(2026-08-17 통일). 저장은 나라+지역 글자 둘 다 하지만, 앱의 다른
 * 자리가 전부 지역 이름으로 말한다(문구 요약 행의 `날씨 · 서울`). 설정에서만 "대한민국 인천" 이면
 * 같은 값이 두 이름을 갖는다. iOS `weatherLocationLabel` 도 같다.
 * 목록의 지역이면 앱 언어의 이름, 되짚지 못한 옛 값이면 적힌 글자 그대로다(행 아래 안내가 붙는다).
 */
internal fun weatherLocationSettingsLabel(context: Context, country: String, city: String): String =
    weatherRegionDisplay(context, country, city).label
        .ifBlank { context.getString(R.string.misc2_settings_not_set) }

/**
 * 설정 행에 보이는 운세 정보 — **성별 · 생년월일**까지다.
 *
 * ⚠ **'설정됨' 으로 줄이지 말 것.** 이 행이 답해야 하는 질문은 둘이다: 넣었나, 그리고
 * **제대로 넣었나**. 사주는 생년월일이 전부라 오타가 나면 알람 문구가 통째로 남의 것이
 * 되는데, '설정됨' 은 그걸 영영 감춘다.
 * ⚠ **태어난 시각까지 넣지도 말 것**(2026-08-17 정리). 셋을 다 넣으면 행이 넘쳐 잘리고,
 * 잘리는 쪽은 값이다 — 훑어서 틀림을 알아채라고 둔 정보가 먼저 사라진다.
 * 시각은 눌러서 여는 다이얼로그에 그대로 있다. iOS `fortuneInfoLabel` 도 같다.
 */
internal fun fortuneInfoSettingsLabel(
    context: Context,
    gender: String,
    birthDate: String,
): String {
    val value = listOf(fortuneValueLabel(context, gender.trim()), birthDate)
        .map { it.trim() }
        .filter { it.isNotBlank() }
        .joinToString(" · ")
    return value.ifBlank { context.getString(R.string.misc2_settings_not_set) }
}
