import Foundation

// MARK: - System (Stock) Voices
// Android: `SystemVoices.kt:8-11`
// 백엔드 migration 43(system-stock-voices)에서 시드되는 시스템 스톡 보이스의
// 고정 UUID prefix. 서버 응답이 전체 목록의 권위이며, 클라이언트는 첫 응답 전 카탈로그와
// 오프라인 판정(무료 다운그레이드 시 로컬 알람 보존 등)에 이 값을 쓴다.
let systemVoiceIDPrefix = "70000000-0000-4000-9000-"

/// 첫 서버 응답 전에도 즉시 그릴 수 있는 기본 목소리 카탈로그.
///
/// 개인·공유 목소리는 넣지 않는다. `GET /voice` 성공 응답이 오면 전체 응답으로 교체된다.
/// 백엔드 system-stock-voices 시드를 바꾸면 이 목록도 함께 맞춘다.
func bundledSystemVoiceProfiles() -> [VoiceProfile] {
    [
        VoiceProfile(id: systemVoiceIDPrefix + "000000000101", name: "시우", status: "ready", isSystem: true),
        VoiceProfile(id: systemVoiceIDPrefix + "000000000102", name: "미나", status: "ready", isSystem: true),
        VoiceProfile(id: systemVoiceIDPrefix + "000000000103", name: "도현", status: "ready", isSystem: true),
        VoiceProfile(id: systemVoiceIDPrefix + "000000000104", name: "애니", status: "ready", isSystem: true),
    ]
}

/// 시스템 제공(스톡) 보이스 id 인지 — 무료 플랜에서도 사용할 수 있다.
/// Android `SystemVoices.isSystemVoiceId` 동일.
func isSystemVoiceId(_ id: String?) -> Bool {
    id?.hasPrefix(systemVoiceIDPrefix) == true
}

func isSystemVoice(_ profile: VoiceProfile) -> Bool {
    profile.isSystem == true || isSystemVoiceId(profile.id)
}

/// 기본(시스템) 목소리의 **번들 인사말 클립** 이름. 없으면 nil.
///
/// 안드로이드 `data/SystemVoices.kt:76-108` `bundledSystemGreetingRes` 대응.
/// ⚠ **iOS 에는 이 12개 파일이 아예 없었다.** 그래서 기본 목소리 미리듣기가 매번 서버
/// 왕복이었고, 네트워크가 없으면 아무 소리도 안 났다 — 계정을 막 만든 사람이 가장 먼저
/// 눌러 보는 버튼이 그거다.
func bundledSystemGreetingResource(voiceProfileId: String?, appLanguage: String) -> String? {
    let voice: String
    switch voiceProfileId {
    case systemVoiceIDPrefix + "000000000101": voice = "siwoo"
    case systemVoiceIDPrefix + "000000000102": voice = "mina"
    case systemVoiceIDPrefix + "000000000103": voice = "dohyun"
    case systemVoiceIDPrefix + "000000000104": voice = "narin"
    default: return nil
    }
    let language: String
    switch appLanguage {
    case "en", "ja": language = appLanguage
    default: language = "ko"
    }
    return "voice_greeting_\(voice)_\(language)"
}
