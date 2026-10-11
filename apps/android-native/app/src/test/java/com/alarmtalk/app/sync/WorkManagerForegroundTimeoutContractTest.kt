package com.alarmtalk.app.sync

import org.junit.Assert.assertNotNull
import org.junit.Test

/**
 * **WorkManager 는 `Service.onTimeout` 을 처리하는 버전이어야 한다** — ALARMTALK-ANDROID-Y(2026-10-09 prod).
 *
 * 기본 목소리 받기 워커([StockClipPrefetchWorker])는 `dataSync` 포그라운드 서비스를 올린다. Android 15
 * 부터 시스템은 그 타입의 서비스를 시간 한도로 끝낼 수 있고, 끝내라는 신호가
 * `Service.onTimeout(startId, fgsType)` 이다. 신호를 받고도 서비스가 떠 있으면 시스템이 10초 뒤
 * `ForegroundServiceDidNotStopInTimeException` 으로 **앱을 죽인다.**
 *
 * WorkManager 2.9.1(1.2.10 이 쓰던 버전)의 `SystemForegroundService` 에는 그 콜백이 **없다** —
 * `Service` 의 빈 기본 구현이 돌아 아무도 서비스를 멈추지 않았다. 2.10 부터 WorkManager 가 그 작업과
 * 서비스를 멈추고 작업을 다시 예약한다(스펙 voice-and-message 「준비 페이지」).
 *
 * 이 테스트는 **버전을 내리는 순간** 깨진다. 의존성 정리로 2.9.x 로 되돌아가면 크래시가 조용히
 * 돌아오는데, 그건 Android 15+ 기기에서 시스템이 한도에 닿았다고 볼 때만 나타나 CI 도 테스트폰도
 * 놓치기 쉽다. 실제로 멈추는지는 실기기로만 보인다(스펙 「검증 방법」의 `data_sync_fgs_timeout_duration`).
 *
 * Robolectric 이 필요 없다 — 클래스에 메서드가 **선언돼 있는가**만 본다(`android.jar` 스텁으로 충분하다).
 */
class WorkManagerForegroundTimeoutContractTest {

    @Test
    fun systemForegroundServiceHandlesTheForegroundServiceTimeout() {
        // 선언만 본다 — 클래스를 초기화하지 않는다(정적 초기화가 안드로이드 런타임을 건드리지 않게).
        val service = Class.forName(
            "androidx.work.impl.foreground.SystemForegroundService",
            false,
            javaClass.classLoader,
        )
        // `getDeclaredMethod` 라 상속받은 `Service.onTimeout` 의 빈 구현은 세지 않는다 — WorkManager 가
        // **직접 구현한** 것이어야 한다. 없으면 NoSuchMethodException 으로 실패한다.
        val onTimeout = service.getDeclaredMethod(
            "onTimeout",
            Int::class.javaPrimitiveType,
            Int::class.javaPrimitiveType,
        )
        assertNotNull(
            "WorkManager 의 SystemForegroundService 가 onTimeout(int, int) 을 구현하지 않는다 — " +
                "androidx.work:work-runtime-ktx 가 2.10 아래로 내려갔다(app/build.gradle.kts).",
            onTimeout,
        )
    }
}
