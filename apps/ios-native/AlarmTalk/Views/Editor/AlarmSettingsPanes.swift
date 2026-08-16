import SwiftUI

/// 편집기 '세부 설정' 카드가 여는 상세 화면 3종.
///
/// 안드로이드 `ui/editor/AlarmSettingsCard.kt` 의 `SnoozeSettingsPane` /
/// `AlarmSoundSettingsPane` / `VoiceOutputSettingsPane`.
///
/// ⚠ **진동 pane 을 되살리지 말 것**(2026-08-17). 안드로이드에는 있지만 iOS 에는 없다 —
/// AlarmKit 이 알람 진동을 소유하고 프레임워크가 받는 것은 `sound:` 하나뿐이라, 17종
/// 목록은 무엇을 골라도 실제 알람이 같았다(근거는 `AlarmEnums.swift` 의 `VibrationPattern`).
///
/// ⚠ **인라인 컨트롤로 되돌리지 말 것.** iOS 편집기는 스누즈 간격·반복 횟수를 전부 본문에
/// 펼쳐 두고 있었다. 그러면 한 번 정하고 다시 안 볼 값들이 시간 설정·목소리 선택과 같은
/// 무게로 화면을 차지해, 정작 매번 바꾸는 것(시각·목소리)이 밀려난다.
enum AlarmSettingsPane: String, Identifiable, Hashable {
    case snooze
    case alarmSound
    case voiceOutput

    var id: String { rawValue }

    var title: String {
        switch self {
        // ⚠ **'다시 알림' 으로 되돌리지 말 것**(2026-08-16 통일). 이 앱에서 **알림은
        // notification** 이 굳은 뜻이다(알림 권한, "알람 알림이 뜨지 않아요") — 스누즈는
        // 알림이 다시 뜨는 게 아니라 **알람이 다시 울리는** 것이다. 앱의 다른 어휘도
        // 울림이다(울림 화면, `docs/spec/alarm-ringing.md`).
        case .snooze: return "다시 울림"
        case .alarmSound: return "알람음"
        // ⚠ **상세 화면 제목은 그 화면을 연 행과 같은 말이다**(2026-08-16 통일) —
        // 다시 울림·진동·알람음·문구가 모두 그렇다. 여기만 행은 '목소리 크기' 인데
        // 제목이 '음성 출력' 이었고(안드로이드는 '목소리'), 같은 화면에 이름이 셋이었다.
        // '음성' 이 아니라 '목소리' 다 — 사용자에게 보이는 말은 앱 전체가 목소리다.
        case .voiceOutput: return "목소리 크기"
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
        // ⚠ **입력창 밖을 눌러 키보드를 닫을 길을 둔다.** iOS 는 바깥 탭으로 키보드가
        // 자동으로 닫히지 않아서, 없으면 키보드가 화면 절반을 가린 채 버튼에 닿지 못한다
        // (2026-08-10 사용자 보고 — 편집기에는 이미 있었고 나머지 화면만 빠져 있었다).
        .scrollDismissesKeyboard(.interactively)
        .homeGradientBackground()
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        // ⚠ **바를 명시적으로 켠다.** 부모(편집기)가 `.toolbar(.hidden, for: .navigationBar)`
        // 로 자기 상단바를 지우는데, 그게 하위로 번지면 이 화면에 **뒤로갈 길이 사라진다.**
        // 여기는 뒤로가기가 유일한 탈출구라(하단 액션바가 없다) 반드시 보여야 한다.
        .toolbar(.visible, for: .navigationBar)
    }
}

// MARK: - 다시 울림

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
                Toggle("다시 울림 사용", isOn: $enabled)
                    .alarmTalkSwitch()
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
                if let value = Int(customDraft.filter(\.isNumber)), (1...30).contains(value) {
                    minutes = value
                }
            }
            // ⚠ **범위를 벗어나면 잘라서 저장하지 말 것**(2026-08-17 안드로이드와 통일).
            // 45 를 넣으면 30 이 저장되는데 화면은 그 사실을 말하지 않아, 사용자는 자기가
            // 넣은 값이 들어간 줄 안다. 안드로이드는 처음부터 **버튼을 흐리게** 두고 아래에
            // 이유를 적는다(Codex #671 P2 — '눌러도 아무 일이 없는 것' 은 고장과 구분되지
            // 않는다). 서버 계약도 1–30 이다(`snooze_minutes`).
            .disabled(!(1...30).contains(Int(customDraft.filter(\.isNumber)) ?? 0))
        } message: {
            Text("1분부터 30분까지 정할 수 있어요.")
        }
    }

    static func repeatLabel(_ value: Int) -> String {
        // ⚠ 여기서 `String(localized:)` 로 **미리** 번역해 둔다. `RadioRow` 는 이미
        // 번역된 문자열(진동 `displayName` 등)도 받으므로 라벨을 `LocalizedStringKey`
        // 로 받을 수 없다 — 그러면 번역 결과를 한 번 더 조회하게 된다.
        value == 0 ? String(localized: "무제한") : String(localized: "\(value)회")
    }
}

// MARK: - 알람음

struct AlarmSoundSettingsPane: View {
    @Environment(\.voiceAlarmTheme) private var theme
    /// 고른 알람음 파일 경로(비면 기본 알람음).
    @Binding var soundUri: String?
    @Binding var soundLabel: String?
    /// 미리듣기 — 화면이 소유한 플레이어로 이 파일을 튼다.
    /// `restart` 가 참이면 같은 파일이어도 멈추지 않고 처음부터 다시 튼다(고를 때).
    let onPreview: (URL?, Bool) -> Void
    let previewingPath: String?

    private var entries: [SystemRingtoneLibrary.Entry] { SystemRingtoneLibrary.entries }

    var body: some View {
        PaneScaffold(title: AlarmSettingsPane.alarmSound.title) {
            EditorCard(verticalPadding: 0) {
                soundRow(
                    title: "기본 알람음",
                    selected: soundUri.nilIfBlank == nil,
                    previewURL: nil
                ) {
                    soundUri = nil
                    soundLabel = nil
                    // 기본 알람음은 우리가 가진 파일이 없다 — 들려줄 게 없으니 재생만 멈춘다.
                    onPreview(nil, true)
                }
                ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                    AlarmSettingDivider()
                    soundRow(
                        title: entry.name,
                        selected: soundUri == entry.url.path,
                        previewURL: entry.url
                    ) {
                        soundUri = entry.url.path
                        soundLabel = entry.name
                        // ⚠ **고르면 들린다**(2026-08-16 지시). 소리를 고르는 화면에서
                        // 이름만 보고 정할 수는 없다 — 체크가 켜지는 순간 그 소리를 튼다.
                        // 같은 것을 다시 골라도 처음부터 다시 튼다(`restart`).
                        onPreview(entry.url, true)
                    }
                    .id(index)
                }
            }

            // ⚠ **알람 음량 슬라이더를 두지 않는다.** AlarmKit 이 OS 알람 톤을 소유해
            // 알람별 음량 API 가 없다 — 못 움직이는 컨트롤을 두면 값을 바꿔 보고 저장하고
            // 확인하기를 반복하게 된다(CLAUDE.md 「음량 규약」). 안드로이드는 자체
            // 플레이어라 그 슬라이더가 실제로 동작하므로, 여기만 다른 것이 맞다.
            Text(entries.isEmpty
                 ? "이 기기에서는 알람음을 고를 수 없어 기본 알람음으로 울려요. 음량은 기기의 알람 볼륨을 따라가요."
                 : "음량은 iOS 시스템이 정해요. 기기의 알람 볼륨을 조절해 주세요.")
                .font(theme.typography.bodySmall)
                .foregroundStyle(theme.palette.onSurfaceVariant)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// 행 = [이름] … [체크] [미리듣기]
    /// ⚠ 목소리 선택 시트와 **같은 순서**다 — 체크가 먼저, 재생이 끝이다. 순서를 뒤집으면
    /// 고를 때마다 체크가 끼어들며 재생 버튼이 손가락 밑에서 움직인다.
    @ViewBuilder
    private func soundRow(
        title: String,
        selected: Bool,
        previewURL: URL?,
        onSelect: @escaping () -> Void
    ) -> some View {
        HStack(spacing: 10) {
            Button(action: onSelect) {
                Text(title)
                    .font(theme.typography.bodyLarge)
                    .foregroundStyle(theme.palette.onSurface)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if selected {
                Image(systemName: "checkmark")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(theme.palette.primary)
            }

            if let previewURL {
                Button {
                    onPreview(previewURL, false)
                } label: {
                    Image(systemName: previewingPath == previewURL.path ? "stop.fill" : "speaker.wave.2.fill")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(theme.palette.primary)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(previewingPath == previewURL.path ? "정지" : "들어보기"))
            } else {
                // 기본 알람음은 우리가 가진 파일이 없어 미리듣기가 불가능하다.
                // 자리만 비워 이름 끝선을 맞춘다.
                Color.clear.frame(width: 44, height: 44)
            }
        }
        .frame(minHeight: 52)
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
                    // ⚠ **눈금은 10단위**(안드로이드 `VoiceVolumeSelector` 와 같은 stop).
                    // 5단위로 두면 iOS 에서만 만들 수 있는 값(15·25…)이 생겨, 같은 알람을
                    // 두 기기에서 열었을 때 숫자가 달라 보인다.
                    Slider(
                        value: Binding(
                            get: { Double(volumePercent) },
                            set: { volumePercent = Int($0.rounded()) }
                        ),
                        in: 10...100,
                        step: 10
                    )
                    .tint(theme.palette.primary)
                }
                .padding(.vertical, 12)

                AlarmSettingDivider()

                Toggle("끌 때까지 반복", isOn: $repeatVoice)
                    .alarmTalkSwitch()
                    .padding(.vertical, 12)
            }
        }
    }
}

// MARK: - 공용 라디오 행

struct RadioRow: View {
    // ⚠ **`LocalizedStringKey` 로 바꾸지 말 것.** 이 행은 진동 `displayName` 처럼
    // **이미 번역된** 문자열도 받는다 — 키로 받으면 번역 결과를 한 번 더 조회한다.
    // 라벨은 넘기는 쪽에서 `String(localized:)` 로 확정해 온다.
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
