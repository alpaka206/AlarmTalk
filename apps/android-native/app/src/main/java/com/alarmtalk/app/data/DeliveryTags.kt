package com.alarmtalk.app

/**
 * 우리가 실제로 내보낸 적 있는 ElevenLabs delivery 태그(대괄호 안 연출 지시문) — **닫힌 목록**이다.
 *
 * 지금 쓰는 세트(백엔드 `vertex-translate.ts` 의 `APPROVED_TAGS`)에 더해, 그 이전 세트와 옛 프리셋
 * 문구에 섞여 저장된 것까지 담는다. 옛 행을 씻어내는 것이 이 헬퍼의 존재 이유라서다.
 * 서버에 태그를 새로 추가하면 여기에도 추가한다.
 */
private val DELIVERY_TAGS = setOf(
    "brightly",
    "calm",
    "calmly",
    "caring",
    "cheerfully",
    "comforting",
    "curious",
    "encouraging",
    "excited",
    "gentle",
    "gently",
    "happily",
    "happy",
    "lighthearted",
    "lightly",
    "playfully",
    "proudly",
    "quietly",
    "reassuringly",
    "sleepily",
    "softly",
    "tired",
    "warmly",
    "whispers",
    // 태그는 아니지만 옛 프리셋 문구 앞에 붙은 채 저장된 카테고리 표기(지금은 안 쓴다).
    "morning",
)

private val BRACKETED_RE = Regex("""\[([a-z][a-z -]{1,32})]""", RegexOption.IGNORE_CASE)
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
 * 생성물이어도 [DELIVERY_TAGS] 에 있는 것만 벗기고(우리가 내보낸 적 없는 대괄호는 보존),
 * 벗길 게 없으면 원문을 **그대로** 돌려준다 — 공백 정리조차 하지 않는다. 이 값이 그대로 다시
 * 저장되는 경로가 있다.
 *
 * @param generated 서버·프리셋이 만든 문구면 true, 사용자가 직접 입력한 문구면 false.
 */
internal fun String.stripDeliveryTags(generated: Boolean): String {
    if (!generated) return this
    var removed = false
    val stripped = BRACKETED_RE.replace(this) { match ->
        if (match.groupValues[1].lowercase() in DELIVERY_TAGS) {
            removed = true
            " "
        } else {
            match.value
        }
    }
    if (!removed) return this
    val cleaned = stripped.replace(WHITESPACE_RE, " ").trim()
    // 다 벗겨 아무것도 안 남으면 벗기지 않은 것으로 친다. 문구가 비면 편집기가 저장을 막아
    // (`editor_save_blocked_enter_message_or_random`) 알람을 고칠 수도 지울 수도 없게 된다.
    return cleaned.ifBlank { this }
}
