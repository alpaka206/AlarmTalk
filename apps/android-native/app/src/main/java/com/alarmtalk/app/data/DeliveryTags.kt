package com.alarmtalk.app

/**
 * ElevenLabs delivery 태그(대괄호 안 연출 지시문) 형태. 서버 `normalizeAlarmTextWithoutTags` 와 같은 규격.
 */
private val DELIVERY_TAG_RE = Regex("""\[[a-z][a-z -]{1,32}]""", RegexOption.IGNORE_CASE)

/**
 * 화면에 보여줄 문구에서 delivery 태그를 벗긴다.
 *
 * 태그는 음성 연출용이라 **어떤 경로의 문구든 사용자에게 보이면 안 된다.** 서버가 이미
 * 벗겨서 내려주지만, 과거에 태그가 섞여 저장된 행이 남아 있고(dev 실측 268행 중 10행:
 * `김규원, [brightly] 아침이 밝았어…`) 그 문구를 편집기에서 한 번 고치면 '사용자가 친
 * 대괄호'로 취급돼 계속 살아남는다. 그래서 표시 직전에 한 번 더 벗긴다.
 */
internal fun String.stripDeliveryTags(): String =
    replace(DELIVERY_TAG_RE, " ").replace(Regex("""\s+"""), " ").trim()
