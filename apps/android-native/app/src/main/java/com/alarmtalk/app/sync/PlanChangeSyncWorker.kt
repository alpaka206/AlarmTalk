package com.alarmtalk.app.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.alarmtalk.app.AccessSnapshotStore
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.data.AlarmAppContainer
import com.alarmtalk.app.isDefinitelyFree
import com.alarmtalk.app.resolvePaidVoiceAccess
import com.alarmtalk.app.storeSignalStillValid
import com.alarmtalk.app.hasPaidVoiceAccess
import com.alarmtalk.app.network.AlarmTalkApiClient
import com.alarmtalk.app.network.AuthSessionStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 서버 plan_changed 푸시(구독 만료 → 무료 강등) 처리 워커. FCM 서비스가 즉시 리턴한 뒤 프로세스가
 * 죽어도 살아남게 WorkManager 로 돌린다(가족 알람 pull 과 동일 패턴, 네트워크 제약). 구독·플랜·가족을
 * 재조회해 '진짜 무료'(유료구독 없음 + 가족/커플 아님 + user.plan=free)면 유료 목소리 알람을 기본
 * 알람으로 변환한다(강등 '시점'에 반영). 유료/가족/애매하면 변환하지 않아 오변환이 없다. 놓쳐도
 * 다음 앱 시작·울림 시점 게이트가 폴백. 조회 실패는 retry(네트워크 연결 시 재시도).
 */
class PlanChangeSyncWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val sessionStore = AuthSessionStore(applicationContext)
        val session = sessionStore.read() ?: return Result.success()
        // 시작 시점의 세션 세대 — 결과를 쓰기 전에 같은 세션인지 대조한다.
        val startGeneration = sessionStore.sessionGeneration()
        return runCatching {
            val api = AlarmTalkApiClient.create()
            val auth = AlarmTalkApiClient.bearer(session.token)

            // 최신 구독·플랜·가족 재조회(강등 확정 확인). 서버측 plan=free 는 /auth/me 로만 관찰
            // 가능하므로 billing·me 는 필수 — 둘 중 하나라도 실패하면 확정할 수 없으니 throw 시켜
            // outer runCatching 이 Result.retry() 로 처리한다(성공으로 조용히 끝내지 않는다). 가족은 보조.
            val billing = withContext(Dispatchers.IO) { api.getSubscription(auth) }
            // 응답 전체를 들고 있는다 — /auth/me 는 새 토큰도 함께 준다(rolling refresh).
            // user 만 꺼내 버리면 이 워커가 만료 직전 유일한 호출자일 때 갱신된 토큰이 버려지고,
            // 세션이 그대로 만료돼 재로그인을 강요한다(Codex #665 P2).
            val me = withContext(Dispatchers.IO) { api.me(auth) }
            val freshUser = me.user
            val familyGroup = runCatching { withContext(Dispatchers.IO) { api.getFamilyGroup(auth) } }.getOrNull()

            // 네트워크 왕복 중 로그아웃/계정전환이 일어났을 수 있다 — 결과를 쓰기 전에 현재 세션이 아직
            // **같은 계정**인지 재확인한다. 바뀌었으면 옛 세션을 부활시키거나 새 세션을 덮어쓰지
            // 않도록 이 결과를 버린다(성공 처리, 재시도 불요). (FCM 토큰 등록 레이스 가드와 동일 패턴.)
            //
            // 판정 기준은 **세션 세대**다. 토큰으로 보면 rolling refresh 도 '전환' 으로 오판하고,
            // 계정 id 로 보면 로그아웃 후 같은 계정 재로그인을 통과시켜 폐기된 옛 토큰을
            // 되살려 쓴다(Codex #665 P1·P2). 세대는 세션이 끝날 때만 바뀐다.
            val current = sessionStore.read()
            if (current == null ||
                current.user.id != session.user.id ||
                sessionStore.sessionGeneration() != startGeneration
            ) {
                return@runCatching Result.success()
            }

            // 로컬 영속 반영 — 울림 시점 게이트·다음 앱 오픈 UI 가 최신 상태를 쓰게 한다.
            val userId = session.user.id
            val snapshotStore = AccessSnapshotStore(applicationContext)
            snapshotStore.updateSubscription(userId, billing)
            snapshotStore.updateFamilyGroup(userId, familyGroup)
            // ⚠ **방금 받은 plan 도 함께 적는다**(2026-09-01 리뷰). 여기까지 와서 `freshUser`
            // 로 판정만 하고 적지 않으면, 울림 게이트가 읽는 값은 강등 **전** 등급 그대로다.
            // 보류(ON_HOLD)에서 특히 치명적이다 — 서버는 구독 행을 남긴 채 `users.plan` 만
            // 회수하므로, 그 값이 옛 유료로 남아 있으면 판정기가 남은 행을 보고 유료라고
            // 답한다(`resolvePaidVoiceAccess` 2단이 그래서 plan 을 먼저 본다).
            snapshotStore.updateUserPlan(userId, freshUser.plan)
            // 토큰 우선순위: **이 요청이 방금 받은 새 토큰 → 지금 저장소의 토큰**. 시작 시점에
            // 잡아 둔 session.token 은 쓰지 않는다 — 그 사이 굴러간 토큰을 옛 것으로 되돌린다.
            //
            // **토큰만 쓴다.** 프로필까지 쓰면, `/auth/me` 를 받은 뒤 남은 요청을 도는 사이
            // 전경에서 바뀐 닉네임·설정을 자기 옛 스냅샷으로 되돌린다 — 화면은 저장소를 따라
            // 오므로 사용자가 방금 바꾼 이름이 눈앞에서 옛 이름으로 돌아간다(Codex #665 P2).
            // 이 워커에 필요한 건 굴러간 토큰 하나뿐이고, 플랜 판정은 아래에서 `freshUser` 로
            // 직접 하며 권한 스냅샷은 위 `AccessSnapshotStore` 가 따로 들고 있다.
            //
            // 위 확인 이후에도 로그아웃이 끼어들 수 있다. 그래서 '검사 후 저장' 이 아니라
            // **검사와 저장을 한 덩어리로** 하는 [AuthSessionStore.saveTokenIfGeneration] 을
            // 쓴다. 따로 하면 그 사이가 창이라, 비운 저장소에 이 세션을 되쓰면 로그아웃이 통째로
            // 되돌아가고 이어지는 무료 강등이 떼어낸 알람을 로그인 화면 뒤에서 다시 예약한다
            // (Codex #665 P1).
            val rolledToken = me.token?.takeIf { it.isNotBlank() } ?: current.token
            if (sessionStore.saveTokenIfGeneration(startGeneration, rolledToken) == null) {
                return@runCatching Result.success()
            }

            // '진짜 무료'만 변환한다. 판정은 **유일 판정기**로 하고(2026-09-01 리뷰),
            // 스토어 신호를 반드시 넣는다 — Play 가 갱신을 확인해 준 기기에서 서버 반영이
            // 잠깐 늦어 `users.plan` 이 free 로 보이는 순간에 이 워커가 돌면, 돈을 내고 있는
            // 사용자의 클론 목소리 알람이 **영구 변환**된다(안드로이드는 되돌리지 않는다).
            // 「스토어가 권위다」가 여기에도 걸려야 하는 이유다.
            val plan = freshUser.plan
            val now = System.currentTimeMillis()
            val access = resolvePaidVoiceAccess(
                subscriptionResponse = billing,
                familyGroup = familyGroup,
                userPlan = plan,
                storeEntitled = snapshotStore.read(userId).storeSignalStillValid(now),
                nowMillis = now,
            )
            // ⚠ **남아 있는 구독 행을 한 번 더 본다.** 판정기는 `users.plan = free` 를 행보다
            // 위로 보므로(보류를 잡기 위한 규칙) 그것만으로 참이 되는데, 보류는 **회복형**이라
            // 결제가 복구되면 살아난다. 울림·예약은 판정기 그대로 막히지만(되돌릴 수 있다),
            // 이 자리의 변환은 되돌릴 수 없으니 행이 살아 있는 동안에는 하지 않는다.
            val genuinelyFree = access.isDefinitelyFree() && !hasPaidVoiceAccess(billing)
            if (genuinelyFree) {
                // **강등도 세션이 살아 있을 때만 한다.** 세션 쓰기 앞에서 한 번 봤다고 끝이
                // 아니다 — `lockPaidAlarmTalks` 는 알람 행을 고치고 OS 예약을 **새로 거는**
                // 파괴적 쓰기라, 그 사이 로그아웃이 끼면 방금 취소된 예약을 되살린다.
                // 목록은 소유자 필터에 가려 안 보이는데 리시버는 Room 을 직접 읽어 울린다 —
                // 로그인 화면 뒤에서 끌 수 없는 알람이 된다(Codex #665 P1).
                if (sessionStore.sessionGeneration() != startGeneration || sessionStore.read() == null) {
                    return@runCatching Result.success()
                }
                // 그리고 **판정을 확정한 계정을 함께 넘긴다.** 여기까지 통과한 뒤에도 저장소가
                // 소유자를 다시 읽기 전에 로그아웃→B 로그인이 끼면, A 로 확정한 '진짜 무료' 가
                // B 의 **유료** 알람에 적용돼 sound-only 로 바뀌고 다시 예약된다. 검사와 파괴적
                // 쓰기가 다른 시점이면 이 창은 호출부에서 못 닫는다(Codex #665 P1).
                AlarmAppContainer.repository(applicationContext)
                    .lockPaidAlarmTalks(expectedOwnerUserId = userId)
            }
            Result.success()
        }.getOrElse { error ->
            AlarmTalkLog.reportError("plan_changed conversion worker failed", error)
            Result.retry()
        }
    }

    companion object {
        private const val WORK_NAME = "plan_changed_conversion"

        private val networkConstraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        /** plan_changed 푸시 수신 시 호출. 프로세스가 죽어도 살아남는 1회성 WorkManager 작업으로 큐잉. */
        fun runOnce(context: Context) {
            val request = OneTimeWorkRequestBuilder<PlanChangeSyncWorker>()
                .setConstraints(networkConstraints)
                .build()
            WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
                WORK_NAME,
                ExistingWorkPolicy.REPLACE,
                request,
            )
        }
    }
}
