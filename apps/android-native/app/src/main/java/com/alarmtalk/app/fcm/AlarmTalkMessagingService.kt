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
 * FCM 수신 서비스. 플랜·목소리·계정 신호(data)를 받아 해당 워커를 큐잉하거나 화면에 알린다(앱이
 * 백그라운드/종료여도). 토큰 회전 시 서버에 재등록한다. 신호를 놓쳐도 각 워커의 주기 폴백이 맞춘다.
 */
class AlarmTalkMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        registerToken(applicationContext, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        // 내 목소리를 제자리 교체한 뒤 서버가 프리셋 클립을 다 다시 구웠다(이름은 옛 공유 신호에서 왔다) →
        // 클립 매니페스트를 새로 받는다. 프로세스에 UI가 없어도 낡은 캐시를 새 audio_url 로 갈아 끼운다
        // (워커는 매니페스트에서 기존 캐시가 stale 인 클립만 받는다). UI 가 떠 있으면 신호로 매니페스트도 새로 받는다.
        if (message.data["type"] == "voice_share_changed") {
            com.alarmtalk.app.sync.StockClipPrefetchWorker.enqueue(applicationContext)
            com.alarmtalk.app.core.AppSignals.emitVoiceShareChanged()
        }
        // 서버에서 목소리 접근권이 사라짐(동의 철회·보관 만료 정리·제자리 교체) → 내 소유 알람 강등 신호.
        // plan_changed 는 '진짜 무료'일 때만 변환하므로 이 경우를 못 덮는다. 프로세스가 죽어도 살아남게
        // WorkManager 로 큐잉.
        if (message.data["type"] == "voice_access_revoked") {
            // 제자리 교체 신호는 payload 에 무엇이 무효가 됐는지가 실려 온다. 교체는 프로필
            // id 를 재사용하므로 워커의 '접근 가능 목록 대조' 로는 아무것도 안 걸린다 —
            // 이 id 가 있어야 그 목소리의 직접 입력 알람을 내릴 수 있다.
            val replacedVoiceId = message.data["voiceProfileId"]
                ?.takeIf { message.data["scope"] == "custom_messages" }
            // 세대까지 함께 넘긴다 — 이미 반영한 교체면 워커가 건너뛴다(늦게 온 푸시가 그
            // 사이 **새 목소리로** 만든 알람까지 지우면 안 된다).
            val replacedGeneration = message.data["invalidatedAt"]?.takeIf { replacedVoiceId != null }
            runCatching {
                com.alarmtalk.app.sync.VoiceAccessSyncWorker.runOnce(
                    applicationContext,
                    replacedVoiceId,
                    replacedGeneration,
                )
            }.onFailure { AlarmTalkLog.reportError("voice_access_revoked handling failed", it) }
        }
        // 이용권 결제 실패 — 표시 전용. 백그라운드에서는 시스템이 띄우지만
        // 포그라운드에서는 여기로만 오므로 직접 그린다(안 그리면 아무것도 안 보인다).
        if (message.data["type"] == "billing_hold") {
            val title = message.notification?.title ?: message.data["title"]
            val body = message.notification?.body ?: message.data["body"]
            if (!title.isNullOrBlank() && !body.isNullOrBlank()) {
                runCatching {
                    com.alarmtalk.app.alarm.SocialNotificationFactory.notifyBillingHold(
                        applicationContext, title, body,
                    )
                }.onFailure { AlarmTalkLog.reportError("billing_hold notification failed", it) }
            }
        }
        // 다른 기기에서 탈퇴를 신청했다(2026-10-15) — 이 기기의 세션도 끊겼다. **신호만 믿고 떠나지 않는다**(그 사이
        // 다른 기기에서 다시 로그인해 철회됐을 수 있다): 계정 확인 워커를 곧바로 돌려 서버에 묻게 하고, 서버가 403
        // `ACCOUNT_PENDING_DELETION` 이면 그 워커가 알람까지 끄고 떠난다(`endWorkerSession` →
        // `leaveAccountAfterPendingDeletion`). 앱이 떠 있으면 같은 403 을 인터셉터가 받아 전경도 떠난다.
        if (message.data["type"] == "account_deletion_requested") {
            runCatching { RemoteAlarmSyncScheduler.runOnce(applicationContext) }
                .onFailure { AlarmTalkLog.reportError("account_deletion_requested handling failed", it) }
        }
        // 구독 만료 → 무료 강등 신호. 프로세스가 죽어도 살아남게 WorkManager 로 큐잉 → 백그라운드에서
        // 구독·플랜 재조회 후 '진짜 무료'면 유료 목소리 알람을 기본 목소리 알람으로 변환(강등 시점 반영).
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
                // 계정 id 로 본다 — rolling refresh 가 토큰만 바꾸는데 토큰으로 비교하면
                // 콜드스타트마다 등록이 조용히 취소된다(Codex #665 P1).
                val current = AuthSessionStore(context).read()
                if (current == null || current.user.id != session.user.id) return@launch
                runCatching {
                    // **지금 유효한 토큰**으로 보낸다. 시작 시점에 잡아 둔 session.token 은 그
                    // 사이 rolling refresh 로 대체됐을 수 있고, 옛 토큰이 만료돼 있으면 등록이
                    // 401 로 실패한 뒤 다음 앱 시작·로그인·FCM 토큰 회전까지 재시도되지 않는다
                    // — 그동안 플랜/목소리 즉시 푸시를 못 받는다(Codex #665 P2).
                    AlarmTalkApiClient.create().registerPushToken(
                        AlarmTalkApiClient.bearer(current.token),
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
