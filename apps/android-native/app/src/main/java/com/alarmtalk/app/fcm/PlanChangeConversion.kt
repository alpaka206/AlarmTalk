package com.alarmtalk.app.fcm

import android.content.Context
import com.alarmtalk.app.AccessSnapshotStore
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.data.AlarmAppContainer
import com.alarmtalk.app.hasCoupleOrFamilyAccess
import com.alarmtalk.app.hasPaidVoiceAccess
import com.alarmtalk.app.network.AlarmTalkApiClient
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.network.AuthTokenResponse
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * 서버 plan_changed 푸시(구독 만료 → 무료 강등)를 받으면, 앱이 백그라운드/종료여도 구독·플랜·가족을
 * 재조회해 '진짜 무료'면 유료 목소리 알람을 기본 알람(사운드온리)으로 변환한다(강등 '시점'에 반영).
 * 서버가 과다발송해도 여기서 재조회로 확인 — 유료/가족/애매하면 변환하지 않아 오변환이 없다.
 * 놓쳐도 다음 앱 시작(LaunchedEffect)·울림 시점 게이트가 폴백. 변환은 앱 포그라운드 게이트와 동일 규칙.
 */
object PlanChangeConversion {
    private val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun runOnce(context: Context) {
        val appContext = context.applicationContext
        ioScope.launch {
            runCatching { runOnceInternal(appContext) }
                .onFailure { AlarmTalkLog.reportError("plan_changed conversion failed", it) }
        }
    }

    private suspend fun runOnceInternal(appContext: Context) {
        val sessionStore = AuthSessionStore(appContext)
        val session = sessionStore.read() ?: return
        val api = AlarmTalkApiClient.create()
        val auth = AlarmTalkApiClient.bearer(session.token)

        // 최신 구독·플랜·가족 재조회(강등 확정 확인). 구독 조회 실패면 조용히 종료(폴백에 맡김).
        val billing = runCatching { withContext(Dispatchers.IO) { api.getSubscription(auth) } }.getOrNull()
            ?: return
        val freshUser = runCatching { withContext(Dispatchers.IO) { api.me(auth).user } }.getOrNull()
        val familyGroup = runCatching { withContext(Dispatchers.IO) { api.getFamilyGroup(auth) } }.getOrNull()

        // 로컬 영속 반영 — 울림 시점 게이트·다음 앱 오픈 UI 가 최신 상태를 쓰게 한다.
        val userId = session.user.id
        val snapshotStore = AccessSnapshotStore(appContext)
        snapshotStore.updateSubscription(userId, billing)
        snapshotStore.updateFamilyGroup(userId, familyGroup)
        if (freshUser != null) {
            val response = AuthTokenResponse(token = session.token, user = freshUser)
            if (session.provider == AuthSessionStore.PROVIDER_GOOGLE) {
                sessionStore.saveGoogleSession(response)
            } else {
                sessionStore.saveAppSession(response)
            }
        }

        // '진짜 무료'만 변환: 유료 구독 없음 + 가족/커플 접근 없음 + user.plan 무료.
        val plan = freshUser?.plan ?: session.user.plan
        val genuinelyFree = !hasPaidVoiceAccess(billing) &&
            !hasCoupleOrFamilyAccess(billing, familyGroup) &&
            (plan.isBlank() || plan == "free")
        if (genuinelyFree) {
            runCatching { AlarmAppContainer.repository(appContext).lockPaidAlarmTalks() }
                .onFailure { AlarmTalkLog.reportError("plan_changed lock failed", it) }
        }
    }
}
