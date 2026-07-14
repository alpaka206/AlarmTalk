package com.alarmtalk.app

import android.app.Application
import android.util.Log
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.alarmtalk.app.alarm.NotificationChannels
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.data.AlarmAppContainer
import com.alarmtalk.app.network.AuthSessionStore
import com.alarmtalk.app.sync.RemoteAlarmSyncScheduler
import io.sentry.SentryOptions
import io.sentry.android.core.SentryAndroid
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class AlarmTalkApplication : Application() {
    // 앱 프로세스 생존 주기 동안 살아있는 백그라운드 작업용 스코프(캐시 정리 등).
    private val applicationScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onCreate() {
        super.onCreate()
        // 각 초기화 단계의 실패가 앱 진입을 막지 않도록 개별 보호한다.
        // (release 빌드에서 Sentry/WorkManager 등 초기화가 던지면 첫 화면 전에
        //  프로세스가 즉시 종료되던 문제를 방지. 실패는 로그로만 남기고 계속 진행.)
        runCatching { initializeSentry() }
            .onFailure { AlarmTalkLog.reportError("Sentry init failed", it) }
        runCatching { NotificationChannels.ensure(this) }
            .onFailure { AlarmTalkLog.reportError("NotificationChannels init failed", it) }
        runCatching { RemoteAlarmSyncScheduler.ensurePeriodic(this) }
            .onFailure { AlarmTalkLog.reportError("RemoteAlarmSyncScheduler.ensurePeriodic failed", it) }
        // 앱이 포그라운드로 올라올 때마다(cold start 포함, 어느 화면/탭이든) 즉시 원격 알람을 pull 한다.
        // 로그인 세션이 있을 때만, 60초 throttle 로 연속 복귀 중복을 막는다. 이전엔 cold start + '알람 탭
        // 진입' 에서만 즉시 pull 이었던 것을 포그라운드 복귀 전체로 확장 — FCM 없이도 "앱을 열면 바로"
        // 가족 알람 수신+로컬 알림이 촘촘해진다(백그라운드 초단위 즉시는 별도 push 필요).
        runCatching {
            ProcessLifecycleOwner.get().lifecycle.addObserver(
                object : DefaultLifecycleObserver {
                    override fun onStart(owner: LifecycleOwner) {
                        runCatching {
                            if (AuthSessionStore(this@AlarmTalkApplication).read() != null) {
                                RemoteAlarmSyncScheduler.runOnceThrottled(this@AlarmTalkApplication)
                            }
                        }.onFailure { AlarmTalkLog.reportError("Foreground alarm sync failed", it) }
                    }
                },
            )
        }.onFailure { AlarmTalkLog.reportError("ProcessLifecycle observer registration failed", it) }
        // 30일 이상 미참조 음성 캐시를 백그라운드에서 정리. 실패해도 앱 진입에 영향 없음.
        applicationScope.launch {
            runCatching { AlarmAppContainer.repository(this@AlarmTalkApplication).sweepStaleAudioCache() }
                .onFailure { AlarmTalkLog.reportError("Stale audio cache sweep failed", it) }
        }
        Log.i(TAG, "Voice Alarm native application started")
    }

    private fun initializeSentry() {
        val sentryDsn = BuildConfig.VOICE_ALARM_SENTRY_DSN.trim()
        if (sentryDsn.isEmpty()) {
            Log.i(TAG, "Sentry disabled; DSN is not configured")
            return
        }

        SentryAndroid.init(this) { options ->
            options.dsn = sentryDsn
            options.environment = BuildConfig.VOICE_ALARM_SENTRY_ENVIRONMENT
            options.release =
                "${BuildConfig.APPLICATION_ID}@${BuildConfig.VERSION_NAME}+${BuildConfig.VERSION_CODE}"
            options.isSendDefaultPii = false
            options.isDebug = BuildConfig.DEBUG
            options.isAttachScreenshot = false
            options.isAttachViewHierarchy = false
            // 사용자 미디어 URI(content://, file://)가 이벤트에 실려 나가지 않도록 전송 전 마스킹.
            // isSendDefaultPii=false 로도 못 막는 경로: 플랫폼 예외(FileNotFoundException,
            // SecurityException 등) 메시지에는 선택한 파일의 전체 URI 가 포함될 수 있고,
            // 이는 captureException 의 exception value 로 그대로 전송된다.
            // log_message 컨텍스트는 AlarmTalkLog.reportError 가 저장 전에 마스킹한다.
            options.beforeSend = SentryOptions.BeforeSendCallback { event, _ ->
                event.message?.let { message ->
                    message.formatted = message.formatted?.let(AlarmTalkLog::redactUserUris)
                    message.message = message.message?.let(AlarmTalkLog::redactUserUris)
                }
                event.exceptions?.forEach { exception ->
                    exception.value = exception.value?.let(AlarmTalkLog::redactUserUris)
                }
                event
            }
        }
    }
}
