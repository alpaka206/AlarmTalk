package com.alarmtalk.app

import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
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
/**
 * 어떤 입력에도 들어와선 안 되는 문자를 걷는다 — **모든 사용자 입력의 1차 방어선**.
 *
 * 서버가 zod 로 다시 검증하고 SQL 은 `?`-바인딩이라 주입 자체는 막혀 있지만, 그건
 * "터지지 않는다" 지 "들어가도 된다" 가 아니다. 아래 문자들은 어디에도 쓸모가 없고 사고만
 * 만든다:
 *  - **제어문자(C0/C1)**: 로그·CSV·헤더를 깨고, 알람 문구로 들어가면 TTS 가 이상하게 읽는다.
 *  - **제로폭 문자**(U+200B~200D, U+FEFF): 눈에 안 보이는데 길이·중복 검사만 통과시킨다.
 *    "홍길동" 과 "홍<ZWSP>길동" 이 다른 이름이 되어 사칭에 쓰인다.
 *  - **양방향 문자**(U+202A~202E 삽입/오버라이드, U+2066~2069 격리, 그리고 방향 **표식**인
 *    U+061C ALM · U+200E LRM · U+200F RLM): 화면에 보이는 글자 순서를 뒤집는다. 파일명·이름
 *    스푸핑의 고전 수법이고, 표식만으로도 같은 일이 된다(Codex #672 P2).
 *
 * 따옴표·세미콜론·`--` 같은 SQL 문법 문자는 **일부러 남긴다.** "O'Brien" 은 정당한 이름이고,
 * 그걸 막는 건 주입 방어가 아니라 이름을 못 쓰게 하는 것이다. 주입은 바인딩이 막는다.
 */
internal fun sanitizeUserText(raw: String, allowNewlines: Boolean = false): String {
    // 줄바꿈·탭은 **지우지 않고 공백으로 바꾼다.** 지우면 "김\n규원" 이 "김규원" 으로 붙어
    // 원래 없던 한 단어가 된다 — 걸러내려던 건 서식 문자지 단어 경계가 아니다.
    val normalized = buildString(raw.length) {
        for (ch in raw) {
            when {
                ch == '\n' -> append(if (allowNewlines) '\n' else ' ')
                ch == '\r' || ch == '\t' -> append(' ')
                else -> append(ch)
            }
        }
    }
    return normalized.filter { ch ->
        when {
            ch == '\n' -> true // 위에서 허용된 경우만 남아 있다
            ch.isISOControl() -> false
            ch in '\u200B'..'\u200F' || ch == '\uFEFF' || ch == '\u061C' -> false
            ch in '\u202A'..'\u202E' || ch in '\u2066'..'\u2069' -> false
            else -> true
        }
    }
}

/**
 * 표시 이름 상한. 서버(`@alarmtalk/shared`)의 `DISPLAY_NAME_MAX_LENGTH`·
 * `VOICE_NAME_MAX_LENGTH` 와 같은 값이어야 한다 — 앱이 더 느슨하면 서버에서 거절당하고,
 * 더 빡빡하면 서버가 허용하는 이름을 못 쓴다.
 *
 * 목소리 이름이 더 긴 건 의도다. 사람 이름이 아니라 라벨이라("엄마 목소리(2024년 녹음)")
 * 여유를 둔다. **글자 규칙은 둘이 같다**(sanitizeDisplayName).
 */
internal const val DisplayNameMaxLength = 30
internal const val VoiceNameMaxLength = 50

/**
 * 길이 상한까지 자르되 **서러게이트 쌍을 반으로 가르지 않는다.**
 *
 * 코틀린 `String.take` 는 UTF-16 코드 유닛 단위라, 29자 뒤에 이모지가 오면 30에서 자를 때
 * 앞쪽 절반만 남아 깨진 문자가 된다. 그대로 서버로 올라가 DB·JWT 에 실린다
 * (서버도 `@alarmtalk/shared` 의 `clampDisplayName` 이 같은 규칙으로 막는다 — Codex #671 P2).
 */
internal fun String.takeWithoutSplittingPairs(maxLength: Int): String {
    if (length <= maxLength) return this
    val cut = take(maxLength)
    return if (cut.last().isHighSurrogate()) cut.dropLast(1) else cut
}

/**
 * 한 줄 표시 이름(닉네임·목소리 이름). 줄바꿈을 막고 앞뒤 공백을 정리한다.
 *
 * `maxLength` 를 주지 않으면 **자르지 않는다.** 말없이 잘리면 사용자는 왜 글자가 안
 * 들어가는지 모른 채 지웠다 다시 치는데, 그럴 바엔 넘치게 두고 밑에 이유를 적어 주는
 * 편이 낫다(위험 문자 제거는 상한과 무관하게 언제나 한다).
 */
internal fun sanitizeDisplayName(raw: String, maxLength: Int = Int.MAX_VALUE): String =
    sanitizeUserText(raw, allowNewlines = false)
        // 연속 공백을 하나로 — 공백만으로 이름을 다르게 보이게 하는 것도 막는다.
        .replace(Regex("\\s+"), " ")
        .trimStart()
        .takeWithoutSplittingPairs(maxLength)

/**
 * 이용권·초대·프로모션 코드. **영문 대문자·숫자·`-`·`_` 만 남긴다.**
 *
 * ⚠ **`isLetterOrDigit()` 하나로 거르지 말 것.** 한글도 letter 라서 그대로 통과한다 —
 * 코드에는 한글이 쓰이지 않는데 입력은 되니, 사용자는 다 치고 나서야 "잘못된 코드" 를
 * 본다(2026-08-13 지시). 아예 안 들어가게 막는다. iOS `sanitizeRedeemCode` 와 같은 규칙.
 */
internal fun sanitizeRedeemCode(raw: String): String = raw
    .uppercase()
    .filter { (it.code < 128 && it.isLetterOrDigit()) || it == '-' || it == '_' }
    // 프로모 코드 최대 64자(admin 발급 폼 maxlength=64)와 맞춘다 — 32자 잘림으로 긴 코드가 실패하던 문제.
    .take(64)

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
        // ⚠ **M3 `OutlinedTextField` 로 되돌리지 말 것.** 그건 최소 높이가 56이라 옆
        // 버튼과 높이를 맞출 수 없다(2026-08-17: 버튼을 56으로 키우자 "버튼이 너무 크다,
        // 입력칸을 줄여라"). 알럿에서 쓰던 컴팩트 필드를 모서리만 바꿔 재사용한다.
        IosAlertField(
            value = code,
            onValueChange = { code = sanitizeRedeemCode(it) },
            placeholder = stringResource(R.string.code_redeem_placeholder),
            enabled = !busy,
            minHeight = WakerControlHeight,
            shape = WakerInputShape,
            modifier = Modifier.weight(1f),
        )
        Button(
            onClick = {
                // 제출했다고 입력을 비우지 않는다 — 실패했을 때 길게 친 코드가 사라지면
                // 처음부터 다시 타이핑해야 한다. 성공하면 화면 자체가 닫히거나 홈으로
                // 이동해 이 필드가 컴포지션에서 빠지므로 남은 텍스트는 문제되지 않는다.
                code.trim().takeIf { it.isNotBlank() }?.let(onSubmit)
            },
            enabled = code.isNotBlank() && !busy,
            colors = wakerButtonColors(),
            shape = WakerButtonShape,
            // 입력칸과 **같은 높이·같은 최소 폭**이다(`WakerControlHeight`/`MinWidth`).
            // iOS 도 같은 값을 쓴다 — 한쪽만 바꾸면 두 앱의 버튼 크기가 갈라진다.
            modifier = Modifier
                .height(WakerControlHeight)
                .widthIn(min = WakerControlMinWidth),
        ) {
            if (busy) {
                CircularProgressIndicator(
                    modifier = Modifier.size(16.dp),
                    strokeWidth = 2.dp,
                    color = MaterialTheme.colorScheme.onPrimary,
                )
            } else {
                Text(stringResource(R.string.code_redeem_submit))
            }
        }
    }
}
