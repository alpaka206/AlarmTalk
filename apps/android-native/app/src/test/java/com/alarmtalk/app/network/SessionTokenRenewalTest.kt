package com.alarmtalk.app.network

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.junit.runner.RunWith

/**
 * "한 번 로그인하면 다시 안 해도 된다" 를 지키는 판정.
 *
 * ⚠ iOS `SessionTokenRenewalTests.swift` 와 **같은 경우**를 검사한다. 두 플랫폼의
 * 임계값·판정이 갈라지면 한쪽만 조용히 로그아웃된다.
 *
 * Robolectric 을 쓰는 이유: `android.util.Base64` 는 JVM 단위 테스트에서 스텁이라
 * 항상 0 을 돌려준다(그러면 이 테스트가 통과하는 척만 한다).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SessionTokenRenewalTest {

    /** 서명 없이 payload 만 있는 가짜 JWT — 판정은 `exp` 만 읽으므로 이걸로 충분하다. */
    private fun token(expiresInSeconds: Long, nowMillis: Long = NOW): String {
        val exp = nowMillis / 1000 + expiresInSeconds
        val payload = JSONObject().put("exp", exp).toString()
        val encoded = android.util.Base64.encodeToString(
            payload.toByteArray(Charsets.UTF_8),
            android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING,
        )
        return "header.$encoded.signature"
    }

    @Test
    fun `exp 클레임을 읽는다`() {
        val expiresAt = SessionTokenRenewal.expiresAtMillis(token(3600))
        assertEquals((NOW / 1000 + 3600) * 1000, expiresAt)
    }

    /** 방금 발급된 토큰(365일)은 건드리지 않는다 — 15분마다 갱신하면 하루 96회다. */
    @Test
    fun `갓 발급된 토큰은 갱신하지 않는다`() {
        assertFalse(SessionTokenRenewal.shouldRenew(token(365 * 24 * 3600), NOW))
    }

    @Test
    fun `임계값을 지나면 갱신한다`() {
        assertTrue(SessionTokenRenewal.shouldRenew(token(80 * 24 * 3600), NOW))
    }

    @Test
    fun `만료된 토큰은 갱신한다`() {
        assertTrue(SessionTokenRenewal.shouldRenew(token(-3600), NOW))
    }

    /**
     * ⚠ 핵심: **못 읽으면 갱신한다.** false 로 답하면 갱신이 영영 안 돌아
     * 조용한 로그아웃으로 끝난다.
     */
    @Test
    fun `읽을 수 없는 토큰은 갱신한다`() {
        assertNull(SessionTokenRenewal.expiresAtMillis("not-a-jwt"))
        assertTrue(SessionTokenRenewal.shouldRenew("not-a-jwt", NOW))
        assertTrue(SessionTokenRenewal.shouldRenew("a.b.c", NOW))
        // exp 클레임이 없는 정상 형식
        val noExp = android.util.Base64.encodeToString(
            JSONObject().put("sub", "x").toString().toByteArray(Charsets.UTF_8),
            android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING,
        )
        assertTrue(SessionTokenRenewal.shouldRenew("header.$noExp.sig", NOW))
    }

    /** 세션이 없는 상태에서 헛되이 네트워크를 때리지 않는다. */
    @Test
    fun `빈 토큰은 갱신하지 않는다`() {
        assertFalse(SessionTokenRenewal.shouldRenew("", NOW))
    }

    /** base64url 은 패딩이 없다 — payload 길이가 달라져도 전부 읽혀야 한다. */
    @Test
    fun `패딩 없는 base64url 을 읽는다`() {
        listOf(1L, 61L, 3601L, 86_401L).forEach { seconds ->
            assertNotNull(
                "패딩 길이가 달라지는 exp=$seconds 에서 디코딩 실패",
                SessionTokenRenewal.expiresAtMillis(token(seconds)),
            )
        }
    }

    /** iOS 와 임계값이 같아야 한다(`SessionTokenRenewal.renewWhenRemaining`). */
    @Test
    fun `임계값은 90일이다`() {
        assertEquals(90L * 24 * 60 * 60 * 1000, SessionTokenRenewal.RENEW_WHEN_REMAINING_MILLIS)
    }

    private companion object {
        /** 고정 시각 — 테스트가 실행 시각에 흔들리지 않게. */
        const val NOW = 1_800_000_000_000L
    }
}
