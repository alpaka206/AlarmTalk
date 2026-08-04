package com.alarmtalk.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp

/**
 * [text] 안의 [highlight] 만 강조색으로 칠한다. 없으면 그냥 원문 — 번역에서 그 표현이
 * 달라져도 문장이 깨지지 않는다(강조가 빠질 뿐이다).
 *
 * 문장을 조각내 이어붙이지 않는 이유: 조각 순서가 언어마다 달라서, 붙이는 순간 번역이
 * 어색해진다. 완성된 문장을 두고 그 안에서 찾는 편이 안전하다.
 */
@Composable
private fun highlighted(text: String, highlight: String): AnnotatedString {
    val start = text.indexOf(highlight)
    if (highlight.isBlank() || start < 0) return AnnotatedString(text)
    return buildAnnotatedString {
        append(text.substring(0, start))
        withStyle(
            SpanStyle(
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.SemiBold,
            ),
        ) {
            append(highlight)
        }
        append(text.substring(start + highlight.length))
    }
}

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
 *
 * 껍데기는 앱의 공용 알럿([IosAlertDialog])이다. 입력이 있다고 별도 모달을 두지 않는다 —
 * iOS 알럿도 `addTextField` 로 입력을 받는다. 액션이 셋이라 세로로 쌓이고(2개면 가로),
 * 닫기는 X 아이콘이 아니라 액션 하나로 들어간다.
 */
@Composable
internal fun WelcomePromoDialog(
    busy: Boolean,
    onSubmitCode: (String) -> Unit,
    onDismiss: () -> Unit,
    onOpenInstagram: () -> Unit,
    // 등록 실패를 **이 안에서** 보여 준다. 스낵바는 Scaffold 안에 있어 다이얼로그 뒤로 가리고,
    // 이 안내는 계정당 1회라 실패했다고 닫아 버리면 고쳐 넣을 기회가 사라진다(Codex #660).
    errorText: String? = null,
) {
    var code by remember { mutableStateOf("") }
    IosAlertDialog(
        title = stringResource(R.string.welcome_promo_title),
        // 본문은 강조색이 섞인 두 줄이라 알럿의 message(순수 문자열) 대신 슬롯에서 그린다.
        // 타이포는 알럿 본문과 같게 맞춘다(13/18, 가운데, 보조색).
        message = null,
        onDismiss = { if (!busy) onDismiss() },
        actions = listOf(
            IosAlertAction(
                label = stringResource(R.string.code_redeem_submit),
                emphasized = true,
                onClick = { code.trim().takeIf { it.isNotBlank() }?.let(onSubmitCode) },
            ),
            IosAlertAction(
                label = stringResource(R.string.welcome_promo_where),
                onClick = onOpenInstagram,
            ),
            // iOS 는 세로 스택에서 닫기를 맨 아래에 둔다.
            IosAlertAction(
                label = stringResource(R.string.r3dlg_modal_dialog_close),
                onClick = onDismiss,
            ),
        ),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            AlertBodyLine(
                highlighted(
                    text = stringResource(R.string.welcome_promo_body_free),
                    highlight = stringResource(R.string.welcome_promo_highlight_free),
                ),
            )
            AlertBodyLine(
                highlighted(
                    text = stringResource(R.string.welcome_promo_body_later),
                    highlight = stringResource(R.string.welcome_promo_highlight_where),
                ),
            )
        }
        // 설명과 입력란 사이는 알럿의 필드 간격(16)을 그대로 쓴다.
        IosAlertField(
            value = code,
            onValueChange = { code = sanitizeRedeemCode(it) },
            placeholder = stringResource(R.string.code_redeem_placeholder),
            enabled = !busy,
            modifier = Modifier.padding(top = 14.dp),
        )
        errorText?.let {
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
    }
}

/** 알럿 본문과 같은 타이포의 한 줄 — 강조색이 섞여 message 파라미터로는 못 넘기는 경우에 쓴다. */
@Composable
private fun AlertBodyLine(text: AnnotatedString) {
    Text(
        text = text,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
        style = IosAlertType.Message,
        modifier = Modifier.fillMaxWidth(),
    )
}
