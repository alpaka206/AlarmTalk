package com.alarmtalk.app.network

import com.google.gson.TypeAdapter
import com.google.gson.stream.JsonReader
import com.google.gson.stream.JsonToken
import com.google.gson.stream.JsonWriter

/**
 * `personal_promo` 를 **관대하게** 읽는 Gson 어댑터([PersonalPromo] 에 `@JsonAdapter` 로 붙는다).
 *
 * 왜 따로 두는가: 이 값은 이용권 화면의 한 줄과 종료 안내에만 쓰는 **표시용** 필드인데, Gson
 * 기본(리플렉션) 어댑터는 객체 자리에 문자열·배열·숫자가 오면 `JsonSyntaxException` 을 던진다.
 * 그 예외는 이 필드가 아니라 **응답 전체**의 파싱을 깨뜨린다 — 로그인·가입·`/auth/me`·구독
 * 조회가 통째로 실패한다. 표시용 필드 하나 때문에 로그인이 막히면 안 되므로:
 *
 * - 객체가 아니면(문자열·배열·숫자·불리언) **값을 건너뛰고 null** — 프로모가 없는 것으로 본다.
 * - 객체 안의 필드도 모양이 틀리면 그 필드만 null 이다(`ends_at` 이 숫자 등). 모르는 키는 건너뛴다.
 * - JSON `null` 은 Gson 이 이 어댑터를 부르기 전에 null 로 처리한다(`@JsonAdapter` 의 nullSafe 기본값).
 *
 * iOS 는 `PersonalPromo.init(from:)` 이 던지지 않는 것으로 같은 규칙을 지킨다.
 *
 * 쓰기(`AccessSnapshot` 캐시 직렬화)는 서버와 같은 키로 적는다 — 캐시를 다시 읽을 때도 이
 * 어댑터가 읽는다.
 */
class PersonalPromoJsonAdapter : TypeAdapter<PersonalPromo>() {

    override fun read(reader: JsonReader): PersonalPromo? {
        if (reader.peek() != JsonToken.BEGIN_OBJECT) {
            reader.skipValue()
            return null
        }
        var endsAt: String? = null
        var noticeFrom: String? = null
        var deletesVoicesAtEnd: Boolean? = null
        reader.beginObject()
        while (reader.hasNext()) {
            when (reader.nextName()) {
                KEY_ENDS_AT -> endsAt = reader.stringOrNull()
                KEY_NOTICE_FROM -> noticeFrom = reader.stringOrNull()
                KEY_DELETES_VOICES_AT_END -> deletesVoicesAtEnd = reader.booleanOrNull()
                else -> reader.skipValue()
            }
        }
        reader.endObject()
        return PersonalPromo(
            endsAt = endsAt,
            noticeFrom = noticeFrom,
            deletesVoicesAtEnd = deletesVoicesAtEnd,
        )
    }

    override fun write(out: JsonWriter, value: PersonalPromo?) {
        if (value == null) {
            out.nullValue()
            return
        }
        out.beginObject()
        value.endsAt?.let { out.name(KEY_ENDS_AT).value(it) }
        value.noticeFrom?.let { out.name(KEY_NOTICE_FROM).value(it) }
        value.deletesVoicesAtEnd?.let { out.name(KEY_DELETES_VOICES_AT_END).value(it) }
        out.endObject()
    }

    private fun JsonReader.stringOrNull(): String? =
        if (peek() == JsonToken.STRING) {
            nextString()
        } else {
            skipValue()
            null
        }

    private fun JsonReader.booleanOrNull(): Boolean? =
        if (peek() == JsonToken.BOOLEAN) {
            nextBoolean()
        } else {
            skipValue()
            null
        }

    private companion object {
        const val KEY_ENDS_AT = "ends_at"
        const val KEY_NOTICE_FROM = "notice_from"
        const val KEY_DELETES_VOICES_AT_END = "deletes_voices_at_end"
    }
}
