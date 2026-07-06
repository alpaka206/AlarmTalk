package com.alarmtalk.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp

/**
 * 통합 코드 입력 필드 — 초대(INV-)·이용권 선물(GIFT-)·프로모션(자유 문자열) 코드를
 * 전부 이 한 필드로 받는다. 종류 판별은 서버(POST /code/register)가 하므로 클라는
 * 형식을 가리지 않는다. 프로모 코드에 밑줄이 올 수 있어 `_` 를 허용한다.
 * 입력은 대문자로 자동 변환한다 — 서버가 바우처/초대는 대문자화, 프로모는 COLLATE NOCASE 로
 * 처리하므로 어떤 체계도 깨지지 않고, 사용자 입력 편의만 올라간다.
 */
@Composable
internal fun CodeRedeemField(
    busy: Boolean,
    onSubmit: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var code by remember { mutableStateOf("") }
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        OutlinedTextField(
            value = code,
            onValueChange = { value ->
                code = value
                    .uppercase()
                    .filter { it.isLetterOrDigit() || it == '-' || it == '_' }
                    .take(32)
            },
            placeholder = {
                Text(
                    text = stringResource(R.string.code_redeem_placeholder),
                    style = MaterialTheme.typography.bodyMedium,
                )
            },
            singleLine = true,
            enabled = !busy,
            shape = WakerInputShape,
            colors = wakerOutlinedTextFieldColors(),
            modifier = Modifier.weight(1f),
        )
        Button(
            onClick = {
                val trimmed = code.trim()
                if (trimmed.isNotBlank()) {
                    onSubmit(trimmed)
                    code = ""
                }
            },
            enabled = code.isNotBlank() && !busy,
            shape = WakerButtonShape,
        ) {
            Text(stringResource(R.string.code_redeem_submit))
        }
    }
}
