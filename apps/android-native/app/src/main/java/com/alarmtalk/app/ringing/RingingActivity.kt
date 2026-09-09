package com.alarmtalk.app.ringing

import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import android.view.WindowManager
import androidx.activity.OnBackPressedCallback
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.core.content.getSystemService
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.animation.core.Animatable
import androidx.compose.ui.graphics.graphicsLayer
import com.alarmtalk.app.AlarmTalkDarkColorScheme
import com.alarmtalk.app.R
import com.alarmtalk.app.stripDeliveryTags
import com.alarmtalk.app.fitToWidthScale
import com.alarmtalk.app.alarm.AlarmContract.EXTRA_ALARM_ID
import com.alarmtalk.app.alarm.RingingService
import com.alarmtalk.app.data.AlarmAppContainer
import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.SnoozeMinutes
import com.alarmtalk.app.data.bucketClipTexts
import com.alarmtalk.app.data.SnoozeRepeatLimits
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale
import kotlin.math.roundToInt
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.awaitHorizontalTouchSlopOrCancellation
import androidx.compose.foundation.gestures.horizontalDrag
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import com.alarmtalk.app.HomeGradientDark
import com.alarmtalk.app.WakerPillShape
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.StartOffset
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.role
import com.alarmtalk.app.AlarmTalkTypography

class RingingActivity : ComponentActivity() {
    private var alarmId by mutableStateOf<String?>(null)

    /**
     * 이 인스턴스가 **아직 살아 있는 최신 울림 화면인가.**
     *
     * ⚠ 이게 없으면 알람이 스스로 꺼진다(2026-09-09 SM-A325N 실기기). 울림 화면을 여는
     * 인텐트는 `FLAG_ACTIVITY_CLEAR_TASK` 라, 같은 화면이 한 번 더 열리면 먼저 뜬
     * 인스턴스가 **파괴되면서 `onStop`** 을 부른다 — 그게 '화면을 벗어났다' 로 읽혀
     * 알람을 끝냈다. 지금은 정상 경로에서 두 번 열리지 않게 고쳤지만
     * (`RingingNotificationFactory` 의 FSI 를 폴백 전용으로), 이 표시는 **그래도 남긴다.**
     * 화면을 여는 경로가 하나 더 생겨도 알람이 죽지 않아야 한다.
     */
    private val superseded: Boolean get() = liveInstance !== this
    /** 끄기·다시 알림으로 이미 끝냈다 — `onStop` 이 한 번 더 끝내지 않게. */
    private var handled = false

    /**
     * 사용자가 ＋/− 로 간격을 **실제로 바꿨는가.**
     *
     * ⚠ 이게 없으면 콜드 스타트에서 사고가 난다(코덱스 #729 2차). 행을 읽어 오기 전까지
     * 화면은 기본값 5분을 들고 있는데, 그 사이 '다시 울리기' 를 누르면 5를 **덮어쓴다** —
     * 30분으로 저장해 둔 알람이 5분이 된다. 바꾼 적이 없으면 값을 싣지 않는다.
     */
    private var snoozeMinutesAdjusted = false

    /**
     * 이 화면이 떠 있는 동안 **잠금이 풀린 적이 있는가**.
     *
     * 손에 들고 쓰던 폰이라는 뜻이라, 그때는 전원 버튼이 유예 없이 곧바로 든다.
     * 자세한 이유는 [leavingScreenDecision] 주석 참조.
     */
    private var seenUnlocked = false

    /**
     * **마지막으로 화면에 보이기 시작한 시각.** 액티비티 생성 시각이 아니다 —
     * 플립커버는 열렸다 닫히기를 반복하는데, 생성 시각으로 재면 두 번째 닫힘부터는
     * 유예를 지나 버려 **가방 속에서 알람이 꺼진다.**
     */
    private var visibleSinceElapsedMs = SystemClock.elapsedRealtime()

    /**
     * 화면이 **덮여 있는가**(근접 센서). 가방·주머니·플립커버를 시간이 아니라 **사실로**
     * 가르는 유일한 신호다.
     *
     * ⚠ 이게 없으면 잠금을 안 쓰는 폰에서 방어가 통째로 꺼진다 — `seenUnlocked` 가 첫
     * `onResume` 에 true 가 되므로 유예도 걸리지 않고, 커버가 화면을 되끄는 순간 알람이
     * 죽는다. 유예(3초)만으로도 부족하다: 배낭 덮개가 8초 열렸다 닫히면 유예를 지나 버린다.
     */
    private var screenCovered = false

    /**
     * **사용자가 스스로 나갔는가**(홈·최근앱). `onUserLeaveHint` 는 사용자의 선택으로
     * 배경으로 갈 때만 오고, **다른 것이 치고 들어온 경우**(전화 수신 등)에는 오지 않는다.
     * `onStop` 만으로는 그 둘이 구분되지 않아 이 표시가 필요하다.
     * 매번 [onStart] 에서 지운다 — 지난번에 나간 기록이 다음 판정에 남으면 안 된다.
     */
    private var userLeaveHinted = false

    private var proximitySensor: Sensor? = null

    private val proximityListener = object : SensorEventListener {
        override fun onSensorChanged(event: SensorEvent) {
            val sensor = event.sensor ?: return
            // 대부분의 근접 센서는 0(near) / maxRange(far) 두 값만 낸다.
            screenCovered = event.values.firstOrNull()?.let { it < sensor.maximumRange } ?: false
        }

        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        liveInstance = this
        configureLockScreen()
        blockBackNavigation()
        alarmId = intent.getStringExtra(EXTRA_ALARM_ID)
        ensureRingingServiceStarted()

        setContent {
            var uiState by remember { mutableStateOf(RingingUiState()) }
            val currentAlarmId = alarmId
            val appContext = applicationContext
            // ⚠ **알림으로 알람이 끝나면 이 화면도 닫혀야 한다.** 액티비티는 서비스 생명주기를
            //   모르는데 이제 이 화면이 항상 떠 있으므로, 알림의 '해제'·'다시 울리기' 를 누르면
            //   소리만 멎고 화면은 남는다. 남은 화면의 '밀어서 끄기' 를 밀면 이미 미뤄 둔
            //   알람에 dismiss 가 한 번 더 나가 **스누즈가 지워진다.**
            //   ⚠ 처음 한 번은 서비스가 이 알람을 잡을 때까지 기다린다 — `startRinging` 이
            //   값을 채우기 전에 닫으면 뜨자마자 사라진다.
            LaunchedEffect(currentAlarmId) {
                val id = currentAlarmId ?: return@LaunchedEffect
                var everMatched = false
                // ⚠ **유예를 흐름 방출에 걸지 말 것**(코덱스 #729 2차). 화면이 뜨기 전에
                //   끝나면 `null` 하나만 오고 그 뒤로 아무것도 안 와서, 방출 안에서만
                //   시간을 재면 **타이머가 영영 안 돈다.** 진짜 타이머를 따로 태운다.
                val timeout = launch {
                    delay(SERVICE_HANDOFF_GRACE_MS)
                    if (!everMatched && RingingService.activeRingingAlarmId != id) {
                        handled = true
                        finishAndRemoveTask()
                    }
                }
                RingingService.activeRingingAlarmIdFlow.collect { active ->
                    if (active == id) {
                        everMatched = true
                        timeout.cancel()
                        return@collect
                    }
                    // ⚠ **한 번도 못 잡은 경우도 닫아야 한다**(코덱스 #729). 화면이 뜨기
                    //   전에 알림·워치에서 해제·다시 울림이 끝나면 서비스는 이미 사라져
                    //   `everMatched` 가 영영 false 다 — 소리도 서비스도 없는데 화면만
                    //   남아, 거기서 밀면 **이미 끝난 알람을 한 번 더** 해제·미룬다.
                    //   그렇다고 곧바로 닫으면 서비스가 값을 채우기 전에 사라지므로
                    //   시작 유예를 둔다.
                    if (everMatched) {
                        handled = true
                        finishAndRemoveTask()
                    }
                }
            }

            LaunchedEffect(currentAlarmId) {
                uiState = currentAlarmId?.let { id ->
                    withContext(Dispatchers.IO) {
                        val repository = AlarmAppContainer.repository(appContext)
                        repository.getAlarm(id)?.let { alarm ->
                            val playbackVariantIndex = repository.resolveBucketClipSelection(alarm)?.variantIndex
                            alarm.toRingingUiState(appContext, playbackVariantIndex)
                        }
                    }
                } ?: defaultRingingUiState(appContext)
            }
            val scope = rememberCoroutineScope()
            RingingRoute(
                uiState = uiState,
                onSnoozeMinutesChange = { next ->
                    // 화면은 곧바로 반응하고, 값은 행에 남긴다 — `AlarmRepository.snooze` 가
                    // 읽는 것이 그 행의 `snoozeMinutes` 라서, 저장이 늦으면 방금 고른 값이
                    // 아니라 옛 값으로 미뤄진다.
                    snoozeMinutesAdjusted = true
                    uiState = uiState.copy(snoozeMinutes = next)
                    // ⚠ **콤포지션 스코프에 붙이지 말 것**(코덱스 #729 3차). 값을 바꾸자마자
                    //   끄거나 나가면 화면이 사라지며 **Room 커밋 전에 취소돼** 고른 간격이
                    //   사라진다. 앱 수명 스코프는 단일 스레드라 연타 순서도 지켜진다.
                    currentAlarmId?.let { id ->
                        AlarmAppContainer.appScope.launch {
                            AlarmAppContainer.repository(appContext).updateSnoozeMinutes(id, next)
                        }
                    }
                },
                onDismiss = {
                    handled = true
                    currentAlarmId?.let { RingingService.dismiss(this, it) }
                    finishAndRemoveTask()
                },
                onSnooze = {
                    handled = true
                    // ⚠ **지금 화면에 보이는 값을 실어 보낸다.** ＋/− 의 저장은 비동기라,
                    //   바로 이어 누르면 서비스가 옛 간격으로 미룰 수 있다(코덱스 #729).
                    currentAlarmId?.let {
                        RingingService.snooze(this, it, uiState.snoozeMinutes.takeIf { snoozeMinutesAdjusted })
                    }
                    finishAndRemoveTask()
                },
            )
        }
    }

    override fun onDestroy() {
        // 내 것일 때만 비운다 — 새 인스턴스가 이미 가져갔으면 남의 것이다.
        if (liveInstance === this) liveInstance = null
        super.onDestroy()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        alarmId = intent.getStringExtra(EXTRA_ALARM_ID)
        ensureRingingServiceStarted()
    }

    /**
     * FGS 시작이 막혀(Android 12+) 풀스크린 알림 폴백으로 이 화면이 떴을 때, 울림 서비스(소리·진동)가
     * 아직 안 돌고 있으면 여기서 시작한다. 가시 액티비티에서의 FGS 시작은 허용된다. 이미 같은 알람을
     * 울리는 중이면 건너뛰어 중복 시작과 서비스→액티비티 재오픈 루프를 막는다.
     */
    private fun ensureRingingServiceStarted() {
        val id = alarmId ?: return
        if (RingingService.activeRingingAlarmId != id) {
            RingingService.start(this, id)
        }
    }

    override fun onStart() {
        super.onStart()
        visibleCount += 1
        visibleSinceElapsedMs = SystemClock.elapsedRealtime()
        userLeaveHinted = false
        val sensorManager = getSystemService<SensorManager>() ?: return
        proximitySensor = sensorManager.getDefaultSensor(Sensor.TYPE_PROXIMITY)
        proximitySensor?.let {
            sensorManager.registerListener(proximityListener, it, SensorManager.SENSOR_DELAY_NORMAL)
        }
    }

    override fun onResume() {
        super.onResume()
        if (getSystemService<KeyguardManager>()?.isKeyguardLocked != true) seenUnlocked = true
        hideSystemBars()
    }

    override fun onStop() {
        super.onStop()
        visibleCount -= 1
        // ⚠ **판정 전에는 해제하지 않는다** — 덮임 여부를 판정이 읽어야 한다.
        dismissOnLeavingScreen()
        getSystemService<SensorManager>()?.unregisterListener(proximityListener)
    }

    /**
     * **울림 화면을 벗어나면 알람이 꺼진다**(2026-09-09 지시). 홈·최근앱·앱 전환·전원 버튼이
     * 전부 같은 한 가지다 — 화면을 떠났다.
     *
     * 하단 내비게이션을 막을 수 없다는 사실에 대한 답이기도 하다(막는 대신 나가는 것을 뜻
     * 있게 만든다). 알람 자체는 여전히 **아무도 멈춰 주지 않는다** — 끄거나 나갈 때까지 운다.
     *
     * ⚠ **기본은 끄는 것이다 — 잠금 여부를 보지 않는다.** 알람이 울린다고 전화를 못 받게
     * 할 수는 없다. 판정의 전부는 [leavingScreenDecision] 에 있고, 여기서 조건을 다시
     * 조립하지 말 것.
     *
     * ⚠ 예외는 **화면이 꺼졌는데 기기가 덮여 있는 경우** 하나다(가방·주머니·플립커버).
     * 근접 센서가 없는 기기를 위해 [LEAVE_GRACE_MS] 를 두 번째 그물로 둔다.
     *
     * ⚠ **`superseded` 를 빼지 말 것** — 같은 화면이 한 번 더 열리면(`CLEAR_TASK`) 먼저 뜬
 * 인스턴스가 파괴되며 `onStop` 을 부른다. 2026-09-09 SM-A325N 에서 알람이 **2초 만에 스스로
 * 꺼진** 원인이 정확히 이것이었다.
 *
 * ⚠ **`isChangingConfigurations` 를 빼지 말 것** — 설정 변경으로 액티비티가 다시 만들어지는
     * 동안에도 `onStop` 은 온다. 빼면 그 한 번이 알람을 끝낸다.
     */
    /**
     * 지금 통화 중인가. **권한 없이** 읽을 수 있는 유일한 신호다 —
     * `TelephonyManager` 의 통화 상태는 `READ_PHONE_STATE` 를 요구한다.
     *  - `MODE_RINGTONE` 수신 벨이 울리는 중
     *  - `MODE_IN_CALL` 일반 통화 / `MODE_IN_COMMUNICATION` VoIP(카카오·페이스타임 등)
     */
    private fun isInCall(): Boolean = when (getSystemService<AudioManager>()?.mode) {
        AudioManager.MODE_RINGTONE,
        AudioManager.MODE_IN_CALL,
        AudioManager.MODE_IN_COMMUNICATION -> true
        else -> false
    }

    private fun dismissOnLeavingScreen() {
        val id = alarmId ?: return
        // 화면이 꺼져서 떠난 것인지(전원 버튼·커버) 다른 화면으로 간 것인지(전화·홈·앱 전환).
        // 판정에도 쓰고 기록에도 남긴다 — 오탐이 나고 있어도 구분되지 않으면 알 수 없다.
        val screenOff = getSystemService<PowerManager>()?.isInteractive == false
        val decision = leavingScreenDecision(
            handled = handled,
            superseded = superseded,
            changingConfigurations = isChangingConfigurations,
            isActiveRingingAlarm = RingingService.activeRingingAlarmId == id,
            screenOff = screenOff,
            screenCovered = screenCovered,
            inCall = isInCall(),
            userLeftDeliberately = userLeaveHinted,
            seenUnlocked = seenUnlocked,
            elapsedSinceShownMs = SystemClock.elapsedRealtime() - visibleSinceElapsedMs,
        )
        Log.i(
            TAG,
            "onStop decision=$decision screenOff=$screenOff covered=$screenCovered " +
                "inCall=${isInCall()} userLeaveHint=$userLeaveHinted",
        )
        if (decision != LeavingScreenDecision.DISMISS) return
        handled = true
        Log.i(TAG, "Left ringing screen; dismissing id=$id screenOff=$screenOff")
        RingingService.dismissForLeavingScreen(this, id, screenOff)
        finishAndRemoveTask()
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        userLeaveHinted = true
        Log.i(TAG, "onUserLeaveHint — user chose to leave")
        hideSystemBars()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    private fun blockBackNavigation() {
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    hideSystemBars()
                }
            },
        )
    }

    private fun configureLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD,
            )
        }

        window.addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_ALLOW_LOCK_WHILE_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_FULLSCREEN,
        )
        WindowCompat.setDecorFitsSystemWindows(window, false)
        hideSystemBars()
    }

    private fun hideSystemBars() {
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    internal companion object {
        private const val TAG = "RingingActivity"

        /** 서비스가 이 알람을 잡을 때까지 기다려 주는 시간. 넘으면 화면을 닫는다. */
        private const val SERVICE_HANDOFF_GRACE_MS = 10_000L

        /** 가장 최근에 만들어진 울림 화면. 옛 인스턴스가 자기가 밀려났음을 아는 유일한 방법. */
        @Volatile
        private var liveInstance: RingingActivity? = null

        /** 지금 화면에 보이는 울림 화면의 수. `onStart`/`onStop` 으로만 오간다. */
        @Volatile
        private var visibleCount = 0

        /**
         * 울림 화면이 **지금 보이는가.** `startActivity` 는 백그라운드 시작 제한에 막혀도
         * **예외를 던지지 않고 무시될 수 있어서**, 띄웠다는 사실만으로는 알 수 없다.
         *
         * ⚠ **인스턴스 보유로 판정하지 말 것**(코덱스 #729 2차). `liveInstance` 는 화면이
         * 멈춘 뒤에도 남아 있어, 한 번이라도 뜬 적이 있으면 영영 true 가 된다 — 그러면
         * 정작 나중에 시작이 막혔을 때 폴백 승격이 억제돼 해제 수단이 사라진다.
         */
        fun isShowing(): Boolean = visibleCount > 0

    }
}

/** [leavingScreenDecision] 의 답. 무시할 때는 **왜** 무시했는지가 로그에 남아야 한다. */
internal enum class LeavingScreenDecision {
    DISMISS,

    /** 끄기·다시 알림으로 이미 끝냈다. */
    ALREADY_HANDLED,

    /** 설정 변경으로 다시 만들어지는 중 — 떠난 것이 아니다. */
    RECREATING,

    /** 이미 다른 알람이 울리는 중이거나 이 알람은 끝났다. */
    NOT_THE_RINGING_ALARM,

    /**
     * **화면은 켜져 있는데 통화가 아니다** = 다른 앱으로 갔을 뿐이다.
     *
     * 홈·최근앱·앱 전환, 그리고 사이드키가 카메라·어시스턴트를 띄우는 경우가 전부 여기다 —
     * 안드로이드는 그 넷을 구분해 주지 않는다(`onStop` 하나로 온다). 여기서 끄면
     * **전원 말고도 알람을 끄는 버튼이 생긴다.**
     */
    LEFT_TO_ANOTHER_APP,

    /**
     * **같은 화면이 한 번 더 열려 이 인스턴스가 밀려났다.** 사용자가 떠난 것이 아니라
     * 우리가 화면을 새로 그린 것이다 — 여기서 끄면 알람이 스스로 죽는다.
     */
    SUPERSEDED,

    /**
     * **잠긴 기기의 화면이 뜬 직후 꺼졌다 = 사람이 아니라 기계다.**
     * 가방·주머니·플립커버가 되끈 경우다. 유일하게 남은 오탐 방어선이다.
     */
    MACHINE_TURNED_SCREEN_OFF,
}

/**
 * 울림 화면을 떠났을 때 알람을 끌지 가른다.
 *
 * **끄는 것은 둘뿐이다: 화면이 꺼짐(전원 버튼)과 통화**(2026-09-09 지시 "확실하게 전원
 * 버튼만"). 잠금 여부는 보지 않는다.
 *
 * ⚠ **홈·최근앱·앱 전환으로는 끄지 않는다.** 안드로이드는 그것들을 `onStop` 하나로만
 * 알려 줘서, 사이드키가 카메라·빅스비를 띄우는 것과 **코드상 구분되지 않는다.** 거기서
 * 끄면 '전원 말고도 알람을 끄는 버튼' 이 생긴다. 대신 나가도 알람은 계속 운다(소리의
 * 주인이 액티비티가 아니라 포그라운드 서비스다) — 돌아오거나 알림에서 끄면 된다.
 *
 * ⚠ **통화는 `AudioManager.mode` 로 가른다 — 권한이 필요 없다.** `TelephonyManager` 의
 * 통화 상태는 `READ_PHONE_STATE` 를 요구하는데, 그 권한을 알람 앱이 들고 있을 이유가 없다.
 *
 * ⚠ **예외는 하나뿐이고, 지우지 말 것.** 잠긴 기기에서 **뜬 직후**([graceMs] 안에) 화면이
 * 꺼진 경우다. 사람이 그 사이에 반응하기는 어렵고, 그 시간대에 화면을 끄는 것은 대개
 * **가방·주머니·플립커버**다. 이걸 '나갔다' 로 읽으면 **자는 사람이 못 일어난다** — 이 앱에서
 * 가장 나쁜 결과라, 모르면 울리는 쪽으로 기운다.
 *
 * 잠금이 풀린 적이 있으면 이 예외도 걸지 않는다. 손에 들고 쓰던 폰이 그 순간 주머니로
 * 들어갈 일은 없고, 그때는 전원 버튼이 **곧바로** 들어야 한다.
 *
 * 화면이 켜진 채 떠난 것(전화·홈·앱 전환)은 언제나 사람이 한 일이라 유예를 두지 않는다.
 *
 * 액티비티에서 떼어 낸 것은 이 규칙만 따로 검사하기 위해서다(`LeavingScreenDecisionTest`).
 * 순서가 곧 우선순위다.
 */
internal fun leavingScreenDecision(
    handled: Boolean,
    superseded: Boolean,
    changingConfigurations: Boolean,
    isActiveRingingAlarm: Boolean,
    screenOff: Boolean,
    screenCovered: Boolean,
    inCall: Boolean,
    userLeftDeliberately: Boolean,
    seenUnlocked: Boolean,
    elapsedSinceShownMs: Long,
    graceMs: Long = LEAVE_GRACE_MS,
): LeavingScreenDecision = when {
    handled -> LeavingScreenDecision.ALREADY_HANDLED
    superseded -> LeavingScreenDecision.SUPERSEDED
    changingConfigurations -> LeavingScreenDecision.RECREATING
    !isActiveRingingAlarm -> LeavingScreenDecision.NOT_THE_RINGING_ALARM
    // 덮여 있는데 화면이 꺼졌다 = 가방·주머니·플립커버. 잠금 여부도 시간도 보지 않는다.
    screenOff && screenCovered -> LeavingScreenDecision.MACHINE_TURNED_SCREEN_OFF
    // 센서가 없거나 못 읽는 기기를 위한 두 번째 그물.
    screenOff && !seenUnlocked && elapsedSinceShownMs < graceMs ->
        LeavingScreenDecision.MACHINE_TURNED_SCREEN_OFF
    screenOff -> LeavingScreenDecision.DISMISS
    inCall -> LeavingScreenDecision.DISMISS
    userLeftDeliberately -> LeavingScreenDecision.DISMISS
    else -> LeavingScreenDecision.LEFT_TO_ANOTHER_APP
}

/** 잠긴 기기에서 이만큼 안에 화면이 꺼지면 사람이 아니라 기계로 본다. */
internal const val LEAVE_GRACE_MS = 3_000L

/**
 * 울림 화면 (2026-09-06 다시 그림).
 *
 * 자다 깬 사람이 3초 안에 알아야 할 것은 **몇 시인가**와 **어떻게 끄는가** 둘이다. 그래서
 * 시계가 가장 크고, 문구는 카드 없이 시계 아래에 바로 놓는다.
 * ⚠ **문구가 없으면 그 자리는 비운다**(2026-09-09). 예전에는 '무엇이 울리는가' 를 알리려고
 * "알람음" 칩을 놓았는데, 재생 방식은 잠결에 필요한 정보가 아니라 시선만 하나 더 만들었다 —
 * 칩을 되살리지 말 것. 색은 여기서 새로 짓지 않는다 —
 * 잠금화면 위라 앱 테마를 상속하지는 않지만 값은 전부 `AlarmTalkDarkColorScheme` 과 홈 탭
 * 그라데이션(`HomeGradientDark`)에서 온다. 예전에는 이 파일에만 있는 고정색 8종이었고, 잠금화면에서
 * 앱으로 넘어가면 다른 앱처럼 보였다.
 *
 * 끄기와 다시 알림은 **비대칭**이다(탭 = 다시 알림, 밀기 = 끄기). 다시 알림은 가벼운 캡슐로,
 * 끄기는 채운 손잡이의 슬라이더로 그려 어느 쪽이 되돌릴 수 없는지 보이게 한다.
 * ⚠ 슬라이더에 관성·플릭 판정을 넣지 말 것 — 잠결에 한 번 튕기면 알람이 영구 종료된다
 *   (`docs/spec/alarm-ringing.md`). 마찰이 이 컨트롤의 존재 이유다.
 */
@Composable
private fun RingingRoute(
    uiState: RingingUiState,
    onDismiss: () -> Unit,
    onSnooze: () -> Unit,
    onSnoozeMinutesChange: (Int) -> Unit,
) {
    val paneTitle = stringResource(R.string.ringing_notification_title)
    // 잠금화면 위에서는 항상 다크로 떠야 하므로 앱 테마를 상속하지 않는다. 값은 단일 출처 그대로 —
    // 글꼴(Pretendard·자간 0)도 같이 넘긴다. 색만 넘기면 이 화면만 시스템 글꼴로 뜬다.
    MaterialTheme(colorScheme = AlarmTalkDarkColorScheme, typography = AlarmTalkTypography) {
        // 리플·아이콘 기본색은 LocalContentColor 에서 온다 — 테마만 바꾸면 검정으로 남아 리플이 안 보인다.
        CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onSurface) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .background(HomeGradientDark)
                    .systemBarsPadding()
                    .padding(horizontal = 28.dp)
                    // TalkBack 이 창을 만나는 순간 '알람이 울리고 있다' 를 먼저 듣게 한다.
                    .semantics { this.paneTitle = paneTitle },
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Spacer(Modifier.height(54.dp))
                // 날짜 줄에 알람 이름을 합친다 — 카드 한 장을 줄인다.
                Text(
                    text = listOfNotNull(uiState.dateText.takeIf { it.isNotBlank() }, uiState.label)
                        .joinToString(" · "),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 14.sp,
                    lineHeight = 20.sp,
                    fontWeight = FontWeight.SemiBold,
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(6.dp))
                RingingClock(ampm = uiState.ampm, time = uiState.timeText, spokenTime = uiState.spokenTime)

                // 문구는 시계와 컨트롤 사이의 빈 공간에서 **위쪽 1/3 지점**에 앉는다(실기 S23 Ultra 에서
                // 시계 바로 아래 붙이니 화면 가운데가 통째로 비어 보였다). 위 0.5 : 아래 1 비율.
                Spacer(Modifier.height(24.dp))
                Spacer(Modifier.weight(0.5f))
                // ⚠ **문구가 없으면 그 자리는 비운다**(2026-09-09 지시). 예전에는 '알람음' 칩을
                //   대신 놓았는데, 재생 방식이 알람음이라는 것은 **잠결에 필요한 정보가 아니다** —
                //   지금 필요한 건 몇 시인가와 어떻게 끄는가 둘뿐이라, 칩은 시선만 하나 더 만들었다.
                // ⚠ **문구가 길어도 컨트롤을 밀어내지 않는다**(코덱스 #729). 이 Column 은
                //   스크롤되지 않으므로, 자르지 않기로 한 문구(최대 200자·큰 글꼴)가
                //   남은 높이를 넘기면 다시 알림·끄기 슬라이더가 화면 밖으로 밀려 **알람을
                //   끌 방법이 사라진다.** 문구 쪽만 남는 공간 안에서 스크롤시킨다.
                uiState.voiceText?.let { text ->
                    Box(
                        modifier = Modifier
                            .weight(1f, fill = false)
                            .verticalScroll(rememberScrollState()),
                    ) {
                        RingingMessage(text)
                    }
                }

                Spacer(Modifier.weight(1f))

                // ⚠ **조건 없이 보인다**(2026-09-09). 편집기에서 '다시 울림' 설정을 없앴으므로
                //   저장된 `snoozeEnabled` 는 읽지 않는다 — 알림도 같은 규칙이다.
                RingingSnoozeRow(
                    minutes = uiState.snoozeMinutes,
                    onMinutesChange = onSnoozeMinutesChange,
                    onSnooze = onSnooze,
                )
                Spacer(Modifier.height(16.dp))
                RingingSlideToDismiss(onDismiss = onDismiss)
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

/**
 * 이 화면의 캡슐·칩·트랙 테두리 규칙. 바닥(그라데이션)이 어두워 `outline`(#4C587E)은 2.4:1 로
 * 비텍스트 기준(3:1)에 못 미친다 — `onSurfaceVariant` 60% 면 3.7:1. 세 곳이 같은 이유를 가리킨다.
 */
@Composable
private fun ringingEdge(): BorderStroke =
    BorderStroke(1.dp, MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f))

/**
 * 울림 화면의 시계.
 *
 * ⚠ **폭에 맞춰 줄인다.** 104sp 를 고정으로 두면 좁은 화면(갤럭시 폴드 커버 화면 등)이나
 * 큰 글꼴에서 '오전' 과 시각이 서로 **겹쳐 보인다**(실제 제보). 이 화면은 자다 깬 사람이
 * 몇 시인지 확인하는 곳이라 시각이 읽히지 않으면 화면 자체가 쓸모없다.
 *
 * 배율은 [가용 폭] ÷ ([기준 폭] × [글꼴 배율]) 이다 — 글꼴 배율을 나누는 이유는, 폭은
 * dp 라 사용자가 글꼴을 키워도 그대로지만 글자만 커져 넘치기 때문이다. 알람 편집기의
 * `AlarmTimePicker` 도 같은 방식으로 줄인다.
 *
 * TalkBack 에는 한 노드로, 말로 읽는 시각(`spokenTime`)을 준다 — '오전' 과 '6:00' 을 두 조각으로
 * 읽히게 두면 자다 깬 사람이 첫 정보를 두 번에 나눠 듣고, '6:00' 은 TTS 마다 발음이 다르다.
 */
@Composable
private fun RingingClock(ampm: String, time: String, spokenTime: String) {
    // '오전' + 104sp 시각이 여유롭게 들어가는 폭. Pretendard 숫자는 시스템 글꼴보다 넓어
    // "10:00" 기준 324dp 가 필요하다(실측) — 여유를 두고 340. 이보다 넓으면 줄이지 않는다.
    val referenceWidth = 340.dp
    // 영어는 '6:30 AM' 이다 — 로케일의 시각 패턴에서 오전/오후 자리를 읽는다.
    val ampmFirst = remember {
        val pattern = android.text.format.DateFormat.getBestDateTimePattern(Locale.getDefault(), "hma")
        pattern.indexOf('a') < pattern.indexOf('h')
    }
    BoxWithConstraints {
        val scale = fitToWidthScale(maxWidth, referenceWidth)
        Row(
            modifier = Modifier.clearAndSetSemantics { contentDescription = spokenTime },
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(10.dp * scale),
        ) {
            val ampmText: @Composable () -> Unit = {
                if (ampm.isNotBlank()) {
                    Text(
                        text = ampm,
                        modifier = Modifier.padding(bottom = 18.dp * scale),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 26.sp * scale,
                        lineHeight = 30.sp * scale,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        softWrap = false,
                    )
                }
            }
            if (ampmFirst) ampmText()
            Text(
                text = time,
                color = MaterialTheme.colorScheme.onSurface,
                fontSize = 104.sp * scale,
                lineHeight = 110.sp * scale,
                fontWeight = FontWeight.Bold,
                // 큰 숫자는 자간을 조인다(-0.03em) — 기본 자간이면 흩어져 보인다.
                letterSpacing = (-3).sp * scale,
                maxLines = 1,
                softWrap = false,
            )
            if (!ampmFirst) ampmText()
        }
    }
}

/**
 * 울리는 문구. 카드 없이 시계 아래에 바로 — 카드는 시계와 겨루는 두 번째 상자였다.
 * 긴 문구가 컨트롤을 화면 밖으로 밀지 않도록 세 줄에서 자른다(전문은 목소리가 읽는다).
 * 한글 본문이라 자간은 0(앱 규칙). 시계의 음수 자간은 라틴 숫자라서다.
 */
@Composable
private fun RingingMessage(text: String) {
    Text(
        text = text,
        modifier = Modifier
            .fillMaxWidth()
            .widthIn(max = 440.dp),
        color = MaterialTheme.colorScheme.onSurface,
        fontSize = 23.sp,
        lineHeight = 33.sp,
        fontWeight = FontWeight.Medium,
        textAlign = TextAlign.Center,
        // ⚠ **자르지 않는다**(2026-09-09 지시). 예전에는 3줄 + `…` 였는데, 알람이 읽어 줄
        //   문장을 화면이 중간에서 끊으면 무슨 말인지 확인할 길이 없다. 긴 문장은 그대로
        //   흐르게 두고, 자리가 모자라면 위아래 여백(weight Spacer)이 먼저 줄어든다.
    )
}

/**
 * 다시 알림 — 가벼운 캡슐. 끄기 슬라이더보다 눈에 띄지 않아야 어느 쪽이 되돌릴 수 없는지 보인다.
 * 액션 라벨 둘(다시 알림·끄기)은 같은 16sp 다 — 무게 차이는 컨테이너와 굵기가 낸다.
 */
@Composable
private fun RingingSnoozeRow(
    minutes: Int,
    onMinutesChange: (Int) -> Unit,
    onSnooze: () -> Unit,
) {
    // ⚠ **간격 조절은 여기에만 있다**(2026-09-09 지시). 편집기에는 '다시 울림' 설정 자체가
    //   없다 — 미리 정해 두는 값이 아니라 **울릴 때 그 자리에서** 정하는 값이라서다.
    //   ('5분 뒤 다시' 를 누르면 그 값으로 미뤄지고, 다음 알람에도 그 값이 남는다.)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        RingingStepButton(
            label = "\u2212",
            enabled = minutes > SnoozeMinutes.MIN,
            contentDescription = stringResource(R.string.rd_snooze_minus),
            onClick = { onMinutesChange((minutes - 1).coerceIn(SnoozeMinutes.range)) },
        )
        RingingSnoozeButton(minutes = minutes, onSnooze = onSnooze)
        RingingStepButton(
            label = "+",
            enabled = minutes < SnoozeMinutes.MAX,
            contentDescription = stringResource(R.string.rd_snooze_plus),
            onClick = { onMinutesChange((minutes + 1).coerceIn(SnoozeMinutes.range)) },
        )
    }
}

@Composable
private fun RingingStepButton(
    label: String,
    enabled: Boolean,
    contentDescription: String,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier
            .size(52.dp)
            .semantics {
                role = Role.Button
                this.contentDescription = contentDescription
            },
        shape = WakerPillShape,
        color = Color.Transparent,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = ringingEdge(),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text(
                text = label,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = if (enabled) 1f else 0.35f),
                fontSize = 22.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

@Composable
private fun RingingSnoozeButton(minutes: Int, onSnooze: () -> Unit) {
    Surface(
        onClick = onSnooze,
        modifier = Modifier
            .height(52.dp)
            .widthIn(min = 160.dp)
            // Surface(onClick) 은 role 을 안 붙인다 — TalkBack 이 '버튼' 을 읽게 한다.
            .semantics { role = Role.Button },
        shape = WakerPillShape,
        color = Color.Transparent,
        // 리플이 이 색을 읽는다.
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = ringingEdge(),
    ) {
        Box(
            modifier = Modifier
                .fillMaxHeight()
                .padding(horizontal = 26.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = stringResource(R.string.rd_snooze_button_minutes, minutes),
                color = MaterialTheme.colorScheme.onSurface,
                fontSize = 16.sp,
                lineHeight = 22.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

private const val DISMISS_THRESHOLD_FRACTION = 0.7f

/**
 * 밀어서 끄기.
 *
 * - 손잡이는 **누르는 순간** 눌린다(0.94, 튕기지 않는 스프링) — 놓을 때가 아니라.
 * - 잡는 순간 정착 애니메이션을 멈춘다 — 손 밑에서 흘러가지 않고, 드래그는 **표시값**에서 시작한다.
 * - 70% 문턱을 **넘는 순간** 햅틱 한 번 + 트랙 색이 바뀐다(햅틱을 끈 기기의 짝). 되돌아오면 다시 무장한다.
 * - **놓는 순간 끈다.** 채움 애니메이션이 끝나기를 기다리지 않는다 — 그 사이 소리가 계속 나고,
 *   다시 잡으면 애니메이션이 취소되며 확정한 끄기가 조용히 무효가 됐다.
 * - 밀기밖에 없는 탈출구는 TalkBack·스위치 사용자에게 없는 것과 같다 — 접근성 커스텀 액션
 *   '끄기' 를 붙인다. 길게 누르기는 일부러 두지 않는다(잠결에 손을 얹기만 해도 꺼진다).
 * - 관성·플릭 판정은 없다. 끝까지 밀어야 한다.
 */
@Composable
private fun RingingSlideToDismiss(onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    val view = LocalView.current
    val knobSizePx = with(density) { 60.dp.toPx() }
    val edgePadPx = with(density) { 6.dp.toPx() }

    var trackWidthPx by remember { mutableStateOf(0) }
    val offsetX = remember { Animatable(0f) }
    val maxOffset = (trackWidthPx - knobSizePx - edgePadPx * 2).coerceAtLeast(0f)
    val threshold = maxOffset * DISMISS_THRESHOLD_FRACTION

    var pressed by remember { mutableStateOf(false) }
    var armed by remember { mutableStateOf(false) }
    val knobScale by animateFloatAsState(
        targetValue = if (pressed) 0.94f else 1f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessMedium),
        label = "knobPress",
    )
    val trackColor by animateColorAsState(
        targetValue = if (armed) {
            MaterialTheme.colorScheme.primaryContainer
        } else {
            MaterialTheme.colorScheme.surfaceContainerHigh
        },
        animationSpec = spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessMedium),
        label = "trackArmed",
    )

    val dismissLabel = stringResource(R.string.rd_slide_to_dismiss)
    val dismissAction = stringResource(R.string.rd_dismiss_action)
    val hintColor = MaterialTheme.colorScheme.onSurfaceVariant
    val edge = ringingEdge()

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(72.dp)
            .onSizeChanged { trackWidthPx = it.width }
            .clip(WakerPillShape)
            .background(trackColor)
            .border(edge, WakerPillShape)
            .semantics {
                customActions = listOf(
                    CustomAccessibilityAction(dismissAction) {
                        onDismiss()
                        true
                    },
                )
            },
        contentAlignment = Alignment.CenterStart,
    ) {
        // 라벨은 손잡이가 이동할수록 서서히 사라진다. 값은 그리기 단계에서 읽는다(포인터마다 재구성하지 않게).
        val fadeWithKnob: androidx.compose.ui.graphics.GraphicsLayerScope.() -> Unit = {
            alpha = if (maxOffset <= 0f) 1f else (1f - offsetX.value / maxOffset).coerceIn(0f, 1f)
        }
        Text(
            text = dismissLabel,
            modifier = Modifier
                .fillMaxWidth()
                // 손잡이(6+60)와 셰브론 묶음(22+37)이 차지하는 폭만큼 비워 남는 구간의 정중앙에 앉힌다.
                .padding(start = 66.dp, end = 59.dp)
                .graphicsLayer(fadeWithKnob),
            color = MaterialTheme.colorScheme.onSurface,
            fontSize = 16.sp,
            lineHeight = 22.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
        )

        SlideHintArrows(
            color = hintColor,
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .padding(end = 22.dp)
                .graphicsLayer(fadeWithKnob),
        )

        Box(
            modifier = Modifier
                .padding(start = 6.dp)
                .offset { IntOffset(offsetX.value.roundToInt(), 0) }
                .size(60.dp)
                .graphicsLayer {
                    scaleX = knobScale
                    scaleY = knobScale
                }
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.primary)
                .pointerInput(maxOffset) {
                    awaitEachGesture {
                        val down = awaitFirstDown()
                        pressed = true
                        // 잡는 순간 정착을 멈춘다 — 손 밑에서 흘러가지 않게.
                        scope.launch { offsetX.stop() }
                        var latest = offsetX.value
                        var crossed = false
                        fun moveBy(delta: Float) {
                            latest = (latest + delta).coerceIn(0f, maxOffset)
                            val target = latest
                            scope.launch { offsetX.snapTo(target) }
                            if (maxOffset > 0f) {
                                if (!crossed && latest >= threshold) {
                                    crossed = true
                                    armed = true
                                    view.performThresholdHaptic()
                                } else if (crossed && latest < threshold) {
                                    crossed = false
                                    armed = false
                                }
                            }
                        }
                        val dragStart = awaitHorizontalTouchSlopOrCancellation(down.id) { change, overSlop ->
                            change.consume()
                            // stop 이 한 프레임 늦어도 표시값에서 시작한다.
                            latest = offsetX.value
                            moveBy(overSlop)
                        }
                        // ⚠ **놓아야 끈다 — 취소는 놓은 것이 아니다.** `horizontalDrag` 는
                        //   제스처가 취소되면 false 를 돌려준다(다른 창이 터치를 가져가거나
                        //   시스템이 끊을 때). 그 값을 버리면 임계값만 넘겨 둔 채 취소된
                        //   드래그가 **알람을 꺼 버린다** — 되돌릴 수 없는 쪽이다.
                        //   예전에 쓰던 `detectHorizontalDragGestures` 는 이 갈래를
                        //   `onDragEnd`/`onDragCancel` 로 나눠 줬는데, 손으로 다시 쓰면서
                        //   그 구분이 사라졌다(2026-09-07 리뷰 31차).
                        val completed = dragStart != null && horizontalDrag(dragStart.id) { change ->
                            val delta = change.positionChange().x
                            change.consume()
                            moveBy(delta)
                        }
                        pressed = false
                        if (completed && maxOffset > 0f && latest >= threshold) {
                            // 놓는 순간이 원인 — 소리·진동은 여기서 끈다. 채움은 장식이라 종료 전환에 잘려도 된다.
                            onDismiss()
                            scope.launch { offsetX.animateTo(maxOffset) }
                        } else {
                            armed = false
                            scope.launch { offsetX.animateTo(0f) }
                        }
                    }
                },
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = Icons.AutoMirrored.Outlined.ArrowForward,
                contentDescription = dismissLabel,
                tint = MaterialTheme.colorScheme.onPrimary,
                modifier = Modifier.size(24.dp),
            )
        }
    }
}

/** 문턱을 넘는 순간의 햅틱. CONFIRM 은 API 30 부터라 그 아래는 키 탭으로 대신한다. */
private fun View.performThresholdHaptic() {
    val constant = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        HapticFeedbackConstants.CONFIRM
    } else {
        HapticFeedbackConstants.KEYBOARD_TAP
    }
    performHapticFeedback(constant)
}

/** 밀기 방향 힌트 — 같은 화면의 다른 글리프처럼 머티리얼 셰브론이다(손으로 그린 선을 쓰지 않는다). */
@Composable
private fun SlideHintArrows(color: Color, modifier: Modifier = Modifier) {
    // 시스템 애니메이터 배율(축소 동작)은 Compose 가 MotionDurationScale 로 그대로 먹는다.
    val transition = rememberInfiniteTransition(label = "slideHint")
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy((-4).dp),
    ) {
        repeat(3) { index ->
            val alpha by transition.animateFloat(
                initialValue = 0.25f,
                targetValue = 0.9f,
                animationSpec = infiniteRepeatable(
                    animation = tween(durationMillis = 750, easing = LinearEasing),
                    repeatMode = RepeatMode.Reverse,
                    // 시차는 위상으로 준다 — delayMillis 는 회차마다 길이에 더해져 시차가 유지되지 않는다.
                    initialStartOffset = StartOffset(index * 180),
                ),
                label = "arrow$index",
            )
            Icon(
                imageVector = Icons.Outlined.ChevronRight,
                contentDescription = null,
                tint = color.copy(alpha = alpha),
                modifier = Modifier.size(16.dp),
            )
        }
    }
}

private data class RingingUiState(
    /** 사용자가 지은 알람 이름 — 없으면 카드에 라벨 줄을 그리지 않는다. */
    val label: String? = null,
    val voiceText: String? = null,
    val snoozeMinutes: Int = 5,
    val dateText: String = "",
    val ampm: String = "",
    val timeText: String = "",
    /** TalkBack 이 읽는 시각("오전 6시 0분"). 화면의 "6:00" 은 눈으로 보는 용도라 이름으로 쓰지 않는다. */
    val spokenTime: String = "",
)

/** 알람을 아직 불러오지 못했을 때(빈 상태) 표시할 기본 UI 상태. */
private fun defaultRingingUiState(context: android.content.Context): RingingUiState {
    val now = java.time.LocalTime.now()
    val ampm = context.getString(if (now.hour < 12) R.string.rd2_am else R.string.rd2_pm)
    return RingingUiState(
        dateText = todayDateLabel(context),
        ampm = ampm,
        timeText = alarmClockLabel(now.hour, now.minute),
        spokenTime = spokenClockLabel(context, ampm, now.hour, now.minute),
    )
}

private fun AlarmEntity.toRingingUiState(
    context: android.content.Context,
    playbackVariantIndex: Int?,
): RingingUiState {
    val customTitle = label.trim()
        .takeIf { it.isNotBlank() && it != context.getString(R.string.rd_default_alarm_label) }
    // 표시 텍스트: 버킷 알람이면 발사 시 고른 variant 의 문구를 쓴다(오디오와 같은 bucketVariantIndex).
    // 그래야 날씨/운세 매칭 버킷에서 음성('비 와요')과 잠금화면 문구가 어긋나지 않는다. 버킷이 아니면
    // 기존 voiceText. 서버가 delivery 태그를 이미 제거하지만 과거분/회귀 대비 한 번 더 벗긴다 —
    // 단 **기계가 만든 문구일 때만**이다. 버킷 클립은 우리가 만든 스톡 문구라 항상 대상이고,
    // 그 외에는 랜덤/프리셋일 때만 벗긴다. 직접 입력 문구의 대괄호는 사용자 것이라 손대지
    // 않는다 — 태그와 같은 단어를 사용자가 쓸 수 있다(`[calm] 약 먹기`, Codex #660).
    // 빈/공백 문구는 null 로 취급해 대표 voiceText 로 폴백한다(Elvis 는 null 에만 걸려, "" 면 잠금화면
    // 문구가 통째로 사라진다). 한 variant 의 text 가 비어도 대표 문구는 보인다.
    val bucketText = if (bucketId != null && playbackVariantIndex != null) {
        bucketClipTexts().getOrNull(playbackVariantIndex)?.takeIf { it.isNotBlank() }
    } else {
        null
    }
    val displayedVoiceText = bucketText ?: voiceText
    val voiceMessage = displayedVoiceText
        ?.let { raw -> raw.stripDeliveryTags(generated = bucketText != null || voiceRandomPrompt) }
        ?.takeIf { it.isNotBlank() && playMode != AlarmPlayModes.ALARM_ONLY }
    val ampm = context.getString(if (hour < 12) R.string.rd2_am else R.string.rd2_pm)
    return RingingUiState(
        label = customTitle,
        voiceText = voiceMessage,
        snoozeMinutes = snoozeMinutes,
        dateText = todayDateLabel(context),
        ampm = ampm,
        timeText = alarmClockLabel(hour, minute),
        spokenTime = spokenClockLabel(context, ampm, hour, minute),
    )
}

private fun todayDateLabel(context: android.content.Context): String {
    val today = LocalDate.now()
    val weekday = today.dayOfWeek.getDisplayName(TextStyle.FULL, Locale.getDefault())
    return context.getString(
        R.string.rd2_ringing_date,
        today.monthValue,
        today.dayOfMonth,
        weekday,
    )
}

/** "6:30" 형태(12시간제, 분 0패딩) — 큰 시계 표시용. */
private fun alarmClockLabel(hour: Int, minute: Int): String {
    return "${hour12Of(hour)}:${"%02d".format(minute)}"
}

/** 말로 읽는 시각("오전 6시 30분" / "6:30 AM") — TalkBack 용. */
private fun spokenClockLabel(context: android.content.Context, ampm: String, hour: Int, minute: Int): String {
    return context.getString(R.string.rd_clock_spoken, ampm, hour12Of(hour), minute)
}

private fun hour12Of(hour: Int): Int {
    val hour12 = hour % 12
    return if (hour12 == 0) 12 else hour12
}

