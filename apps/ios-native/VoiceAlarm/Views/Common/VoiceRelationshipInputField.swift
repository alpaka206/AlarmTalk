import SwiftUI

enum VoiceRelationshipPreset: String, CaseIterable, Identifiable {
    case custom
    case mom
    case dad
    case grandma
    case grandpa
    case son
    case daughter
    case granddaughter
    case grandson
    case sibling
    case boyfriend
    case girlfriend
    case husband
    case wife
    case friend
    case celebrity

    var id: String { rawValue }

    var label: String {
        switch self {
        case .custom: return "직접 입력"
        case .mom: return "엄마"
        case .dad: return "아빠"
        case .grandma: return "할머니"
        case .grandpa: return "할아버지"
        case .son: return "아들"
        case .daughter: return "딸"
        case .granddaughter: return "손녀"
        case .grandson: return "손주"
        case .sibling: return "형제·자매"
        case .boyfriend: return "남자친구"
        case .girlfriend: return "여자친구"
        case .husband: return "남편"
        case .wife: return "아내"
        case .friend: return "친구"
        case .celebrity: return "연예인"
        }
    }
}

struct VoiceRelationshipSelection: Equatable {
    var preset: VoiceRelationshipPreset?
    var customLabel: String

    init(preset: VoiceRelationshipPreset? = nil, customLabel: String = "") {
        self.preset = preset
        self.customLabel = customLabel
    }

    var resolved: String {
        switch preset {
        case .custom:
            return customLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        case .some(let preset):
            return preset.label
        case nil:
            return ""
        }
    }

    var isComplete: Bool {
        !resolved.isEmpty
    }
}

func parseVoiceRelationshipLabel(_ raw: String?) -> VoiceRelationshipSelection {
    let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard !trimmed.isEmpty else { return VoiceRelationshipSelection() }
    if let match = VoiceRelationshipPreset.allCases.first(where: { $0 != .custom && $0.label == trimmed }) {
        return VoiceRelationshipSelection(preset: match)
    }
    return VoiceRelationshipSelection(preset: .custom, customLabel: trimmed)
}

struct VoiceRelationshipInputField: View {
    @Binding var selection: VoiceRelationshipSelection

    var title: String = "나와의 관계"
    var submitted: Bool = false
    var required: Bool = true
    var placeholder: String = "예: 손녀, 연인, 동료"

    private var options: [VoiceRelationshipPreset] {
        [.custom] + VoiceRelationshipPreset.allCases.filter { $0 != .custom }
    }

    private var isError: Bool {
        submitted && required && !selection.isComplete
    }

    @ViewBuilder
    @ViewBuilder
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(required ? "\(title) (필수)" : title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(VoiceAlarmTheme.textSecondary)

            Menu {
                ForEach(options) { preset in
                    Button(preset.label) {
                        if preset == .custom {
                            selection = VoiceRelationshipSelection(
                                preset: .custom,
                                customLabel: selection.customLabel
                            )
                        } else {
                            selection = VoiceRelationshipSelection(preset: preset)
                        }
                    }
                }
            } label: {
                HStack(spacing: 10) {
                    Text(selection.preset?.label ?? "관계를 선택해 주세요")
                        .font(.subheadline)
                        .foregroundStyle(selection.preset == nil ? VoiceAlarmTheme.textSecondary : VoiceAlarmTheme.text)
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                }
                .padding(.horizontal, 12)
                .frame(minHeight: 46)
                .background(VoiceAlarmTheme.surfaceVariant.opacity(0.55), in: RoundedRectangle(cornerRadius: 10))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(isError ? VoiceAlarmTheme.error : VoiceAlarmTheme.outline, lineWidth: 1)
                )
            }
            .buttonStyle(.plain)

            if selection.preset == .custom {
                TextField(placeholder, text: Binding(
                    get: { selection.customLabel },
                    set: { selection.customLabel = String($0.prefix(30)) }
                ))
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.never)
                .disableAutocorrection(true)
            }

            if isError {
                Text("꼭 입력해 주세요.")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(VoiceAlarmTheme.error)
            }
        }
    }
}

struct VoiceListenerPreviewCard: View {
    let listenerTitle: String
    let relationshipLabel: String

    private var trimmedListener: String {
        listenerTitle.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var trimmedRelationship: String {
        relationshipLabel.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        if !trimmedListener.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text("이 목소리는 이렇게 불러줘요")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(VoiceAlarmTheme.primaryDark)
                Text("\"\(trimmedListener), 일어날 시간이에요\"")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(VoiceAlarmTheme.text)
                if !trimmedRelationship.isEmpty {
                    Text("관계 · \(trimmedRelationship)")
                        .font(.caption)
                        .foregroundStyle(VoiceAlarmTheme.textSecondary)
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(VoiceAlarmTheme.primary.opacity(0.10), in: RoundedRectangle(cornerRadius: 12))
        }
    }
}
