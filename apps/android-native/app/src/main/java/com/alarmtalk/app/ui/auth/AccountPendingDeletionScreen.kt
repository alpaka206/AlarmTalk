package com.alarmtalk.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.HistoryToggleOff
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.R

/**
 * 탈퇴 유예(pending_deletion) 상태로 로그인했을 때 표시되는 화면.
 * 30일 유예 안내 + 탈퇴 취소(복구)/로그아웃만 가능하다. 복구해야 앱을 다시 쓸 수 있다.
 */
@Composable
internal fun AccountPendingDeletionScreen(
    contentPadding: PaddingValues,
    busy: Boolean,
    onRecover: () -> Unit,
    onLogout: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(contentPadding)
            .padding(horizontal = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            imageVector = Icons.Outlined.HistoryToggleOff,
            contentDescription = null,
            modifier = Modifier.size(72.dp),
            tint = MaterialTheme.colorScheme.error,
        )
        Spacer(Modifier.height(24.dp))
        Text(
            text = stringResource(R.string.r3dlg_pending_deletion_title),
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(12.dp))
        Text(
            text = stringResource(R.string.r3dlg_pending_deletion_body),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(32.dp))
        Button(
            onClick = onRecover,
            enabled = !busy,
            modifier = Modifier
                .fillMaxWidth()
                .height(50.dp),
        ) {
            Text(if (busy) stringResource(R.string.r3dlg_pending_deletion_processing) else stringResource(R.string.r3dlg_pending_deletion_recover))
        }
        Spacer(Modifier.height(12.dp))
        OutlinedButton(
            onClick = onLogout,
            enabled = !busy,
            modifier = Modifier
                .fillMaxWidth()
                .height(50.dp),
        ) {
            Text(stringResource(R.string.r3dlg_pending_deletion_logout))
        }
    }
}
