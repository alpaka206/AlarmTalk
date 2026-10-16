package com.alarmtalk.app

import android.app.Application
import android.content.Context
import android.os.Build
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * **유닛 테스트가 Sentry 로 쏘지 않는다** 를 고정한다 — ALARMTALK-ANDROID-2/-3(10,256건).
 *
 * 그 이벤트들은 사용자 기기가 아니라 **이 맥의 JVM 테스트**에서 올라왔다. Robolectric 이
 * 매니페스트의 [AlarmTalkApplication] 을 그대로 세워 테스트마다 `onCreate()` 가 돌았고,
 * 첫 줄 `initializeSentry()` 가 `~/.gradle/gradle.properties` 의 **진짜 DSN** 으로 SDK 를
 * 켠 뒤, JVM 에 없는 androidx.startup·AndroidKeyStore 때문에 줄줄이 터진 실패를
 * `runCatching{}.onFailure{ reportError }` 가 전부 이슈로 올렸다.
 *
 * 막는 겹이 둘이라 테스트도 둘이다 — [robolectricRunsThePlainApplication] 이 1차
 * (`src/test/resources/robolectric.properties`), 나머지가 2차([shouldInitializeSentry]).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SentryInitializationGateTest {

    @Test
    fun robolectricRunsThePlainApplication() {
        // ⚠ 이 한 줄이 1차 방어선의 전부다. `robolectric.properties` 가 사라지거나
        // `application=` 줄이 지워지면 매니페스트의 AlarmTalkApplication 이 다시 세워지고,
        // 테스트마다 onCreate()(→ Sentry 초기화 + WorkManager 예약 실패)가 돈다.
        val context = ApplicationProvider.getApplicationContext<Context>()
        assertEquals(Application::class.java, context.javaClass)
    }

    @Test
    fun robolectricFingerprintIsTheSentinel() {
        // 2차 방어선이 무엇을 보고 판단하는지 — android-all 의 build.prop 에
        // `ro.build.fingerprint=robolectric` 으로 박혀 있다. 이 값이 바뀌면 게이트가
        // 조용히 열리므로 여기서 고정한다.
        assertEquals(ROBOLECTRIC_BUILD_FINGERPRINT, Build.FINGERPRINT)
    }

    @Test
    fun sentryStaysOffUnderRobolectricEvenWithARealDsn() {
        // DSN 이 설정돼 있어도(= 이 맥의 로컬 빌드가 늘 그렇다) 켜지 않는다.
        assertFalse(shouldInitializeSentry(REAL_LOOKING_DSN, Build.FINGERPRINT))
    }

    @Test
    fun sentryStillInitializesOnRealDevices() {
        // ⚠ 실기기에서 WorkManager 초기화가 진짜로 깨졌을 때 우리에게 오는 **유일한 신호**가
        // 그 이벤트다. 게이트를 메시지 기준으로 넓히면 이 줄이 무너진다.
        assertTrue(shouldInitializeSentry(REAL_LOOKING_DSN, DEVICE_FINGERPRINT))
    }

    @Test
    fun sentryStaysOffWithoutDsn() {
        assertFalse(shouldInitializeSentry("", DEVICE_FINGERPRINT))
    }

    // ── 사전 출시 로봇은 환경으로 가른다(버리지 않는다) ─────────────────────

    @Test
    fun prelaunchRobotsWithoutTheSettingAreRecognizedByTheirScreen() {
        // 2026-10 Play 사전 출시 로봇은 firebase.test.lab 을 세우지 않았다 — 화면은 언제나 288×448·약 106dpi 였다.
        assertEquals("prelaunch", sentryEnvironment("production", null, displayShortSidePx = 288, displayDensityDpi = 106))
        // 실기기(짧은 변 720~1440, 320dpi 이상)는 그대로 production.
        assertEquals("production", sentryEnvironment("production", null, displayShortSidePx = 720, displayDensityDpi = 320))
        assertEquals("production", sentryEnvironment("production", null, displayShortSidePx = 1080, displayDensityDpi = 440))
        // 하나만 맞으면 가르지 않는다 — 좁지만 밀도가 높은 화면(접는 폰 바깥 화면 등), 밀도는 낮지만 넓은 화면.
        assertEquals("production", sentryEnvironment("production", null, displayShortSidePx = 300, displayDensityDpi = 320))
        assertEquals("production", sentryEnvironment("production", null, displayShortSidePx = 800, displayDensityDpi = 120))
        // 화면을 모르면 가르지 않는다.
        assertEquals("production", sentryEnvironment("production", null))
    }

    @Test
    fun prelaunchRobotsReportUnderTheirOwnEnvironment() {
        // 1.2.10 의 잡동사니 이슈(ANDROID-Q) 42건 중 26건이 Play 사전 출시 로봇이었다. 이벤트는
        // 그대로 올라오되 운영 사용자 수에 섞이지 않게 환경만 바꾼다.
        assertEquals("prelaunch", sentryEnvironment("production", "true"))
        assertEquals("prelaunch", sentryEnvironment("development", "true"))
    }

    @Test
    fun everythingElseKeepsTheBuildEnvironment() {
        // ⚠ 정확히 "true" 일 때만이다. 설정이 없거나(실기기) 다른 값이면 빌드가 정한 환경 그대로 —
        // 실기기 이벤트가 다른 환경으로 새면 운영 경보에서 사라진다.
        for (value in listOf(null, "", "false", "TRUE", "1", " true")) {
            assertEquals("값=$value", "production", sentryEnvironment("production", value))
        }
        assertEquals("development", sentryEnvironment("development", null))
    }

    @Test
    fun robolectricHasNoTestLabSetting() {
        // 초기화 경로가 읽는 그 설정이 테스트 환경에는 없다 — 읽기 자체가 던지지 않는다는 것까지 본다.
        val context = ApplicationProvider.getApplicationContext<Context>()
        val value = android.provider.Settings.System.getString(context.contentResolver, FIREBASE_TEST_LAB_SETTING)
        assertEquals("firebase.test.lab", FIREBASE_TEST_LAB_SETTING)
        assertEquals("production", sentryEnvironment("production", value))
    }

    private companion object {
        /** 값은 쓰이지 않는다 — 형태만 실제와 같게 둔다(테스트는 SDK 를 켜지 않는다). */
        const val REAL_LOOKING_DSN = "https://0123456789abcdef@o0.ingest.sentry.io/1234567"

        /** 테스트폰(SM-S918N)의 지문 모양. 실기기 지문은 슬래시로 나뉜 긴 문자열이다. */
        const val DEVICE_FINGERPRINT =
            "samsung/dm3qksx/dm3q:14/UP1A.231005.007/S918NKSU4CXG5:user/release-keys"
    }
}
