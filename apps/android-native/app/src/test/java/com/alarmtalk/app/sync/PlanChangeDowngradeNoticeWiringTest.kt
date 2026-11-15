package com.alarmtalk.app.sync

import com.alarmtalk.app.readSource
import com.alarmtalk.app.withoutLineComments
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * **백그라운드 강등도 안내를 남긴다**(2026-10-29 두 앱 비교).
 *
 * 앱을 닫아 둔 사이 구독이 끝나면 `plan_changed` 워커가 먼저 잠근다. 다음에 앱을 열어도 전경의
 * `applyFreePlanVoiceLock` 은 이미 잠긴 행을 건너뛰어 0 개를 잠그므로, 워커가 대기표에 적지 않으면 안내가 영영 뜨지 않는다.
 * 워커는 네트워크·WorkManager 를 물고 있어 배선만 소스로 본다(`SourceWiring.kt` 머리말). 개수가 0 이면 `record` 가 아무것도 하지 않는다.
 */
class PlanChangeDowngradeNoticeWiringTest {

    private val worker: String by lazy { withoutLineComments(readSource("sync/PlanChangeSyncWorker.kt")) }

    @Test
    fun `워커가 잠근 개수를 확정한 계정의 무료 강등 안내로 적는다`() {
        val lock = worker.indexOf("val locked = AlarmAppContainer.repository(applicationContext)")
        assertTrue("워커가 잠근 개수를 받지 않는다 — 안내에 넘길 값이 없다.", lock >= 0)
        val record = worker.indexOf(
            "DowngradeNoticeStore(applicationContext).record(userId, DowngradeNoticeStore.Cause.FREE_PLAN, locked)",
        )
        assertTrue("워커가 잠근 뒤 무료 강등 안내를 남기지 않는다.", record > lock)
    }
}
