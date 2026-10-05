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

/// 저장된 이름은 계약값이며 화면에서만 id에 대응하는 번역 이름을 쓴다.
func systemVoiceDisplayName(id: String?, fallback: String, bundle: Bundle = .main) -> String {
    switch id {
    case systemVoiceIDPrefix + "000000000101": return String(localized: "시우", bundle: bundle)
    case systemVoiceIDPrefix + "000000000102": return String(localized: "미나", bundle: bundle)
    case systemVoiceIDPrefix + "000000000103": return String(localized: "도현", bundle: bundle)
    case systemVoiceIDPrefix + "000000000104": return String(localized: "애니", bundle: bundle)
    default: return fallback
    }
}

extension VoiceProfile {
    var displayName: String { systemVoiceDisplayName(id: id, fallback: name) }
}

/// 시스템 제공(스톡) 보이스 id 인지 — 무료 플랜에서도 사용할 수 있다.
/// Android `SystemVoices.isSystemVoiceId` 동일.
func isSystemVoiceId(_ id: String?) -> Bool {
    id?.hasPrefix(systemVoiceIDPrefix) == true
}

func isSystemVoice(_ profile: VoiceProfile) -> Bool {
    profile.isSystem == true || isSystemVoiceId(profile.id)
}

/// 유료 목소리를 못 쓰게 된 알람이 넘어갈 **대체 기본 목소리 — 미나**. 대체는 전부 이 하나다:
/// 무료 잠금 · 예약 때 대체 · 목소리를 **잃은** 알람(삭제 · 공유 해제 · 발신자 철회 · 제자리 교체된
/// 직접 입력). 알람이 이미 기본 목소리면 그 목소리를 그대로 둔다(`DefaultVoiceSubstitute.pickVoiceID`).
///
/// 2026-09-29 사용자 결정 — "삭제했거나 공유가 해제된 알람은 기본 목소리로, 미나로 해 그냥", 이어서
/// "미나로 통일도 해". 그전 무료 잠금은 **마지막에 쓴 기본 목소리**를 골라, 같은 계정의 알람이 경로마다
/// 다른 목소리로 바뀌었다. 기억값을 보지 말 것 — 한 목소리로 정해 둔다.
/// 규칙: `docs/spec/billing-lifecycle.md` 「목소리를 못 쓰게 되면」. 안드로이드 `SUBSTITUTE_SYSTEM_VOICE_ID`.
let substituteSystemVoiceID = systemVoiceIDPrefix + "000000000102"

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
