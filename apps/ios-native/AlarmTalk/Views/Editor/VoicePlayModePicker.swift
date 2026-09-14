import SwiftUI

/// 재생 방식 선택 — **목소리 / 알람** 두 칸 세그먼트.
///
/// 안드로이드 `ui/editor/AlarmEditorControls.kt` 의 `PlayModeSelector` 대응.
/// 선택 표시는 배경 하나가 **미끄러져 옮겨간다**(`matchedGeometryEffect`).
/// 선택지가 둘일 때 카드 두 장은 세로 공간을 두 배로 쓰면서 '둘 중 하나' 라는 사실은
/// 오히려 덜 드러난다 — 트랙 안에서 움직이면 배타 선택이 형태로 보인다.
///
/// ⚠ **아래에 설명 문구를 다시 넣지 말 것.** 안드로이드 `PlayModeCard` 는 제목과 세그먼트
/// 둘뿐이다. '목소리'/'알람' 이라는 라벨이 이미 무엇인지 말하고, 고른 쪽 설명 한 줄은
/// 길이가 달라 한 줄↔두 줄로 바뀌며 아래 카드 전체를 밀어 올렸다.
///
/// ⚠ **모서리는 캡슐이 아니다.** 트랙은 `vocaButton`(18 = `WakerButtonShape`), 칸은
/// `small`(14 = `WakerChipShape`) — 안드로이드와 같은 값이다. 캡슐로 두면 같은 세그먼트가
/// 두 앱에서 다른 모양이 된다.
///
/// ⚠ 모드는 둘뿐이다. '알람 + 목소리' 를 되살리지 말 것 — 이유는 `AlarmPlayMode` 주석 참조.
struct VoicePlayModePicker: View {
    @Binding var mode: AlarmPlayMode
    var voiceLocked: Bool = false
    var onLockedVoiceClick: () -> Void = {}

    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var thumbNamespace

    var body: some View {
        HStack(spacing: 4) {
            ForEach(AlarmPlayMode.pickerCases) { option in
                segment(for: option)
            }
        }
        .padding(4)
        .background(
            trackShape.fill(theme.palette.surfaceVariant.opacity(0.44))
        )
        .overlay(
            trackShape.stroke(theme.palette.outlineVariant.opacity(0.62), lineWidth: 1)
        )
    }

    private var trackShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
    }

    private var segmentShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: theme.shapes.small, style: .continuous)
    }

    @ViewBuilder
    private func segment(for option: AlarmPlayMode) -> some View {
        let selected = option == mode
        let locked = voiceLocked && option != .alarmOnly
        Button {
            commit(option)
        } label: {
            // ⚠ **아이콘을 넣지 말 것.** 안드로이드 `PlayModeChip` 은 글자만 둔다 —
            // '목소리'/'알람' 이라는 말이 이미 무엇인지 다 말하고, 아이콘을 붙이면
            // 좁은 화면에서 글자가 먼저 줄어든다.
            Text(option.label)
                .font(theme.typography.labelLarge)
                .fontWeight(.semibold)
                // 색도 안드로이드와 같은 역할을 쓴다: 선택 `onPrimaryContainer`,
                // 잠긴 미선택 `onSurfaceVariant`, 그냥 미선택은 **`onSurface`** 다.
                // (미선택을 흐린 색으로 두면 안 고른 쪽이 비활성처럼 보인다.)
                .foregroundStyle(
                    selected ? theme.palette.onPrimaryContainer
                        : (locked ? theme.palette.onSurfaceVariant : theme.palette.onSurface)
                )
                .lineLimit(1)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 10)
                .padding(.vertical, theme.spacing.sm)
                .overlay(alignment: .topTrailing) {
                    if locked && !selected {
                        // 잠금 표시는 **공용 배지 하나**로 그린다 — 생 `lock.fill` 을 손으로
                        // 그리면 화면마다 크기·배경이 달라진다(안드로이드 `FeatureLockBadge`).
                        // 위치도 안드로이드와 같은 우상단 겹침이다 — 글자 옆에 끼우면
                        // 라벨이 밀려 두 칸의 글자 중심이 어긋난다.
                        FeatureLockBadge(size: 18, iconSize: 10)
                    }
                }
                .background {
                    if selected {
                        // 배경 하나가 두 칸 사이를 옮겨 다닌다.
                        segmentShape
                            .fill(theme.palette.primaryContainer)
                            .overlay(
                                segmentShape
                                    .stroke(theme.palette.primary.opacity(0.42), lineWidth: 1)
                            )
                            .matchedGeometryEffect(id: "playModeThumb", in: thumbNamespace)
                    }
                }
                .contentShape(segmentShape)
        }
        .buttonStyle(.plain)
        .opacity(locked && !selected ? 0.62 : 1)
        .accessibilityLabel(Text("재생 방식 \(option.label)"))
        .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
    }

    private func commit(_ option: AlarmPlayMode) {
        guard option != mode else { return }
        if voiceLocked && option != .alarmOnly {
            onLockedVoiceClick()
            return
        }
        // 모션을 줄인 사용자에게는 미끄러짐 없이 즉시 전환한다.
        if reduceMotion {
            mode = option
        } else {
            withAnimation(.snappy(duration: 0.28)) { mode = option }
        }
        UISelectionFeedbackGenerator().selectionChanged()
    }
}

// MARK: - Preview

#if DEBUG
private struct PlayModePickerPreviewHost: View {
    @State private var mode: AlarmPlayMode = .alarmOnly
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("선택: \(mode.label)")
            VoicePlayModePicker(mode: $mode)
        }
        .padding(20)
    }
}

#Preview("VoicePlayModePicker — light") {
    AlarmTalkThemeProvider { PlayModePickerPreviewHost() }
}

#Preview("VoicePlayModePicker — dark") {
    AlarmTalkThemeProvider { PlayModePickerPreviewHost() }
        .preferredColorScheme(.dark)
}
#endif
