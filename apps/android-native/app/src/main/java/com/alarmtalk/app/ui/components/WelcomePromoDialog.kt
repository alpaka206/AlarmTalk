package com.alarmtalk.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Button
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
    // ⚠ **알럿(`IosAlertDialog`)으로 되돌리지 말 것**(2026-08-18 지시로 시트가 됐다).
    //
    // 세 가지가 알럿과 맞지 않았다:
    //  1. **닫아도 되는 안내**다(주석도 "닫기가 1급 선택지" 라고 적고 있었다). 알럿은
    //     "지금 답하라" 는 무게이고, 시트는 쓸어내려 닫는 게 표준이라 성격이 맞는다.
    //  2. 액션이 **셋**이라 알럿에서는 구분선으로 똑같이 쌓였다 — 실기기에서 보면
    //     주행동인 '등록' 이 나머지 둘과 구분되지 않는다.
    //  3. 입력 + **실패 사유**가 함께 있어야 하는데(계정당 1회라 실패하면 기회가 끝난다),
    //     그 자리를 만들려고 알럿을 흉내 낸 자체 카드를 쓰고 있었다.
    //
    // 보조 액션 둘은 **상단바**로 올린다(운세 정보 입력 시트와 같은 골격) — iOS 짝은
    // `Views/Auxiliary/WelcomePromoSheet.swift` 이고 **배치까지 같아야 한다.**
    WakerFormSheet(
        title = stringResource(R.string.welcome_promo_title),
        onCancel = { if (!busy) onDismiss() },
        onSave = onOpenInstagram,
        // ⚠ 툴바 액션은 **짧아야** 한다 — '코드 받으러 가기' 를 그대로 쓰면 제목을 밀어내
        // 셋이 한 줄에서 다툰다(iOS 실기기 확인). 무엇을 받는지는 제목이 이미 말한다.
        saveLabel = stringResource(R.string.welcome_promo_where_short),
        cancelLabel = stringResource(R.string.r3dlg_modal_dialog_close),
        saveEnabled = !busy,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(bottom = 20.dp),
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
                    style = IosAlertType.Message,
                    modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                )
            }
            // 주행동만 채움 버튼으로 남긴다 — 상단바의 둘과 무게를 가른다.
            Button(
                onClick = { code.trim().takeIf { it.isNotBlank() }?.let(onSubmitCode) },
                enabled = !busy && code.isNotBlank(),
                shape = WakerButtonShape,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 16.dp)
                    .height(52.dp),
            ) {
                Text(stringResource(R.string.code_redeem_submit))
            }
        }
    }
}

/** 알럿 본문과 같은 타이포의 한 줄 — 강조색이 섞여 message 파라미터로는 못 넘기는 경우에 쓴다. */
@Composable
private fun AlertBodyLine(text: AnnotatedString) {
    Text(
        text = text,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        // ⚠ **왼쪽 정렬이다**(2026-08-18 지시). 알럿이던 시절엔 가운데였는데, 시트에서는
        // 입력창·버튼이 모두 왼쪽에서 시작해 설명만 가운데면 시작점이 둘이 된다.
        textAlign = TextAlign.Start,
        style = IosAlertType.Message,
        modifier = Modifier.fillMaxWidth(),
    )
}
