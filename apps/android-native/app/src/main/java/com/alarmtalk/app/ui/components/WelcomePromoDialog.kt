package com.alarmtalk.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog

/**
 * 첫 로그인 + 무료 플랜에게 한 번만 뜨는 웰컴 코드 안내.
 *
 * 프로모 코드는 우리가 직접 뿌리는 공개 코드다(사용 한도 무제한, 30일 유료 플랜).
 * 스토어에서 앱을 받은 사람은 코드를 들고 올 수 있는데, 지금 코드 등록은 '더보기 → 코드
 * 등록' 2뎁스 안쪽에 있어 처음 온 사람은 그 자리를 찾지 못한다. 그래서 첫 진입에 한 번만
 * 물어본다.
 *
 * 닫기가 1급 선택지다 — 코드가 없어도 앱은 그대로 쓸 수 있고, 그 사실이 문구에서 먼저
 * 읽혀야 한다. 강제로 통과시키는 게이트가 아니라 지나칠 수 있는 안내다.
 */
@Composable
internal fun WelcomePromoDialog(
    busy: Boolean,
    onSubmitCode: (String) -> Unit,
    onDismiss: () -> Unit,
    onOpenInstagram: () -> Unit,
) {
    Dialog(onDismissRequest = { if (!busy) onDismiss() }) {
        Surface(
            shape = WakerDialogShape,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 2.dp,
        ) {
            Column(
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    text = stringResource(R.string.welcome_promo_title),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    text = stringResource(R.string.welcome_promo_body),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                CodeRedeemField(busy = busy, onSubmit = onSubmitCode)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    TextButton(onClick = onOpenInstagram, enabled = !busy) {
                        Text(
                            text = stringResource(R.string.welcome_promo_where),
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    TextButton(onClick = onDismiss, enabled = !busy) {
                        Text(stringResource(R.string.welcome_promo_skip))
                    }
                }
            }
        }
    }
}
