package com.alarmtalk.app.alarm

import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.AlarmOrigins
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.hasVoiceResources
import com.alarmtalk.app.data.isLegacyPlanLock
import com.alarmtalk.app.data.isSystemVoiceId
import com.alarmtalk.app.data.usesFreeSystemVoiceAlarm
import com.alarmtalk.app.data.wasVoiceAlarmConvertedBySystem

/**
 * 울릴 때 **무슨 소리를 낼지**. `RingingService.startRingingAudio` 가 이 결과대로만 움직인다.
 *
 * 규칙: `docs/spec/alarm-ringing.md` §4 「조용한 알람은 사용자가 고른 것뿐이다」,
 * `docs/spec/billing-lifecycle.md` 「목소리를 못 쓰게 되면」.
 */
internal sealed interface RingSound {
    /** 알람 자신의 목소리. */
    data class OwnVoice(val uri: String) : RingSound

    /** 유료 목소리를 못 쓰게 돼 대신 트는 **기본 목소리**(클립 또는 내장 인사말). */
    data class DefaultVoice(val uri: String) : RingSound

    /**
     * 알람음. [forced] 면 알람음 스위치를 무시하고 [forcedTonePercent] 크기로 튼다 —
     * 시스템이 목소리 알람을 바꿨거나 목소리를 틀 수 없는 경우라, 스위치가 꺼져 있어도
     * 사용자가 고른 무음이 아니다.
     */
    data class Tone(val forced: Boolean) : RingSound

    /** **사용자가 고른** 무음 — '알람' 모드 + 알람음 끔(진동·화면만), 또는 목소리 크기 0 인 옛 행. */
    data object Silent : RingSound
}

/** [decideRingSound] 에 넣는 사실들. 저장소·세션을 읽는 일은 서비스가 하고 여기는 판정만 한다. */
internal data class RingSoundFacts(
    /** 저장된 재생 방식(정규화). */
    val playMode: String,
    /** 알람 자신의 목소리 오디오(버킷이면 이번 자리의 클립). 없으면 null. */
    val ownVoiceUri: String?,
    val voiceVolumePercent: Int,
    /** 알람음 스위치가 켜져 있고 크기가 0 보다 큰가. */
    val toneSwitchOn: Boolean,
    /** 울리는 지금 유료 목소리를 쓸 권한이 없다(본인 알람·유료 목소리·권한 없음). */
    val paidVoiceUnusable: Boolean,
    /** 이 버전 전에 '알람' 모드로 잠긴 옛 모양 — `isLegacyPlanLock`. */
    val legacyPlanLock: Boolean,
    /** 알람의 목소리가 기본(시스템) 목소리인가. */
    val systemVoice: Boolean,
    /** 시스템이 목소리 알람을 '알람' 모드로 바꿔 둔 행 — `wasVoiceAlarmConvertedBySystem`. */
    val convertedBySystem: Boolean,
)

/**
 * 판정 — **조용한 결과는 사용자가 고른 무음뿐이다.**
 *
 *  - 목소리 크기 0 인 옛 행 → 무음(사용자의 선택 — 아래 어떤 대체보다 먼저 본다).
 *  - 목소리 알람인데 유료 목소리를 못 쓴다(울릴 때 강등 · 옛 모양 잠금) → **기본 목소리**.
 *    기본 목소리 소리조차 없으면 알람음을 강제한다. 2026-09-29 리허설에서 여기가 '알람' 모드로
 *    내려가 목소리 알람 시절의 꺼진 알람음 스위치를 봤고, 알람이 **아무 소리 없이** 울렸다.
 *  - 목소리 알람인데 자기 오디오가 없다 → 기본 목소리 알람이면 그 목소리의 클립·인사말
 *    (잠금이 오디오 없이 묶은 행이 이 갈래다), 아니면 알람음 강제.
 *  - '알람' 모드 → 스위치대로. 꺼져 있어도 시스템이 바꿔 둔 목소리 알람이면 강제한다.
 *
 * 진동은 여기서 정하지 않는다 — 알람의 설정 그대로다(강등이 진동을 건드리지 않는다).
 *
 * @param defaultVoiceUri 기본 목소리 소리를 찾는다(필요할 때만 부른다 — 매니페스트·캐시를 읽는다).
 */
internal fun decideRingSound(
    facts: RingSoundFacts,
    defaultVoiceUri: () -> String?,
): RingSound {
    val voiceAlarm = facts.playMode == AlarmPlayModes.VOICE_ONLY || facts.legacyPlanLock
    if (voiceAlarm) {
        // ⚠ **목소리 크기 0 은 사용자가 고른 무음이다 — 어떤 대체보다 먼저 본다**(Codex #820).
        // 슬라이더로는 0 을 만들 수 없어 옛 행에만 있는 값이다. 오디오가 사라졌거나 권한이 없다고
        // 기본 목소리·알람음 강제로 넘어가면, 일부러 조용히 둔 알람이 소리를 낸다(alarm-ringing.md §4).
        if (facts.voiceVolumePercent <= 0) return RingSound.Silent
        if (facts.paidVoiceUnusable || facts.legacyPlanLock) {
            return defaultVoiceUri()?.let { RingSound.DefaultVoice(it) } ?: RingSound.Tone(forced = true)
        }
        facts.ownVoiceUri?.let { uri -> return RingSound.OwnVoice(uri) }
        if (facts.systemVoice) {
            defaultVoiceUri()?.let { return RingSound.DefaultVoice(it) }
        }
        return RingSound.Tone(forced = true)
    }
    if (facts.toneSwitchOn) return RingSound.Tone(forced = false)
    return if (facts.convertedBySystem) RingSound.Tone(forced = true) else RingSound.Silent
}

/**
 * 알람 행에서 [RingSoundFacts] 를 만든다 — `RingingService` 와 테스트가 같은 조립을 쓴다.
 *
 * @param ownVoiceUri 알람 자신의 목소리 오디오(버킷이면 이번 자리의 클립).
 * @param entitled 유료 목소리 권한(저장소를 읽는다 — [ringTimePaidVoiceUnusable] 이 필요할 때만 부른다).
 */
internal fun ringSoundFactsFor(
    alarm: AlarmEntity?,
    ownVoiceUri: String?,
    entitled: () -> Boolean,
): RingSoundFacts = RingSoundFacts(
    playMode = AlarmPlayModes.normalize(alarm?.playMode ?: AlarmPlayModes.ALARM_ONLY),
    ownVoiceUri = ownVoiceUri?.takeIf { it.isNotBlank() },
    voiceVolumePercent = alarm?.voiceVolumePercent ?: 100,
    toneSwitchOn = (alarm?.alarmSoundEnabled ?: true) && (alarm?.alarmVolumePercent ?: 100) > 0,
    paidVoiceUnusable = ringTimePaidVoiceUnusable(alarm, entitled),
    legacyPlanLock = alarm?.isLegacyPlanLock() == true,
    systemVoice = isSystemVoiceId(alarm?.voiceProfileId),
    convertedBySystem = alarm?.wasVoiceAlarmConvertedBySystem() == true,
)

/**
 * 울리는 지금 **유료 목소리를 못 쓰는가** — 본인 알람(`LOCAL_OWNED`)의 목소리 모드이고, 유료
 * 목소리 자원을 쓰며(무료 기본 목소리·직접 녹음 제외), 권한이 없다.
 *
 * 받은 알람(`RECEIVED_REMOTE`)은 보낸 사람의 구독으로 성립하므로 받는 쪽 권한으로 판단하지
 * 않는다(공유가 끊기면 서버가 걷어내고 pull 로 내려온다). '알람' 모드는 목소리를 틀지 않으므로
 * 볼 필요가 없다. [entitled] 는 저장소를 읽으므로 앞 조건이 다 맞을 때만 부른다.
 */
internal fun ringTimePaidVoiceUnusable(alarm: AlarmEntity?, entitled: () -> Boolean): Boolean =
    alarm != null &&
        AlarmPlayModes.normalize(alarm.playMode) == AlarmPlayModes.VOICE_ONLY &&
        alarm.origin == AlarmOrigins.LOCAL_OWNED &&
        !alarm.usesFreeSystemVoiceAlarm() &&
        alarm.hasVoiceResources() &&
        !entitled()

/**
 * 강제로 트는 알람음의 크기 — 그 알람의 목소리 크기와 알람음 크기 중 **큰 값**(하한 10%).
 *
 * 목소리 알람의 알람음 크기는 화면에 없는 값이라 낮게 남아 있기 쉽다(리허설 로그 `volume=10`).
 * 사용자가 이 알람에 맞춘 크기는 목소리 크기다.
 */
internal fun forcedTonePercent(alarm: AlarmEntity?): Int =
    maxOf(alarm?.voiceVolumePercent ?: 100, alarm?.alarmVolumePercent ?: 100).coerceIn(MIN_FORCED_TONE_PERCENT, 100)

private const val MIN_FORCED_TONE_PERCENT = 10
