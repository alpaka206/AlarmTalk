package com.alarmtalk.app.alarm

import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.media.audiofx.LoudnessEnhancer
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
import androidx.core.content.getSystemService
import com.alarmtalk.app.R
import com.alarmtalk.app.alarm.AlarmContract.ACTION_DISMISS
import com.alarmtalk.app.alarm.AlarmContract.ACTION_SNOOZE
import com.alarmtalk.app.alarm.AlarmContract.ACTION_START_RINGING
import com.alarmtalk.app.alarm.AlarmContract.EXTRA_ALARM_ID
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.data.AlarmAppContainer
import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.VibrationPatternLibrary
import com.alarmtalk.app.data.VibrationPatterns
import com.alarmtalk.app.data.decodeBucketClipKeys
import com.alarmtalk.app.ringing.RingingActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

internal fun storedVoiceFallbackUri(
    localAudioUri: String?,
    bucketId: String?,
    bucketClipCount: Int,
    bucketSelectionAvailable: Boolean,
): String? = localAudioUri?.takeIf {
    bucketId == null || bucketClipCount == 0 || !bucketSelectionAvailable
}

class RingingService : Service() {
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    // 서비스가 파괴됐는지 표시. 준비(prepare) 도중 파괴되면 좀비 플레이어가 start() 되지 않게 막는다.
    @Volatile
    private var destroyed = false
    private var mediaPlayer: MediaPlayer? = null
    private var vibrator: Vibrator? = null
    private var audioManager: AudioManager? = null
    private var audioFocusRequest: AudioFocusRequest? = null
    private var audioSequenceActive = false
    private var voiceLoopActive = false
    private var voiceRepeatJob: Job? = null
    private var voiceFadeJob: Job? = null
    private var voiceRepeatLoudness: LoudnessEnhancer? = null
    private var currentAlarm: AlarmEntity? = null
    private var ringingAlarmId: String? = null
    private var voiceAfterAlarmStarted = false
    private var voiceHasPlayedThisRing = false

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
        destroyed = true
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

        if (ringingAlarmId == alarmId) {
            openRingingActivity(alarmId)
            Log.i(TAG, "Ringing already active id=$alarmId; ignoring duplicate start")
            return
        }

        if (ringingAlarmId != null) {
            stopMediaAndVibration()
        }
        ringingAlarmId = alarmId
        activeRingingAlarmId = alarmId

        serviceScope.launch {
            val repository = AlarmAppContainer.repository(applicationContext)
            val alarm = repository.getAlarm(alarmId)
            if (ringingAlarmId != alarmId) return@launch
            currentAlarm = alarm
            voiceAfterAlarmStarted = false
            voiceHasPlayedThisRing = false
            requestAlarmAudioFocus()
            val bucketVoiceUri = alarm?.let { repository.resolveBucketClipLocalUri(it) }
            startRingingAudio(alarm, bucketVoiceUri)
            val pattern = alarm?.vibrationPattern ?: VibrationPatterns.DEFAULT
            startVibration(pattern)
        }
        openRingingActivity(alarmId)
        Log.i(TAG, "Ringing started id=$alarmId")
    }

    private fun startRingingAudio(alarm: AlarmEntity?, voiceUriOverride: String? = null) {
        if (mediaPlayer?.isPlaying == true) return

        val storedVoiceUri = alarm?.let {
            storedVoiceFallbackUri(
                it.localAudioUri,
                it.bucketId,
                decodeBucketClipKeys(it.bucketClipKeysJson).size,
                voiceUriOverride != null,
            )
        }
        val voiceUri = (voiceUriOverride ?: storedVoiceUri)?.takeIf { it.isNotBlank() }?.let(Uri::parse)
        val playMode = alarm?.playMode ?: AlarmPlayModes.ALARM_ONLY
        val alarmVolumePercent = alarm?.alarmVolumePercent ?: 100
        val voiceVolumePercent = alarm?.voiceVolumePercent ?: 100
        if (playMode == AlarmPlayModes.ALARM_ONLY && alarmVolumePercent <= 0) {
            stopMediaOnly()
            Log.i(TAG, "Ringing alarm tone muted by per-alarm volume id=${alarm?.id}")
            return
        }
        Log.i(
            TAG,
            "Starting ringing audio playMode=$playMode hasVoiceAudio=${voiceUri != null} alarmVolume=$alarmVolumePercent voiceVolume=$voiceVolumePercent",
        )
        when {
            playMode == AlarmPlayModes.VOICE_ONLY && voiceUri != null && voiceVolumePercent > 0 -> {
                startVoiceLoop(voiceUri, alarm, fadeIn = true)
            }

            playMode == AlarmPlayModes.VOICE_ONLY && voiceUri != null -> {
                stopMediaOnly()
                Log.i(TAG, "Voice-only alarm muted by per-voice volume id=${alarm?.id}")
            }

            playMode == AlarmPlayModes.ALARM_VOICE && voiceUri != null -> {
                if (alarmVolumePercent > 0) {
                    startAlarmToneLoop(alarm)
                } else if (voiceVolumePercent > 0) {
                    voiceAfterAlarmStarted = true
                    startVoiceLoop(voiceUri, alarm, fadeIn = true)
                } else {
                    stopMediaOnly()
                    Log.i(TAG, "Alarm+voice audio muted by per-alarm settings id=${alarm?.id}")
                }
            }

            playMode == AlarmPlayModes.VOICE_ONLY && voiceUri == null -> {
                Log.w(TAG, "Voice-only alarm has no local voice audio; falling back to bundled alarm")
                startAlarmToneLoop(alarm)
            }

            playMode == AlarmPlayModes.ALARM_VOICE && voiceUri == null -> {
                Log.w(TAG, "Alarm+voice alarm has no local voice audio; falling back to bundled alarm")
                startAlarmToneLoop(alarm)
            }

            else -> startAlarmToneLoop(alarm)
        }
    }

    private fun startAlarmToneLoop(alarm: AlarmEntity?) {
        audioSequenceActive = false
        voiceLoopActive = false
        cancelVoiceRepeatJob()
        cancelVoiceFadeJob()
        mediaPlayer?.release()
        val player = createAlarmTonePlayer(alarm, looping = true)
        // 준비 도중 dismiss/snooze/파괴로 현재 알람이 바뀌었으면 좀비 루프 플레이어를 남기지 않는다.
        if (destroyed || (alarm != null && ringingAlarmId != alarm.id)) {
            player?.release()
            mediaPlayer = null
            return
        }
        mediaPlayer = player?.apply {
            applyAlarmVolume(alarm)
            isLooping = true
            start()
        }

        if (mediaPlayer == null) {
            AlarmTalkLog.reportError("Failed to create alarm tone MediaPlayer")
        }
    }

    private fun startVoiceLoop(voiceUri: Uri, alarm: AlarmEntity?, fadeIn: Boolean) {
        audioSequenceActive = false
        voiceLoopActive = true
        cancelVoiceRepeatJob()
        cancelVoiceFadeJob()
        releaseVoiceRepeatLoudness()
        mediaPlayer?.release()
        val repeatVoice = alarm?.voiceRepeat != false
        val shouldFadeIn = fadeIn && !voiceHasPlayedThisRing
        val player = createVoicePlayer(voiceUri)
        // 준비 도중 dismiss/snooze/파괴로 현재 알람이 바뀌었으면 좀비 루프 플레이어를 남기지 않는다.
        if (destroyed || (alarm != null && ringingAlarmId != alarm.id)) {
            player?.release()
            mediaPlayer = null
            return
        }
        mediaPlayer = player?.apply {
            voiceHasPlayedThisRing = true
            applyVoiceVolume(this, alarm, fadeIn = shouldFadeIn)
            isLooping = false
            setOnCompletionListener { completed ->
                if (repeatVoice && voiceLoopActive) {
                    if (mediaPlayer === completed) {
                        cancelVoiceFadeJob()
                        scheduleVoiceRepeat(completed, alarm)
                    } else {
                        completed.release()
                    }
                } else {
                    completed.release()
                    if (mediaPlayer === completed) {
                        cancelVoiceFadeJob()
                        mediaPlayer = null
                    }
                }
            }
            start()
        }
        if (mediaPlayer == null) {
            AlarmTalkLog.reportError("Failed to create voice MediaPlayer; falling back to bundled alarm")
            startAlarmToneLoop(alarm)
        }
    }

    private fun scheduleVoiceRepeat(player: MediaPlayer, alarm: AlarmEntity?) {
        cancelVoiceRepeatJob()
        voiceRepeatJob = serviceScope.launch {
            delay(VOICE_REPEAT_GAP_MS)
            voiceRepeatJob = null
            if (!voiceLoopActive || mediaPlayer !== player) return@launch
            val alarmId = alarm?.id
            if (alarmId != null && currentAlarm?.id != alarmId) return@launch
            val targetVolume = VoiceVolumeRamp.targetVolume(alarm?.voiceVolumePercent ?: 100)
            runCatching {
                Log.i(TAG, "Repeating voice playback on existing player volume=$targetVolume")
                enableVoiceRepeatLoudness(player)
                player.setVolume(targetVolume, targetVolume)
                player.seekTo(0)
                player.start()
            }.onFailure { error ->
                AlarmTalkLog.reportError("Failed to repeat voice playback on existing player", error)
                stopMediaOnly()
                startRingingAudio(alarm)
            }
        }
    }

    private fun cancelVoiceRepeatJob() {
        voiceRepeatJob?.cancel()
        voiceRepeatJob = null
    }

    private fun cancelVoiceFadeJob() {
        voiceFadeJob?.cancel()
        voiceFadeJob = null
    }

    private fun enableVoiceRepeatLoudness(player: MediaPlayer) {
        if (voiceRepeatLoudness != null) return
        runCatching {
            LoudnessEnhancer(player.audioSessionId).apply {
                setTargetGain(VOICE_REPEAT_LOUDNESS_GAIN_MB)
                enabled = true
                voiceRepeatLoudness = this
                Log.i(TAG, "Enabled repeat voice loudness enhancer gainMb=$VOICE_REPEAT_LOUDNESS_GAIN_MB")
            }
        }.onFailure { error ->
            Log.w(TAG, "Unable to enable repeat voice loudness enhancer", error)
        }
    }

    private fun releaseVoiceRepeatLoudness() {
        voiceRepeatLoudness?.run {
            runCatching { enabled = false }
            release()
        }
        voiceRepeatLoudness = null
    }

    private fun startAlarmVoiceSequence(voiceUri: Uri, alarm: AlarmEntity?) {
        voiceLoopActive = false
        cancelVoiceRepeatJob()
        cancelVoiceFadeJob()
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
            AlarmTalkLog.reportError("Failed to create sequence MediaPlayer; falling back to bundled alarm")
            startAlarmToneLoop(alarm)
            return
        }

        // 준비 도중 dismiss/snooze/파괴로 현재 알람이 바뀌었으면 좀비 플레이어를 남기지 않는다.
        if (destroyed || (alarm != null && ringingAlarmId != alarm.id)) {
            nextPlayer.release()
            mediaPlayer = null
            return
        }

        mediaPlayer = nextPlayer.apply {
            if (playAlarmTone) {
                applyAlarmVolume(alarm)
            } else {
                val shouldFadeIn = !voiceHasPlayedThisRing
                voiceHasPlayedThisRing = true
                applyVoiceVolume(this, alarm, fadeIn = shouldFadeIn)
            }
            isLooping = false
            setOnCompletionListener { completed ->
                completed.release()
                if (mediaPlayer === completed) {
                    if (!playAlarmTone) cancelVoiceFadeJob()
                    mediaPlayer = null
                }
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
        val alarmUris = buildList {
            alarm?.alarmSoundUri?.takeIf { it.isNotBlank() }?.let { add(Uri.parse(it)) }
            add(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM))
            add(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))
        }.filterNotNull().distinct()
        val player = alarmUris.firstNotNullOfOrNull { uri ->
            runCatching {
                MediaPlayer().apply {
                    setWakeMode(applicationContext, PowerManager.PARTIAL_WAKE_LOCK)
                    setAudioAttributes(alarmAttributes)
                    setDataSource(applicationContext, uri)
                    prepare()
                }
            }.onFailure { error ->
                Log.w(TAG, "Failed to prepare alarm sound uri=$uri", error)
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
            AlarmTalkLog.reportError("Failed to prepare voice audio uri=$voiceUri", error)
        }.getOrNull()

    private fun MediaPlayer.applyAlarmVolume(alarm: AlarmEntity?) {
        val volume = ((alarm?.alarmVolumePercent ?: 100).coerceIn(0, 100)) / 100f
        setVolume(volume, volume)
    }

    private fun applyVoiceVolume(player: MediaPlayer, alarm: AlarmEntity?, fadeIn: Boolean) {
        val plan = VoiceVolumeRamp.plan(
            volumePercent = alarm?.voiceVolumePercent ?: 100,
            fadeIn = fadeIn,
        )
        Log.i(
            TAG,
            "Applying voice volume fadeIn=$fadeIn start=${plan.startVolume} target=${VoiceVolumeRamp.targetVolume(alarm?.voiceVolumePercent ?: 100)} steps=${plan.stepVolumes.size}",
        )
        player.setVolume(plan.startVolume, plan.startVolume)
        if (plan.stepVolumes.isEmpty()) {
            return
        }

        voiceFadeJob = serviceScope.launch {
            plan.stepVolumes.forEach { volume ->
                delay(VoiceVolumeRamp.FADE_IN_MS / VoiceVolumeRamp.FADE_STEPS)
                if (mediaPlayer !== player) return@launch
                runCatching { player.setVolume(volume, volume) }
            }
            if (mediaPlayer === player) voiceFadeJob = null
        }
    }

    private fun startVibration(patternName: String) {
        if (patternName == VibrationPatterns.NONE) {
            Log.i(TAG, "Vibration disabled for ringing alarm")
            return
        }

        val alarmAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

        vibrator?.vibrate(VibrationPatternLibrary.effect(patternName, repeat = true), alarmAttributes)
    }

    /**
     * 사용자가 기기를 능동적으로 쓰는 중(화면 켜짐 + 잠금 해제)인지. 이때는 전체화면 강탈
     * 대신 알림의 full-screen intent 가 헤드업 배너로 뜨게 둔다. 화면이 꺼져 있거나 잠금
     * 상태면(자는 중 등) false → 잠금화면 위 전체 울림 화면을 직접 띄운다.
     */
    private fun isDeviceActivelyInUse(): Boolean {
        val interactive = getSystemService<PowerManager>()?.isInteractive == true
        val locked = getSystemService<KeyguardManager>()?.isKeyguardLocked == true
        return interactive && !locked
    }

    /**
     * 울림 알림이 실제로 헤드업 배너로 떠서 해제 UI 를 제공할 수 있는 상태인지 판정한다.
     * 하나라도 어긋나면 헤드업이 보장되지 않으므로 false → 전체 울림 화면을 직접 띄운다.
     *  1) 앱 알림이 켜져 있어야 한다.
     *  2) 울림 채널(RINGING_CHANNEL_ID) importance 가 HIGH 이상이어야 한다. 사용자가 채널을
     *     음소거·강등하면 areNotificationsEnabled() 는 true 여도 헤드업이 안 뜬다.
     *  3) 방해금지(DND)가 시각 알림을 억제하지 않아야 한다. 알람 소리는 USAGE_ALARM 이라 DND 에서도
     *     나지만, 이 채널은 DND 를 우회하지 않으므로 DND 중엔 HIGH 라도 헤드업이 안 뜬다. 시스템이
     *     실제로 시각 방해가 가능할 때(DND 해제 = INTERRUPTION_FILTER_ALL, 또는 채널이 DND 우회)만 허용.
     */
    private fun ringingChannelCanShowHeadsUp(): Boolean {
        if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) return false
        val nm = getSystemService<NotificationManager>() ?: return false
        val channel = nm.getNotificationChannel(NotificationChannels.RINGING_CHANNEL_ID)
        // 아직 채널 생성 전이면 곧 IMPORTANCE_HIGH 로 만들어지므로 강등으로 보지 않는다.
        if (channel != null && channel.importance < NotificationManager.IMPORTANCE_HIGH) return false
        // 채널이 DND 를 우회하면 어떤 DND 에서도 헤드업 가능.
        if (channel?.canBypassDnd() == true) return true
        // 이 알림은 CATEGORY_ALARM 이라 '알람 허용' DND 모드에선 시각 방해가 허용된다.
        //  - ALL(DND off), ALARMS(알람만 허용): 허용
        //  - PRIORITY: 정책이 알람 카테고리를 허용할 때만
        //  - NONE(완전 무음)·UNKNOWN: 억제로 본다
        return when (nm.currentInterruptionFilter) {
            NotificationManager.INTERRUPTION_FILTER_ALL,
            NotificationManager.INTERRUPTION_FILTER_ALARMS -> true
            NotificationManager.INTERRUPTION_FILTER_PRIORITY -> priorityDndAllowsAlarms(nm)
            else -> false
        }
    }

    /**
     * PRIORITY DND 정책이 알람 카테고리를 허용하는지. getNotificationPolicy 는 알림 정책 접근
     * 권한이 있어야 하므로(미보유 시 SecurityException) 실패하면 보수적으로 false → 전체 울림
     * 화면을 띄운다. PRIORITY_CATEGORY_ALARMS 는 API 28+ 라 하위에선 false.
     */
    private fun priorityDndAllowsAlarms(nm: NotificationManager): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return false
        return runCatching {
            (nm.notificationPolicy.priorityCategories and NotificationManager.Policy.PRIORITY_CATEGORY_ALARMS) != 0
        }.getOrDefault(false)
    }

    private fun openRingingActivity(alarmId: String) {
        // 화면 켜짐 + 잠금 해제 상태이고 '울림 알림이 헤드업으로 뜰 수 있을 때'만 전체화면 직접 실행을
        // 생략하고 헤드업에 맡긴다(헤드업 + 전체화면 동시 표시 방지). 화면이 꺼졌거나 잠겼거나,
        // 사용자가 울림 채널을 음소거·강등해 헤드업이 안 뜨는 경우엔 소리만 나고 해제 UI가 사라지지
        // 않도록 잠금화면 위 전체 울림 화면을 직접 띄운다.
        if (isDeviceActivelyInUse() && ringingChannelCanShowHeadsUp()) {
            Log.i(TAG, "Device in active use with heads-up-capable channel; relying on heads-up notification")
            return
        }
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
            val repository = AlarmAppContainer.repository(applicationContext)
            val alarm = currentAlarm ?: repository.getAlarm(alarmId)
            val voiceUri = alarm
                ?.takeIf { it.playMode == AlarmPlayModes.ALARM_VOICE }
                ?.let {
                    repository.resolveBucketClipLocalUri(it)
                        ?: storedVoiceFallbackUri(
                            localAudioUri = it.localAudioUri,
                            bucketId = it.bucketId,
                            bucketClipCount = decodeBucketClipKeys(it.bucketClipKeysJson).size,
                            bucketSelectionAvailable = false,
                        )
                }
                ?.let(Uri::parse)
            if (voiceUri != null && !voiceAfterAlarmStarted) {
                startDismissVoiceThenFinish(alarmId, startId, voiceUri, alarm)
                return@launch
            }
            stopRingingOutputs()
            runCatching {
                AlarmAppContainer.repository(applicationContext).dismiss(alarmId)
            }.onFailure { error ->
                AlarmTalkLog.reportError("Failed to dismiss alarm id=$alarmId", error)
            }
            stopSelf(startId)
        }
    }

    private fun startDismissVoiceThenFinish(alarmId: String, startId: Int, voiceUri: Uri, alarm: AlarmEntity?) {
        voiceAfterAlarmStarted = true
        stopMediaAndVibration()
        val player = createVoicePlayer(voiceUri)
        if (player == null) {
            AlarmTalkLog.reportError("Failed to play voice after alarm dismissal; dismissing alarm id=$alarmId")
            serviceScope.launch {
                finishDismiss(alarmId, startId)
            }
            return
        }
        // 준비 도중 파괴/알람 교체 시 좀비 플레이어를 남기지 않고, 파괴가 아니면 dismiss 는 마무리한다.
        if (destroyed || (alarm != null && ringingAlarmId != alarm.id)) {
            player.release()
            mediaPlayer = null
            serviceScope.launch {
                finishDismiss(alarmId, startId)
            }
            return
        }
        mediaPlayer = player.apply {
            val shouldFadeIn = !voiceHasPlayedThisRing
            voiceHasPlayedThisRing = true
            applyVoiceVolume(this, alarm, fadeIn = shouldFadeIn)
            isLooping = false
            setOnCompletionListener { completed ->
                completed.release()
                if (mediaPlayer === completed) {
                    cancelVoiceFadeJob()
                    mediaPlayer = null
                }
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
            AlarmTalkLog.reportError("Failed to dismiss alarm id=$alarmId", error)
        }
        stopSelf(startId)
    }

    private fun snooze(alarmId: String, startId: Int) {
        stopRingingOutputs()
        serviceScope.launch {
            runCatching {
                AlarmAppContainer.repository(applicationContext).snooze(alarmId)
            }.onFailure { error ->
                AlarmTalkLog.reportError("Failed to snooze alarm id=$alarmId", error)
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
        ringingAlarmId = null
        activeRingingAlarmId = null
        currentAlarm = null
        voiceAfterAlarmStarted = false
        voiceHasPlayedThisRing = false
        abandonAlarmAudioFocus()
    }

    private fun stopMediaAndVibration() {
        stopMediaOnly()
        vibrator?.cancel()
    }

    private fun stopMediaOnly() {
        audioSequenceActive = false
        voiceLoopActive = false
        cancelVoiceRepeatJob()
        cancelVoiceFadeJob()
        releaseVoiceRepeatLoudness()
        mediaPlayer?.run {
            runCatching {
                if (isPlaying) stop()
            }
            release()
        }
        mediaPlayer = null
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
        /**
         * 현재 울림 세션의 알람 id(없으면 null). RingingActivity 가 FGS 차단 폴백으로 진입했을 때
         * 서비스가 이미 울리고 있는지 확인해, 중복 시작과 "서비스→액티비티 재오픈" 루프를 막는다.
         */
        @Volatile
        var activeRingingAlarmId: String? = null
            private set

        private const val RINGING_NOTIFICATION_ID = 1001
        private const val VOICE_REPEAT_GAP_MS = 900L
        private const val VOICE_REPEAT_LOUDNESS_GAIN_MB = 600

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
