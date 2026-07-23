package com.alarmtalk.app.fcm

import android.content.Context
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.network.AlarmTalkApiClient
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.network.PushTokenRegisterRequest
import com.alarmtalk.app.network.PushTokenUnregisterRequest
import com.alarmtalk.app.sync.RemoteAlarmSyncScheduler
import com.google.android.gms.tasks.Tasks
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * FCM 수신 서비스. 가족 알람 push(data-only)를 받으면 즉시 원격 알람을 pull 해 로컬 스케줄+알림을
 * 그린다(앱이 백그라운드/종료여도). 토큰 회전 시 서버에 재등록한다. push 를 놓쳐도 15분 주기 pull 폴백.
 */
class AlarmTalkMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        registerToken(applicationContext, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        // data-only 가족 알람 신호 → 즉시 pull(RemoteAlarmPullSyncService 가 upsert + notifyReceivedAlarm).
        if (message.data["type"] == "family_alarm") {
            runCatching { RemoteAlarmSyncScheduler.runOnce(applicationContext) }
                .onFailure { AlarmTalkLog.reportError("FCM-triggered alarm pull failed", it) }
        }
        // 상대가 목소리 공유를 켜거나/끄면 → 공유 목록·클립 매니페스트 즉시 새로고침 신호.
        // UI 가 없으면 무시(다음 앱 시작의 초기 로드가 폴백).
        if (message.data["type"] == "voice_share_changed") {
            com.alarmtalk.app.core.AppSignals.emitVoiceShareChanged()
        }
        // 구독 만료 → 무료 강등 신호. 프로세스가 죽어도 살아남게 WorkManager 로 큐잉 → 백그라운드에서
        // 구독/플랜/가족 재조회 후 '진짜 무료'면 유료 목소리 알람을 기본 알람으로 변환(강등 시점 반영).
        // 앱이 포그라운드로 살아 있으면 워커가 쓴 SharedPreferences 만으론 live UI(구독/플랜 state)가
        // 안 바뀌므로, 신호도 함께 emit 해 MainViewModel 이 즉시 재조회하게 한다(구독자 없으면 버려짐).
        if (message.data["type"] == "plan_changed") {
            runCatching { com.alarmtalk.app.sync.PlanChangeSyncWorker.runOnce(applicationContext) }
                .onFailure { AlarmTalkLog.reportError("plan_changed handling failed", it) }
            com.alarmtalk.app.core.AppSignals.emitPlanChanged()
        }
    }

    companion object {
        private val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

        /** 로그인·앱 시작 시 현재 FCM 토큰을 받아 서버에 등록(onNewToken 은 토큰 회전 때만 발화). */
        fun registerCurrentToken(context: Context) {
            val appContext = context.applicationContext
            if (AuthSessionStore(appContext).read() == null) return
            FirebaseMessaging.getInstance().token
                .addOnSuccessListener { token -> registerToken(appContext, token) }
                .addOnFailureListener { AlarmTalkLog.reportError("FCM getToken failed", it) }
        }

        private fun registerToken(context: Context, token: String) {
            val session = AuthSessionStore(context).read() ?: return
            if (token.isBlank()) return
            ioScope.launch {
                // 등록 API 를 쏘기 직전에 세션이 아직 이 세션 그대로인지 재확인한다. 로그인/앱 시작 시 시작된
                // 등록(fire-and-forget)이 로그아웃/계정전환 뒤에 늦게 완료돼 옛 세션으로 토큰을 되살리는
                // 레이스를 막는다(서버 로그아웃은 JWT 만 무효화하고 push_tokens 를 지우지 않으므로).
                val current = AuthSessionStore(context).read()
                if (current == null || current.token != session.token) return@launch
                runCatching {
                    AlarmTalkApiClient.create().registerPushToken(
                        AlarmTalkApiClient.bearer(session.token),
                        PushTokenRegisterRequest(token = token),
                    )
                }.onFailure { AlarmTalkLog.reportError("Push token register failed", it) }
            }
        }

        /**
         * 로그아웃 시 이 기기의 FCM 토큰을 서버에서 제거해, 로그아웃한(또는 공유) 기기가 이 계정의 알람
         * push 를 더 받지 않게 한다. 반드시 /auth/logout(=token_epoch 무효화) '전에' 유효한 세션 토큰으로
         * 호출해야 한다. 현재 토큰을 받아 서버 unregister 까지 끝나면 반환(suspend). 실패해도 로그아웃은 계속.
         */
        suspend fun unregisterCurrentToken(authorizationToken: String) {
            runCatching {
                val token = withContext(Dispatchers.IO) {
                    Tasks.await(FirebaseMessaging.getInstance().token)
                }
                if (token.isNullOrBlank()) return
                withContext(Dispatchers.IO) {
                    AlarmTalkApiClient.create().unregisterPushToken(
                        AlarmTalkApiClient.bearer(authorizationToken),
                        PushTokenUnregisterRequest(token = token),
                    )
                }
            }.onFailure { AlarmTalkLog.reportError("Push token unregister failed", it) }
        }
    }
}
