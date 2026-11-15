package com.alarmtalk.app.data

import android.content.Context

/**
 * **예전 캐시 키에 들어 있던 닉네임** — 키 계산에만 쓴다(2026-10-29 닉네임 삭제).
 *
 * 안드로이드는 기본 목소리 직접 입력 음성의 폰 안 재사용 키(`AlarmAudioStore.ttsInputKey`)에 계정 닉네임을 넣어 왔다(iOS 는
 * 넣지 않았다 — 목소리 프로필의 호칭만 넣는다). 서버는 직접 입력 문구에 호칭을 붙이지 않으므로 소리에는 아무 영향이 없었고,
 * 키에만 들어갔다. 닉네임을 지우면 그 키가 바뀌어, 직전에 쓴 문구로 새 알람을 저장할 때 폰에 있는 음성을 못 찾고 서버에서 다시
 * 받는다 — 무료 한도가 한 번 더 깎인다. 그래서 그 계정에서 **처음 본 닉네임을 이 기기에 얼려 두고** 키 계산에만 쓴다.
 * 화면에도, 서버로 보내는 문구에도 쓰지 않는다. 새 계정(닉네임 없음)은 빈 값으로 얼어 키에 아무것도 넣지 않는다.
 */
class LegacyNicknameKeyStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("legacy_nickname_cache_key", Context.MODE_PRIVATE)

    /**
     * [userId] 의 얼린 값. 처음이면 [sessionName](이 기기에 적어 둔 세션의 닉네임 — `AuthSessionStore` 는 같은 계정의 이름을 빈
     * 값으로 덮지 않는다)으로, 그것도 비었으면 [savedAlarmTitle](이 계정이 기본 목소리로 저장한 알람의 호칭 —
     * [legacyNicknameFromAlarms])로 얼린다.
     *
     * ⚠ **세션 이름만 믿지 말 것**(코덱스 #976). 서버가 빈 이름을 주기 시작한 뒤 옛 앱(1.2.16)은 세션의 이름을 빈 값으로 덮었다 —
     *   그 기기가 1.3 으로 올라오면 닉네임은 알람 행에만 남아 있다(그 알람을 저장할 때 키에 넣은 바로 그 값이다).
     */
    fun titleFor(userId: String, sessionName: String?, savedAlarmTitle: String? = null): String? {
        val key = "title_$userId"
        if (!prefs.contains(key)) {
            val seed = sessionName?.trim()?.takeIf { it.isNotEmpty() } ?: savedAlarmTitle?.trim().orEmpty()
            prefs.edit().putString(key, seed).apply()
        }
        return prefs.getString(key, null)?.takeIf { it.isNotBlank() }
    }
}

/**
 * **기본 목소리 알람에 남은 호칭 — 옛 키에 들어간 닉네임**(가장 최근에 저장한 것). 편집기는 기본 목소리 알람을 저장할 때 계정 닉네임을
 * 그 알람의 호칭으로 적었고(`AlarmEditorState.voiceListenerTitleOverride`), 호칭을 손으로 바꾸는 길은 없다. [alarms] 는 이 계정의
 * 알람이어야 한다(`observeAlarms` 가 이미 소유자로 거른다).
 */
fun legacyNicknameFromAlarms(alarms: List<AlarmEntity>): String? =
    alarms.asSequence()
        .filter { isSystemVoiceId(it.voiceProfileId) && !it.voiceListenerTitle.isNullOrBlank() }
        .maxByOrNull { it.updatedAtMillis }
        ?.voiceListenerTitle
        ?.trim()
