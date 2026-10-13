package com.alarmtalk.app

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource

/**
 * 유료 기능 게이트 다이얼로그. iOS 시스템 알럿 스타일(`IosAlertDialog`)로 표시한다.
 *
 * 호출자가 넘긴 title 과 message 를 각각 알럿 제목/본문으로 유지하고,
 * 닫기 + 이용권 보기(강조) 두 텍스트 액션을 제공한다(2개라 가로 한 줄이다 — 순서의 이유는 액션 목록 위 주석).
 *
 * ⚠ **코드 입력 액션('선물·초대 코드가 있어요'와 그 입력 알럿)은 2026-10-14 에 지웠다 — 되살리지 말 것.**
 * iOS 1.2.12 가 App Store 지침 3.1.1 로 두 번째 반려됐다("선물 코드로 디지털 기능을 연다"). 막힌 기능
 * 바로 옆의 코드 칸은 '코드를 넣으면 유료 기능이 열린다' 로 읽힌다. 초대 코드는 더보기의 '초대 코드 등록'
 * 화면(`FamilyConnectionPanel`)에서만 받는다. 할인·무료 이용은 스토어 오퍼 코드로 준다.
 */
@Composable
internal fun PlanGateDialog(
    message: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    title: String = stringResource(R.string.r3dlg_plan_gate_title),
    confirmLabel: String = stringResource(R.string.r3dlg_plan_gate_confirm),
) {
    IosAlertDialog(
        title = title,
        message = message,
        onDismiss = onDismiss,
        modifier = modifier,
        // ⚠ **순서는 [닫기][이용권 보기] 다** — 닫기가 앞(왼쪽), 강조한 확인이 끝(오른쪽)이다(2026-10-14).
        // 2026-08-15 지시의 이유는 "두 앱이 같은 순서로 보인다" 였다. 그 지시는 코드 액션까지 셋을 세로로 쌓던 때의
        // 것이고, 세로에서는 iOS 알럿이 `.cancel` 을 맨 아래로 내리니 닫기가 맨 끝이었다. 코드 액션을 지워 언제나 둘만
        // 남아 가로 한 줄이고, 한 줄에서는 iOS 시스템 알럿이 `.cancel` 을 **앞쪽**에 둔다(`VoicePlanGateAlert` 의 '닫기').
        // 같은 이유가 이제 닫기를 앞으로 보낸다. 취소·닫기가 있는 앱의 다른 두 액션 알럿도 전부 그것이 앞이다 —
        // 이 게이트만 거꾸로면 익은 자리를 누른 손이 반대 버튼을 누른다. 회귀 테스트 `GiftCodeRemovalTest`.
        actions = listOf(
            IosAlertAction(
                label = stringResource(R.string.r3dlg_modal_dialog_close),
                onClick = onDismiss,
            ),
            IosAlertAction(
                label = confirmLabel,
                emphasized = true,
                onClick = onConfirm,
            ),
        ),
    )
}
