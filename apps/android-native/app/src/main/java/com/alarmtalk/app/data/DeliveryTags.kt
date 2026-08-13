package com.alarmtalk.app

/**
 * delivery 태그의 **모양**. 백엔드 `vertex-translate.ts` 의 `TAG_BODY_PATTERN` 과 같은 문자셋이다 —
 * **한쪽만 고치지 말 것.**
 *
 * ⚠ **쉼표를 빼지 말 것.** `[low, controlled]`·`[measured, deliberate]` 처럼 두 마디로 된 지시가
 * 흔하다. 쉼표가 없던 동안 그 형태는 **매치조차 되지 않아** 잠금화면에 대괄호가 그대로 샜다.
 */
private val BRACKETED_RE = Regex("""\[[a-z][a-z ,-]{1,48}]""", RegexOption.IGNORE_CASE)
private val WHITESPACE_RE = Regex("""\s+""")

/**
 * **기계가 만든 문구**에서 delivery 태그를 벗긴다.
 *
 * 태그는 음성 연출용이라 사용자에게 보이면 안 된다. 서버가 이미 벗겨서 내려주지만, 과거에
 * 태그가 섞여 저장된 행이 남아 있어(19ffac80 제보: dev 268행 중 10행
 * `김규원, [brightly] 아침이 밝았어…`) 표시 직전에 한 번 더 벗긴다.
 *
 * **판정 기준은 태그 철자가 아니라 출처다.** 사용자가 직접 친 문구에는 손대지 않는다.
 * 서버는 사용자가 친 대괄호를 의도적으로 보존하는데(`deriveAlarmDisplayText`) 앱만 지우면,
 * 편집기에서 한 번 열었다 저장하는 순간 그 부분이 영구히 사라진다. 철자만 보고 거르면
 * `[calm] 약 먹기` 처럼 **태그와 같은 단어를 사용자가 쓴 경우**를 구분할 수 없다(Codex #660).
 * 그래서 호출부가 '이 문구가 생성물인가'를 [generated] 로 알려 준다.
 *
 * ⚠ **철자 목록으로 판정하지 말 것**(2026-08-13 변경). 예전에는 우리가 내보낸 적 있는 태그
 * 25개를 적어 두고 그 철자에만 반응했는데, 이제 태그 어휘가 **열린 집합**이다(비언어 소리·
 * 발성 방식·태도를 모델이 고른다). 목록으로는 원리적으로 못 따라가고, 빠진 것은
 * `[shouting]`·`[laughs nervously]`·`[through gritted teeth]` 처럼 **그대로 화면에 샌다.**
 * 사용자가 친 대괄호를 지키는 일은 이제 전적으로 [generated](출처)가 맡는다.
 *
 * 벗길 게 없으면 원문을 **그대로** 돌려준다 — 공백 정리조차 하지 않는다. 이 값이 그대로 다시
 * 저장되는 경로가 있다.
 *
 * @param generated 서버·프리셋이 만든 문구면 true, 사용자가 직접 입력한 문구면 false.
 */
internal fun String.stripDeliveryTags(generated: Boolean): String {
    if (!generated) return this
    if (!BRACKETED_RE.containsMatchIn(this)) return this
    val stripped = BRACKETED_RE.replace(this, " ")
    val cleaned = stripped.replace(WHITESPACE_RE, " ").trim()
    // 다 벗겨 아무것도 안 남으면 벗기지 않은 것으로 친다. 문구가 비면 편집기가 저장을 막아
    // (`editor_save_blocked_enter_message_or_random`) 알람을 고칠 수도 지울 수도 없게 된다.
    return cleaned.ifBlank { this }
}
