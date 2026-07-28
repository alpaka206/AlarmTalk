package com.alarmtalk.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog

/**
 * 유료 기능 게이트 다이얼로그. iOS 시스템 알럿 스타일(`IosAlertDialog`)로 표시한다.
 *
 * 호출자가 넘긴 title 과 message 를 각각 알럿 제목/본문으로 유지하고,
 * 닫기(보조) + 이용권 보기(강조) 두 텍스트 액션을 제공한다.
 *
 * [onRedeemCode] 를 넘기면 '쿠폰이 있어요' 액션이 하나 더 붙는다. 프로모션 코드를 받은
 * 사람은 결제 화면까지 갔다가 거기서 코드 입력란을 찾아야 했는데, 막힌 그 자리에서 바로
 * 넣을 수 있게 한다. 입력은 통합 코드 필드(초대·선물·프로모 공용)를 그대로 쓴다.
 */
@Composable
internal fun PlanGateDialog(
    message: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    title: String = stringResource(R.string.r3dlg_plan_gate_title),
    confirmLabel: String = stringResource(R.string.r3dlg_plan_gate_confirm),
    onRedeemCode: ((String) -> Unit)? = null,
    redeemBusy: Boolean = false,
) {
    var codeEntryOpen by remember { mutableStateOf(false) }

    if (codeEntryOpen && onRedeemCode != null) {
        // 알럿 안에 입력 필드를 넣지 않고 별도 시트/다이얼로그로 뺀다 — iOS 알럿은 텍스트
        // 액션만 두는 형식이라(IosAlertDialog 스펙) 입력란을 끼우면 그 규칙이 깨진다.
        Dialog(onDismissRequest = { if (!redeemBusy) codeEntryOpen = false }) {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = WakerDialogShape,
                color = MaterialTheme.colorScheme.surface,
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(
                        text = stringResource(R.string.plan_gate_redeem_title),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                    )
                    MutedText(stringResource(R.string.plan_gate_redeem_desc))
                    CodeRedeemField(
                        busy = redeemBusy,
                        onSubmit = { code ->
                            onRedeemCode(code)
                            codeEntryOpen = false
                            // 결과(성공/실패)는 공용 메시지 배너가 알려주므로 게이트도 닫는다 —
                            // 코드가 통했다면 막고 있을 이유가 사라진다.
                            onDismiss()
                        },
                    )
                }
            }
        }
        return
    }

    IosAlertDialog(
        title = title,
        message = message,
        onDismiss = onDismiss,
        modifier = modifier,
        actions = buildList {
            add(
                IosAlertAction(
                    label = stringResource(R.string.r3dlg_modal_dialog_close),
                    onClick = onDismiss,
                ),
            )
            if (onRedeemCode != null) {
                add(
                    IosAlertAction(
                        label = stringResource(R.string.plan_gate_redeem_action),
                        onClick = { codeEntryOpen = true },
                    ),
                )
            }
            add(
                IosAlertAction(
                    label = confirmLabel,
                    emphasized = true,
                    onClick = onConfirm,
                ),
            )
        },
    )
}
