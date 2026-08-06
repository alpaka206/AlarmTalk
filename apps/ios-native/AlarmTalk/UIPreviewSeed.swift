import Foundation

/// **DEBUG 전용** — 서버·로그인 없이 실제 화면을 띄우기 위한 시드.
///
/// 앱은 로그인 게이트로 막혀 있어 시뮬레이터에서 화면을 확인하려면 계정이 필요하다.
/// 디자인·레이아웃을 눈으로 확인하는 데 그 왕복은 불필요하므로, 실행 인자
/// `-UIPreviewSeed` 가 있으면 가짜 세션과 알람 몇 개를 메모리에 심는다.
///
/// ⚠ **릴리스 빌드에는 들어가지 않는다**(`#if DEBUG`). Keychain 에도 쓰지 않으므로
/// 앱을 다시 켜면 사라지고, 실제 로그인 상태를 오염시키지 않는다.
enum UIPreviewSeed {

    /// 실행 인자로 켜졌는가. 릴리스에서는 항상 false.
    static var isEnabled: Bool {
        #if DEBUG
        return ProcessInfo.processInfo.arguments.contains("-UIPreviewSeed")
        #else
        return false
        #endif
    }

    /// 인증 화면을 바로 띄우는 실행 인자 — `-UIPreviewAuthScreen login|register|reset`.
    /// 시뮬레이터에는 스크립트로 탭할 방법이 없어, 화면 확인용 진입점을 인자로 연다.
    static var authScreen: String? {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-UIPreviewAuthScreen"), i + 1 < args.count else { return nil }
        return args[i + 1]
        #else
        return nil
        #endif
    }

    /// 실행하자마자 알람 편집기를 연다 — `-UIPreviewEditor`. 화면 확인용.
    static var opensEditor: Bool {
        #if DEBUG
        return ProcessInfo.processInfo.arguments.contains("-UIPreviewEditor")
        #else
        return false
        #endif
    }

    /// 첫 화면으로 띄울 탭 — `-UIPreviewTab alarms|voices|menu`. 화면 확인용.
    static var initialTab: NativeTab? {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-UIPreviewTab"), i + 1 < args.count else { return nil }
        return NativeTab(rawValue: args[i + 1])
        #else
        return nil
        #endif
    }

    #if DEBUG
    /// 로그인 다음 게이트(온보딩·기본 목소리 고르기)도 통과 처리한다.
    /// 화면을 보려는 것이지 온보딩을 보려는 게 아니다.
    static func markGatesPassed(userID: String) {
        let voiceStore = DefaultVoicePreferenceStore()
        voiceStore.markSkipped(userID: userID)
        voiceStore.setDefaultVoiceId(userID: userID, voiceId: "preview-voice")
    }

    /// 화면을 채울 가짜 세션.
    static func makeSession() -> AuthSession {
        AuthSession(
            token: "ui-preview-token",
            user: AuthUser(
                id: "ui-preview-user",
                email: "preview@alarm-talk.com",
                name: "김규원",
                plan: "personal"
            )
        )
    }

    /// 목소리 탭을 채우는 표본 프로필(내 목소리 1 + 기본 목소리 4).
    static func makeVoiceProfiles() -> [VoiceProfile] {
        var own = VoiceProfile(id: "preview-voice", name: "엄마 목소리", status: "ready")
        own.relationshipLabel = "엄마"
        own.isShared = true
        let names = ["아담", "미나", "하준", "소은"]
        let system = names.enumerated().map { index, name -> VoiceProfile in
            var profile = VoiceProfile(
                id: systemVoiceIDPrefix + String(format: "%012d", 101 + index),
                name: name,
                status: "ready"
            )
            profile.isSystem = true
            return profile
        }
        return [own] + system
    }

    /// 알람 목록·헤드라인이 비어 보이지 않게 하는 표본 알람.
    static func makeAlarms(nowMillis: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) -> [LocalAlarmRecord] {
        var morning = LocalAlarmRecord(
            id: "preview-morning",
            label: "아침 알람",
            hour: 6,
            minute: 0,
            fireAtMillis: nowMillis + 9 * 60 * 60 * 1000 + 21 * 60 * 1000,
            repeatDaysMask: 0,
            createdAtMillis: nowMillis,
            updatedAtMillis: nowMillis
        )
        morning.playMode = AlarmPlayMode.voiceOnly.rawValue
        morning.voiceProfileId = "preview-voice"
        morning.audioCacheKey = "preview-key"

        var weekday = LocalAlarmRecord(
            id: "preview-weekday",
            label: "평일 기상",
            hour: 7,
            minute: 30,
            fireAtMillis: nowMillis + 21 * 60 * 60 * 1000,
            repeatDaysMask: [RepeatDay.monday, .tuesday, .wednesday, .thursday, .friday].mask,
            createdAtMillis: nowMillis,
            updatedAtMillis: nowMillis
        )
        weekday.playMode = AlarmPlayMode.alarmOnly.rawValue
        weekday.enabled = false

        return [morning, weekday]
    }
    #endif
}
