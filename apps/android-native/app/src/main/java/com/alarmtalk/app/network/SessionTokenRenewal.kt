package com.alarmtalk.app.network

import android.util.Base64
import org.json.JSONObject

/**
 * **한 번 로그인하면 다시 안 해도 되게** 만드는 조각.
 *
 * 서버 토큰은 365일이고 `GET /auth/me` 가 매번 새 토큰을 준다(rolling refresh). 그런데
 * 그 갱신이 **앱을 여는 것**에만 걸려 있으면, 알람 앱 특성상 몇 달씩 안 여는 사용자에게는
 * 아무 소용이 없다 — 알람은 앱을 안 열어도 `AlarmManager` 가 울리기 때문에 실제로 그런
 * 사용자가 흔하다. 만료된 채 열면 조용히 로그아웃돼 있고, 그게 알람 목록·재예약의 소유자
 * 게이트에 걸려 **알람이 사라지고 울리지도 않는** 상태가 된다.
 *
 * 그래서 이미 15분마다 도는 [com.alarmtalk.app.sync.RemoteAlarmSyncWorker] 가 만료가
 * 가까울 때 갱신을 대신 해 준다. 기기가 **1년에 한 번이라도 네트워크에 붙으면** 세션은
 * 끊기지 않는다.
 *
 * ⚠ **매 회차 갱신하지 말 것.** 15분마다 `/auth/me` 를 때리면 기기당 하루 96회다.
 * 남은 수명이 [RENEW_WHEN_REMAINING_MILLIS] 아래일 때만 부른다 — 정상 사용에서는
 * 대략 9개월에 한 번이고, 앱을 열어 온 사용자에게는 아예 안 걸린다.
 *
 * iOS 대응: `AlarmTalk/SessionTokenRenewal.swift` — **한쪽만 고치지 말 것.**
 */
object SessionTokenRenewal {

    /** 남은 수명이 이보다 짧으면 갱신한다. 서버 TTL(365일)의 약 1/4. */
    const val RENEW_WHEN_REMAINING_MILLIS: Long = 90L * 24 * 60 * 60 * 1000

    /**
     * JWT `exp`(초) 를 밀리초로. 형식이 아니거나 클레임이 없으면 null.
     *
     * 서명을 검증하지 않는다 — **판단이 아니라 일정**에 쓰는 값이라 그걸로 충분하다.
     * 위조된 exp 로 할 수 있는 최악은 갱신을 한 번 더 시도하는 것뿐이고, 진짜 판정은
     * 서버가 한다.
     */
    fun expiresAtMillis(token: String): Long? = runCatching {
        val part = token.split('.').getOrNull(1) ?: return@runCatching null
        val decoded = String(
            Base64.decode(part, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING),
            Charsets.UTF_8,
        )
        val exp = JSONObject(decoded).optLong("exp", 0L)
        if (exp <= 0L) null else exp * 1000L
    }.getOrNull()

    /**
     * 지금 갱신해야 하나.
     *
     * ⚠ **exp 를 못 읽으면 `true` 다.** 못 읽는 토큰은 (a) 우리가 모르는 형식이거나
     * (b) 깨진 것인데, 어느 쪽이든 "만료가 멀다" 고 단정할 근거가 없다. 여기서 false 를
     * 주면 갱신이 영영 안 돌아 조용한 로그아웃으로 끝난다 — 헛걸음 한 번이 훨씬 싸다.
     */
    fun shouldRenew(token: String, nowMillis: Long): Boolean {
        if (token.isBlank()) return false
        val expiresAt = expiresAtMillis(token) ?: return true
        return expiresAt - nowMillis < RENEW_WHEN_REMAINING_MILLIS
    }
}
