package com.alarmtalk.app

import android.app.Notification
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import com.alarmtalk.app.alarm.NotificationChannels
import com.alarmtalk.app.alarm.RingingNotificationFactory
import com.alarmtalk.app.alarm.RingingNotificationFactory.Variant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * 울림 알림 회귀 가드 — 갈래별 채널·전체화면 인텐트·삭제 인텐트·플래그.
 *
 * ⚠ **잠긴 기기에서 울림 화면을 여는 유일한 공식 경로는 HIGH 채널의 전체화면 인텐트다.**
 * 2026-09-22 실기기(S23 Ultra / Android 16, A32 / Android 13 양쪽)에서 잠금 화면 알람이
 * **소리만 나고 화면이 없었다.** 원인 둘 다 logcat 으로 확인했다:
 *  1. 서비스의 `startActivity` 는 앱에 보이는 액티비티가 없으면 `BAL_BLOCK` 으로 조용히 막힌다.
 *  2. 그때 올리던 '승격' 알림은 같은 id 의 **갱신**이라 SystemUI 가 전체화면 인텐트를 검사하지
 *     않았고(새 항목에만 검사), 채널도 처음엔 LOW 였다.
 * 그래서 이제 **처음부터** ALERTING(HIGH + 전체화면)으로 올린다. 이 테스트는 그 계약을 고정한다.
 *
 * 시스템이 실제로 전체화면을 여는지·deleteIntent 를 발송하는지는 유닛 테스트로 잡히지 않는다 —
 * 실기기 확인 필요. 여기서는 "알림에 무엇이 실려 있는가" 라는 회귀만 고정한다.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "ko")
class RingingNotificationDismissTest {
    private val factory =
        RingingNotificationFactory(ApplicationProvider.getApplicationContext())

    @Test
    fun ringingNotificationCarriesDeleteIntentSoSwipeStopsTheAlarm() {
        val notification = factory.build("alarm-1", Variant.ALERTING)
        assertNotNull("스와이프 제거 시 알람을 멈출 deleteIntent 가 없다", notification.deleteIntent)
    }

    @Test
    fun quietNotificationKeepsDeleteIntent() {
        // ⚠ 조용한 갈래도 **서비스가 살아 있다**(코덱스 #729 3차). 삭제 인텐트가 없으면
        //   안드로이드 14+ 에서 스와이프로 배너만 사라지고 소리·진동이 무기한 계속된다.
        val notification = factory.build("alarm-1", Variant.QUIET)
        assertNotNull("조용한 알림에 삭제 인텐트가 없다 — 스와이프하면 못 끈다", notification.deleteIntent)
    }

    @Test
    fun fallbackNotificationHasNoDeleteIntent() {
        // 폴백은 FGS 를 못 띄운 경로라 getService 가 실패할 수 있고, 소리도 채널 사운드
        // 1회성이라 '무한히 울림' 대상이 아니다.
        val notification = factory.build("alarm-1", Variant.FALLBACK)
        assertNull(notification.deleteIntent)
    }

    @Test
    fun alertingNotificationOpensTheScreenThroughTheSystem() {
        // 잠금 화면에서 화면을 여는 유일한 길 — HIGH 채널 + 전체화면 인텐트 + 갱신에서도 알림.
        val notification = factory.build("alarm-1", Variant.ALERTING)
        assertEquals(NotificationChannels.RINGING_CHANNEL_ID, notification.channelId)
        assertNotNull("ALERTING 에 전체화면 인텐트가 없다 — 잠금 화면에서 소리만 난다", notification.fullScreenIntent)
        assertEquals(
            "ALERTING 이 ONLY_ALERT_ONCE 면 QUIET 에서 승격될 때 배너조차 안 뜬다",
            0,
            notification.flags and Notification.FLAG_ONLY_ALERT_ONCE,
        )
    }

    @Test
    fun quietNotificationNeverCompetesWithOurOwnScreen() {
        // 앱이 보여서 우리가 직접 띄우는 경우 — LOW 채널, 전체화면 인텐트 없음(있으면 배너가 겹친다).
        val notification = factory.build("alarm-1", Variant.QUIET)
        assertEquals(NotificationChannels.RINGING_QUIET_CHANNEL_ID, notification.channelId)
        assertNull("QUIET 에 전체화면 인텐트가 있다 — 우리 화면 위에 배너가 겹친다", notification.fullScreenIntent)
    }

    @Test
    fun fallbackNotificationStillOpensTheScreenThroughTheSystem() {
        val notification = factory.build("alarm-1", Variant.FALLBACK)
        assertEquals(NotificationChannels.RINGING_FALLBACK_CHANNEL_ID, notification.channelId)
        assertNotNull(notification.fullScreenIntent)
    }

    @Test
    fun ringingScreenIntentsDoNotClearTheTask() {
        // ⚠ CLEAR_TASK 가 있으면 시스템(전체화면)과 우리(startActivity)가 같은 화면을 연달아
        //   열 때 먼저 뜬 인스턴스가 파괴되고, 그 onStop 이 '떠났다' 로 읽혀 알람이 2초 만에
        //   꺼진다(2026-09-09 SM-A325N). singleTask 라 두 번째 열기는 onNewIntent 로 가야 한다.
        assertEquals(
            0,
            RingingNotificationFactory.RINGING_ACTIVITY_FLAGS and Intent.FLAG_ACTIVITY_CLEAR_TASK,
        )
        val notification = factory.build("alarm-1", Variant.ALERTING)
        val launched = shadowOf(notification.fullScreenIntent).savedIntent
        assertEquals(0, launched.flags and Intent.FLAG_ACTIVITY_CLEAR_TASK)
        assertTrue(launched.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
    }

    @Test
    fun initialVariantFollowsWhetherTheAppIsVisible() {
        // 보이는 액티비티가 있는가 = Android 14+ 가 서비스의 startActivity 를 허용하는가.
        assertEquals(Variant.QUIET, RingingNotificationFactory.initialVariant(appHasVisibleActivity = true))
        assertEquals(Variant.ALERTING, RingingNotificationFactory.initialVariant(appHasVisibleActivity = false))
    }
}
