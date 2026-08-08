package com.alarmtalk.app

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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.res.stringResource
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
    /// 코드 등록 실패 사유. 모달을 열어 둔 채 고칠 수 있게 필드 아래에 그린다.
    redeemErrorText: String? = null,
) {
    var codeEntryOpen by remember { mutableStateOf(false) }

    if (codeEntryOpen && onRedeemCode != null) {
        // ⚠ **전용 `Dialog` 껍데기를 다시 만들지 말 것.** 예전에는 "iOS 알럿은 텍스트
        // 액션만 두는 형식이라 입력란을 끼우면 규칙이 깨진다" 는 근거로 여기만 별도
        // Surface 를 그렸는데, 그 근거는 철회됐다 — `IosAlertDialog` 은 `content` 슬롯에
        // `IosAlertField` 를 받는다(CLAUDE.md 「입력이 있는 알럿도 이걸 쓴다」, 이미
        // 프로모 코드·닉네임 수정·스누즈 직접 입력이 그렇게 쓴다).
        //
        // 껍데기가 갈려 있어서 같은 '코드 등록' 이 웰컴 안내와 유료 게이트에서 완전히
        // 다르게 생겼고, **여기에는 실패 사유를 보여줄 자리가 없어** 코드가 틀리면
        // 모달이 그냥 닫혔다.
        var code by remember { mutableStateOf("") }
        IosAlertDialog(
            title = stringResource(R.string.plan_gate_redeem_title),
            message = stringResource(R.string.plan_gate_redeem_desc),
            onDismiss = { if (!redeemBusy) codeEntryOpen = false },
            modifier = modifier,
            content = {
                IosAlertField(
                    value = code,
                    onValueChange = { code = sanitizeRedeemCode(it) },
                    placeholder = stringResource(R.string.code_redeem_placeholder),
                    enabled = !redeemBusy,
                    modifier = Modifier.padding(top = 14.dp),
                )
                redeemErrorText?.let {
                    Text(
                        text = it,
                        color = MaterialTheme.colorScheme.error,
                        textAlign = TextAlign.Center,
                        style = IosAlertType.Message,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 6.dp),
                    )
                }
            },
            actions = listOf(
                IosAlertAction(
                    label = stringResource(R.string.r3dlg_modal_dialog_close),
                    onClick = { if (!redeemBusy) codeEntryOpen = false },
                ),
                IosAlertAction(
                    label = stringResource(R.string.plan_gate_redeem_action),
                    emphasized = true,
                    enabled = !redeemBusy && code.isNotBlank(),
                    onClick = {
                        onRedeemCode(code)
                        codeEntryOpen = false
                        // 코드가 통했다면 막고 있을 이유가 사라진다.
                        onDismiss()
                    },
                ),
            ),
        )
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
