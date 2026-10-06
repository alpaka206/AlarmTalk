import Foundation

extension VoiceRelationshipPreset {
    var displayLabel: String { localizedDisplayLabel() }

    func localizedDisplayLabel(bundle: Bundle = .main) -> String {
        switch self {
        case .custom: return String(localized: "voice.relationship.custom", defaultValue: "직접 입력", bundle: bundle)
        case .mom: return String(localized: "엄마", bundle: bundle)
        case .dad: return String(localized: "아빠", bundle: bundle)
        case .grandma: return String(localized: "할머니", bundle: bundle)
        case .grandpa: return String(localized: "할아버지", bundle: bundle)
        case .son: return String(localized: "아들", bundle: bundle)
        case .daughter: return String(localized: "딸", bundle: bundle)
        case .granddaughter: return String(localized: "손녀", bundle: bundle)
        case .grandson: return String(localized: "손주", bundle: bundle)
        case .sibling: return String(localized: "형제·자매", bundle: bundle)
        case .boyfriend: return String(localized: "남자친구", bundle: bundle)
        case .girlfriend: return String(localized: "여자친구", bundle: bundle)
        case .husband: return String(localized: "남편", bundle: bundle)
        case .wife: return String(localized: "아내", bundle: bundle)
        case .friend: return String(localized: "친구", bundle: bundle)
        case .celebrity: return String(localized: "연예인", bundle: bundle)
        }
    }
}

extension VoiceRelationshipSelection {
    func localizedDisplayLabel(bundle: Bundle = .main) -> String {
        guard let preset, preset != .custom else { return resolved }
        return preset.localizedDisplayLabel(bundle: bundle)
    }
}

// ⚠ **목소리의 관계(`relationshipLabel`)는 목록에 보이지 않는다** — 저장·전송만 한다(두 앱 같다,
// `docs/spec/localization.md` §2). 관계는 출처를 모르는 저장 문자열이라 번역할 수 없어, en·ja
// 사용자가 「Mom」을 골라도 목록에는 저장된 「엄마」가 떴다. 안드로이드는 처음부터 목록에 그리지 않는다.
// 등록·수정 폼의 관계 입력(`VoiceRelationshipInputField`)은 그대로다.

/// 내 목소리 행 둘째 줄 — 공유 중이면 「공유 중」, 아니면 없음
/// (안드로이드 `ui/voices/VoiceProfileRowComponents.kt` 의 `VoiceCatalogRow` subtitle).
func ownVoiceRowSubtitle(isShared: Bool, bundle: Bundle = .main) -> String? {
    isShared ? String(localized: "공유 중", bundle: bundle) : nil
}

/// 편집기 목소리 선택 시트의 내 목소리 보조 줄(안드로이드 `ui/editor/VoiceAudioCard.kt` 의 `ownedVoiceDetail`).
func ownVoiceOptionDetail(isShared: Bool, bundle: Bundle = .main) -> String {
    isShared ? String(localized: "내 목소리 · 공유 중", bundle: bundle) : String(localized: "내 목소리", bundle: bundle)
}

/// 알람 행 둘째 줄의 목소리 이름 — 이름만 쓴다(안드로이드 `ui/alarms/AlarmListScreen.kt` 의 `voiceName`).
/// 내 목소리·기본 목소리를 먼저 찾고, 없으면 공유받은 목소리에서 찾는다.
func alarmRowVoiceName(voiceProfileID id: String, profiles: [VoiceProfile], familyVoices: [FamilyVoiceProfile]) -> String? {
    if let profile = profiles.first(where: { $0.id == id }) { return profile.displayName }
    return familyVoices.first(where: { $0.id == id })?.name
}

func personDisplayName(_ name: String, bundle: Bundle = .main) -> String {
    name.hasSuffix("님") || name.hasSuffix("さん")
        ? name : String(localized: "\(name)님", bundle: bundle)
}

func receivedAlarmDisplayLabel(sender: String?, bundle: Bundle = .main) -> String {
    guard let sender = sender?.trimmingCharacters(in: .whitespacesAndNewlines), !sender.isEmpty else {
        return String(localized: "상대가 보낸 알람", bundle: bundle)
    }
    let name = personDisplayName(sender, bundle: bundle)
    return String(localized: "\(name)이 보낸 알람", bundle: bundle)
}

enum LegalLinks {
    static var terms: URL { url(for: "terms", language: Bundle.main.preferredLocalizations.first) }
    static var privacy: URL { url(for: "privacy", language: Bundle.main.preferredLocalizations.first) }

    static func url(for page: String, language: String?) -> URL {
        let base = (language ?? "ko").lowercased().split(whereSeparator: { $0 == "-" || $0 == "_" }).first.map(String.init) ?? "ko"
        let supported = ["ko", "en", "ja"].contains(base) ? base : "ko"
        return URL(string: "https://alarm-talk.com/\(supported)/\(page)")!
    }
}
