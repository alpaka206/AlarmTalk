package com.alarmtalk.app

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 표시 문구에서 delivery 태그를 벗기는 규칙.
 *
 * 이 헬퍼가 실어 나르는 값은 편집기의 편집 대상이라 **그대로 다시 저장된다.** 대괄호를 가리지
 * 않고 벗기던 시절에는 사용자가 직접 친 대괄호까지 지워져, 알람을 한 번 열었다 저장하는 것만으로
 * 그 부분이 영구히 사라졌다(Codex #660). 서버는 사용자가 친 대괄호를 의도적으로 보존하므로
 * (`deriveAlarmDisplayText`) 앱이 더 지우면 계약이 어긋난다.
 */
class DeliveryTagStripTest {

    @Test
    fun `옛 행에 섞인 delivery 태그는 벗긴다`() {
        // 19ffac80 제보 원본 형태(dev messages 268행 중 10행).
        assertEquals(
            "김규원, 아침이 밝았어. 이불 속 오 분만 더.",
            "[morning] 김규원, [brightly] 아침이 밝았어. 이불 속 오 분만 더.".stripDeliveryTags(generated = true),
        )
    }

    @Test
    fun `대문자 태그도 벗긴다`() {
        assertEquals("잘 잤어?", "[Cheerfully] 잘 잤어?".stripDeliveryTags(generated = true))
    }

    @Test
    fun `사용자가 친 대괄호는 그대로 둔다`() {
        // ⚠ **판정 축은 '출처' 하나다**(2026-08-13 변경).
        // 예전에는 철자 목록으로 "우리 태그인가" 를 가렸지만, 이제 태그 어휘가 **열린
        // 집합**이라(비언어 소리·발성 방식·태도) `[after lunch]`(사용자 메모)와
        // `[laughs nervously]`(우리 태그)를 **모양으로는 구분할 수 없다.**
        //
        // 그래서 사용자 문구는 `generated = false` 로 들어와 **아예 손대지 않는 것**으로
        // 지킨다. 서버도 같은 축이다(`deriveAlarmDisplayText` 는 사용자가 친 대괄호를 보존).
        assertEquals(
            "[after lunch] take medicine",
            "[after lunch] take medicine".stripDeliveryTags(generated = false),
        )
    }

    @Test
    fun `벗길 게 없으면 원문을 손대지 않는다`() {
        // 공백 정리조차 하지 않는다 — 이 값이 그대로 다시 저장되는 경로가 있다.
        val original = "  일어나  규원아  "
        assertEquals(original, original.stripDeliveryTags(generated = true))
    }

    // 생성물 안의 대괄호는 **전부 우리 것**이다 — 그 문구는 사용자가 친 적이 없다.
    @Test
    fun `생성물의 대괄호는 목록에 없던 어휘도 벗긴다`() {
        assertEquals(
            "일어나! 오늘도 힘내자.",
            "[shouting] 일어나! [laughs nervously] 오늘도 힘내자.".stripDeliveryTags(generated = true),
        )
        // 쉼표가 든 두 마디 지시도 벗겨야 한다 — 예전 정규식은 매치조차 못 했다.
        assertEquals(
            "I am ready.",
            "[measured, deliberate] I am ready.".stripDeliveryTags(generated = true),
        )
    }

    @Test
    fun `태그만 있는 문구는 비우지 않는다`() {
        // 비우면 편집기가 저장을 막아 그 알람을 고치지도 지우지도 못하게 된다.
        assertEquals("[calm]", "[calm]".stripDeliveryTags(generated = true))
    }

    @Test
    fun `한글 대괄호는 태그가 아니다`() {
        assertEquals("[점심 후] 약 먹기", "[점심 후] 약 먹기".stripDeliveryTags(generated = true))
    }

    @Test
    fun `사용자가 직접 입력한 문구는 태그 철자여도 손대지 않는다`() {
        // 철자만 보고 거르면 `[calm] 약 먹기` 처럼 태그와 같은 단어를 사용자가 쓴 경우를
        // 구분할 수 없다. 저장 시 그 부분이 영구히 사라진다.
        assertEquals(
            "[calm] 약 먹기",
            "[calm] 약 먹기".stripDeliveryTags(generated = false),
        )
        assertEquals(
            "[morning] 김규원, [brightly] 아침이 밝았어.",
            "[morning] 김규원, [brightly] 아침이 밝았어.".stripDeliveryTags(generated = false),
        )
    }
}
