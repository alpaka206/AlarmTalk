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

struct VoiceRelationshipInputField: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Binding var selection: VoiceRelationshipSelection

    var title: String = String(localized: "나와의 관계")
    var submitted: Bool = false
    var required: Bool = true
    var placeholder: String = String(localized: "예: 손녀, 연인, 동료")

    private var isError: Bool {
        submitted && required && !selection.isComplete
    }

    @ViewBuilder
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // 칸 위 라벨 — 목소리 등록 세부 정보의 다른 칸 라벨과 같은 모양(labelMedium · SemiBold · 흐린 글자, 안드로이드
            // `VoiceFieldLabel`).
            Text(required ? String(localized: "\(title) (필수)") : title)
                .font(theme.typography.labelMedium)
                .fontWeight(.semibold)
                .foregroundStyle(theme.palette.onSurfaceVariant)

            // 고르기 칸 — 다른 입력칸과 같은 모양이다(높이 56 · surface 74% 채움 · outlineVariant 테두리 · 모서리 18 · 글자 16).
            // 안드로이드는 읽기 전용 `OutlinedTextField` 를 드롭다운 트리거로 쓴다(`RelationshipDropdownField`).
            Menu {
                ForEach(VoiceRelationshipPreset.allCases) { preset in
                    Button(preset.displayLabel) {
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
                    Text(selection.preset?.displayLabel ?? String(localized: "예: 엄마, 친구"))
                        .font(theme.typography.bodyLarge)
                        .foregroundStyle(selection.preset == nil ? theme.palette.onSurfaceVariant : theme.palette.onSurface)
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }
                .padding(.horizontal, 16)
                .frame(minHeight: 56)
                .background(
                    theme.palette.surface.opacity(0.74),
                    in: RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                        .stroke(isError ? theme.palette.error : theme.palette.outlineVariant, lineWidth: 1)
                )
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if selection.preset == .custom {
                TextField(placeholder, text: Binding(
                    get: { selection.customLabel },
                    set: { selection.customLabel = InputSanitizer.clampDisplayName($0) }
                ))
                .textInputAutocapitalization(.never)
                .disableAutocorrection(true)
                .alarmTalkFieldStyle()
            }

            if isError {
                Text(String(localized: "꼭 입력해 주세요."))
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.error)
                    .padding(.horizontal, 16)
            }
        }
    }
}
