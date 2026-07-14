package com.alarmtalk.app.fcm

import android.content.Context
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.network.AlarmTalkApiClient
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.network.PushTokenRegisterRequest
import com.alarmtalk.app.sync.RemoteAlarmSyncScheduler
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

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
                runCatching {
                    AlarmTalkApiClient.create().registerPushToken(
                        AlarmTalkApiClient.bearer(session.token),
                        PushTokenRegisterRequest(token = token),
                    )
                }.onFailure { AlarmTalkLog.reportError("Push token register failed", it) }
            }
        }
    }
}
