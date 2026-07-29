package com.alarmtalk.app

import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.alarm.RingingNotificationFactory
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 울림 알림 스와이프 제거 회귀 가드.
 *
 * 화면이 켜져 있고 잠금이 풀려 있으면 RingingService 가 울림 화면을 띄우지 않아, 이 알림이
 * 유일한 해제 UI 다. targetSdk 34+ 에서는 setOngoing(true) 로도 스와이프 제거를 막지 못하므로
 * (Android 13 의 FGS 알림 스와이프 허용 + 14 의 ongoing 무력화), deleteIntent 가 없으면
 * 배너만 사라지고 톤·목소리·진동이 무기한 계속된다.
 *
 * 시스템이 실제로 deleteIntent 를 발송하는지는 유닛 테스트로 잡히지 않는다 — 실기기 확인 필요.
 * 이 테스트는 "인텐트가 붙어 있는가"라는 회귀만 고정한다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "ko")
class RingingNotificationDismissTest {
    private val factory =
        RingingNotificationFactory(ApplicationProvider.getApplicationContext())

    @Test
    fun ringingNotificationCarriesDeleteIntentSoSwipeStopsTheAlarm() {
        val notification = factory.build("alarm-1")
        assertNotNull("스와이프 제거 시 알람을 멈출 deleteIntent 가 없다", notification.deleteIntent)
    }

    @Test
    fun fallbackNotificationHasNoDeleteIntent() {
        // 폴백은 FGS 를 못 띄운 경로라 getService 가 실패할 수 있고, 소리도 채널 사운드
        // 1회성이라 '무한히 울림' 대상이 아니다.
        val notification = factory.build("alarm-1", fallback = true)
        assertNull(notification.deleteIntent)
    }
}
