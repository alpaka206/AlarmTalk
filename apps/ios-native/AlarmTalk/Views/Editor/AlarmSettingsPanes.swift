import SwiftUI

/// 편집기 '세부 설정' 카드가 여는 상세 화면 4종.
///
/// 안드로이드 `ui/editor/AlarmSettingsCard.kt` 의 `SnoozeSettingsPane` /
/// `VibrationSettingsPane` / `AlarmSoundSettingsPane` / `VoiceOutputSettingsPane`.
///
/// ⚠ **인라인 컨트롤로 되돌리지 말 것.** iOS 편집기는 스누즈 간격·반복 횟수·진동 패턴을
/// 전부 본문에 펼쳐 두고 있었다. 그러면 한 번 정하고 다시 안 볼 값들이 시간 설정·목소리
/// 선택과 같은 무게로 화면을 차지해, 정작 매번 바꾸는 것(시각·목소리)이 밀려난다.
enum AlarmSettingsPane: String, Identifiable, Hashable {
    case snooze
    case vibration
    case alarmSound
    case voiceOutput

    var id: String { rawValue }

    var title: String {
        switch self {
        case .snooze: return "다시 알림"
        case .vibration: return "진동"
        case .alarmSound: return "알람음"
        case .voiceOutput: return "음성 출력"
        }
    }
}

/// pane 공통 껍데기 — 홈 그라데이션 + 인라인 제목.
private struct PaneScaffold<Content: View>: View {
    let title: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                content()
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
        }
        .homeGradientBackground()
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - 다시 알림

struct SnoozeSettingsPane: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Binding var enabled: Bool
    @Binding var minutes: Int
    @Binding var repeatLimit: Int

    /// 안드로이드 `AlarmSnoozeSettings.kt` 의 프리셋. '직접 입력' 은 알럿으로 받는다.
    private static let presets = [5, 10, 15, 30]

    @State private var customOpen = false
    @State private var customDraft = ""

    var body: some View {
        PaneScaffold(title: AlarmSettingsPane.snooze.title) {
            EditorCard {
                Toggle("다시 알림 사용", isOn: $enabled)
                    .tint(theme.palette.primary)
                    .padding(.vertical, 12)
            }

            if enabled {
                EditorSectionTitle(text: "간격")
                EditorCard(verticalPadding: 0) {
                    ForEach(Array(Self.presets.enumerated()), id: \.element) { index, value in
                        if index > 0 { AlarmSettingDivider() }
                        RadioRow(label: "\(value)분", selected: minutes == value) { minutes = value }
                    }
                    AlarmSettingDivider()
                    RadioRow(
                        label: Self.presets.contains(minutes) ? "직접 입력" : "직접 입력 (\(minutes)분)",
                        selected: !Self.presets.contains(minutes)
                    ) {
                        customDraft = String(minutes)
                        customOpen = true
                    }
                }

                EditorSectionTitle(text: "최대 반복 횟수")
                EditorCard(verticalPadding: 0) {
                    ForEach(Array(SnoozeRepeatLimit.validValues.enumerated()), id: \.element) { index, value in
                        if index > 0 { AlarmSettingDivider() }
                        RadioRow(label: Self.repeatLabel(value), selected: repeatLimit == value) {
                            repeatLimit = value
                        }
                    }
                }
            }
        }
        .alert("간격 직접 설정", isPresented: $customOpen) {
            TextField("분", text: $customDraft).keyboardType(.numberPad)
            Button("취소", role: .cancel) { }
            Button("확인") {
                // 서버 계약이 1–30분이다(`snooze_minutes`). 범위를 벗어나면 잘라서 저장한다 —
                // 여기서 거절하면 사용자는 왜 안 되는지 모른 채 같은 값을 다시 넣는다.
                if let value = Int(customDraft.filter(\.isNumber)) {
                    minutes = min(max(value, 1), 30)
                }
            }
        } message: {
            Text("1분부터 30분까지 정할 수 있어요.")
        }
    }

    static func repeatLabel(_ value: Int) -> String {
        value == 0 ? "무제한" : "\(value)회"
    }
}

// MARK: - 진동

struct VibrationSettingsPane: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Binding var pattern: VibrationPattern

    /// 마지막으로 고른 '켜짐' 패턴. 껐다 켤 때 기본으로 되돌아가지 않게 기억한다.
    @State private var lastOnPattern: VibrationPattern = .default

    var body: some View {
        PaneScaffold(title: AlarmSettingsPane.vibration.title) {
            EditorCard {
                Toggle("진동 사용", isOn: Binding(
                    get: { pattern != .none },
                    set: { on in
                        if on {
                            pattern = lastOnPattern == .none ? .default : lastOnPattern
                        } else {
                            if pattern != .none { lastOnPattern = pattern }
                            pattern = .none
                        }
                    }
                ))
                .tint(theme.palette.primary)
                .padding(.vertical, 12)
            }

            if pattern != .none {
                EditorSectionTitle(text: "패턴")
                // ⚠ 드롭다운 메뉴가 아니라 **전체 목록**이다. 17종을 메뉴에 넣으면 고르려고
                // 매번 열어 스크롤해야 하고, 지금 무엇이 골라져 있는지도 한눈에 안 보인다.
                EditorCard(verticalPadding: 0) {
                    let options = VibrationPattern.allCases.filter { $0 != .none }
                    ForEach(Array(options.enumerated()), id: \.element) { index, option in
                        if index > 0 { AlarmSettingDivider() }
                        RadioRow(label: option.displayName, selected: pattern == option) {
                            pattern = option
                            lastOnPattern = option
                            // 고르는 즉시 한 번 울려 준다 — 이름만으로는 구분할 수 없다.
                            VibrationHapticPreview.play(option)
                        }
                    }
                }

                Text("고르면 한 번 울려서 들려드려요. 실제 알람에서는 이 패턴이 반복돼요.")
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .onAppear { if pattern != .none { lastOnPattern = pattern } }
    }
}

// MARK: - 알람음

struct AlarmSoundSettingsPane: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let soundLabel: String

    var body: some View {
        PaneScaffold(title: AlarmSettingsPane.alarmSound.title) {
            EditorCard {
                HStack {
                    Text("알람음 종류")
                        .font(theme.typography.bodyLarge)
                        .fontWeight(.semibold)
                    Spacer(minLength: 12)
                    Text(soundLabel)
                        .font(theme.typography.bodyMedium)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }
                .padding(.vertical, 12)
            }

            // ⚠ **알람 음량 슬라이더를 두지 않는다.** AlarmKit 이 OS 알람 톤을 소유해
            // 알람별 음량 API 가 없다 — 못 움직이는 컨트롤을 두면 값을 바꿔 보고 저장하고
            // 확인하기를 반복하게 된다(CLAUDE.md 「음량 규약」). 안드로이드는 자체
            // 플레이어라 그 슬라이더가 실제로 동작하므로, 여기만 다른 것이 맞다.
            Text("알람음과 음량은 iOS 시스템이 정해요. 기기의 알람 볼륨을 조절해 주세요.")
                .font(theme.typography.bodySmall)
                .foregroundStyle(theme.palette.onSurfaceVariant)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: - 음성 출력

struct VoiceOutputSettingsPane: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Binding var volumePercent: Int
    @Binding var repeatVoice: Bool

    var body: some View {
        PaneScaffold(title: AlarmSettingsPane.voiceOutput.title) {
            EditorCard {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("목소리 크기")
                            .font(theme.typography.bodyLarge)
                            .fontWeight(.semibold)
                        Spacer()
                        Text("\(volumePercent)%")
                            .font(theme.typography.bodyMedium)
                            .foregroundStyle(theme.palette.primary)
                            .monospacedDigit()
                    }
                    // ⚠ **하한은 10% 다.** 30% 로 막아 두면 안드로이드에서 10~29% 로 맞춘
                    // 알람이 iOS 에서 다른 크기로 울린다. 0 은 슬라이더로 만들 수 없다 —
                    // '무음' 은 별개의 뜻이라 끝값으로 두면 실수로 닿아 조용히 안 울린다.
                    Slider(
                        value: Binding(
                            get: { Double(volumePercent) },
                            set: { volumePercent = Int($0.rounded()) }
                        ),
                        in: 10...100,
                        step: 5
                    )
                    .tint(theme.palette.primary)
                }
                .padding(.vertical, 12)

                AlarmSettingDivider()

                Toggle("끌 때까지 반복", isOn: $repeatVoice)
                    .tint(theme.palette.primary)
                    .padding(.vertical, 12)
            }

            Text("반복을 끄면 목소리가 한 번만 나와요.")
                .font(theme.typography.bodySmall)
                .foregroundStyle(theme.palette.onSurfaceVariant)
        }
    }
}

// MARK: - 공용 라디오 행

struct RadioRow: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let label: String
    let selected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                Text(label)
                    .font(theme.typography.bodyLarge)
                    .foregroundStyle(theme.palette.onSurface)
                Spacer(minLength: 8)
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 20))
                    .foregroundStyle(selected ? theme.palette.primary : theme.palette.outline)
            }
            .padding(.vertical, 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
