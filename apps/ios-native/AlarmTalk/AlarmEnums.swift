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

    static let pickerCases: [AlarmPlayMode] = [
        .soundThenVoice,
        .voiceOnly,
        .alarmOnly
    ]

    /// Legacy / Android 호환: "alarm_voice" 도 sound_then_voice 로 매핑.
    static func decode(_ raw: String) -> AlarmPlayMode {
        if raw == "alarm_voice" { return .soundThenVoice }
        return AlarmPlayMode(rawValue: raw) ?? .alarmOnly
    }

    var label: String {
        switch self {
        case .alarmOnly: return "알람"
        case .voiceOnly: return "음성"
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
        raw == "scheduled" ? .armed : (AlarmRuntimeState(rawValue: raw) ?? .idle)
    }
}

// MARK: - Voice Source
// Android: `AlarmEntity.kt:166-172` `VoiceSources`
enum VoiceSource: String, Codable, CaseIterable, Hashable {
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
}

// MARK: - Snooze Repeat Limit
// Android: `AlarmEntity.kt:158-164` `SnoozeRepeatLimits` (3 / 5 / 0=무제한).
enum SnoozeRepeatLimit: Int, Codable, CaseIterable {
    case unlimited = 0
    case three = 3
    case five = 5

    static var validValues: [Int] { [three.rawValue, five.rawValue, unlimited.rawValue] }
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

// MARK: - Random Prompt Context
// Android: `TtsApi.kt:17` `randomContext`. 랜덤 깨움말 생성 시 함께 보내는
// 컨텍스트 키. 백엔드가 컨텍스트별 프롬프트 템플릿/추가 입력값 (날씨/운세 등) 을
// 결정한다. 추가 컨텍스트는 백엔드 합의 후 enum case 만 늘리면 된다.
/// 문구 종류. **서버가 받는 값과 정확히 같아야 한다.**
///
/// 서버 화이트리스트는 `tts.ts` 의 `RANDOM_CONTEXTS = ['preset','wake_weather',
/// 'wake_fortune','love']` 이고, `medication` 은 일부러 그 밖에 두어 `preset` 으로
/// 정규화된다(고정 프리셋 문구 경로를 탄다). 안드로이드 `RandomPromptContexts` 도 같은
/// 다섯이다.
///
/// ⚠ 예전에는 여기에 `meal`/`sleep`/`exercise` 가 있었다. 제품에서 '10테마 개별선택' 이
/// 사라지면서 서버가 그 셋을 **400 으로 거절**하게 됐는데 iOS 만 메뉴에 계속 그리고 있었다 —
/// 고르면 저장이 100% 실패했다. 반대로 실제로 있는 `medication`(약)은 iOS 에서 **고를 수조차
/// 없었다.** 새 값을 늘릴 때는 반드시 `tts.ts` 의 화이트리스트부터 확인할 것.
enum RandomPromptContext: String, CaseIterable, Identifiable {
    case preset
    case wakeWeather = "wake_weather"
    case wakeFortune = "wake_fortune"
    case love
    /// 동적 생성이 아니라 **고정 프리셋**이다. 서버가 `preset` 으로 정규화하고
    /// `category='medication'` 문구를 뽑는다.
    case medication

    var id: String { rawValue }

    static let defaultContext: RandomPromptContext = .preset
    static let alarmEditorCases: [RandomPromptContext] = [
        .preset,
        .wakeWeather,
        .wakeFortune,
        .love,
        .medication
    ]

    static func normalized(_ rawValue: String?) -> RandomPromptContext {
        switch rawValue {
        case "daily", "weather":
            return .wakeWeather
        case "fortune":
            return .wakeFortune
        // 사라진 값으로 저장된 옛 행은 기본으로 접는다 — 그대로 두면 서버가 400 을 준다.
        case "meal", "sleep", "exercise":
            return .preset
        default:
            // 'preset' 은 서버 무료 게이트(tts.ts:695)가 요구하는 정식 값이므로
            // 더 이상 defaultContext 로 흡수하지 않고 그대로 보존한다.
            guard let rawValue,
                  let context = RandomPromptContext(rawValue: rawValue) else {
                return defaultContext
            }
            return context
        }
    }

    /// 안드로이드 문자열과 같은 라벨(strings.xml 의 editor_msg_mode_preset·editor2_ctx_*).
    var label: String {
        switch self {
        case .preset: return "기본 인사말"
        case .wakeWeather: return "날씨"
        case .wakeFortune: return "운세"
        case .love: return "사랑"
        case .medication: return "약"
        }
    }

    /// 서버 `TTS_CATEGORIES = ['morning','medication','love','custom']` 안의 값이어야 한다.
    var ttsCategory: String {
        switch self {
        case .love: return "love"
        case .medication: return "medication"
        // preset·날씨·운세는 공통 라벨 morning 을 쓴다(문구는 preset/동적 경로가 따로 정한다).
        case .preset, .wakeWeather, .wakeFortune: return "morning"
        }
    }

    var usesWeather: Bool { self == .wakeWeather }

    var usesFortune: Bool { self == .wakeFortune }
}

// MARK: - Default Alarm Sound IDs
// Android: `AlarmEntity.kt:174-176` `DefaultAlarmSounds`
enum DefaultAlarmSounds {
    static let bundledDefault = "bundled_default"
}
