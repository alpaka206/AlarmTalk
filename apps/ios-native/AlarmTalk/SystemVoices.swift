import Foundation

// MARK: - System (Stock) Voices
// Android: `SystemVoices.kt:8-11`
// 백엔드 migration 43(system-stock-voices)에서 시드되는 시스템 스톡 보이스의
// 고정 UUID prefix. 서버가 단일 진실 공급원이며, 클라이언트는 오프라인 판정
// (무료 다운그레이드 시 로컬 알람 보존 등)에만 이 prefix 를 쓴다.
let systemVoiceIDPrefix = "70000000-0000-4000-9000-"

/// 시스템 제공(스톡) 보이스 id 인지 — 무료 플랜에서도 사용할 수 있다.
/// Android `SystemVoices.isSystemVoiceId` 동일.
func isSystemVoiceId(_ id: String?) -> Bool {
    id?.hasPrefix(systemVoiceIDPrefix) == true
}

func isSystemVoice(_ profile: VoiceProfile) -> Bool {
    profile.isSystem == true || isSystemVoiceId(profile.id)
}
