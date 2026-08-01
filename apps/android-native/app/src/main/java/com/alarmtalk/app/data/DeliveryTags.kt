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
 * 화면에 보여줄 문구에서 delivery 태그를 벗긴다.
 *
 * 태그는 음성 연출용이라 **어떤 경로의 문구든 사용자에게 보이면 안 된다.** 서버가 이미 벗겨서
 * 내려주지만, 과거에 태그가 섞여 저장된 행이 남아 있고(19ffac80 제보: dev 268행 중 10행
 * `김규원, [brightly] 아침이 밝았어…`) 그 문구를 편집기에서 한 번 고치면 '사용자가 친 대괄호'로
 * 취급돼 계속 살아남는다. 그래서 표시 직전에 한 번 더 벗긴다.
 *
 * **대괄호를 가리지 않고 벗기면 안 된다.** 서버는 사용자가 친 대괄호를 의도적으로 보존하는데
 * (`deriveAlarmDisplayText`) 앱만 지우면, 편집기에서 한 번 열었다 저장하는 순간 그 부분이 영구히
 * 사라진다. `[calm]` 하나만 입력한 알람은 문구가 통째로 비어 저장조차 막혔다(Codex #660).
 * 그래서 [DELIVERY_TAGS] 에 있는 것만 벗기고, 벗길 게 없으면 원문을 **그대로** 돌려준다
 * (공백 정리조차 하지 않는다 — 이 값이 그대로 다시 저장되는 경로가 있다).
 */
internal fun String.stripDeliveryTags(): String {
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
