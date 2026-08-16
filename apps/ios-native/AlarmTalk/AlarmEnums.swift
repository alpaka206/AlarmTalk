import Foundation

// MARK: - Play Mode
// Android: `AlarmConstants.kt` `AlarmPlayModes`
//
// ⚠ **재생 방식은 둘뿐이다(2026-08-06). '알람 + 목소리' 를 되살리지 말 것.**
// 그 모드는 두 플랫폼 어디에서도 약속을 지키지 못했다:
//  - iOS: AlarmKit 에 넘길 사운드는 **1개**라 '톤 먼저, 목소리 나중' 이 구조적으로 불가능하다.
//    재생 코드도 `!= .alarmOnly` 하나로만 갈라져 '목소리만' 과 완전히 같게 동작했다 —
//    픽커의 아이콘과 설명만 달랐고, 없는 기능을 광고하고 있었다.
//  - Android: 톤이 울리고 **해제할 때** 목소리가 한 번 났는데, 알림을 밀어서 없애면
//    건너뛰었다(`ACTION_DISMISS_SILENT`). 목소리를 들으려면 알람을 꺼야 하는 구조라
//    발견 자체가 어려웠고 "목소리가 안 나온다" 문의가 반복됐다.
//
// 저장된 `sound_then_voice` / `alarm_voice` 는 **`voice_only` 로 읽는다** —
// 그 모드를 고른 사람은 목소리를 만들어 둔 사용자이므로 목소리를 살리는 쪽이 의도에 가깝다
// (알람음으로 옮기면 애써 만든 목소리를 못 듣게 된다).
enum AlarmPlayMode: String, Codable, CaseIterable, Identifiable {
    case alarmOnly = "alarm_only"
    case voiceOnly = "voice_only"

    var id: String { rawValue }

    /// 화면에 그리는 순서. 세그먼트 컨트롤이 이 순서로 좌→우.
    /// ⚠ **목소리가 먼저다** — 목소리 알람 앱이고 새 알람의 기본값도 목소리라
    /// (`defaultPlayModeForPlan`), 읽는 순서와 기본 선택을 맞춘다. 안드로이드
    /// `PlayModeSelector` 와 같은 순서여야 한다.
    static let pickerCases: [AlarmPlayMode] = [.voiceOnly, .alarmOnly]

    /// 옛 값 호환: `sound_then_voice` / `alarm_voice` 는 목소리로 읽는다(위 주석 참조).
    static func decode(_ raw: String) -> AlarmPlayMode {
        if raw == "alarm_voice" || raw == "sound_then_voice" { return .voiceOnly }
        return AlarmPlayMode(rawValue: raw) ?? .alarmOnly
    }

    var label: String {
        switch self {
        case .alarmOnly: return "알람"
        case .voiceOnly: return "목소리"
        }
    }

    /// 서버 계약(`wake_mode`)은 그대로 둔다 — 안드로이드 구버전과 값이 같아야 한다.
    var remoteWakeMode: String {
        switch self {
        case .voiceOnly: return "voice_only"
        case .alarmOnly: return "sound_then_voice"
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
// Android `data/AlarmConstants.kt:28-49` `VibrationPatterns` — **17종**.
//
// ⚠ **6종을 빠뜨리지 말 것.** iOS 에는 rise/pulse/bounce/drumroll/soft/sos 가 없어서,
// 안드로이드에서 그 패턴으로 만든 알람을 iOS 로 동기화하면 값이 낯설어 기본으로
// 떨어졌다 — 사용자가 고른 진동이 조용히 바뀐다. 순서도 안드로이드 목록 그대로 둔다.
//
// ⚠ **iOS 에는 이 값을 고르는 화면이 없다**(2026-08-17). 알람이 울릴 때의 진동은
// AlarmKit 이 소유하고, 프레임워크가 받는 것은 `sound:` **하나뿐**이다 — SDK 인터페이스
// (`AlarmKit.swiftinterface`)에 vibration·haptic 이라는 낱말이 **한 번도 나오지 않는다.**
// 그래서 예전의 17종 목록은 고르든 말든 실제 알람이 그대로였고, 화면은 "실제 알람에서는
// 이 패턴이 반복돼요" 라고 **없는 기능을 광고**했다. 알람 음량 슬라이더를 iOS 에 두지
// 않는 것과 같은 이유다(CLAUDE.md).
// 값 자체는 계속 왕복시킨다 — 안드로이드에서 고른 패턴이 iOS 에서 알람을 고쳤다는
// 이유로 사라지면 안 된다. `.none` 은 여전히 뜻이 있다(포그라운드 울림 햅틱을 건너뛴다).
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
    case rise
    case pulse
    case bounce
    case drumroll
    case soft
    case sos
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
    /// 알람 재생 음원의 최대 길이(AlarmKit 커스텀 사운드 상한).
    ///
    /// 초과분은 `AudioCacheStore.trimCachedAudioIfNeeded` 가 앞 30초로 잘라 낸다.
    /// 서버가 길이를 보장하는 TTS·스톡 클립은 `enforceMaxDuration: false` 로 받아
    /// 한도를 메타에만 기록한다(트림이 필요하면 그때 발화).
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

    /// 테마(버킷) id → 문구 종류. 안드로이드 `randomPromptContextForBucket` 대응이고,
    /// 아래 `bucketCategory` 의 **역**이다 — **한쪽만 고치지 말 것.**
    ///
    /// 종류를 떨어뜨리던 시절에 저장된 테마 알람은 `voiceRandomContext` 가 nil 이라,
    /// 열 때 이걸로 되짚지 않으면 '직접 입력' 으로 보인다.
    static func forBucket(_ bucket: String?) -> RandomPromptContext? {
        switch bucket?.trimmingCharacters(in: .whitespacesAndNewlines) {
        case "greeting": return .preset
        case "love": return .love
        case "medication": return .medication
        case "fortune": return .wakeFortune
        case "weather": return .wakeWeather
        default: return nil
        }
    }

    /// 문구 종류 → 테마(버킷) id. 안드로이드 `clonePrerenderBucketCategoryFor` 대응.
    var bucketCategory: String {
        switch self {
        case .preset: return "greeting"
        case .love: return "love"
        case .medication: return "medication"
        case .wakeFortune: return "fortune"
        case .wakeWeather: return "weather"
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
