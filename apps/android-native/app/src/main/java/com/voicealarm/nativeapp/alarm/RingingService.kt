package com.voicealarm.nativeapp.alarm

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
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
import com.voicealarm.nativeapp.data.AlarmEntity
import com.voicealarm.nativeapp.data.AlarmPlayModes
import com.voicealarm.nativeapp.data.VibrationPatterns
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
    private var audioManager: AudioManager? = null
    private var audioFocusRequest: AudioFocusRequest? = null
    private var audioSequenceActive = false
    private var currentAlarm: AlarmEntity? = null
    private var voiceAfterAlarmStarted = false

    override fun onCreate() {
        super.onCreate()
        NotificationChannels.ensure(this)
        vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            getSystemService(VibratorManager::class.java).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(VIBRATOR_SERVICE) as Vibrator
        }
        audioManager = getSystemService(AudioManager::class.java)
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
        val notification = RingingNotificationFactory(this).build(alarmId)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                RINGING_NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
            )
        } else {
            startForeground(RINGING_NOTIFICATION_ID, notification)
        }

        serviceScope.launch {
            val alarm = AlarmAppContainer.repository(applicationContext).getAlarm(alarmId)
            currentAlarm = alarm
            voiceAfterAlarmStarted = false
            requestAlarmAudioFocus()
            startRingingAudio(alarm)
            val pattern = alarm?.vibrationPattern ?: VibrationPatterns.DEFAULT
            startVibration(pattern)
        }
        openRingingActivity(alarmId)
        Log.i(TAG, "Ringing started id=$alarmId")
    }

    private fun startRingingAudio(alarm: AlarmEntity?) {
        if (mediaPlayer?.isPlaying == true) return

        val voiceUri = alarm?.localAudioUri?.takeIf { it.isNotBlank() }?.let(Uri::parse)
        val volumePercent = alarm?.alarmVolumePercent ?: 100
        if (volumePercent <= 0) {
            audioSequenceActive = false
            mediaPlayer?.release()
            mediaPlayer = null
            Log.i(TAG, "Ringing audio muted by per-alarm volume id=${alarm?.id}")
            return
        }
        Log.i(
            TAG,
            "Starting ringing audio playMode=${alarm?.playMode ?: AlarmPlayModes.ALARM_ONLY} hasVoiceAudio=${voiceUri != null} volume=$volumePercent",
        )
        when {
            alarm?.playMode == AlarmPlayModes.VOICE_ONLY && voiceUri != null -> {
                startVoiceLoop(voiceUri, alarm)
            }

            alarm?.playMode == AlarmPlayModes.ALARM_VOICE && voiceUri != null -> {
                startAlarmToneLoop(alarm)
            }

            alarm?.playMode == AlarmPlayModes.VOICE_ONLY && voiceUri == null -> {
                Log.w(TAG, "Voice-only alarm has no local voice audio; falling back to bundled alarm")
                startAlarmToneLoop(alarm)
            }

            alarm?.playMode == AlarmPlayModes.ALARM_VOICE && voiceUri == null -> {
                Log.w(TAG, "Alarm+voice alarm has no local voice audio; falling back to bundled alarm")
                startAlarmToneLoop(alarm)
            }

            else -> startAlarmToneLoop(alarm)
        }
    }

    private fun startAlarmToneLoop(alarm: AlarmEntity?) {
        audioSequenceActive = false
        mediaPlayer?.release()
        mediaPlayer = createAlarmTonePlayer(alarm, looping = true)?.apply {
            applyAlarmVolume(alarm)
            isLooping = true
            start()
        }

        if (mediaPlayer == null) {
            Log.e(TAG, "Failed to create alarm tone MediaPlayer")
        }
    }

    private fun startVoiceLoop(voiceUri: Uri, alarm: AlarmEntity?) {
        audioSequenceActive = false
        mediaPlayer?.release()
        mediaPlayer = createVoicePlayer(voiceUri)?.apply {
            applyAlarmVolume(alarm)
            isLooping = true
            start()
        }
        if (mediaPlayer == null) {
            Log.e(TAG, "Failed to create voice MediaPlayer; falling back to bundled alarm")
            startAlarmToneLoop(alarm)
        }
    }

    private fun startAlarmVoiceSequence(voiceUri: Uri, alarm: AlarmEntity?) {
        audioSequenceActive = true
        mediaPlayer?.release()
        playSequenceStep(voiceUri = voiceUri, alarm = alarm, playAlarmTone = true)
    }

    private fun playSequenceStep(voiceUri: Uri, alarm: AlarmEntity?, playAlarmTone: Boolean) {
        if (!audioSequenceActive) return

        val nextPlayer = if (playAlarmTone) {
            createAlarmTonePlayer(alarm, looping = false)
        } else {
            createVoicePlayer(voiceUri)
        }

        if (nextPlayer == null) {
            Log.e(TAG, "Failed to create sequence MediaPlayer; falling back to bundled alarm")
            startAlarmToneLoop(alarm)
            return
        }

        mediaPlayer = nextPlayer.apply {
            applyAlarmVolume(alarm)
            isLooping = false
            setOnCompletionListener { completed ->
                completed.release()
                if (mediaPlayer === completed) mediaPlayer = null
                playSequenceStep(voiceUri, alarm, playAlarmTone = !playAlarmTone)
            }
            start()
        }
    }

    private fun createAlarmTonePlayer(alarm: AlarmEntity?, looping: Boolean): MediaPlayer? {
        val alarmAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        val selectedUri = alarm?.alarmSoundUri?.takeIf { it.isNotBlank() }?.let(Uri::parse)
        val player = selectedUri?.let { uri ->
            runCatching {
                MediaPlayer().apply {
                    setWakeMode(applicationContext, PowerManager.PARTIAL_WAKE_LOCK)
                    setAudioAttributes(alarmAttributes)
                    setDataSource(applicationContext, uri)
                    prepare()
                }
            }.onFailure { error ->
                Log.w(TAG, "Failed to prepare selected alarm sound uri=$uri; using bundled default", error)
            }.getOrNull()
        } ?: MediaPlayer.create(this, R.raw.voice_alarm_default, alarmAttributes, 0)

        return player?.apply {
            setWakeMode(applicationContext, PowerManager.PARTIAL_WAKE_LOCK)
            isLooping = looping
        }
    }

    private fun createVoicePlayer(voiceUri: Uri): MediaPlayer? =
        runCatching {
            MediaPlayer().apply {
                setWakeMode(applicationContext, PowerManager.PARTIAL_WAKE_LOCK)
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build(),
                )
                setDataSource(applicationContext, voiceUri)
                prepare()
            }
        }.onFailure { error ->
            Log.e(TAG, "Failed to prepare voice audio uri=$voiceUri", error)
        }.getOrNull()

    private fun MediaPlayer.applyAlarmVolume(alarm: AlarmEntity?) {
        val volume = ((alarm?.alarmVolumePercent ?: 100).coerceIn(0, 100)) / 100f
        setVolume(volume, volume)
    }

    private fun startVibration(patternName: String) {
        if (patternName == VibrationPatterns.NONE) {
            Log.i(TAG, "Vibration disabled for ringing alarm")
            return
        }

        val pattern = when (patternName) {
            VibrationPatterns.STRONG -> longArrayOf(0L, 1_000L, 250L, 1_000L, 250L)
            else -> longArrayOf(0L, 700L, 350L, 900L)
        }
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
                Intent.FLAG_ACTIVITY_CLEAR_TASK or
                Intent.FLAG_ACTIVITY_NO_ANIMATION
        }
        runCatching {
            startActivity(intent)
        }.onFailure { error ->
            Log.w(TAG, "Direct ringing activity launch failed; relying on full-screen notification", error)
        }
    }

    private fun dismiss(alarmId: String, startId: Int) {
        serviceScope.launch {
            val alarm = currentAlarm ?: AlarmAppContainer.repository(applicationContext).getAlarm(alarmId)
            val voiceUri = alarm?.localAudioUri
                ?.takeIf { it.isNotBlank() && alarm.playMode == AlarmPlayModes.ALARM_VOICE }
                ?.let(Uri::parse)
            if (voiceUri != null && !voiceAfterAlarmStarted) {
                startDismissVoiceThenFinish(alarmId, startId, voiceUri, alarm)
                return@launch
            }
            stopRingingOutputs()
            runCatching {
                AlarmAppContainer.repository(applicationContext).dismiss(alarmId)
            }.onFailure { error ->
                Log.e(TAG, "Failed to dismiss alarm id=$alarmId", error)
            }
            stopSelf(startId)
        }
    }

    private fun startDismissVoiceThenFinish(alarmId: String, startId: Int, voiceUri: Uri, alarm: AlarmEntity?) {
        voiceAfterAlarmStarted = true
        stopMediaAndVibration()
        val player = createVoicePlayer(voiceUri)
        if (player == null) {
            Log.e(TAG, "Failed to play voice after alarm dismissal; dismissing alarm id=$alarmId")
            serviceScope.launch {
                finishDismiss(alarmId, startId)
            }
            return
        }
        mediaPlayer = player.apply {
            applyAlarmVolume(alarm)
            isLooping = false
            setOnCompletionListener { completed ->
                completed.release()
                if (mediaPlayer === completed) mediaPlayer = null
                serviceScope.launch {
                    finishDismiss(alarmId, startId)
                }
            }
            start()
        }
        Log.i(TAG, "Alarm tone dismissed; playing voice once before finish id=$alarmId")
    }

    private suspend fun finishDismiss(alarmId: String, startId: Int) {
        stopRingingOutputs()
        runCatching {
            AlarmAppContainer.repository(applicationContext).dismiss(alarmId)
        }.onFailure { error ->
            Log.e(TAG, "Failed to dismiss alarm id=$alarmId", error)
        }
        stopSelf(startId)
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
        stopMediaAndVibration()
        NotificationManagerCompat.from(this).cancel(RINGING_NOTIFICATION_ID)
        runCatching {
            stopForeground(STOP_FOREGROUND_REMOVE)
        }
        abandonAlarmAudioFocus()
    }

    private fun stopMediaAndVibration() {
        audioSequenceActive = false
        mediaPlayer?.run {
            runCatching {
                if (isPlaying) stop()
            }
            release()
        }
        mediaPlayer = null
        vibrator?.cancel()
    }

    private fun requestAlarmAudioFocus() {
        val manager = audioManager ?: return
        val attributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
                .setAudioAttributes(attributes)
                .setWillPauseWhenDucked(false)
                .setOnAudioFocusChangeListener { }
                .build()
            audioFocusRequest = request
            manager.requestAudioFocus(request)
        } else {
            @Suppress("DEPRECATION")
            manager.requestAudioFocus(
                null,
                AudioManager.STREAM_ALARM,
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT,
            )
        }
        if (result != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            Log.w(TAG, "Alarm audio focus was not granted result=$result")
        }
    }

    private fun abandonAlarmAudioFocus() {
        val manager = audioManager ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioFocusRequest?.let(manager::abandonAudioFocusRequest)
            audioFocusRequest = null
        } else {
            @Suppress("DEPRECATION")
            manager.abandonAudioFocus(null)
        }
    }

    companion object {
        private const val RINGING_NOTIFICATION_ID = 1001

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
