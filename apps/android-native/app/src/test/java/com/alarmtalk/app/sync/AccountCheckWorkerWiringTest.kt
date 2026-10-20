package com.alarmtalk.app.sync

import com.alarmtalk.app.readSource
import com.alarmtalk.app.withoutLineComments
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * **계정 확인 워커**(`RemoteAlarmSyncWorker`)가 받은 알람 pull 을 걷어낸 뒤에도 하던 일을 그대로 하는지 —
 * 백그라운드 토큰 갱신, plan 기록, 세션이 끝났는지 확인(401·파기된 계정·다른 기기의 탈퇴 신청).
 *
 * 이 일들이 빠지면 앱을 오래 안 연 사용자의 세션이 만료되고, 다른 기기에서 탈퇴를 신청해도 이 기기의 알람이 계속 운다.
 * 워커는 네트워크·WorkManager 를 물고 있어 배선은 소스로 본다(`SourceWiring.kt` 머리말). 판정 자체는
 * `SessionExpiryPlanTest`·`WorkerTokenRollTest`·`DestroyedAccountSessionTest` 가, 실패 처리의 모양은
 * CI lint(`scripts/check-sync-worker-unauthorized.py`)가 본다.
 */
class AccountCheckWorkerWiringTest {

    private val worker: String by lazy { withoutLineComments(readSource("sync/RemoteAlarmSyncWorker.kt")) }

    @Test
    fun `회차마다 실제로 보낸 토큰으로 계정을 조회한다`() {
        assertTrue(worker.contains("val usedToken = session.token"))
        assertTrue("계정 확인 워커가 `/auth/me` 를 부르지 않는다.", worker.contains("api.me(AlarmTalkApiClient.bearer(usedToken))"))
    }

    @Test
    fun `plan 은 인증에 쓴 세션의 계정으로 적는다`() {
        assertTrue(worker.contains(".write(AccessTicket(userId, startGeneration)"))
        assertTrue("plan 과 프로모 짝을 한 벌로 적지 않는다.", worker.contains("it.withServerUser(me.user, fetchedAt)"))
    }

    @Test
    fun `토큰은 만료가 가까울 때만 세대를 확인하며 갈아 끼운다`() {
        assertTrue(worker.contains("SessionTokenRenewal.shouldRenew(usedToken, fetchedAt)"))
        assertTrue(
            "토큰 저장이 세대 확인과 한 덩어리가 아니다 — 그 사이 로그아웃을 되돌린다.",
            worker.contains("sessionStore.saveTokenIfGeneration(startGeneration, rolled)"),
        )
    }

    @Test
    fun `세션이 끝났으면 떠나고 파기된 계정도 같은 결말이다`() {
        val start = worker.indexOf(".getOrElse")
        assertTrue("계정 확인 워커의 실패 처리(`getOrElse`)를 못 찾았다.", start >= 0)
        val failure = worker.substring(start)
        val destroyed = failure.indexOf("isDestroyedAccountFailure(error)")
        val general = failure.indexOf("syncWorkerOutcome(error)")
        assertTrue(
            "파기된 계정(404 `AUTH_USER_NOT_FOUND`)을 일반 판정보다 먼저 세션 만료로 보내지 않는다 — 이 라우트만 401 이 아니다.",
            destroyed in 0 until general,
        )
        assertTrue(failure.contains("SyncWorkerOutcome.SESSION_EXPIRED"))
        assertTrue("세션 만료·탈퇴 신청에서 세션을 끝내지 않는다.", failure.contains("endWorkerSession("))
    }

    @Test
    fun `탈퇴 신청 푸시가 이 워커를 부르고 작업 이름은 그대로다`() {
        val push = withoutLineComments(readSource("fcm/AlarmTalkMessagingService.kt"))
        val at = push.indexOf("message.data[\"type\"] == \"account_deletion_requested\"")
        assertTrue("FCM 서비스가 `account_deletion_requested` 를 받지 않는다.", at >= 0)
        assertTrue(push.substring(at, minOf(push.length, at + 200)).contains("RemoteAlarmSyncScheduler.runOnce(applicationContext)"))
        // 이름을 바꾸면 이미 깔린 주기 작업이 옛 이름으로 남아 같은 워커가 두 벌 돈다.
        val scheduler = withoutLineComments(readSource("sync/RemoteAlarmSyncScheduler.kt"))
        assertTrue(scheduler.contains("\"remote_alarm_periodic_sync\""))
        assertTrue(scheduler.contains("\"remote_alarm_immediate_sync\""))
    }
}
