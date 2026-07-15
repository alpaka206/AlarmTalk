package com.alarmtalk.app.data

import java.time.LocalDate

// AlarmEntity 에서 분리한 알람 상수/룩업 모음 (iOS AlarmEnums.swift 와 동일 역할).
// 동작 변경 없음 — 같은 패키지라 참조처는 수정 불필요.

object AlarmStates {
    const val SCHEDULED = "scheduled"
    const val RINGING = "ringing"
    const val SNOOZED = "snoozed"
    const val DISMISSED = "dismissed"
    const val DISABLED = "disabled"
    const val FAILED = "failed"
}

object AlarmSyncStates {
    const val LOCAL_ONLY = "local_only"
    const val SYNCED = "synced"
    const val DIRTY = "dirty"
    const val FAILED = "sync_failed"
}

object AlarmOrigins {
    const val LOCAL_OWNED = "local_owned"
    const val RECEIVED_REMOTE = "received_remote"

    val all = listOf(LOCAL_OWNED, RECEIVED_REMOTE)
}

object VibrationPatterns {
    const val DEFAULT = "default"
    const val STRONG = "strong"
    const val SHORT = "short"
    const val MEDIUM = "medium"
    const val HEARTBEAT = "heartbeat"
    const val TICKTOCK = "ticktock"
    const val WALTZ = "waltz"
    const val ZIGZAG = "zigzag"
    const val OFF_BEAT = "off_beat"
    const val RIPPLE = "ripple"
    const val SIREN = "siren"

    // 진폭(amplitude) 제어를 활용한 패턴 — 진폭 미지원 기기에선 on/off 만으로 degrade.
    const val RISE = "rise"
    const val PULSE = "pulse"
    const val BOUNCE = "bounce"
    const val DRUMROLL = "drumroll"
    const val SOFT = "soft"
    const val SOS = "sos"

    const val NONE = "none"

    val all = listOf(
        DEFAULT,
        STRONG,
        SHORT,
        MEDIUM,
        RISE,
        PULSE,
        BOUNCE,
        DRUMROLL,
        HEARTBEAT,
        TICKTOCK,
        WALTZ,
        ZIGZAG,
        OFF_BEAT,
        RIPPLE,
        SIREN,
        SOFT,
        SOS,
        NONE,
    )
}

object VibrationPatternLibrary {
    // timings 는 [쉼, 진동, 쉼, 진동 …] 교대(ms). amplitudes 가 null 이 아니면 같은 길이로
    // 세기(0~255)를 지정한다 — 진폭 미지원 기기는 0이 아닌 세기를 전부 최대로 처리(자연 degrade).
    private class Wave(val timings: LongArray, val amplitudes: IntArray? = null)

    private fun wave(patternName: String): Wave =
        when (patternName) {
            VibrationPatterns.STRONG -> Wave(longArrayOf(0L, 1_000L, 240L, 1_000L, 240L))
            VibrationPatterns.SHORT -> Wave(longArrayOf(0L, 260L, 520L))
            VibrationPatterns.MEDIUM -> Wave(longArrayOf(0L, 560L, 420L))
            VibrationPatterns.HEARTBEAT -> Wave(longArrayOf(0L, 120L, 120L, 240L, 580L))
            VibrationPatterns.TICKTOCK -> Wave(longArrayOf(0L, 90L, 210L, 90L, 620L))
            VibrationPatterns.WALTZ -> Wave(longArrayOf(0L, 280L, 140L, 150L, 140L, 150L, 620L))
            VibrationPatterns.ZIGZAG -> Wave(longArrayOf(0L, 110L, 100L, 180L, 100L, 280L, 520L))
            VibrationPatterns.OFF_BEAT -> Wave(longArrayOf(0L, 80L, 260L, 240L, 150L, 110L, 560L))
            VibrationPatterns.RIPPLE -> Wave(longArrayOf(0L, 90L, 110L, 160L, 130L, 260L, 620L))
            VibrationPatterns.SIREN -> Wave(longArrayOf(0L, 240L, 110L, 240L, 110L, 520L, 360L))

            // 약하게 시작해 점점 세지는 웨이크업 램프 — 잠결에 놀라지 않게 깨운다.
            VibrationPatterns.RISE -> Wave(
                longArrayOf(0L, 220L, 110L, 220L, 110L, 280L, 110L, 380L, 130L, 520L, 700L),
                intArrayOf(0, 45, 0, 95, 0, 150, 0, 210, 0, 255, 0),
            )
            // 여림-세게가 번갈아 오는 이중 맥동.
            VibrationPatterns.PULSE -> Wave(
                longArrayOf(0L, 420L, 200L, 420L, 620L),
                intArrayOf(0, 120, 0, 255, 0),
            )
            // 튀는 공처럼 세게 시작해 점점 잦아드는 감쇠 바운스.
            VibrationPatterns.BOUNCE -> Wave(
                longArrayOf(0L, 110L, 80L, 110L, 80L, 110L, 80L, 110L, 520L),
                intArrayOf(0, 255, 0, 180, 0, 120, 0, 70, 0),
            )
            // 빠른 연타가 점점 세지는 드럼롤.
            VibrationPatterns.DRUMROLL -> Wave(
                longArrayOf(0L, 60L, 55L, 60L, 55L, 60L, 55L, 70L, 55L, 90L, 55L, 130L, 45L, 220L, 640L),
                intArrayOf(0, 80, 0, 110, 0, 140, 0, 170, 0, 200, 0, 230, 0, 255, 0),
            )
            // 낮은 세기의 긴 울림 — 조용한 환경용.
            VibrationPatterns.SOFT -> Wave(
                longArrayOf(0L, 900L, 520L),
                intArrayOf(0, 95, 0),
            )
            // 모스 부호 SOS(··· ——— ···).
            VibrationPatterns.SOS -> Wave(
                longArrayOf(
                    0L, 120L, 120L, 120L, 120L, 120L, 260L,
                    360L, 140L, 360L, 140L, 360L, 260L,
                    120L, 120L, 120L, 120L, 120L, 780L,
                ),
            )

            else -> Wave(longArrayOf(0L, 700L, 350L, 900L))
        }

    /** 링잉(반복)·미리듣기(1회)에서 공용으로 쓰는 진동 이펙트. */
    fun effect(patternName: String, repeat: Boolean): android.os.VibrationEffect {
        val wave = wave(patternName)
        val repeatIndex = if (repeat) 0 else -1
        return if (wave.amplitudes != null) {
            android.os.VibrationEffect.createWaveform(wave.timings, wave.amplitudes, repeatIndex)
        } else {
            android.os.VibrationEffect.createWaveform(wave.timings, repeatIndex)
        }
    }
}

object HolidaySeedData {
    fun holidays(countryCode: String, year: Int): List<HolidayDate> =
        when (countryCode.uppercase()) {
            "KR" -> koreanHolidaysByYear[year].orEmpty()
            else -> emptyList()
        }

    private val koreanHolidaysByYear = mapOf(
        2026 to listOf(
            HolidayDate(LocalDate.of(2026, 1, 1), "신정"),
            HolidayDate(LocalDate.of(2026, 2, 16), "설날 연휴"),
            HolidayDate(LocalDate.of(2026, 2, 17), "설날"),
            HolidayDate(LocalDate.of(2026, 2, 18), "설날 연휴"),
            HolidayDate(LocalDate.of(2026, 3, 1), "삼일절"),
            HolidayDate(LocalDate.of(2026, 3, 2), "대체공휴일"),
            HolidayDate(LocalDate.of(2026, 5, 5), "어린이날"),
            HolidayDate(LocalDate.of(2026, 5, 24), "부처님오신날"),
            HolidayDate(LocalDate.of(2026, 5, 25), "대체공휴일"),
            HolidayDate(LocalDate.of(2026, 6, 3), "전국동시지방선거"),
            HolidayDate(LocalDate.of(2026, 6, 6), "현충일"),
            HolidayDate(LocalDate.of(2026, 8, 15), "광복절"),
            HolidayDate(LocalDate.of(2026, 8, 17), "대체공휴일"),
            HolidayDate(LocalDate.of(2026, 9, 24), "추석 연휴"),
            HolidayDate(LocalDate.of(2026, 9, 25), "추석"),
            HolidayDate(LocalDate.of(2026, 9, 26), "추석 연휴"),
            HolidayDate(LocalDate.of(2026, 10, 3), "개천절"),
            HolidayDate(LocalDate.of(2026, 10, 5), "대체공휴일"),
            HolidayDate(LocalDate.of(2026, 10, 9), "한글날"),
            HolidayDate(LocalDate.of(2026, 12, 25), "기독탄신일"),
        ),
        2027 to listOf(
            HolidayDate(LocalDate.of(2027, 1, 1), "신정"),
            HolidayDate(LocalDate.of(2027, 2, 6), "설날 연휴"),
            HolidayDate(LocalDate.of(2027, 2, 7), "설날"),
            HolidayDate(LocalDate.of(2027, 2, 8), "설날 연휴"),
            HolidayDate(LocalDate.of(2027, 2, 9), "대체공휴일(설날)"),
            HolidayDate(LocalDate.of(2027, 3, 1), "삼일절"),
            HolidayDate(LocalDate.of(2027, 5, 5), "어린이날"),
            HolidayDate(LocalDate.of(2027, 5, 13), "부처님오신날"),
            HolidayDate(LocalDate.of(2027, 6, 6), "현충일"),
            HolidayDate(LocalDate.of(2027, 8, 15), "광복절"),
            HolidayDate(LocalDate.of(2027, 8, 16), "대체공휴일(광복절)"),
            HolidayDate(LocalDate.of(2027, 9, 14), "추석 연휴"),
            HolidayDate(LocalDate.of(2027, 9, 15), "추석"),
            HolidayDate(LocalDate.of(2027, 9, 16), "추석 연휴"),
            HolidayDate(LocalDate.of(2027, 10, 3), "개천절"),
            HolidayDate(LocalDate.of(2027, 10, 4), "대체공휴일(개천절)"),
            HolidayDate(LocalDate.of(2027, 10, 9), "한글날"),
            HolidayDate(LocalDate.of(2027, 10, 11), "대체공휴일(한글날)"),
            HolidayDate(LocalDate.of(2027, 12, 25), "성탄절"),
            HolidayDate(LocalDate.of(2027, 12, 27), "대체공휴일(성탄절)"),
        ),
        2028 to listOf(
            HolidayDate(LocalDate.of(2028, 1, 1), "신정"),
            HolidayDate(LocalDate.of(2028, 1, 26), "설날 연휴"),
            HolidayDate(LocalDate.of(2028, 1, 27), "설날"),
            HolidayDate(LocalDate.of(2028, 1, 28), "설날 연휴"),
            HolidayDate(LocalDate.of(2028, 3, 1), "삼일절"),
            HolidayDate(LocalDate.of(2028, 5, 2), "부처님오신날"),
            HolidayDate(LocalDate.of(2028, 5, 5), "어린이날"),
            HolidayDate(LocalDate.of(2028, 6, 6), "현충일"),
            HolidayDate(LocalDate.of(2028, 8, 15), "광복절"),
            HolidayDate(LocalDate.of(2028, 10, 2), "추석 연휴"),
            HolidayDate(LocalDate.of(2028, 10, 3), "추석/개천절"),
            HolidayDate(LocalDate.of(2028, 10, 4), "추석 연휴"),
            HolidayDate(LocalDate.of(2028, 10, 5), "대체공휴일(개천절)"),
            HolidayDate(LocalDate.of(2028, 10, 9), "한글날"),
            HolidayDate(LocalDate.of(2028, 12, 25), "성탄절"),
        ),
        2029 to listOf(
            HolidayDate(LocalDate.of(2029, 1, 1), "신정"),
            HolidayDate(LocalDate.of(2029, 2, 12), "설날 연휴"),
            HolidayDate(LocalDate.of(2029, 2, 13), "설날"),
            HolidayDate(LocalDate.of(2029, 2, 14), "설날 연휴"),
            HolidayDate(LocalDate.of(2029, 3, 1), "삼일절"),
            HolidayDate(LocalDate.of(2029, 5, 5), "어린이날"),
            HolidayDate(LocalDate.of(2029, 5, 7), "대체공휴일(어린이날)"),
            HolidayDate(LocalDate.of(2029, 5, 20), "부처님오신날"),
            HolidayDate(LocalDate.of(2029, 5, 21), "대체공휴일(부처님오신날)"),
            HolidayDate(LocalDate.of(2029, 6, 6), "현충일"),
            HolidayDate(LocalDate.of(2029, 8, 15), "광복절"),
            HolidayDate(LocalDate.of(2029, 9, 21), "추석 연휴"),
            HolidayDate(LocalDate.of(2029, 9, 22), "추석"),
            HolidayDate(LocalDate.of(2029, 9, 23), "추석 연휴"),
            HolidayDate(LocalDate.of(2029, 9, 24), "대체공휴일(추석)"),
            HolidayDate(LocalDate.of(2029, 10, 3), "개천절"),
            HolidayDate(LocalDate.of(2029, 10, 9), "한글날"),
            HolidayDate(LocalDate.of(2029, 12, 25), "성탄절"),
        ),
    )
}

object AlarmPlayModes {
    const val ALARM_ONLY = "alarm_only"
    const val VOICE_ONLY = "voice_only"
    const val ALARM_VOICE = "alarm_voice"

    val all = listOf(ALARM_ONLY, VOICE_ONLY, ALARM_VOICE)
}

object SnoozeRepeatLimits {
    const val THREE = 3
    const val FIVE = 5
    const val FOREVER = 0

    val all = listOf(THREE, FIVE, FOREVER)
}

object VoiceSources {
    const val LOCAL_AUDIO = "local_audio"
    const val TTS_PROFILE = "tts_profile"
    const val SERVER_TTS = "server_tts"

    val all = listOf(LOCAL_AUDIO, TTS_PROFILE, SERVER_TTS)
}

object DefaultAlarmSounds {
    const val BUNDLED_DEFAULT = "bundled_default"
}
