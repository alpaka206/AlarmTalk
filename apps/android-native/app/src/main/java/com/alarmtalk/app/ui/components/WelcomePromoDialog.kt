package com.alarmtalk.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

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
 * **껍데기는 앱의 표준 모달 그대로다**(닉네임 변경·운세 설정·스누즈 설정과 같은 형태):
 * 화면 폭을 채우고 좌우 20dp 를 띄운 뒤 큰 화면에서는 430dp 로 묶고, 테두리·그림자로
 * 띄운다. 예전에는 이 다이얼로그만 `usePlatformDefaultWidth` 기본값에 폭을 맡겨
 * **내용 크기대로 쪼그라들었고**, 좌우 여백도 다른 모달과 달랐다.
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
    Dialog(
        onDismissRequest = { if (!busy) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .widthIn(max = 430.dp),
            shape = WakerDialogShape,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 0.dp,
            shadowElevation = 18.dp,
            border = wakerCardBorder(),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                // 제목 + 우상단 닫기(X) — 다른 모달과 같은 헤더. 닫기가 1급 선택지라는 성격이
                // 앱 어디서나 같은 자리에서 보이는 편이 낫다.
                ModalDialogTitle(
                    title = stringResource(R.string.welcome_promo_title),
                    onDismiss = onDismiss,
                    dismissEnabled = !busy,
                )
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    // 두 문장을 각각 한 줄로 둔다 — 한 덩어리로 흘리면 '무료로 쓸 수 있다' 와
                    // '나중에 넣을 수 있다' 가 섞여 읽힌다. 각 줄의 핵심어만 강조색으로 띄운다.
                    Text(
                        text = highlighted(
                            text = stringResource(R.string.welcome_promo_body_free),
                            highlight = stringResource(R.string.welcome_promo_highlight_free),
                        ),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        text = highlighted(
                            text = stringResource(R.string.welcome_promo_body_later),
                            highlight = stringResource(R.string.welcome_promo_highlight_where),
                        ),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    CodeRedeemField(busy = busy, onSubmit = onSubmitCode)
                    // 오류는 입력란 **바로 아래**에 붙인다 — 무엇을 고쳐야 하는지가 붙어 읽힌다.
                    errorText?.let {
                        Text(
                            text = it,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                }
                // 닫기는 헤더의 X 하나뿐이다. '건너뛰기' 버튼도 같은 일을 했는데, 같은 동작을
                // 두 자리에 두면 사용자가 둘의 차이를 찾느라 멈춘다(코드를 버리는 건지, 다음에
                // 다시 물어보는 건지). 앱의 다른 모달도 닫기는 X 하나다.
                //
                // 가로 컨텐트 패딩을 0 으로 둬서 라벨이 위 제목·본문과 **같은 세로선**에서
                // 시작하게 한다. TextButton 기본값(12dp)을 그대로 두면 이 손수 짠 컬럼 안에서
                // 이 줄만 안쪽으로 밀려 들쭉날쭉해 보인다.
                TextButton(
                    onClick = onOpenInstagram,
                    enabled = !busy,
                    contentPadding = PaddingValues(horizontal = 0.dp, vertical = 8.dp),
                ) {
                    Text(
                        text = stringResource(R.string.welcome_promo_where),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
    }
}
