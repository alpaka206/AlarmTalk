package com.alarmtalk.app

// 사용자 입력 정리 함수 모음(앱 1차 방어선 — CLAUDE.md 「입력 규칙은 한 곳에서만」). 파일 이름은 옛 코드
// 입력칸에서 왔고, 문서·iOS 미러 주석이 이 경로를 대므로 그대로 둔다.

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
/**
 * 이름 칸의 `onValueChange` 한 번 — 정리한 값과 **상한을 넘겨 친 경고**를 함께 정한다(CLAUDE.md 「말없이 자르지 말 것」).
 * 상한에서 입력은 막고, 넘겨 치는 순간 경고를 켠다. ⚠ **정확히 상한일 때는 경고를 건드리지 않는다** — 잘라서 돌려준 값을
 * IME 가 그대로 되돌려 보내므로, 거기서 끄면 켜자마자 꺼진다. 상한보다 짧아지면 끈다.
 */
internal fun boundedNameInput(raw: String, maxLength: Int, wasTooLong: Boolean): Pair<String, Boolean> {
    val cleaned = sanitizeDisplayName(raw)
    val clamped = cleaned.takeWithoutSplittingPairs(maxLength)
    val tooLong = when {
        clamped.length < cleaned.length -> true
        clamped.length < maxLength -> false
        else -> wasTooLong
    }
    return clamped to tooLong
}

internal fun sanitizeDisplayName(raw: String, maxLength: Int = Int.MAX_VALUE): String =
    sanitizeUserText(raw, allowNewlines = false)
        // 연속 공백을 하나로 — 공백만으로 이름을 다르게 보이게 하는 것도 막는다.
        .replace(Regex("\\s+"), " ")
        .trimStart()
        .takeWithoutSplittingPairs(maxLength)

/** 이메일 인증 코드의 자릿수. 서버(`@alarmtalk/shared` 의 `EmailVerificationCodeSchema`)와 같은 값이다. */
internal const val VerificationCodeLength = 6

/**
 * 이메일 인증 코드(가입·비밀번호 재설정). **ASCII 숫자 여섯 자만 남긴다.**
 *
 * 유니코드 십진 숫자는 **같은 값의 ASCII 숫자**로 바꾸고(아라비아-인도 U+0660–0669 · 페르시아
 * U+06F0–06F9 · 전각 U+FF10–FF19 등), 숫자가 아닌 것(공백·하이픈·글자·분수·원문자)은 버리고, 여섯
 * 자에서 자른다. 메일 본문을 통째로 붙여도 앞의 여섯 자리만 남는다.
 *
 * ⚠ **`filter(Char::isDigit)` 로 거르지 말 것.** `isDigit` 은 ASCII 가 아닌 숫자를 **그대로** 통과시키는데
 * 서버의 형식 검사는 ASCII 만 받는다 — 그런 키보드로 친 코드는 형식에서 떨어져(400
 * `AUTH_VALIDATION_FAILED`) 틀린 횟수도 세지 않은 채 영영 통과하지 못한다. 가입·재설정 두 화면의 코드
 * 칸이 이 함수 하나를 거친다(스펙 session-and-auth 「코드는 ASCII 숫자 여섯 자다」). 서버도 2차로 같은
 * 변환을 한다. iOS `InputSanitizer.sanitizeVerificationCode` 와 같은 규칙.
 */
internal fun sanitizeVerificationCode(raw: String): String = buildString(VerificationCodeLength) {
    var index = 0
    while (index < raw.length && length < VerificationCodeLength) {
        // 코드 포인트로 본다 — BMP 밖의 십진 숫자(수학 기호 숫자 등)는 서러게이트 쌍이다.
        val codePoint = raw.codePointAt(index)
        index += Character.charCount(codePoint)
        val digit = Character.digit(codePoint, 10)
        if (digit >= 0) append('0' + digit)
    }
}
