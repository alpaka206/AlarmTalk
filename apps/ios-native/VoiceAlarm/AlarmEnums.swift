import Foundation

// MARK: - Play Mode
// Android: `AlarmEntity.kt:150-156` `AlarmPlayModes`
// 주의: Android 는 ALARM_VOICE("alarm_voice") 를 쓰고 있으나, 사양 문서에서는
// 새 이식 시 "sound_then_voice" 로 정합한다. 두 raw 모두 디코딩 가능하도록
// CustomStringConvertible/Codable 보조를 제공한다.
enum AlarmPlayMode: String, Codable, CaseIterable, Identifiable {
    case alarmOnly = "alarm_only"
    case voiceOnly = "voice_only"
    case soundThenVoice = "sound_then_voice"

    var id: String { rawValue }

    /// Legacy / Android 호환: "alarm_voice" 도 sound_then_voice 로 매핑.
    static func decode(_ raw: String) -> AlarmPlayMode {
        switch raw {
        case AlarmPlayMode.alarmOnly.rawValue: return .alarmOnly
        case AlarmPlayMode.voiceOnly.rawValue: return .voiceOnly
        case AlarmPlayMode.soundThenVoice.rawValue, "alarm_voice": return .soundThenVoice
        default: return .alarmOnly
        }
    }

    var label: String {
        switch self {
        case .alarmOnly: return "알람만"
        case .voiceOnly: return "음성만"
        case .soundThenVoice: return "알람 + 음성"
        }
    }

    var remoteWakeMode: String {
        switch self {
        case .voiceOnly: return "voice_only"
        default: return "sound_then_voice"
        }
    }
}

// MARK: - Sync State
// Android: `AlarmEntity.kt:56-61` `AlarmSyncStates`
enum AlarmSyncState: String, Codable, CaseIterable {
    case localOnly = "local_only"
    case synced
    case dirty
    case syncFailed = "sync_failed"
}

// MARK: - Origin
// Android: `AlarmEntity.kt:63-68` `AlarmOrigins`
enum AlarmOrigin: String, Codable, CaseIterable {
    case localOwned = "local_owned"
    case receivedRemote = "received_remote"
}

// MARK: - Runtime State
// Android: `AlarmEntity.kt:47-54` `AlarmStates`
// 매핑: scheduled -> idle/armed (스케줄 직후), ringing/snoozed/dismissed/failed 동일.
// iOS 는 더 명시적인 idle/armed 분리를 채택하고, "scheduled" 디코딩을 armed 로 폴백.
enum AlarmRuntimeState: String, Codable, CaseIterable {
    case idle
    case armed
    case ringing
    case snoozed
    case dismissed
    case failed
    case disabled

    static func decode(_ raw: String) -> AlarmRuntimeState {
        switch raw {
        case "scheduled": return .armed
        case AlarmRuntimeState.idle.rawValue: return .idle
        case AlarmRuntimeState.armed.rawValue: return .armed
        case AlarmRuntimeState.ringing.rawValue: return .ringing
        case AlarmRuntimeState.snoozed.rawValue: return .snoozed
        case AlarmRuntimeState.dismissed.rawValue: return .dismissed
        case AlarmRuntimeState.failed.rawValue: return .failed
        case AlarmRuntimeState.disabled.rawValue: return .disabled
        default: return .idle
        }
    }
}

// MARK: - Voice Source
// Android: `AlarmEntity.kt:166-172` `VoiceSources`
enum VoiceSource: String, Codable, CaseIterable {
    case localAudio = "local_audio"
    case ttsProfile = "tts_profile"
    case serverTts = "server_tts"
}

// MARK: - Vibration Pattern
// Android: `AlarmEntity.kt:70-98` `VibrationPatterns` (12종, default/strong/short/medium/
// heartbeat/ticktock/waltz/zigzag/off_beat/ripple/siren/none)
enum VibrationPattern: String, Codable, CaseIterable {
    case `default`
    case strong
    case short
    case medium
    case heartbeat
    case ticktock
    case waltz
    case zigzag
    case offBeat = "off_beat"
    case ripple
    case siren
    case none

    static var allRawValues: [String] { allCases.map(\.rawValue) }
}

// MARK: - Snooze Repeat Limit
// Android: `AlarmEntity.kt:158-164` `SnoozeRepeatLimits` (3 / 5 / 0=무제한).
// 사양 문서에서 "once = 1" 도 명시. 모두 보존.
enum SnoozeRepeatLimit: Int, Codable, CaseIterable {
    case unlimited = 0
    case once = 1
    case three = 3
    case five = 5

    static var validValues: [Int] { allCases.map(\.rawValue) }
    static func isValid(_ value: Int) -> Bool { validValues.contains(value) }
}

// MARK: - Repeat Days
// Android: `AlarmTimeCalculator.kt:55-58` 의 bit 규약과 동일.
// 0=일, 1=월, ..., 6=토. mask = 1 << index.
enum RepeatDay: Int, CaseIterable, Sendable {
    case sunday = 0
    case monday = 1
    case tuesday = 2
    case wednesday = 3
    case thursday = 4
    case friday = 5
    case saturday = 6

    var mask: Int { 1 << rawValue }

    /// `Calendar.current.weekday` 는 1=Sun..7=Sat 이므로 -1 변환.
    static func fromCalendarWeekday(_ value: Int) -> RepeatDay? {
        let index = value - 1
        return RepeatDay(rawValue: index)
    }

    /// iOS `Locale.Weekday` (.sunday/.monday/...) 1..7 매핑.
    var localeWeekdayInt: Int { rawValue + 1 }
}

extension Int {
    /// repeatDaysMask -> [RepeatDay]
    var repeatDays: [RepeatDay] { RepeatDay.allCases.filter { self & $0.mask != 0 } }

    /// 비트별 활성 여부
    func hasRepeatDay(_ day: RepeatDay) -> Bool { (self & day.mask) != 0 }
}

extension Array where Element == RepeatDay {
    var mask: Int { reduce(0) { $0 | $1.mask } }
}

// MARK: - Audio Duration Limits
// Android: `AlarmAudioStore.kt:21-29`
enum AlarmAudioLimits {
    /// 알람 재생 음원의 최대 길이. 본 Phase 에서는 메타에만 기록하고,
    /// trim 자체는 Phase 2-B4 또는 추후. 단 cacheBytes 시 한도를 넘으면 throw.
    static let maxDurationMillis: Int64 = 30_000

    /// `MediaMetadataRetriever` 가 ms 단위 끝자리에서 들쭉날쭉할 수 있어
    /// Android 와 동일하게 750ms tolerance.
    static let durationToleranceMillis: Int64 = 750
}

enum VoiceProfileAudioLimits {
    static let minDurationMillis: Int64 = 60_000
    static let recommendedDurationMillis: Int64 = 90_000
    static let maxDurationMillis: Int64 = 120_000
}

// MARK: - Default Alarm Sound IDs
// Android: `AlarmEntity.kt:174-176` `DefaultAlarmSounds`
enum DefaultAlarmSounds {
    static let bundledDefault = "bundled_default"
}
