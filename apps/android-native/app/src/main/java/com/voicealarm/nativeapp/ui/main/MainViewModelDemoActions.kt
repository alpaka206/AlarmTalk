package com.voicealarm.nativeapp

import android.app.Application
import android.util.Base64
import android.util.Log
import androidx.lifecycle.viewModelScope
import com.voicealarm.nativeapp.alarm.RingingService
import com.voicealarm.nativeapp.core.VoiceAlarmLog.TAG
import com.voicealarm.nativeapp.data.AlarmAudioStore
import com.voicealarm.nativeapp.data.AlarmRepository
import com.voicealarm.nativeapp.data.CachedAlarmAudio
import com.voicealarm.nativeapp.network.TtsGenerateRequest
import com.voicealarm.nativeapp.network.VoiceAlarmApiClient
import java.time.LocalTime
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val SIA_DEMO_CACHE_KEY = "demo_sia_grandfather_wake_weather_v7_rain_can"
private const val SIA_DEMO_LOCAL_URI_KEY = "sia_demo_local_audio_uri"
private const val SIA_DEMO_TEXT_KEY = "sia_demo_text"
private const val SIA_DEMO_TEXT = "할아버지, 일어나실 시간이에요. 오늘 비가 올 수 있대요. 나가실 때 우산 꼭 챙기세요!"

internal fun MainViewModel.prepareSiaDemoVoice() {
    if (!BuildConfig.DEBUG) return
    if (demoVoiceBusy) return

    viewModelScope.launch {
        demoVoiceBusy = true
        message = "시연용 시아 음성을 저장하는 중이에요."
        runCatching {
            loadOrCreateSiaDemoVoice(AlarmAudioStore(getApplication<Application>()))
        }.onSuccess { cached ->
            demoVoiceLocalUri = cached.localAudioUri
            demoPrefs.edit()
                .putString(SIA_DEMO_LOCAL_URI_KEY, cached.localAudioUri)
                .apply()
            message = "자연스러운 시연용 음성을 저장했어요. Alarms 탭에서 바로 울릴 수 있어요."
        }.onFailure { error ->
            Log.e(TAG, "Failed to prepare Sia demo voice", error)
            message = userFacingError(error, "시연용 음성 저장에 실패했어요.")
        }
        demoVoiceBusy = false
    }
}

internal fun MainViewModel.ringSiaDemoVoiceNow() {
    if (!BuildConfig.DEBUG) return
    if (demoVoiceBusy) return

    viewModelScope.launch {
        demoVoiceBusy = true
        runCatching {
            val app = getApplication<Application>()
            val audioStore = AlarmAudioStore(app)
            val cached = loadOrCreateSiaDemoVoice(audioStore)
            demoVoiceLocalUri = cached.localAudioUri
            demoPrefs.edit()
                .putString(SIA_DEMO_LOCAL_URI_KEY, cached.localAudioUri)
                .apply()

            val reference = alarms.value
                .filterNot { it.id == AlarmRepository.DEBUG_DEMO_ALARM_ID }
                .maxByOrNull { it.updatedAtMillis }
            val fallbackTime = LocalTime.now()
            val hour = reference?.hour ?: fallbackTime.hour
            val minute = reference?.minute ?: fallbackTime.minute
            val label = reference?.label
                ?.takeIf { it.isNotBlank() && it != "시연용 음성 재생하기" }
                ?: "알람"
            val demoAlarm = withContext(Dispatchers.IO) {
                repository.upsertDebugDemoVoiceAlarm(
                    localAudioUri = cached.localAudioUri,
                    audioCacheKey = cached.cacheKey,
                    messageId = cached.messageId,
                    label = label,
                    voiceText = SIA_DEMO_TEXT,
                    hour = hour,
                    minute = minute,
                )
            }
            RingingService.start(app, demoAlarm.id)
            message = "알람을 바로 울렸어요."
        }.onFailure { error ->
            Log.e(TAG, "Failed to ring Sia demo voice now", error)
            message = userFacingError(error, "알람을 울리지 못했어요.")
        }
        demoVoiceBusy = false
    }
}

private suspend fun MainViewModel.loadOrCreateSiaDemoVoice(
    audioStore: AlarmAudioStore,
): CachedAlarmAudio {
    withContext(Dispatchers.IO) {
        audioStore.getCachedAudio(SIA_DEMO_CACHE_KEY)
    }?.let { return it }

    val session = authSession ?: throw IllegalStateException("음성을 만들려면 먼저 로그인해 주세요.")
    if (!hasPaidVoiceAccess(subscriptionResponse)) {
        throw IllegalStateException("음성 생성은 유료 음성 기능이 열려 있어야 해요.")
    }

    val loadedProfiles = if (voiceProfiles.any { it.name.trim().contains("시아") }) {
        voiceProfiles
    } else {
        withContext(Dispatchers.IO) {
            api.listVoiceProfiles(VoiceAlarmApiClient.bearer(session.token)).profiles
        }.also {
            voiceProfiles = it
        }
    }
    val profile = loadedProfiles.firstOrNull {
        it.name.trim().contains("시아") && (it.status == null || it.status == "ready")
    } ?: throw IllegalStateException("ready 상태의 '시아' 목소리를 찾지 못했어요.")

    val response = withContext(Dispatchers.IO) {
        api.generateTts(
            authorization = VoiceAlarmApiClient.bearer(session.token),
            request = TtsGenerateRequest(
                voiceProfileId = profile.id,
                text = SIA_DEMO_TEXT,
                category = "morning",
                language = "ko",
                random = false,
                alarmHour = 7,
                alarmMinute = 0,
                weatherCountry = "대한민국",
                weatherCity = "서울",
                relationshipLabel = "손녀",
                listenerTitle = "할아버지",
            ),
        )
    }
    val audioBytes = Base64.decode(response.audioBase64, Base64.DEFAULT)
    val rawAudioUri = response.audioUrl ?: response.audioObjectKey?.let { "r2://$it" }
    return withContext(Dispatchers.IO) {
        audioStore.cacheGeneratedAudio(
            bytes = audioBytes,
            format = response.audioFormat,
            rawAudioUri = rawAudioUri,
            displayName = "demo_sia_grandfather_wake_weather_natural",
            cacheKey = SIA_DEMO_CACHE_KEY,
            messageId = response.messageId,
        )
    }.also { cached ->
        demoPrefs.edit()
            .putString(SIA_DEMO_LOCAL_URI_KEY, cached.localAudioUri)
            .putString(SIA_DEMO_TEXT_KEY, response.text.ifBlank { SIA_DEMO_TEXT })
            .apply()
    }
}
