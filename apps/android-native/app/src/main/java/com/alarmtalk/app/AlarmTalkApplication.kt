package com.alarmtalk.app

import android.app.Application
import android.os.Build
import android.util.Log
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.alarmtalk.app.alarm.AlarmStreamVolume
import com.alarmtalk.app.alarm.NotificationChannels
import com.alarmtalk.app.fcm.AlarmTalkMessagingService
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
        // 울림 알림의 갈래("앱에 보이는 액티비티가 있는가")가 읽는 카운터. 콜백 등록은 실패할
        // 일이 없지만 같은 모양으로 감싼다 — 실패해도 앱 진입을 막지 않는다.
        runCatching { com.alarmtalk.app.alarm.VisibleActivityTracker.install(this) }
            .onFailure { AlarmTalkLog.reportError("VisibleActivityTracker install failed", it) }
        runCatching { NotificationChannels.ensure(this) }
            .onFailure { AlarmTalkLog.reportError("NotificationChannels init failed", it) }
        // ⚠ **우리가 올려 둔 기기 알람 볼륨을 여기서도 되돌린다.** 울림은 서비스가 끝내면서
        //   되돌리고 그 서비스가 다시 뜰 때 한 번 더 본다. 그런데 **미리듣기**도 같은 크기로
        //   들려주려고 스트림을 올리므로(2026-09-09), 미리듣기 도중 프로세스가 죽으면
        //   서비스가 뜨는 다음 알람까지 사용자의 알람 볼륨이 100% 로 남는다.
        //   앱을 여는 것이 그 사이를 메우는 유일한 기회다.
        runCatching { AlarmStreamVolume.restoreIfLeftOver(this) }
            .onFailure { AlarmTalkLog.reportError("AlarmStreamVolume.restoreIfLeftOver failed", it) }
        runCatching { RemoteAlarmSyncScheduler.ensurePeriodic(this) }
            .onFailure { AlarmTalkLog.reportError("RemoteAlarmSyncScheduler.ensurePeriodic failed", it) }
        // OS 알람 예약 정합성 주기 점검. **여기서 거는 게 핵심이다** — 이 안전망이 막으려는
        // 실패(MY_PACKAGE_REPLACED 유실)에서는 리시버가 아예 안 도니, 리시버에서만 등록하면
        // 정작 필요한 기기에 등록되지 않는다. 앱을 한 번이라도 열면 그때부터 걸린다.
        runCatching { com.alarmtalk.app.sync.AlarmScheduleIntegrityScheduler.ensurePeriodic(this) }
            .onFailure { AlarmTalkLog.reportError("AlarmScheduleIntegrityScheduler.ensurePeriodic failed", it) }
        // 목소리 접근권(동의 철회·보관 만료) 주기 재확인 — 푸시 유실·앱 미실행에도 정확성을
        // 지키는 비-FCM 폴백. 하루 한 번.
        runCatching { com.alarmtalk.app.sync.VoiceAccessSyncWorker.ensurePeriodic(this) }
            .onFailure { AlarmTalkLog.reportError("VoiceAccessSyncWorker.ensurePeriodic failed", it) }
        // 사용 기록 전송 — 오프라인에 쌓인 이벤트를 주기적으로 올린다. **울릴 때가 아니라
        // 여기서** 보낸다(울림 경로는 로컬·오프라인이 원칙 — CLAUDE.md 「Real alarm」).
        runCatching { com.alarmtalk.app.sync.UsageEventUploadWorker.ensurePeriodic(this) }
            .onFailure { AlarmTalkLog.reportError("UsageEventUploadWorker.ensurePeriodic failed", it) }
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
                                // 앱을 열 때마다 밀린 기록을 올려 본다 — 네트워크 제약이 붙어
                                // 있어 연결이 없으면 워커가 아예 돌지 않는다.
                                com.alarmtalk.app.sync.UsageEventUploadWorker.runOnce(
                                    this@AlarmTalkApplication,
                                )
                            }
                        }.onFailure { AlarmTalkLog.reportError("Foreground alarm sync failed", it) }
                    }
                },
            )
        }.onFailure { AlarmTalkLog.reportError("ProcessLifecycle observer registration failed", it) }
        // 로그인 세션이 있으면 현재 FCM 토큰을 서버에 등록(가족 알람 push 대상). 세션 없으면 내부에서 no-op.
        runCatching { AlarmTalkMessagingService.registerCurrentToken(this) }
            .onFailure { AlarmTalkLog.reportError("FCM token registration failed", it) }
        // 30일 이상 미참조 음성 캐시를 백그라운드에서 정리. 실패해도 앱 진입에 영향 없음.
        applicationScope.launch {
            runCatching { AlarmAppContainer.repository(this@AlarmTalkApplication).sweepStaleAudioCache() }
                .onFailure { AlarmTalkLog.reportError("Stale audio cache sweep failed", it) }
        }
        Log.i(TAG, "Voice Alarm native application started")
    }

    private fun initializeSentry() {
        val sentryDsn = BuildConfig.VOICE_ALARM_SENTRY_DSN.trim()
        if (!shouldInitializeSentry(sentryDsn, Build.FINGERPRINT)) {
            Log.i(TAG, "Sentry disabled; dsnConfigured=${sentryDsn.isNotEmpty()} fingerprint=${Build.FINGERPRINT}")
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

/**
 * Robolectric 이 쓰는 `Build.FINGERPRINT` 값. 실기기 지문은
 * `제조사/제품/기기:버전/빌드id/증분:타입/키` 꼴이라 이 값과 겹칠 수 없다.
 * (android-all 의 `build.prop` 에 `ro.build.fingerprint=robolectric` 으로 박혀 있다.)
 */
internal const val ROBOLECTRIC_BUILD_FINGERPRINT = "robolectric"

/**
 * Sentry 를 **켤 것인가.**
 *
 * ⚠ **유닛 테스트에서는 켜지 않는다.** 이게 이 판정의 전부다 — 2026-09-21 기준 미해결
 * ALARMTALK-ANDROID-2/-3 의 10,256건이 전부 JVM 테스트에서 올라온 것이었다. Robolectric 이
 * 매니페스트의 [AlarmTalkApplication] 을 그대로 인스턴스화해 테스트마다 `onCreate()` 가
 * 돌고, 그 첫 줄이 이 함수가 지키는 초기화다. 켜지고 나면 JVM 에 androidx.startup 도
 * AndroidKeyStore 도 없어 WorkManager 예약과 `AuthSessionStore` 생성이 줄줄이 던지고,
 * `onCreate` 의 `runCatching{}.onFailure{ reportError }` 가 그걸 전부 이슈로 올린다.
 *
 * ⚠ **막는 겹이 둘인 것은 일부러다.**
 *  1. `app/src/test/resources/robolectric.properties` 의 `application=android.app.Application`
 *     — 이 클래스가 아예 뜨지 않는다(프로덕션 코드 무변경).
 *  2. 여기. 1번은 테스트가 `@Config(application = …)` 한 줄로 되돌릴 수 있고, 새로 만든
 *     테스트 소스셋에는 딸려 가지도 않는다. **진짜 DSN 이 걸린 스위치**라 켜는 자리에서도
 *     한 번 더 본다.
 *
 * ⚠ **메시지·예외 이름으로 거르지 말 것.** 실기기에서 WorkManager 초기화가 정말 깨졌을 때
 * 우리에게 오는 **유일한 신호가 그 이벤트**다. 여기서 가르는 것은 "실행 환경이 테스트인가"
 * 하나이고, 실기기에서 올라오는 것은 무엇이든 그대로 올린다.
 *
 * @param dsn `BuildConfig.VOICE_ALARM_SENTRY_DSN` 을 trim 한 값.
 * @param buildFingerprint `Build.FINGERPRINT`.
 */
internal fun shouldInitializeSentry(dsn: String, buildFingerprint: String?): Boolean =
    dsn.isNotEmpty() && buildFingerprint != ROBOLECTRIC_BUILD_FINGERPRINT
