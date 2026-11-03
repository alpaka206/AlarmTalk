package com.alarmtalk.app

import android.app.Application
import android.content.Context
import androidx.test.runner.AndroidJUnitRunner

/**
 * 기기 계측 테스트는 **운영 Application 을 띄우지 않는다** — Sentry 로 쏘지 않게(CLAUDE.md 「테스트가 Sentry 로 쏘지
 * 않게 한다」). 유닛 테스트의 `src/test/resources/robolectric.properties`(`application=android.app.Application`)와 같은
 * 1차 방어선이다.
 *
 * 2026-10-26 녹음 계측 테스트가 dev 앱의 `AlarmTalkApplication` 안에서 돌아 Sentry 에 이슈(ALARMTALK-ANDROID-1Q,
 * environment development)를 열었다. 지금 계측 테스트는 `AlarmTalkApplication` 의 초기화에 기대지 않는다.
 */
class AlarmTalkTestRunner : AndroidJUnitRunner() {
    override fun newApplication(cl: ClassLoader?, className: String?, context: Context?): Application =
        super.newApplication(cl, Application::class.java.name, context)
}
