package com.alarmtalk.app.alarm

import android.content.Context
import android.media.AudioManager
import android.util.Log

/**
 * 울리는 동안 **시스템 알람 스트림 볼륨**을 알람에 맞춘 크기로 올리고, 끝나면 원래대로 되돌린다.
 *
 * 왜 필요한가: `MediaPlayer.setVolume` 은 스트림 볼륨에 **곱해지는 상대값**이다. 기기의 알람
 * 볼륨이 낮거나 0 이면 앱에서 100% 로 설정해도 작게 울리거나 아예 안 들린다 — 사용자에게는
 * "앱 설정이 안 먹는다" 로 보인다. 알람은 사용자가 **미리 맞춰 둔 약속**이므로, 그 순간만큼은
 * 기기 볼륨을 우리가 맞춘다.
 *
 * (참고: 무음/진동 모드 자체는 원래 알람 스트림을 막지 않는다 — 안드로이드가 알람을 예외로
 * 둔다. 여기서 해결하는 것은 **알람 볼륨 슬라이더가 낮거나 0** 인 경우다.)
 *
 * ⚠ **원복이 이 클래스의 존재 이유다.** 사용자의 기기 설정을 우리가 바꾸는 것이므로 반드시
 * 되돌려야 한다. 그래서 원래 값을 메모리가 아니라 **SharedPreferences 에 먼저 적어 둔다** —
 * 울리는 중 프로세스가 죽어도 다음 실행의 [restoreIfLeftOver] 가 되돌린다. 그게 없으면
 * 사용자의 알람 볼륨이 우리가 올린 값에 **영구히 고정**된다.
 */
internal object AlarmStreamVolume {

    private const val TAG = "AlarmStreamVolume"
    private const val PREFS = "alarm_stream_volume"
    private const val KEY_SAVED_VOLUME = "saved_alarm_volume"

    /** 저장된 값이 없음을 뜻하는 표식(0 도 유효한 볼륨이라 -1 을 쓴다). */
    private const val NONE = -1

    /**
     * [percent] (0~100) 에 해당하는 크기로 알람 스트림을 올린다.
     *
     * **이미 그보다 크면 건드리지 않는다** — 사용자가 더 크게 해 둔 것을 우리가 낮출 이유는
     * 없다(알람은 들려야 하는 쪽이 안전하다).
     */
    fun applyForRinging(context: Context, percent: Int) {
        val manager = context.getSystemService(AudioManager::class.java) ?: return
        runCatching {
            val max = manager.getStreamMaxVolume(AudioManager.STREAM_ALARM)
            if (max <= 0) return
            val current = manager.getStreamVolume(AudioManager.STREAM_ALARM)
            // 최소 1칸은 보장한다 — percent 가 낮아도 0 칸이 되면 무음이라 알람의 뜻이 없다.
            val desired = ((max * percent.coerceIn(0, 100)) / 100).coerceIn(1, max)
            if (current >= desired) {
                Log.i(TAG, "Alarm stream already loud enough current=$current desired=$desired")
                return
            }
            // ⚠ 올리기 **전에** 저장한다. 순서를 뒤집으면 그 사이에 죽었을 때 되돌릴 값이 없다.
            saveOriginal(context, current)
            manager.setStreamVolume(AudioManager.STREAM_ALARM, desired, 0)
            Log.i(TAG, "Raised alarm stream $current -> $desired (max=$max, percent=$percent)")
        }.onFailure { error ->
            // 방해금지(DND)에서 알람까지 차단한 기기는 ACCESS_NOTIFICATION_POLICY 없이
            // SecurityException 을 던진다. 못 올려도 알람은 그대로 울려야 하므로 삼킨다.
            Log.w(TAG, "Failed to raise alarm stream volume", error)
            clearSaved(context)
        }
    }

    /** 울림이 끝나면 원래 볼륨으로 되돌린다. 저장된 값이 없으면(안 올렸으면) 아무것도 하지 않는다. */
    fun restore(context: Context) {
        val saved = readSaved(context)
        if (saved == NONE) return
        val manager = context.getSystemService(AudioManager::class.java)
        if (manager == null) {
            clearSaved(context)
            return
        }
        runCatching {
            manager.setStreamVolume(AudioManager.STREAM_ALARM, saved, 0)
            Log.i(TAG, "Restored alarm stream volume to $saved")
        }.onFailure { error ->
            Log.w(TAG, "Failed to restore alarm stream volume", error)
        }
        // 성공·실패 모두 지운다 — 실패한 값을 남겨 두면 다음 울림에서 그걸 '원래 값' 으로
        // 다시 복원하려 들어 더 어긋난다.
        clearSaved(context)
    }

    /**
     * 울리는 중 프로세스가 죽어 원복하지 못한 값이 남아 있으면 되돌린다.
     * 서비스 생성 시 **울림을 시작하기 전에** 한 번 부른다.
     */
    fun restoreIfLeftOver(context: Context) {
        if (readSaved(context) == NONE) return
        Log.i(TAG, "Found leftover alarm stream volume from a previous ring; restoring")
        restore(context)
    }

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun saveOriginal(context: Context, volume: Int) {
        // 이미 저장돼 있으면 덮지 않는다 — 연속 울림에서 우리가 올린 값을 '원래 값' 으로
        // 굳혀 버리면 원복이 영영 어긋난다.
        if (readSaved(context) != NONE) return
        prefs(context).edit().putInt(KEY_SAVED_VOLUME, volume).commit()
    }

    private fun readSaved(context: Context): Int =
        prefs(context).getInt(KEY_SAVED_VOLUME, NONE)

    private fun clearSaved(context: Context) {
        prefs(context).edit().remove(KEY_SAVED_VOLUME).commit()
    }
}
