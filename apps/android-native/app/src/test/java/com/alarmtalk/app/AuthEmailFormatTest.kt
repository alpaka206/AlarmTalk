package com.alarmtalk.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 이메일 형식 판정이 **서버와 같은 답**을 내는지 고정한다.
 *
 * 같은 표가 세 곳에 있다 — `packages/shared/test/schemas.test.ts`,
 * iOS `AlarmTalkTests/AuthEmailFormatTests.swift`. **한 줄을 고치면 셋을 같이 고친다.**
 * 앱이 서버보다 느슨하면 서버가 거절하고, 빡빡하면 서버가 허용하는 주소를 못 쓴다 —
 * 예전에는 후자였고(`android.util.Patterns.EMAIL_ADDRESS`), 아포스트로피가 든 주소로
 * 가입한 사람은 **로그인 자체가 불가능**했다.
 */
class AuthEmailFormatTest {

    /** 입력 · 기대 · 무엇을 보는 줄인지. 세 구현이 공유하는 목록이다. */
    private val cases = listOf(
        // ⚠ 이 줄이 이 표가 생긴 이유다. CLAUDE.md 「"O'Brien" 은 정당한 이름이다」.
        Triple("o'brien@example.com", true, "아포스트로피"),
        // 반대 방향. 앱은 받았는데 서버가 거절해 왔다 — 이제 앱도 같이 거절한다.
        Triple("user%tag@example.com", false, "퍼센트"),
        Triple("  KIM@Example.COM  ", true, "앞뒤 공백 + 대문자"),
        Triple("WITH-CAPS@DOMAIN.COM", true, "대문자"),
        Triple("a.b+tag@sub.example.co", true, "점·플러스·서브도메인"),
        Triple("no-at-sign", false, "@ 없음"),
        Triple("a@example.c", false, "TLD 1글자"),
        Triple("@no-local.com", false, "로컬 파트 없음"),
        Triple("space in@local.com", false, "가운데 공백"),
        Triple("", false, "빈 문자열"),
    )

    @Test
    fun 세_구현이_같은_답을_내는_케이스_표() {
        for ((input, expected, why) in cases) {
            assertEquals("$why: [$input]", expected, isValidAuthEmail(input))
        }
    }

    @Test
    fun 패턴_상수는_서버와_같은_문자열이다() {
        // 서버 `packages/shared/src/schemas/auth.ts` 의 `EMAIL_PATTERN` 과 같은 값.
        // 여기서 바뀌면 서버도 같이 바꿔야 하므로 값을 못 박아 "한쪽만 고치고 끝" 을 막는다.
        assertEquals(
            "^(?:[A-Za-z0-9_'+-]+\\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\\.)+[A-Za-z]{2,}$",
            AuthEmailPattern,
        )
    }

    @Test
    fun 형식을_보기_전에_정규화한다() {
        // 자동완성·복사붙여넣기가 붙이는 값이다. 순서가 뒤집히면 공백 하나에 막힌다.
        assertEquals("kim@example.com", normalizeAuthEmail("  KIM@Example.COM \n"))
    }

    /**
     * ⚠ **형식으로 버튼을 죽이지 않는다**(CLAUDE.md 「잠그는 것은 '저장 중' 일 때뿐이다」).
     * 죽은 버튼은 이유를 알려 주지 않아 고장으로 읽힌다 — 누를 수 있게 두고, 누르면
     * 왜 안 되는지 말한다.
     */
    @Test
    fun 형식이_틀려도_제출_버튼은_살아_있다() {
        assertTrue(canSubmitLogin(email = "o'brien@", password = "any-non-empty"))
        assertEquals(
            AuthEmailSubmitOutcome.ShowEmailFormatError,
            authEmailSubmitOutcome("o'brien@"),
        )
    }

    @Test
    fun 빈_칸이면_보낼_것이_없어_버튼이_잠긴다() {
        // 형식과 달리 이쪽은 "무엇을 보낼지" 자체가 없다 — 알럿으로 말할 내용도 없다.
        assertFalse(canSubmitLogin(email = "", password = "any-non-empty"))
        assertFalse(canSubmitLogin(email = "kim@example.com", password = "   "))
    }

    @Test
    fun 형식이_맞으면_서버로_보낸다() {
        assertEquals(AuthEmailSubmitOutcome.Submit, authEmailSubmitOutcome("o'brien@example.com"))
        // 앞뒤 공백은 정규화가 걷어내므로 그대로 보낼 수 있다.
        assertEquals(AuthEmailSubmitOutcome.Submit, authEmailSubmitOutcome("  KIM@Example.COM  "))
    }

    /**
     * ⚠ **가입·재설정도 같은 규칙이다**(2026-09-21 리뷰). 예전에는 로그인만 "누를 수 있고
     * 누르면 말한다" 였고, 가입의 '이메일 인증' 과 재설정의 '인증 코드 받기' 는 형식으로
     * 버튼을 죽인 채 **아무 말도 하지 않았다.** 같은 주소를 두고 화면마다 다르게 굴면
     * 사용자는 어느 쪽이 고장인지 알 수 없다.
     */
    @Test
    fun 이메일만_보내는_버튼도_형식으로는_안_잠긴다() {
        assertTrue(canRequestEmailCode("o'brien@"))
        assertEquals(
            AuthEmailSubmitOutcome.ShowEmailFormatError,
            authEmailSubmitOutcome("o'brien@"),
        )
        // 잠기는 것은 보낼 것이 없을 때뿐이다.
        assertFalse(canRequestEmailCode(""))
        assertFalse(canRequestEmailCode("   "))
    }

    /**
     * ⚠ **갈래는 번역된 문구가 아니라 에러 코드로 가른다**(2026-09-21 리뷰).
     * 예전에는 화면이 `loginError == getString(auth_error_email_invalid)` 로 비교해서,
     * 문구를 한 글자 고치거나 다른 코드가 같은 문구 자원을 가리키는 순간 **아무 경고 없이**
     * 형식 오류가 비밀번호 칸 아래로 내려갔다.
     */
    @Test
    fun 이메일_형식_갈래는_코드로_가른다() {
        assertEquals("AUTH_EMAIL_INVALID", AuthEmailInvalidErrorCode)
        assertTrue(isEmailFormatErrorCode(AuthEmailInvalidErrorCode))
        // 비밀번호를 보고 낸 실패는 이 갈래가 아니다 — 비밀번호 칸이 맡는다.
        assertFalse(isEmailFormatErrorCode("AUTH_INVALID_CREDENTIALS"))
        assertFalse(isEmailFormatErrorCode("AUTH_VALIDATION_FAILED"))
        // 코드가 없는 실패(네트워크 단절 등)도 형식 갈래가 아니다.
        assertFalse(isEmailFormatErrorCode(null))
    }
}
