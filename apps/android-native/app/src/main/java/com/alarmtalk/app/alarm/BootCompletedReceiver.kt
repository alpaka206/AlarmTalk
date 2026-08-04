package com.alarmtalk.app.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.util.Log
import com.alarmtalk.app.alarm.AlarmContract.ACTION_DEBUG_RESTORE_ALARMS
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.data.AlarmAppContainer
import com.alarmtalk.app.sync.AlarmScheduleIntegrityScheduler
import com.alarmtalk.app.sync.RemoteAlarmSyncScheduler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class BootCompletedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        val isDebuggable = context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
        // 부팅/업데이트뿐 아니라 시간대(여행)·시스템 시각/DST 변경 시에도 알람을 재예약한다.
        // 그렇지 않으면 시간대 변경 후 알람이 잘못된 벽시계 시각에 울린다.
        val isRestoreAction = action == Intent.ACTION_BOOT_COMPLETED ||
            action == Intent.ACTION_MY_PACKAGE_REPLACED ||
            action == Intent.ACTION_TIMEZONE_CHANGED ||
            action == Intent.ACTION_TIME_CHANGED ||
            (isDebuggable && action == ACTION_DEBUG_RESTORE_ALARMS)
        if (!isRestoreAction) return

        Log.i(TAG, "Restore receiver invoked action=$action")
        RemoteAlarmSyncScheduler.ensurePeriodic(context)
        RemoteAlarmSyncScheduler.runOnce(context)
        AlarmScheduleIntegrityScheduler.ensurePeriodic(context)
        val pendingResult = goAsync()
        // 시간대/시스템 시각 변경이면 저장된 절대 발화시각을 벽시계(hour/minute) 기준으로 재계산한다.
        val recomputeFireTime = action == Intent.ACTION_TIMEZONE_CHANGED ||
            action == Intent.ACTION_TIME_CHANGED
        // 안전망 워커는 **OS 예약이 통째로 날아간 경우**(부팅·패키지 교체)에만 덧건다. 아래
        // goAsync() 창은 약 10초뿐이라 알람이 많으면 재예약이 중간에 잘리는데, 잘려도 아무도
        // 모른다 — 사용자에겐 "업데이트하고 나니 알람이 안 울린다" 로만 보인다. 워커가 같은
        // 일을 멱등으로 다시 하므로 잘린 자리를 잇는다.
        //
        // 시간대·시각 변경에는 걸지 않는다. 워커는 recomputeFireTime=false 로 도는데, 그러면
        // 미래 시각인 알람을 '재계산 불필요'로 보고 **옛 절대시각 그대로 다시 예약**한다.
        // 아래 코루틴(=true)과 순서가 엇갈려 워커가 나중에 쓰면 DB 는 새 시각인데 OS 예약만
        // 옛 시각으로 되돌아간다(Codex #666 P1). 이 두 액션은 예약이 사라진 게 아니라 시각만
        // 다시 계산하면 되는 경우라 안전망이 필요하지도 않다.
        if (recomputeFireTime.not()) {
            AlarmScheduleIntegrityScheduler.runOnce(context)
        }
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            runCatching {
                AlarmAppContainer.repository(context).reschedulePendingAlarms(
                    recomputeFireTime = recomputeFireTime,
                )
            }.onFailure { error ->
                AlarmTalkLog.reportError("Failed to restore alarms after $action", error)
            }
            pendingResult.finish()
        }
    }
}
