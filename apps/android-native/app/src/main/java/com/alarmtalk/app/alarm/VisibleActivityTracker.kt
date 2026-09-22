package com.alarmtalk.app.alarm

import android.app.Activity
import android.app.Application
import android.os.Bundle

/**
 * **지금 이 프로세스에 보이는(onStart~onStop 사이) 액티비티가 있는가** — 지연 없이.
 *
 * 왜 `ProcessLifecycleOwner` 가 아닌가: 그것은 마지막 액티비티가 멈춘 뒤에도 **700ms 동안**
 * STARTED 를 유지한다(설정 변경 깜박임을 막으려는 의도된 지연). 그런데 울림 알림의 갈래는
 * "Android 14+ 가 서비스의 `startActivity` 를 허용하는가" 를 묻는 것이고, 그 판정은 **실제로
 * 보이는 액티비티**로 즉시 정해진다. 사용자가 알람 직전(700ms 안)에 홈·전원을 누르면 지연
 * 때문에 '보인다' 로 읽어 QUIET(전체화면 인텐트 없음)를 고르고, `startActivity` 는 막히고,
 * 잠금 화면에서 소리만 나는 옛 증상이 그 창에서 되살아난다(코덱스 리뷰, 2026-09-22).
 *
 * 그래서 `Application.ActivityLifecycleCallbacks` 의 `onActivityStarted/Stopped` 를 그대로
 * 센다 — 이 콜백에는 지연이 없다. 울림 화면 자신도 센다(다른 알람이 울리는 중이면 우리가
 * 보이는 것이고 그때 `startActivity` 는 허용된다).
 */
object VisibleActivityTracker : Application.ActivityLifecycleCallbacks {
    private val counter = VisibleActivityCounter()

    fun install(app: Application) {
        app.registerActivityLifecycleCallbacks(this)
    }

    /** 보이는 액티비티가 하나라도 있는가. 어느 스레드에서 읽어도 된다. */
    val hasVisibleActivity: Boolean get() = counter.hasVisible

    override fun onActivityStarted(activity: Activity) = counter.started(activity)
    override fun onActivityStopped(activity: Activity) = counter.stopped(activity)

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityResumed(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit
}

/**
 * 순수한 세기 — 같은 인스턴스의 started 를 두 번 세지 않고, 모르는 인스턴스의 stopped 를
 * 음수로 만들지 않는다(둘 다 실제 콜백 순서가 뒤틀릴 때 나는 일이다). 테스트가 이것만 본다.
 */
internal class VisibleActivityCounter {
    private val visible = java.util.Collections.newSetFromMap(java.util.WeakHashMap<Any, Boolean>())

    val hasVisible: Boolean get() = synchronized(visible) { visible.isNotEmpty() }

    fun started(activity: Any) = synchronized(visible) { visible.add(activity); Unit }

    fun stopped(activity: Any) = synchronized(visible) { visible.remove(activity); Unit }
}
