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

/// 표준 프리셋의 저장값만 번역한다. 사용자가 직접 쓴 관계는 보존한다.
func displayRelationshipLabel(_ stored: String, bundle: Bundle = .main) -> String {
    guard let preset = VoiceRelationshipPreset.allCases.first(where: { $0 != .custom && $0.label == stored }) else { return stored }
    return preset.localizedDisplayLabel(bundle: bundle)
}

extension VoiceRelationshipSelection {
    func localizedDisplayLabel(bundle: Bundle = .main) -> String {
        guard let preset, preset != .custom else { return resolved }
        return preset.localizedDisplayLabel(bundle: bundle)
    }
}

func voiceRelationshipSubtitle(_ stored: String?, isShared: Bool, bundle: Bundle = .main) -> String? {
    var parts: [String] = []
    if let relationship = stored?.trimmingCharacters(in: .whitespacesAndNewlines), !relationship.isEmpty {
        parts.append(displayRelationshipLabel(relationship, bundle: bundle))
    }
    if isShared { parts.append(String(localized: "공유 중", bundle: bundle)) }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
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
