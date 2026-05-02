package com.voicealarm.nativeapp.alarm

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.voicealarm.nativeapp.R
import com.voicealarm.nativeapp.alarm.AlarmContract.ACTION_DISMISS
import com.voicealarm.nativeapp.alarm.AlarmContract.ACTION_SNOOZE
import com.voicealarm.nativeapp.alarm.AlarmContract.ACTION_START_RINGING
import com.voicealarm.nativeapp.alarm.AlarmContract.EXTRA_ALARM_ID
import com.voicealarm.nativeapp.core.VoiceAlarmLog.TAG
import com.voicealarm.nativeapp.data.AlarmAppContainer
import com.voicealarm.nativeapp.ringing.RingingActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class RingingService : Service() {
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var mediaPlayer: MediaPlayer? = null
    private var vibrator: Vibrator? = null

    override fun onCreate() {
        super.onCreate()
        NotificationChannels.ensure(this)
        vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            getSystemService(VibratorManager::class.java).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(VIBRATOR_SERVICE) as Vibrator
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val alarmId = intent?.getStringExtra(EXTRA_ALARM_ID)
        return when (intent?.action) {
            ACTION_START_RINGING -> {
                if (alarmId.isNullOrBlank()) {
                    Log.w(TAG, "RingingService start requested without alarm id")
                    stopSelf(startId)
                    return START_NOT_STICKY
                }
                startRinging(alarmId)
                START_STICKY
            }

            ACTION_DISMISS -> {
                if (!alarmId.isNullOrBlank()) dismiss(alarmId, startId)
                START_NOT_STICKY
            }

            ACTION_SNOOZE -> {
                if (!alarmId.isNullOrBlank()) snooze(alarmId, startId)
                START_NOT_STICKY
            }

            else -> START_NOT_STICKY
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        stopRingingOutputs()
        serviceScope.cancel()
        super.onDestroy()
    }

    private fun startRinging(alarmId: String) {
        val notification = buildRingingNotification(alarmId)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                RINGING_NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
            )
        } else {
            startForeground(RINGING_NOTIFICATION_ID, notification)
        }

        startAlarmSound()
        startVibration()
        openRingingActivity(alarmId)
        Log.i(TAG, "Ringing started id=$alarmId")
    }

    private fun buildRingingNotification(alarmId: String): Notification {
        val activityIntent = Intent(this, RingingActivity::class.java).apply {
            putExtra(EXTRA_ALARM_ID, alarmId)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val fullScreenIntent = PendingIntent.getActivity(
            this,
            RINGING_ACTIVITY_REQUEST_CODE,
            activityIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        return NotificationCompat.Builder(this, NotificationChannels.RINGING_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_alarm_24)
            .setColor(0xFF2563EB.toInt())
            .setContentTitle(getString(R.string.ringing_notification_title))
            .setContentText(getString(R.string.ringing_notification_text))
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .setAutoCancel(false)
            .setSound(null)
            .setVibrate(null)
            .setContentIntent(fullScreenIntent)
            .setFullScreenIntent(fullScreenIntent, true)
            .addAction(
                R.drawable.ic_alarm_24,
                "Snooze",
                servicePendingIntent(ACTION_SNOOZE, alarmId, SNOOZE_REQUEST_CODE),
            )
            .addAction(
                R.drawable.ic_alarm_24,
                "Dismiss",
                servicePendingIntent(ACTION_DISMISS, alarmId, DISMISS_REQUEST_CODE),
            )
            .build()
    }

    private fun servicePendingIntent(action: String, alarmId: String, requestCode: Int): PendingIntent {
        val intent = Intent(this, RingingService::class.java).apply {
            this.action = action
            putExtra(EXTRA_ALARM_ID, alarmId)
        }
        return PendingIntent.getService(
            this,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun startAlarmSound() {
        if (mediaPlayer?.isPlaying == true) return

        val alarmAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

        mediaPlayer?.release()
        mediaPlayer = MediaPlayer.create(this, R.raw.voice_alarm_default, alarmAttributes, 0)?.apply {
            setWakeMode(applicationContext, PowerManager.PARTIAL_WAKE_LOCK)
            isLooping = true
            start()
        }

        if (mediaPlayer == null) {
            Log.e(TAG, "Failed to create bundled alarm MediaPlayer")
        }
    }

    private fun startVibration() {
        val pattern = longArrayOf(0L, 700L, 350L, 900L)
        val alarmAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

        vibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0), alarmAttributes)
    }

    private fun openRingingActivity(alarmId: String) {
        val intent = Intent(this, RingingActivity::class.java).apply {
            putExtra(EXTRA_ALARM_ID, alarmId)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        runCatching {
            startActivity(intent)
        }.onFailure { error ->
            Log.w(TAG, "Direct ringing activity launch failed; relying on full-screen notification", error)
        }
    }

    private fun dismiss(alarmId: String, startId: Int) {
        stopRingingOutputs()
        serviceScope.launch {
            runCatching {
                AlarmAppContainer.repository(applicationContext).dismiss(alarmId)
            }.onFailure { error ->
                Log.e(TAG, "Failed to dismiss alarm id=$alarmId", error)
            }
            stopSelf(startId)
        }
    }

    private fun snooze(alarmId: String, startId: Int) {
        stopRingingOutputs()
        serviceScope.launch {
            runCatching {
                AlarmAppContainer.repository(applicationContext).snooze(alarmId)
            }.onFailure { error ->
                Log.e(TAG, "Failed to snooze alarm id=$alarmId", error)
            }
            stopSelf(startId)
        }
    }

    private fun stopRingingOutputs() {
        mediaPlayer?.run {
            runCatching {
                if (isPlaying) stop()
            }
            release()
        }
        mediaPlayer = null
        vibrator?.cancel()
        NotificationManagerCompat.from(this).cancel(RINGING_NOTIFICATION_ID)
        runCatching {
            stopForeground(STOP_FOREGROUND_REMOVE)
        }
    }

    companion object {
        private const val RINGING_NOTIFICATION_ID = 1001
        private const val RINGING_ACTIVITY_REQUEST_CODE = 2001
        private const val DISMISS_REQUEST_CODE = 2002
        private const val SNOOZE_REQUEST_CODE = 2003

        fun start(context: Context, alarmId: String) {
            val intent = Intent(context, RingingService::class.java).apply {
                action = ACTION_START_RINGING
                putExtra(EXTRA_ALARM_ID, alarmId)
            }
            ContextCompat.startForegroundService(context, intent)
        }

        fun dismiss(context: Context, alarmId: String) {
            context.startService(Intent(context, RingingService::class.java).apply {
                action = ACTION_DISMISS
                putExtra(EXTRA_ALARM_ID, alarmId)
            })
        }

        fun snooze(context: Context, alarmId: String) {
            context.startService(Intent(context, RingingService::class.java).apply {
                action = ACTION_SNOOZE
                putExtra(EXTRA_ALARM_ID, alarmId)
            })
        }
    }
}
