package com.voicealarm.nativeapp

import android.app.Application
import android.util.Log
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Message
import androidx.compose.material3.Text
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.voicealarm.nativeapp.core.VoiceAlarmLog.TAG
import com.voicealarm.nativeapp.data.AlarmAppContainer
import com.voicealarm.nativeapp.data.AlarmDraft
import com.voicealarm.nativeapp.data.AlarmEntity
import com.voicealarm.nativeapp.data.CachedAlarmAudio
import com.voicealarm.nativeapp.data.CharacterEventEntity
import com.voicealarm.nativeapp.network.AuthTokenResponse
import com.voicealarm.nativeapp.network.AuthSession
import com.voicealarm.nativeapp.network.AuthSessionStore
import com.voicealarm.nativeapp.network.BillingSubscriptionResponse
import com.voicealarm.nativeapp.network.CharacterResponse
import com.voicealarm.nativeapp.network.CheckoutRequest
import com.voicealarm.nativeapp.network.CodeRegisterRequest
import com.voicealarm.nativeapp.network.FamilyGroupCurrentResponse
import com.voicealarm.nativeapp.network.FamilyInvite
import com.voicealarm.nativeapp.network.FamilyVoiceProfile
import com.voicealarm.nativeapp.network.LoginRequest
import com.voicealarm.nativeapp.network.ReceivedNote
import com.voicealarm.nativeapp.network.RegisterRequest
import com.voicealarm.nativeapp.network.SendNoteRequest
import com.voicealarm.nativeapp.network.TtsGenerateRequest
import com.voicealarm.nativeapp.network.TtsGenerateResponse
import com.voicealarm.nativeapp.network.TtsMessage
import com.voicealarm.nativeapp.network.TtsMessageAudioResponse
import com.voicealarm.nativeapp.network.VoiceAlarmApiClient
import com.voicealarm.nativeapp.network.VoiceProfile
import com.voicealarm.nativeapp.network.VoiceProfileUpdateRequest
import com.voicealarm.nativeapp.network.VoucherItem
import java.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue


internal fun MainViewModel.createAlarm(draft: AlarmDraft, onDone: () -> Unit) {
    viewModelScope.launch {
        runCatching {
            repository.createAlarm(draft)
        }.onSuccess { alarm ->
            message = "알람을 저장했어요. ${timeUntilAlarmLabel(alarm.fireAtMillis)}"
            onDone()
        }.onFailure { error ->
            Log.e(TAG, "Failed to create alarm", error)
            message = userFacingError(error, "알람 저장에 실패했어요")
        }
    }
}

internal fun MainViewModel.updateAlarm(alarmId: String, draft: AlarmDraft, onDone: () -> Unit) {
    viewModelScope.launch {
        runCatching {
            repository.updateAlarm(alarmId, draft)
        }.onSuccess { alarm ->
            message = "변경사항을 저장했어요. ${timeUntilAlarmLabel(alarm.fireAtMillis)}"
            onDone()
        }.onFailure { error ->
            Log.e(TAG, "Failed to update alarm id=$alarmId", error)
            message = userFacingError(error, "알람 수정에 실패했어요")
        }
    }
}

internal fun MainViewModel.setAlarmEnabled(alarmId: String, enabled: Boolean) {
    viewModelScope.launch {
        runCatching {
            repository.setEnabled(alarmId, enabled)
        }.onSuccess {
            message = null
        }.onFailure { error ->
            Log.e(TAG, "Failed to change alarm enabled id=$alarmId", error)
            message = userFacingError(error, "알람 상태 변경에 실패했어요")
        }
    }
}

internal fun MainViewModel.deleteAlarm(alarmId: String) {
    viewModelScope.launch {
        runCatching {
            repository.deleteAlarm(alarmId)
        }.onSuccess {
            message = "알람을 삭제했어요"
        }.onFailure { error ->
            Log.e(TAG, "Failed to delete alarm id=$alarmId", error)
            message = userFacingError(error, "알람 삭제에 실패했어요")
        }
    }
}

internal fun MainViewModel.copyAlarm(alarmId: String) {
    viewModelScope.launch {
        runCatching {
            repository.copyAlarm(alarmId)
        }.onSuccess { alarm ->
            message = "알람을 10분 뒤로 복사했어요. ${timeUntilAlarmLabel(alarm.fireAtMillis)}"
        }.onFailure { error ->
            Log.e(TAG, "Failed to copy alarm id=$alarmId", error)
            message = userFacingError(error, "알람 복사에 실패했어요")
        }
    }
}

internal fun MainViewModel.createTestAlarm(delayMinutes: Int) {
    viewModelScope.launch {
        runCatching {
            repository.createTestAlarm(delayMinutes)
        }.onSuccess { alarm ->
            message = "테스트 알람을 저장했어요. ${timeUntilAlarmLabel(alarm.fireAtMillis)}"
        }.onFailure { error ->
            Log.e(TAG, "Failed to create test alarm", error)
            message = userFacingError(error, "테스트 알람 예약에 실패했어요")
        }
    }
}
