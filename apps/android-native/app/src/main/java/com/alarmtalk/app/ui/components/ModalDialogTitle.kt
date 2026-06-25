package com.alarmtalk.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

// 제목 글자 크기를 폰 가로폭에 비례시키는 기준/한계. 360dp 를 1.0 기준으로 좁은
// 기기는 더 작게·넓은 기기는 더 크게 스케일하되, 과도해지지 않게 클램프한다.
private const val TITLE_BASELINE_WIDTH_DP = 360f
private const val TITLE_MIN_SCALE = 0.9f
private const val TITLE_MAX_SCALE = 1.15f

@Composable
internal fun ModalDialogTitle(
    title: String,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    dismissEnabled: Boolean = true,
) {
    val widthScale = (LocalConfiguration.current.screenWidthDp / TITLE_BASELINE_WIDTH_DP)
        .coerceIn(TITLE_MIN_SCALE, TITLE_MAX_SCALE)
    val titleStyle = MaterialTheme.typography.titleLarge.let {
        it.copy(fontWeight = FontWeight.Bold, fontSize = it.fontSize * widthScale)
    }
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = title,
            style = titleStyle,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        IconButton(
            onClick = onDismiss,
            enabled = dismissEnabled,
            modifier = Modifier.size(48.dp),
        ) {
            Icon(
                Icons.Outlined.Close,
                contentDescription = stringResource(R.string.r3dlg_modal_dialog_close),
                modifier = Modifier.size(20.dp),
            )
        }
    }
}
