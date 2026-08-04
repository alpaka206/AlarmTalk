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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/**
 * @param titleMaxLines 제목 줄 수. 기본은 1줄 — 앱의 모달 제목은 "닉네임 수정" 처럼 짧은
 *   구절이라 한 줄로 충분하고, 넘치면 ellipsis 로 자른다.
 *   **문장형 제목**(웰컴 프로모의 "받은 코드가 있다면 지금 등록해요")만 2를 넘긴다 —
 *   1줄로 두면 제목이 통째로 잘려 무슨 말인지 읽히지 않는다. 잘릴 바에는 줄을 내린다.
 */
@Composable
internal fun ModalDialogTitle(
    title: String,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    dismissEnabled: Boolean = true,
    titleMaxLines: Int = 1,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // 앱 전체와 동일한 고정 타입스케일(Material titleLarge)을 사용한다. 화면 폭이 아니라
        // 사용자 시스템 글꼴 설정에만 반응하는 표준 방식이다.
        Text(
            text = title,
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            maxLines = titleMaxLines,
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
