package com.alarmtalk.app.alarm

object AlarmContract {
    const val ACTION_ALARM_TRIGGER = "com.alarmtalk.app.action.ALARM_TRIGGER"
    const val ACTION_DEBUG_RESTORE_ALARMS = "com.alarmtalk.app.action.DEBUG_RESTORE_ALARMS"
    const val ACTION_START_RINGING = "com.alarmtalk.app.action.START_RINGING"
    const val ACTION_DISMISS = "com.alarmtalk.app.action.DISMISS"
    const val ACTION_SNOOZE = "com.alarmtalk.app.action.SNOOZE"

    /**
     * 사용자가 울림 알림을 **스와이프로 치웠을 때** 발송된다(setDeleteIntent).
     * ACTION_DISMISS 와 결과는 같지만 끝맺음 목소리를 재생하지 않는다 — 배너를 치웠는데
     * 목소리가 몇 초 더 나오면 "안 꺼졌다"로 느껴지기 때문.
     */
    const val ACTION_DISMISS_SILENT = "com.alarmtalk.app.action.DISMISS_SILENT"

    /**
     * **울림 화면을 벗어났다**(홈·최근앱·앱 전환·전원 버튼 — 2026-09-09 지시).
     *
     * `ACTION_DISMISS` 와 결과는 같지만 액션을 갈라 둔다 — 이 경로는 사용자가 '끄기' 를
     * 누르지 않은 유일한 해제라 오탐 가능성이 있다(플립커버·근접센서·전화 수신).
     * 로그와 사용 기록에서 구분되지 않으면 오탐이 나고 있어도 아무도 알 수 없다.
     */
    const val ACTION_DISMISS_LEFT_SCREEN = "com.alarmtalk.app.action.DISMISS_LEFT_SCREEN"

    /**
     * **소리·진동만 멈춘다 — 행 상태는 건드리지 않는다.**
     *
     * 울리는 알람을 목록에서 끄거나 지울 때 쓴다. 예전에는 그 자리에서 `ACTION_DISMISS` 를
     * 보냈는데, 그러면 `AlarmRepository.dismiss` 의 **반복 알람 갈래**가 돌아
     * `enabled = true` 로 되살리고 다음 회차를 예약했다 — 사용자가 끈 알람이 조용히
     * 다시 켜졌다(코덱스 #729). 지울 때는 행이 없어 무해했지만 끌 때는 아니었다.
     */
    const val ACTION_STOP_OUTPUTS = "com.alarmtalk.app.action.STOP_OUTPUTS"
    const val EXTRA_ALARM_ID = "com.alarmtalk.app.extra.ALARM_ID"
}
