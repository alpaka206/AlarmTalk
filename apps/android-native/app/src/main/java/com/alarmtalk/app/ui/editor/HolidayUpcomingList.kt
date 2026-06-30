package com.alarmtalk.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.data.HolidayDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * 공휴일에 끄기 토글 아래에 다가오는 공휴일(기본 5개)을 보여준다.
 * - [holidays] 가 비어 있고 비-KR 국가면 "불러오는 중" 플레이스홀더를 표시하고,
 *   [onColdCache] 콜백으로 서버 동기화(ensureHolidaysSynced)를 한 번 트리거한다.
 */
@Composable
internal fun HolidayUpcomingList(
    holidays: List<HolidayDate>,
    countryCode: String,
    onColdCache: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val isKorea = countryCode.trim().uppercase(Locale.ROOT) == "KR"
    val coldCache = holidays.isEmpty() && !isKorea

    if (coldCache) {
        // KR 외 국가는 서버 캐시가 채워질 때까지 비어 있을 수 있다. 한 번만 동기화를 건다.
        androidx.compose.runtime.LaunchedEffect(countryCode) { onColdCache() }
    }

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            text = stringResource(R.string.editor_holiday_show_title),
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (holidays.isEmpty()) {
            Text(
                text = stringResource(R.string.editor_holiday_cold_cache),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            holidays.forEach { holiday ->
                HolidayRow(holiday)
            }
        }
    }
}

@Composable
private fun HolidayRow(holiday: HolidayDate) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = holiday.date.format(HolidayDateFormatter),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = holiday.name,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

private val HolidayDateFormatter: DateTimeFormatter =
    DateTimeFormatter.ofPattern("M.d (E)", Locale.getDefault())
