package com.alarmtalk.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 알람 권한이 모자라면 **앱에 들어가지 못한다**(2026-11-16 오너 — CLAUDE.md 「알람 권한 3종이 없으면 앱에 들어가지
 * 못한다」, 스펙 gates-and-overlays 「알람 권한 게이트」). 화면을 띄우지 않고 소스 배선을 본다 — 되돌리는 변경이
 * 조용히 들어오는 것을 막는다.
 */
class PermissionGateWiringTest {

    private fun source(path: String): String {
        // 테스트는 app/ 에서 돈다. 모듈 루트 기준 상대 경로.
        val file = File("src/main/java/com/alarmtalk/app/$path")
        assertTrue("$path 를 못 찾았다(경로: ${file.absolutePath})", file.exists())
        return file.readText()
    }

    @Test
    fun `알람 권한 게이트는 닫히지 않고 닫기가 앱을 끈다`() {
        val gate = source("ui/permission/PermissionGate.kt")
        // 마이크만 예전 그대로(닫힌다) — 알람 권한 셋은 막는다.
        assertTrue(gate.contains("val blocksApp = target != PermissionTarget.RecordAudio"))
        // 바깥 탭·뒤로가기로 닫히지 않는다.
        assertTrue(gate.contains("onDismiss = if (blocksApp) ({}) else onDismiss"))
        // [닫기][허용하기] — 닫기는 취소가 아니라 앱 종료다.
        assertTrue(gate.contains("R.string.common_permission_gate_close_app"))
        assertTrue(gate.contains("finishAndRemoveTask()"))
    }

    @Test
    fun `본 화면에 들어서면 권한이 모자랄 때 게이트를 세우고 홈 배너는 없다`() {
        val app = source("ui/app/AlarmTalkApp.kt")
        assertTrue(app.contains("val alarmPermissionGateDue = authSession != null"))
        // 차단 게이트(업데이트·교체)·동의 화면이 먼저다.
        assertTrue(app.contains("!blockingGateActive && !permissions.alarmReady"))
        assertTrue(app.contains("permissions.firstMissingAlarmTarget()?.let(viewModel::requestPermissionGate)"))
        // 목록 위 권한 배너는 지웠다 — 게이트가 막으니 그릴 일이 없다.
        assertFalse(source("ui/alarms/AlarmListScreen.kt").contains("AlarmPermissionWarningBanner"))
        assertFalse(source("ui/components/ControlsAndPermissions.kt").contains("fun AlarmPermissionWarningBanner"))
    }
}
