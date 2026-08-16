import Foundation
import UIKit

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

    /// 화면 확인 모드에서 알람 저장소가 쓸 **임시 파일**. 평소에는 nil(진짜 저장소).
    ///
    /// ⚠ **표본 알람을 진짜 저장소에 심지 말 것**(2026-08-17). 예전에는 `alarmStore.upsert`
    /// 로 그냥 넣었는데, `LocalAlarmStore` 는 **디스크에 쓴다** — 위 주석의 "메모리에
    /// 심는다" 가 사실이 아니었다. 그래서 표본이 기기에 남았고, 다음에 로그인한 채로 앱을
    /// 켜면 sync 가 그것을 사용자 알람으로 보고 서버에 올렸다(dev 계정에 07:30 평일 알람이
    /// 11개 쌓였고, 못 올리는 하나 때문에 "저장하지 못했어요" 안내가 매번 떴다).
    /// 매 실행 새 파일이라 이전 실행의 표본도 따라오지 않는다.
    static var ephemeralAlarmStorageURL: URL? {
        #if DEBUG
        guard isEnabled else { return nil }
        return FileManager.default.temporaryDirectory
            .appendingPathComponent("preview-alarms-\(UUID().uuidString).json")
        #else
        return nil
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

    /// **울림 확인용** — `-UIPreviewRingIn <초>` 면 그만큼 뒤에 울릴 알람을 하나 예약한다.
    ///
    /// 왜 필요한가: iOS 의 울림 화면은 **AlarmKit 이 그리는 시스템 alert** 이라 우리가
    /// 띄울 수 없고, 편집기로 알람을 만들려면 시각 휠을 드래그해야 하는데 시뮬레이터를
    /// 스크립트로 조작할 방법이 없다. 그래서 "울리긴 하는가" 를 눈으로 확인할 길이
    /// 아예 없었다. 이 인자가 그 길이다.
    ///
    /// ⚠ 예약만 한다 — 소리·시스템 alert 은 전부 AlarmKit 이 소유한다. 우리 코드가
    /// 화면을 그리지 않는다는 사실 자체를 확인하는 것도 이 진입점의 목적이다.
    static var ringInSeconds: Int? {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-UIPreviewRingIn"), i + 1 < args.count else { return nil }
        return Int(args[i + 1]).map { max(5, min($0, 600)) }
        #else
        return nil
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

    /// `-UIPreviewRingIn <초>` 용 — 지금부터 그만큼 뒤에 울릴 **단발** 알람.
    ///
    /// 알람음 모드로 만든다. 목소리 모드는 캐시된 음원이 있어야 하는데 시드에는 실제
    /// 오디오가 없어서, 목소리로 두면 '왜 소리가 안 나지' 가 되어 확인하려던 것(=시스템
    /// alert 이 뜨는가)이 흐려진다.
    static func makeRingSoonAlarm(
        inSeconds: Int,
        nowMillis: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    ) -> LocalAlarmRecord {
        // ⚠ **다음 '분' 으로 올림한다.** AlarmKit 단발 알람은 `fireAtMillis` 가 아니라
        // **시:분** 으로 예약된다(`makeSchedule` 의 `.relative(.never)`). 지금과 같은 분에
        // 걸면 그 시각이 이미 지난 것으로 읽혀 **즉시 울린다** — 기다려서 확인하려던 것이
        // 앱을 켜자마자 울려 버린다(2026-08-07 실제로 그랬다).
        let secondsIntoMinute = Int64(nowMillis / 1000) % 60
        let toNextMinute = 60 - secondsIntoMinute
        let fireAt = nowMillis + max(Int64(inSeconds), toNextMinute + 5) * 1000
        let fireDate = Date(timeIntervalSince1970: TimeInterval(fireAt) / 1000)
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        let parts = calendar.dateComponents([.hour, .minute], from: fireDate)
        var record = LocalAlarmRecord(
            id: LocalAlarmRecord.previewIDPrefix + "ring-soon",
            label: "울림 확인",
            hour: parts.hour ?? 0,
            minute: parts.minute ?? 0,
            fireAtMillis: fireAt,
            repeatDaysMask: 0,
            createdAtMillis: nowMillis,
            updatedAtMillis: nowMillis
        )
        record.playMode = AlarmPlayMode.alarmOnly.rawValue
        record.enabled = true
        return record
    }

    /// 알람 목록·헤드라인이 비어 보이지 않게 하는 표본 알람.
    static func makeAlarms(nowMillis: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) -> [LocalAlarmRecord] {
        var morning = LocalAlarmRecord(
            id: LocalAlarmRecord.previewIDPrefix + "morning",
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
            id: LocalAlarmRecord.previewIDPrefix + "weekday",
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
