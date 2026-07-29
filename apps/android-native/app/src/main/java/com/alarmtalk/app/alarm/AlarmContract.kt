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
    const val EXTRA_ALARM_ID = "com.alarmtalk.app.extra.ALARM_ID"
}
